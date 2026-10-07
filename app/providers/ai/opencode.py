"""OpenCode Zen AI provider."""

import logging
import os
from typing import Any

import requests

from .base import AIProvider

logger = logging.getLogger(__name__)


class OpenCodeProvider(AIProvider):
    """OpenAI-compatible OpenCode Zen client.

    The base URL is configurable because OpenCode also exposes other
    inference endpoints. The default follows the current Zen chat-completions
    endpoint.
    """

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = os.getenv(
            "OPENCODE_BASE_URL",
            "https://opencode.ai/zen/v1",
        ).rstrip("/")
        self.model = os.getenv("OPENCODE_MODEL", "mimo-v2.6-flash-free")
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        })

    def generate_response(self, prompt: str) -> str:
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 1024,
            "temperature": 0.7,
        }
        response = self.session.post(
            f"{self.base_url}/chat/completions",
            json=payload,
            timeout=45,
        )
        if not response.ok:
            raise RuntimeError(
                f"OpenCode returned HTTP {response.status_code}: "
                f"{response.text[:300]}"
            )

        try:
            data: dict[str, Any] = response.json()
        except ValueError as exc:
            raise RuntimeError("OpenCode returned invalid JSON") from exc

        choices = data.get("choices") or []
        content = (
            choices[0].get("message", {}).get("content", "")
            if choices else ""
        )
        if not isinstance(content, str) or not content.strip():
            raise RuntimeError("OpenCode returned an empty response")
        return content.strip()

    def is_available(self) -> bool:
        return bool(self.api_key.strip())
