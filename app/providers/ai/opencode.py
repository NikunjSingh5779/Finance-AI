"""OpenCode Zen AI provider."""

import logging
import os
import json
from collections.abc import Iterator
from typing import Any

import requests

from .base import (
    AIProvider,
    configured_free_routes,
    expanded_output_token_limit,
    get_output_token_limit,
    require_free_route,
)

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

    def _require_free_model(self) -> None:
        require_free_route(
            self.model,
            allowlist_env="OPENCODE_FREE_MODELS",
            provider_name="OpenCode",
        )

    def generate_response(self, prompt: str) -> str:
        self._require_free_model()
        token_budget = get_output_token_limit("OPENCODE_MAX_OUTPUT_TOKENS")

        for attempt in range(2):
            payload = {
                "model": self.model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": token_budget,
                "temperature": 0.7,
            }
            response = self.session.post(
                f"{self.base_url}/chat/completions",
                json=payload,
                timeout=(5, 35),
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
            if not choices:
                raise RuntimeError("OpenCode returned no completion choices")

            choice = choices[0]
            content = choice.get("message", {}).get("content", "")
            if not isinstance(content, str) or not content.strip():
                raise RuntimeError("OpenCode returned an empty response")

            finish_reason = str(choice.get("finish_reason") or "").lower()
            truncated = finish_reason in {"length", "max_tokens"}
            if not truncated:
                return content.strip()

            retry_budget = expanded_output_token_limit(token_budget)
            if attempt == 0 and retry_budget > token_budget:
                logger.warning(
                    "OpenCode response reached %s tokens; retrying with %s",
                    token_budget,
                    retry_budget,
                )
                token_budget = retry_budget
                continue

            raise RuntimeError(
                f"OpenCode response exceeded the {token_budget}-token output limit after retry"
            )

        raise RuntimeError("OpenCode could not produce a complete response")

    def stream_response(self, prompt: str) -> Iterator[str]:
        """Yield OpenAI-compatible SSE deltas from an explicitly free model."""
        self._require_free_model()
        response = self.session.post(
            f"{self.base_url}/chat/completions",
            json={
                "model": self.model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": get_output_token_limit("OPENCODE_MAX_OUTPUT_TOKENS"),
                "temperature": 0.7,
                "stream": True,
            },
            timeout=(5, 35),
            stream=True,
        )
        try:
            if not response.ok:
                raise RuntimeError(
                    f"OpenCode returned HTTP {response.status_code}: "
                    f"{response.text[:300]}"
                )

            emitted = False
            for raw_line in response.iter_lines(decode_unicode=True):
                line = raw_line.decode("utf-8") if isinstance(raw_line, bytes) else raw_line
                if not line or not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    return
                try:
                    data: dict[str, Any] = json.loads(payload)
                except (TypeError, ValueError):
                    continue
                choices = data.get("choices") or []
                if not choices:
                    continue
                choice = choices[0]
                delta = (choice.get("delta") or {}).get("content", "")
                if isinstance(delta, str) and delta:
                    emitted = True
                    yield delta
                if str(choice.get("finish_reason") or "").lower() in {"length", "max_tokens"}:
                    raise RuntimeError("OpenCode streamed a truncated response")

            if not emitted:
                raise RuntimeError("OpenCode stream contained no text")
        finally:
            close = getattr(response, "close", None)
            if callable(close):
                close()

    def is_available(self) -> bool:
        return bool(
            self.api_key.strip()
            and self.model in configured_free_routes("OPENCODE_FREE_MODELS")
        )
