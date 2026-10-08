"""OpenRouter AI provider implementation."""

import logging
import os

import requests

from .base import AIProvider

logger = logging.getLogger(__name__)


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
        self.available_models = self._discover_models()

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

        # Prefer the explicitly configured model. The OpenRouter free router
        # then provides a reliable free fallback before individual free models.
        if configured_model != "openrouter/free":
            models.append("openrouter/free")

        for model in self.available_models:
            if model not in models:
                models.append(model)

        failures = []
        for model in models:
            try:
                response = self.session.post(
                    f"{self.base_url}/chat/completions",
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": prompt}],
                        "max_tokens": 1024,
                        "temperature": 0.7,
                    },
                    timeout=30,
                )
                if not response.ok:
                    body = response.text[:300].replace("\n", " ")
                    failures.append(
                        f"{model} -> HTTP {response.status_code}: {body}"
                    )
                    continue
                data = response.json()
                choices = data.get("choices") or []
                if choices:
                    content = choices[0].get("message", {}).get("content", "")
                    if isinstance(content, str) and content.strip():
                        return content.strip()
            except Exception as exc:
                logger.warning(
                    "OpenRouter model %s failed: %s",
                    model,
                    exc,
                )
        raise RuntimeError(
            "All configured OpenRouter models failed"
            + (": " + failures[-1] if failures else "")
        )

    def is_available(self) -> bool:
        if not self.api_key:
            return False
        try:
            response = self.session.get(
                f"{self.base_url}/models",
                timeout=5,
            )
            return response.ok
        except Exception:
            return False
