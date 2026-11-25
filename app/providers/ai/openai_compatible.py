"""Shared bounded client for OpenAI-compatible hosted inference APIs."""

from __future__ import annotations

import email.utils
import json
import logging
import os
import time
from collections.abc import Iterator
from datetime import timezone
from typing import Any

import requests

from .base import AIProvider, FreeModelConfigurationError

logger = logging.getLogger(__name__)


class CompatibleAuthenticationError(RuntimeError):
    """Raised when a provider rejects the configured API credential."""


class CompatibleUpstreamError(RuntimeError):
    """An upstream HTTP failure with retry metadata."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        retry_after: str | None = None,
    ):
        super().__init__(message)
        self.status_code = status_code
        self.retry_after = retry_after


class OpenAICompatibleProvider(AIProvider):
    """Bounded OpenAI Chat Completions client with free-model-only routing.

    Providers supply an explicit allowlist of models. The client never
    discovers arbitrary models or sends an output-token limit. It rotates
    through only the allowlisted IDs when an upstream model is unavailable.
    """

    supports_streaming = True

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        model: str,
        allowed_models: tuple[str, ...],
        provider_name: str,
    ):
        self.api_key = api_key.strip()
        self.base_url = base_url.rstrip("/")
        self.model = model.strip()
        self.allowed_models = tuple(dict.fromkeys(allowed_models))
        self.provider_name = provider_name
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            }
        )
        self._cooldowns: dict[str, float] = {}
        self._rotation_index = 0

    @staticmethod
    def _deadline() -> float:
        try:
            configured = int(
                os.getenv("AI_PROVIDER_ATTEMPT_TIMEOUT_SECONDS", "60")
            )
        except (TypeError, ValueError):
            configured = 60
        budget = max(5, min(configured, 80))
        return time.monotonic() + max(3, min(budget - 8, 50))

    @staticmethod
    def _timeout(remaining: float) -> tuple[float, float]:
        if remaining < 2.5:
            raise TimeoutError("AI provider attempt budget exhausted")
        connect = min(2.0, max(1.0, remaining * 0.2))
        read = min(5.0, max(1.0, remaining - connect - 0.5))
        return connect, read

    @staticmethod
    def _retry_after_seconds(value: str | None) -> int | None:
        if not value:
            return None
        try:
            return max(0, int(float(value)))
        except (TypeError, ValueError):
            try:
                retry_at = email.utils.parsedate_to_datetime(value)
                if retry_at.tzinfo is None:
                    retry_at = retry_at.replace(tzinfo=timezone.utc)
                return max(0, int(retry_at.timestamp() - time.time()))
            except (TypeError, ValueError, OverflowError):
                return None

    def _candidate_models(self) -> list[str]:
        if not self.model or self.model not in self.allowed_models:
            raise FreeModelConfigurationError(
                f"{self.provider_name} model {self.model!r} is not in its "
                "explicit free-model allowlist."
            )

        now = time.monotonic()
        self._cooldowns = {
            model: until
            for model, until in self._cooldowns.items()
            if until > now
        }
        available = [
            model for model in self.allowed_models
            if self._cooldowns.get(model, 0.0) <= now
        ]
        if not available:
            # Probe only the model whose cooldown expires first.
            return [
                min(
                    self.allowed_models,
                    key=lambda model: self._cooldowns.get(model, 0.0),
                )
            ]

        fallbacks = [model for model in available if model != self.model]
        if fallbacks:
            offset = self._rotation_index % len(fallbacks)
            self._rotation_index += 1
            fallbacks = fallbacks[offset:] + fallbacks[:offset]
        return ([self.model] if self.model in available else []) + fallbacks

    def _cooldown(self, model: str, error: Exception) -> None:
        status = getattr(error, "status_code", None)
        retry_after = self._retry_after_seconds(
            getattr(error, "retry_after", None)
        )
        if status == 429:
            seconds = max(30, min(retry_after or 120, 300))
        elif isinstance(error, requests.exceptions.Timeout):
            seconds = 90
        elif status is not None and status >= 500:
            seconds = 45
        else:
            seconds = 30
        self._cooldowns[model] = time.monotonic() + seconds
        logger.warning(
            "%s model %s placed in a %ss cooldown after upstream failure",
            self.provider_name,
            model,
            seconds,
        )

    @staticmethod
    def _read_json_response(response, deadline: float) -> dict[str, Any]:
        body = bytearray()
        for chunk in response.iter_content(chunk_size=1024):
            if time.monotonic() >= deadline:
                raise TimeoutError(
                    "AI provider response exceeded its wall-clock deadline"
                )
            if chunk:
                body.extend(chunk)
        if time.monotonic() >= deadline:
            raise TimeoutError(
                "AI provider response exceeded its wall-clock deadline"
            )
        if not body:
            raise RuntimeError("AI provider returned an empty response body")
        return json.loads(body)

    @staticmethod
    def _content(payload: dict[str, Any]) -> tuple[str, bool]:
        choices = payload.get("choices") or []
        if not choices:
            raise RuntimeError("AI provider returned no completion choices")
        choice = choices[0]
        message = choice.get("message") or {}
        content = message.get("content", "")
        if isinstance(content, list):
            content = "\\n".join(
                item.get("text", "")
                for item in content
                if isinstance(item, dict) and item.get("type") in {"text", "output_text"}
            )
        if not isinstance(content, str) or not content.strip():
            raise RuntimeError("AI provider returned an empty response")
        finish = str(choice.get("finish_reason") or "").lower()
        return content.strip(), finish in {"length", "max_tokens"}

    def _check_response(self, response) -> None:
        if response.status_code in {401, 403}:
            raise CompatibleAuthenticationError(
                f"{self.provider_name} rejected its API key "
                f"(HTTP {response.status_code}). Check the provider key."
            )
        if not response.ok:
            raise CompatibleUpstreamError(
                f"HTTP {response.status_code}: {response.text[:250]}",
                status_code=response.status_code,
                retry_after=getattr(response, "headers", {}).get("Retry-After"),
            )

    def _post(self, model: str, prompt: str, deadline: float, *, stream: bool):
        return self.session.post(
            f"{self.base_url}/chat/completions",
            json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.2,
                "stream": stream,
            },
            timeout=self._timeout(deadline - time.monotonic()),
            stream=True,
        )

    def is_available(self) -> bool:
        return bool(
            self.api_key
            and self.model
            and self.model in self.allowed_models
        )

    def generate_response(self, prompt: str) -> str:
        deadline = self._deadline()
        failures: list[str] = []
        for model in self._candidate_models():
            if deadline - time.monotonic() < 2.5:
                break
            response = None
            try:
                response = self._post(model, prompt, deadline, stream=False)
                self._check_response(response)
                payload = self._read_json_response(response, deadline)
                content, truncated = self._content(payload)
                if truncated:
                    raise RuntimeError(
                        "model ended at its own output boundary"
                    )
                self._cooldowns.pop(model, None)
                return content
            except CompatibleAuthenticationError:
                raise
            except Exception as exc:
                self._cooldown(model, exc)
                logger.warning(
                    "%s model %s failed: %s",
                    self.provider_name,
                    model,
                    exc,
                )
                failures.append(f"{model}: {type(exc).__name__}")
            finally:
                close = getattr(response, "close", None)
                if callable(close):
                    close()

        detail = failures[-1] if failures else "attempt budget exhausted"
        raise RuntimeError(
            f"All configured free {self.provider_name} models failed: {detail}"
        )

    def stream_response(self, prompt: str) -> Iterator[str]:
        deadline = self._deadline()
        failures: list[str] = []
        for model in self._candidate_models():
            if deadline - time.monotonic() < 2.5:
                break
            response = None
            emitted = False
            try:
                response = self._post(model, prompt, deadline, stream=True)
                self._check_response(response)
                # SSE is UTF-8 by specification. requests may otherwise
                # guess ISO-8859-1 for text/event-stream responses without a
                # charset parameter, corrupting ₹ and other non-ASCII text.
                for raw_line in response.iter_lines(decode_unicode=False):
                    if time.monotonic() >= deadline:
                        raise TimeoutError(
                            "AI provider stream exceeded its wall-clock deadline"
                        )
                    line = (
                        raw_line.decode("utf-8", errors="replace")
                        if isinstance(raw_line, bytes)
                        else raw_line
                    )
                    if not line or not line.startswith("data:"):
                        continue
                    raw_payload = line[5:].strip()
                    if raw_payload == "[DONE]":
                        if emitted:
                            self._cooldowns.pop(model, None)
                            return
                        raise RuntimeError("AI provider stream contained no text")
                    try:
                        payload = json.loads(raw_payload)
                    except (TypeError, ValueError):
                        continue
                    choices = payload.get("choices") or []
                    if not choices:
                        continue
                    choice = choices[0]
                    delta = (choice.get("delta") or {}).get("content", "")
                    if isinstance(delta, str) and delta:
                        emitted = True
                        yield delta
                    finish = str(choice.get("finish_reason") or "").lower()
                    if finish in {"length", "max_tokens"}:
                        raise RuntimeError(
                            "model ended its stream at its output boundary"
                        )

                if emitted:
                    self._cooldowns.pop(model, None)
                    return
                raise RuntimeError("AI provider stream contained no text")
            except CompatibleAuthenticationError:
                raise
            except Exception as exc:
                self._cooldown(model, exc)
                logger.warning(
                    "%s model %s stream failed: %s",
                    self.provider_name,
                    model,
                    exc,
                )
                failures.append(f"{model}: {type(exc).__name__}")
                if emitted:
                    raise
            finally:
                close = getattr(response, "close", None)
                if callable(close):
                    close()

        detail = failures[-1] if failures else "attempt budget exhausted"
        raise RuntimeError(
            f"All configured free {self.provider_name} streams failed: {detail}"
        )
