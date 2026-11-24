"""OpenRouter AI provider implementation."""

import json
import logging
import os
from collections.abc import Iterator

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


class OpenRouterAuthenticationError(RuntimeError):
    """Raised when OpenRouter rejects the configured API key."""


class OpenRouterProvider(AIProvider):
    """OpenAI-compatible OpenRouter client restricted to free models."""

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
            return candidates

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
                timeout=(5, 35),
            )
            if response.status_code == 401:
                raise OpenRouterAuthenticationError(
                    "OpenRouter rejected OPENROUTER_API_KEY (HTTP 401). "
                    "Create a fresh key at https://openrouter.ai/keys and update "
                    "OPENROUTER_API_KEY in the Render service environment."
                )
            if not response.ok:
                body = response.text[:300].replace("\n", " ")
                raise RuntimeError(
                    f"HTTP {response.status_code}: {body}"
                )

            return self._response_content(response.json())

        def try_models(candidates: list[str]) -> str | None:
            for model in candidates:
                try:
                    token_budget = initial_budget
                    for attempt in range(2):
                        content, truncated = request_model(model, token_budget)
                        if not truncated:
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

                        failures.append(
                            f"{model} -> response still reached the {token_budget}-token output limit"
                        )
                        break
                except OpenRouterAuthenticationError:
                    # Authentication is shared across all models. Retrying other
                    # model IDs cannot recover from an invalid or revoked API key.
                    raise
                except Exception as exc:
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
                    timeout=(5, 35),
                    stream=True,
                )
                try:
                    if response.status_code == 401:
                        raise OpenRouterAuthenticationError(
                            "OpenRouter rejected OPENROUTER_API_KEY (HTTP 401)."
                        )
                    if not response.ok:
                        raise RuntimeError(f"HTTP {response.status_code}")

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
                        return
                    raise RuntimeError("OpenRouter stream contained no text")
                finally:
                    close = getattr(response, "close", None)
                    if callable(close):
                        close()
            except OpenRouterAuthenticationError:
                raise
            except Exception as exc:
                if emitted:
                    raise
                failures.append(f"{model}: {exc}")

        raise RuntimeError(
            "All verified free OpenRouter streams failed"
            + (": " + failures[-1] if failures else "")
        )

    def is_available(self) -> bool:
        return bool(self.api_key.strip() and self._configured_model())
