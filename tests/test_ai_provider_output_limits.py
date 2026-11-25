"""Regression tests for output-budget helpers and uncapped OpenRouter requests."""

import json

import pytest

from app.providers.ai.base import (
    DEFAULT_OUTPUT_TOKENS,
    expanded_output_token_limit,
    get_output_token_limit,
)
from app.providers.ai.openrouter import OpenRouterProvider


class FakeResponse:
    def __init__(self, payload, status_code=200, text=""):
        self._payload = payload
        self.status_code = status_code
        self.ok = 200 <= status_code < 300
        self.text = text
        self.headers = {}

    def json(self):
        return self._payload

    def iter_content(self, chunk_size=1024):
        body = self.text.encode("utf-8") if self.text else json.dumps(
            self._payload
        ).encode("utf-8")
        for offset in range(0, len(body), chunk_size):
            yield body[offset:offset + chunk_size]

    def close(self):
        return None


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.payloads = []
        self.headers = {}

    def post(self, url, json, timeout, **kwargs):
        self.payloads.append(json)
        return self.responses.pop(0)


def completion(content, finish_reason):
    return {
        "choices": [
            {
                "message": {"content": content},
                "finish_reason": finish_reason,
            }
        ]
    }


def test_output_budget_helpers_remain_bounded():
    assert get_output_token_limit("TEST_OUTPUT_TOKENS") == DEFAULT_OUTPUT_TOKENS
    assert expanded_output_token_limit(2048) == 4096


def test_openrouter_does_not_send_an_application_token_cap(monkeypatch):
    monkeypatch.setenv("OPENROUTER_MAX_OUTPUT_TOKENS", "2048")
    monkeypatch.setenv("OPENROUTER_MODEL", "test/free")
    monkeypatch.setenv("OPENROUTER_FREE_MODELS", "test/free")
    provider = OpenRouterProvider("test-key")
    provider.available_models = []
    provider._pricing_metadata_available = False
    provider.session = FakeSession([
        FakeResponse(completion("Complete answer.", "stop")),
    ])

    result = provider.generate_response("Explain a monthly budget.")

    assert result == "Complete answer."
    assert len(provider.session.payloads) == 1
    assert "max_tokens" not in provider.session.payloads[0]


def test_openrouter_stops_model_fallback_after_unauthorized_response(monkeypatch):
    monkeypatch.setenv("OPENROUTER_MODEL", "openrouter/free")
    monkeypatch.setenv("OPENROUTER_FREE_MODELS", "openrouter/free")
    provider = OpenRouterProvider("test-key")
    provider.available_models = ["google/lyria-3-clip-preview"]
    provider._pricing_metadata_available = False
    provider.session = FakeSession([
        FakeResponse(
            {},
            status_code=401,
            text='{"error":{"message":"User not found.","code":401}}',
        ),
    ])

    with pytest.raises(
        RuntimeError,
        match="Create a fresh key.*OPENROUTER_API_KEY",
    ):
        provider.generate_response("Explain a monthly budget.")

    assert len(provider.session.payloads) == 1
    assert provider.session.payloads[0]["model"] == "openrouter/free"
