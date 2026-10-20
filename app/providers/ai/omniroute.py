"""OmniRoute AI provider implementation.

FinanceAI uses OmniRoute's OpenAI Responses endpoint so the gateway can route
requests to the exact combo configured by the user.
"""

import logging
import os
from urllib.parse import urlsplit, urlunsplit

import requests

from .base import AIProvider

logger = logging.getLogger(__name__)


def _normalize_v1_base_url(value: str) -> str:
    """Normalize an OmniRoute URL to its /v1 API root.

    Accepts:
      http://localhost:20128
      http://localhost:20128/v1
      http://localhost:20128/v1/responses
    """
    raw = (value or "").strip().rstrip("/")
    if not raw:
        return "http://127.0.0.1:20128/v1"

    parts = urlsplit(raw)
    path = parts.path.rstrip("/")

    for suffix in ("/responses", "/chat/completions"):
        if path.endswith(suffix):
            path = path[: -len(suffix)].rstrip("/")

    if path.endswith("/v1"):
        return urlunsplit((parts.scheme, parts.netloc, path, "", ""))

    return urlunsplit((parts.scheme, parts.netloc, path + "/v1", "", ""))


class OmniRouteProvider(AIProvider):
    """OpenAI Responses-compatible OmniRoute client.

    Only the explicitly configured combo/model name is sent to OmniRoute.
    Automatic model discovery is intentionally not used for generation.
    """

    def __init__(self, api_key: str, base_url: str, combo_name: str):
        self.api_key = api_key.strip()
        self.base_url = _normalize_v1_base_url(base_url)
        self.combo_name = combo_name.strip()
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            }
        )

    @property
    def responses_url(self) -> str:
        return f"{self.base_url}/responses"

    def generate_response(self, prompt: str) -> str:
        if not self.combo_name:
            raise RuntimeError(
                "OMNIROUTE_COMBO_NAME (or OMNIROUTE_MODEL) must contain "
                "the exact OmniRoute combo name"
            )

        # FinanceAI is intentionally concise. Low reasoning plus a smaller
        # output budget reduces latency while preserving enough room for the
        # compact Summary/Key points/Next step response format.
        reasoning_effort = os.getenv(
            "OMNIROUTE_REASONING_EFFORT", "low"
        ).strip().lower()

        payload = {
            "model": self.combo_name,
            "input": prompt,
            "stream": False,
            "max_output_tokens": 512,
        }
        if reasoning_effort in {"none", "minimal", "low", "medium", "high", "max"}:
            payload["reasoning"] = {"effort": reasoning_effort}

        response = self.session.post(
            self.responses_url,
            json=payload,
            timeout=45,
        )

        if not response.ok:
            raise RuntimeError(
                f"OmniRoute returned HTTP {response.status_code}: "
                f"{response.text[:500]}"
            )

        try:
            data = response.json()
        except ValueError as exc:
            raise RuntimeError("OmniRoute returned invalid JSON") from exc

        output_text = data.get("output_text")
        if isinstance(output_text, str) and output_text.strip():
            return output_text.strip()

        chunks: list[str] = []
        for item in data.get("output") or []:
            for content in item.get("content") or []:
                text = content.get("text")
                if isinstance(text, str) and text.strip():
                    chunks.append(text.strip())

        if chunks:
            return "\n".join(chunks)

        raise RuntimeError(
            "OmniRoute returned a Responses payload without usable output"
        )

    def is_available(self) -> bool:
        # Availability is configuration-based here. Some OmniRoute deployments
        # intentionally expose /v1/responses without a /v1/models endpoint.
        # The actual Responses request remains the authoritative health check,
        # and AIService will fall back if that request fails.
        return bool(self.api_key and self.combo_name and self.responses_url)
