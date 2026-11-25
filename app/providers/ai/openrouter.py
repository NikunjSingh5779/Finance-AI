"""OpenRouter AI provider implementation."""

import email.utils
import json
import logging
import os
import threading
import time
from collections.abc import Iterator
from datetime import timezone

import requests

from .base import (
    AIProvider,
    FreeModelConfigurationError,
    configured_free_routes,
    expanded_output_token_limit,
    get_output_token_limit,
    require_free_route,
)

logger = logging.getLogger(__name__)

# Process-local cooldowns prevent a rate-limited upstream model from being
# hammered by every subsequent chat request. The model catalogue is still
# checked for exact zero input AND output pricing before a model enters this pool.
_FREE_MODEL_STATE_LOCK = threading.Lock()
_FREE_MODEL_COOLDOWNS: dict[str, float] = {}
_FREE_MODEL_ROTATION_INDEX = 0


class OpenRouterAuthenticationError(RuntimeError):
    """Raised when OpenRouter rejects the configured API key."""


class OpenRouterUpstreamError(RuntimeError):
    """An upstream HTTP failure with retry metadata, when available."""

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


class OpenRouterProvider(AIProvider):
    """OpenAI-compatible OpenRouter client restricted to free models."""

    # The free-model router has unreliable SSE streaming on some routed
    # models. Use the bounded completion path instead of spending the request
    # budget on a stream that frequently closes without content.
    supports_streaming = False

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://openrouter.ai/api/v1"
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://financeai.local",
                "X-Title": "FinanceAI",
            }
        )
        self.available_models: list[str] | None = None
        self._pricing_metadata_available: bool | None = None

    def _discover_models(self) -> list[str]:
        """Return model IDs whose published prompt and completion prices are zero."""
        try:
            response = self.session.get(
                f"{self.base_url}/models",
                timeout=5,
            )
            if not response.ok:
                self._pricing_metadata_available = False
                return []

            data = response.json()
            self._pricing_metadata_available = True
            free_models: list[str] = []
            for model in data.get("data", []):
                model_id = model.get("id")
                if not model_id:
                    continue

                pricing = model.get("pricing") or {}
                try:
                    prompt_price = float(pricing["prompt"])
                    completion_price = float(pricing["completion"])
                    explicitly_free = prompt_price == 0 and completion_price == 0
                except (KeyError, TypeError, ValueError):
                    # A model name such as :free is not a pricing proof.
                    explicitly_free = False

                if explicitly_free:
                    free_models.append(model_id)

            return free_models
        except Exception as exc:
            self._pricing_metadata_available = False
            logger.warning("OpenRouter model discovery failed: %s", exc)
            return []

    @staticmethod
    def _configured_model() -> str:
        return os.getenv("OPENROUTER_MODEL", "openrouter/free").strip()

    @staticmethod
    def _max_free_fallbacks() -> int:
        try:
            configured = int(os.getenv("OPENROUTER_MAX_FREE_FALLBACKS", "10"))
        except (TypeError, ValueError):
            configured = 10
        return max(1, min(configured, 20))

    @staticmethod
    def _request_timeout() -> tuple[int, int]:
        """Keep one upstream call within the provider-attempt time budget."""
        try:
            attempt_budget = int(os.getenv("AI_PROVIDER_ATTEMPT_TIMEOUT_SECONDS", "30"))
        except (TypeError, ValueError):
            attempt_budget = 30
        read_timeout = max(5, min(attempt_budget - 5, 25))
        return (5, read_timeout)

    @staticmethod
    def _retry_after_seconds(retry_after: str | None) -> int | None:
        if not retry_after:
            return None
        try:
            return max(0, int(float(retry_after)))
        except (TypeError, ValueError):
            try:
                retry_at = email.utils.parsedate_to_datetime(retry_after)
                if retry_at.tzinfo is None:
                    retry_at = retry_at.replace(tzinfo=timezone.utc)
                return max(0, int(retry_at.timestamp() - time.time()))
            except (TypeError, ValueError, OverflowError):
                return None

    @classmethod
    def _order_free_candidates(
        cls,
        candidates: list[str],
        *,
        primary: str,
    ) -> list[str]:
        """Rotate verified free fallbacks and skip models in temporary cooldown."""
        global _FREE_MODEL_ROTATION_INDEX

        unique = list(dict.fromkeys(candidates))
        if not unique:
            return []

        now = time.monotonic()
        with _FREE_MODEL_STATE_LOCK:
            expired = [
                model for model, until in _FREE_MODEL_COOLDOWNS.items()
                if until <= now
            ]
            for model in expired:
                _FREE_MODEL_COOLDOWNS.pop(model, None)

            available = [
                model for model in unique
                if _FREE_MODEL_COOLDOWNS.get(model, 0.0) <= now
            ]
            if not available:
                # All candidates are cooling down. Probe only the one whose
                # cooldown expires first rather than flooding every provider.
                earliest = min(
                    unique,
                    key=lambda model: _FREE_MODEL_COOLDOWNS.get(model, 0.0),
                )
                return [earliest]

            fallbacks = [model for model in available if model != primary]
            if fallbacks:
                offset = _FREE_MODEL_ROTATION_INDEX % len(fallbacks)
                _FREE_MODEL_ROTATION_INDEX += 1
                fallbacks = fallbacks[offset:] + fallbacks[:offset]

            ordered = ([primary] if primary in available else []) + fallbacks
            return ordered[: cls._max_free_fallbacks() + (1 if primary in ordered else 0)]

    @staticmethod
    def _cooldown_model(model: str, error: Exception) -> None:
        """Temporarily cool down an upstream route after throttling or bad output."""
        status_code = getattr(error, "status_code", None)
        retry_after = OpenRouterProvider._retry_after_seconds(
            getattr(error, "retry_after", None)
        )
        if status_code == 429:
            duration = max(15, min(retry_after or 60, 300))
        elif isinstance(error, OpenRouterUpstreamError) and status_code and status_code >= 500:
            duration = 20
        else:
            duration = 15

        with _FREE_MODEL_STATE_LOCK:
            _FREE_MODEL_COOLDOWNS[model] = time.monotonic() + duration

        logger.warning(
            "OpenRouter model %s placed in a %ss cooldown after an upstream failure",
            model,
            duration,
        )

    @staticmethod
    def _clear_model_cooldown(model: str) -> None:
        with _FREE_MODEL_STATE_LOCK:
            _FREE_MODEL_COOLDOWNS.pop(model, None)

    def _free_model_candidates(self) -> list[str]:
        """Choose only models with a zero-price proof or exact operator opt-in.

        OPENROUTER_FREE_MODELS is an exact allowlist for routes whose price
        metadata cannot be read, for example a provider-managed free route. It
        never permits a route that fetched metadata marks as paid.
        """
        configured_model = self._configured_model()
        if not configured_model:
            raise FreeModelConfigurationError(
                "OpenRouter is disabled until OPENROUTER_MODEL names a free model."
            )

        # OpenRouter's official free-model router is a server-side alias,
        # not an ordinary model catalogue entry. It guarantees routing only
        # to eligible free models, so validating the alias against /models
        # incorrectly rejects this supported zero-cost route.
        if configured_model == "openrouter/free":
            # Try the official free router first. If it returns an empty or
            # failed completion, fall back only to catalogue models whose
            # prompt AND completion prices are explicitly zero.
            if self.available_models is None:
                self.available_models = self._discover_models()
            verified_free = self.available_models or []
            catalogue_candidates = [
                model for model in verified_free if model != configured_model
            ]
            return self._order_free_candidates(
                [configured_model, *catalogue_candidates],
                primary=configured_model,
            )

        allowlisted = configured_free_routes("OPENROUTER_FREE_MODELS")
        if self.available_models is None:
            self.available_models = self._discover_models()

        verified = set(self.available_models)
        if self._pricing_metadata_available:
            if configured_model not in verified:
                raise FreeModelConfigurationError(
                    "OpenRouter rejected the configured model because its current "
                    "pricing metadata is not zero for both input and output tokens."
                )
            candidates = [configured_model]
            # Additional fallbacks must be both explicitly selected and
            # independently verified as free.
            candidates.extend(
                model
                for model in allowlisted
                if model != configured_model and model in verified
            )
            return self._order_free_candidates(
                candidates,
                primary=configured_model,
            )

        # When pricing metadata is unavailable, use one exact operator
        # allowlist entry. Never infer free status from a model name.
        require_free_route(
            configured_model,
            allowlist_env="OPENROUTER_FREE_MODELS",
            provider_name="OpenRouter",
        )
        return [configured_model]

    @staticmethod
    def _response_content(data: dict) -> tuple[str, bool]:
        choices = data.get("choices") or []
        if not choices:
            raise RuntimeError("OpenRouter returned no completion choices")

        choice = choices[0]
        content = choice.get("message", {}).get("content", "")
        if not isinstance(content, str) or not content.strip():
            raise RuntimeError("OpenRouter returned an empty response")

        finish_reason = str(choice.get("finish_reason") or "").lower()
        return content.strip(), finish_reason in {"length", "max_tokens"}

    @staticmethod
    def _stream_delta(payload: dict) -> tuple[str, bool]:
        choices = payload.get("choices") or []
        if not choices:
            return "", False
        choice = choices[0]
        delta = choice.get("delta") or {}
        content = delta.get("content", "")
        finish_reason = str(choice.get("finish_reason") or "").lower()
        return (
            content if isinstance(content, str) else "",
            finish_reason in {"length", "max_tokens"},
        )

    def generate_response(self, prompt: str) -> str:
        models = self._free_model_candidates()
        failures: list[str] = []
        initial_budget = get_output_token_limit(
            "OPENROUTER_MAX_OUTPUT_TOKENS"
        )

        def request_model(model: str, token_budget: int) -> tuple[str, bool]:
            response = self.session.post(
                f"{self.base_url}/chat/completions",
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": token_budget,
                    "temperature": 0.7,
                },
                timeout=self._request_timeout(),
            )
            if response.status_code in {401, 403}:
                raise OpenRouterAuthenticationError(
                    "OpenRouter rejected OPENROUTER_API_KEY "
                    f"(HTTP {response.status_code}). Create a fresh key at "
                    "https://openrouter.ai/keys and update OPENROUTER_API_KEY "
                    "in the Render service environment."
                )
            if not response.ok:
                body = response.text[:300].replace("\n", " ")
                raise OpenRouterUpstreamError(
                    f"HTTP {response.status_code}: {body}",
                    status_code=response.status_code,
                    retry_after=getattr(response, "headers", {}).get("Retry-After"),
                )

            return self._response_content(response.json())

        def try_models(candidates: list[str]) -> str | None:
            for model in candidates:
                try:
                    token_budget = initial_budget
                    for attempt in range(2):
                        content, truncated = request_model(model, token_budget)
                        if not truncated:
                            self._clear_model_cooldown(model)
                            return content

                        retry_budget = expanded_output_token_limit(token_budget)
                        if attempt == 0 and retry_budget > token_budget:
                            logger.warning(
                                "OpenRouter response from %s reached %s tokens; retrying with %s",
                                model,
                                token_budget,
                                retry_budget,
                            )
                            token_budget = retry_budget
                            continue

                        truncation_error = RuntimeError(
                            f"response still reached the {token_budget}-token output limit"
                        )
                        self._cooldown_model(model, truncation_error)
                        failures.append(f"{model} -> {truncation_error}")
                        break
                except OpenRouterAuthenticationError:
                    # Authentication is shared across all models. Retrying other
                    # model IDs cannot recover from an invalid or revoked API key.
                    raise
                except Exception as exc:
                    self._cooldown_model(model, exc)
                    logger.warning("OpenRouter model %s failed: %s", model, exc)
                    failures.append(f"{model} -> {exc}")
            return None

        result = try_models(models)
        if result:
            return result

        raise RuntimeError(
            "All verified free OpenRouter models failed"
            + (": " + failures[-1] if failures else "")
        )

    def stream_response(self, prompt: str) -> Iterator[str]:
        """Stream a response only from the verified free candidate list."""
        token_budget = get_output_token_limit("OPENROUTER_MAX_OUTPUT_TOKENS")
        failures: list[str] = []

        for model in self._free_model_candidates():
            emitted = False
            try:
                response = self.session.post(
                    f"{self.base_url}/chat/completions",
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": prompt}],
                        "max_tokens": token_budget,
                        "temperature": 0.7,
                        "stream": True,
                    },
                    timeout=self._request_timeout(),
                    stream=True,
                )
                try:
                    if response.status_code in {401, 403}:
                        raise OpenRouterAuthenticationError(
                            "OpenRouter rejected OPENROUTER_API_KEY "
                            f"(HTTP {response.status_code}). Verify the key is active "
                            "and belongs to the intended OpenRouter account."
                        )
                    if not response.ok:
                        raise OpenRouterUpstreamError(
                            f"HTTP {response.status_code}",
                            status_code=response.status_code,
                            retry_after=getattr(response, "headers", {}).get("Retry-After"),
                        )

                    for raw_line in response.iter_lines(decode_unicode=True):
                        line = raw_line.decode("utf-8") if isinstance(raw_line, bytes) else raw_line
                        if not line or not line.startswith("data:"):
                            continue
                        payload = line[5:].strip()
                        if payload == "[DONE]":
                            return
                        try:
                            delta, truncated = self._stream_delta(json.loads(payload))
                        except (TypeError, ValueError):
                            continue
                        if delta:
                            emitted = True
                            yield delta
                        if truncated:
                            raise RuntimeError("OpenRouter streamed a truncated response")
                    if emitted:
                        self._clear_model_cooldown(model)
                        return
                    raise RuntimeError("OpenRouter stream contained no text")
                finally:
                    close = getattr(response, "close", None)
                    if callable(close):
                        close()
            except OpenRouterAuthenticationError:
                raise
            except Exception as exc:
                self._cooldown_model(model, exc)
                if emitted:
                    raise
                failures.append(f"{model}: {exc}")

        raise RuntimeError(
            "All verified free OpenRouter streams failed"
            + (": " + failures[-1] if failures else "")
        )

    def is_available(self) -> bool:
        return bool(self.api_key.strip() and self._configured_model())
