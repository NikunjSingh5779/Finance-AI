"""OmniRoute AI provider implementation."""

import logging
import os

import requests

from .base import AIProvider

logger = logging.getLogger(__name__)


class OmniRouteProvider(AIProvider):
    """OpenAI-compatible OmniRoute client."""

    def __init__(self, api_key: str, base_url: str):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            }
        )
        self.available_models = self._discover_models()

    def _discover_models(self) -> list[str]:
        try:
            response = self.session.get(
                f"{self.base_url}/v1/models",
                timeout=10,
            )
            if not response.ok:
                return []
            data = response.json()
            return [
                model["id"]
                for model in data.get("data", [])
                if model.get("id")
            ]
        except Exception as exc:
            logger.warning("OmniRoute model discovery failed: %s", exc)
            return []

    def generate_response(self, prompt: str) -> str:
        models = self.available_models or [
            os.getenv("OMNIROUTE_MODEL", "auto")
        ]
        for model in models:
            try:
                response = self.session.post(
                    f"{self.base_url}/v1/chat/completions",
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": prompt}],
                        "max_tokens": 1024,
                        "temperature": 0.7,
                    },
                    timeout=30,
                )
                if not response.ok:
                    continue
                data = response.json()
                choices = data.get("choices") or []
                if choices:
                    content = choices[0].get("message", {}).get("content", "")
                    if isinstance(content, str) and content.strip():
                        return content.strip()
            except Exception as exc:
                logger.warning(
                    "OmniRoute model %s failed: %s",
                    model,
                    exc,
                )
        raise RuntimeError("All configured OmniRoute models failed")

    def is_available(self) -> bool:
        if not self.api_key:
            return False
        try:
            response = self.session.get(
                f"{self.base_url}/v1/models",
                timeout=5,
            )
            return response.ok
        except Exception:
            return False
