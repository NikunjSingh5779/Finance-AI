"""OpenRouter AI provider implementation."""

import logging
import os

import requests

from .base import (
    AIProvider,
    expanded_output_token_limit,
    get_output_token_limit,
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

    def _discover_models(self) -> list[str]:
        try:
            response = self.session.get(
                f"{self.base_url}/models",
                timeout=10,
            )
            if not response.ok:
                return []

            data = response.json()
            free_models: list[str] = []
            for model in data.get("data", []):
                model_id = model.get("id")
                if not model_id:
                    continue

                pricing = model.get("pricing") or {}
                try:
                    prompt_price = float(pricing["prompt"])
                    completion_price = float(pricing["completion"])
                    explicitly_free = (
                        prompt_price == 0 and completion_price == 0
                    )
                except (KeyError, TypeError, ValueError):
                    explicitly_free = (
                        ":free" in model_id or "/free" in model_id
                    )

                if explicitly_free:
                    free_models.append(model_id)

            return free_models
        except Exception as exc:
            logger.warning("OpenRouter model discovery failed: %s", exc)
            return []

    def generate_response(self, prompt: str) -> str:
        configured_model = os.getenv("OPENROUTER_MODEL", "openrouter/free").strip()
        models = []
        if configured_model:
            models.append(configured_model)
        if configured_model != "openrouter/free":
            models.append("openrouter/free")

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
                timeout=45,
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

            data = response.json()
            choices = data.get("choices") or []
            if not choices:
                raise RuntimeError("OpenRouter returned no completion choices")

            choice = choices[0]
            content = choice.get("message", {}).get("content", "")
            if not isinstance(content, str) or not content.strip():
                raise RuntimeError("OpenRouter returned an empty response")

            finish_reason = str(choice.get("finish_reason") or "").lower()
            truncated = finish_reason in {"length", "max_tokens"}
            return content.strip(), truncated

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

        if self.available_models is None:
            self.available_models = self._discover_models()

        fallback_models = [
            model for model in self.available_models if model not in models
        ]
        result = try_models(fallback_models)
        if result:
            return result

        raise RuntimeError(
            "All configured OpenRouter models failed"
            + (": " + failures[-1] if failures else "")
        )

    def is_available(self) -> bool:
        # Configuration checks are intentionally local. Remote model discovery
        # happens lazily only when OpenRouter is actually needed.
        return bool(self.api_key.strip())
