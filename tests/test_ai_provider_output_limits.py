import pytest

from app.providers.ai.base import (
    expanded_output_token_limit,
    get_output_token_limit,
)
from app.providers.ai.omniroute import OmniRouteProvider
from app.providers.ai.opencode import OpenCodeProvider
from app.providers.ai.openrouter import OpenRouterProvider


class FakeResponse:
    def __init__(self, payload, status_code=200, text=""):
        self._payload = payload
        self.status_code = status_code
        self.ok = 200 <= status_code < 300
        self.text = text

    def json(self):
        return self._payload


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.payloads = []
        self.headers = {}

    def post(self, url, json, timeout):
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


def test_output_budget_is_configurable_and_bounded(monkeypatch):
    monkeypatch.setenv("TEST_OUTPUT_TOKENS", "3072")
    assert get_output_token_limit("TEST_OUTPUT_TOKENS") == 3072
    assert expanded_output_token_limit(2048) == 4096

    monkeypatch.setenv("TEST_OUTPUT_TOKENS", "not-a-number")
    assert get_output_token_limit("TEST_OUTPUT_TOKENS") == 2048

    monkeypatch.setenv("TEST_OUTPUT_TOKENS", "999999")
    assert get_output_token_limit("TEST_OUTPUT_TOKENS") == 8192


def test_openrouter_retries_when_completion_hits_token_limit(monkeypatch):
    monkeypatch.setenv("OPENROUTER_MAX_OUTPUT_TOKENS", "2048")
    provider = OpenRouterProvider("test-key")
    provider.available_models = []
    provider.session = FakeSession([
        FakeResponse(completion("Partial answer", "length")),
        FakeResponse(completion("Complete answer.", "stop")),
    ])

    result = provider.generate_response("Explain a monthly budget.")

    assert result == "Complete answer."
    assert [payload["max_tokens"] for payload in provider.session.payloads] == [
        2048,
        4096,
    ]


def test_openrouter_stops_model_fallback_after_unauthorized_response(monkeypatch):
    monkeypatch.setenv("OPENROUTER_MODEL", "openrouter/free")
    provider = OpenRouterProvider("test-key")
    provider.available_models = ["google/lyria-3-clip-preview"]
    provider.session = FakeSession([
        FakeResponse(
            {},
            status_code=401,
            text='{"error":{"message":"User not found.","code":401}}',
        ),
    ])

    with pytest.raises(RuntimeError, match="Create a fresh key.*OPENROUTER_API_KEY"):
        provider.generate_response("Explain a monthly budget.")

    # A 401 invalidates the shared credential, so no fallback model is tried.
    assert len(provider.session.payloads) == 1
    assert provider.session.payloads[0]["model"] == "openrouter/free"


def test_opencode_retries_when_completion_hits_token_limit(monkeypatch):
    monkeypatch.setenv("OPENCODE_MAX_OUTPUT_TOKENS", "2048")
    provider = OpenCodeProvider("test-key")
    provider.session = FakeSession([
        FakeResponse(completion("Partial answer", "length")),
        FakeResponse(completion("Complete answer.", "stop")),
    ])

    result = provider.generate_response("Explain a monthly budget.")

    assert result == "Complete answer."
    assert [payload["max_tokens"] for payload in provider.session.payloads] == [
        2048,
        4096,
    ]


def test_omniroute_retries_when_response_is_incomplete(monkeypatch):
    monkeypatch.setenv("OMNIROUTE_MAX_OUTPUT_TOKENS", "2048")
    provider = OmniRouteProvider("test-key", "http://localhost:20128/v1", "free-combo")
    provider.session = FakeSession([
        FakeResponse({
            "status": "incomplete",
            "incomplete_details": {"reason": "max_output_tokens"},
            "output_text": "Partial answer",
        }),
        FakeResponse({
            "status": "completed",
            "output_text": "Complete answer.",
        }),
    ])

    result = provider.generate_response("Explain a monthly budget.")

    assert result == "Complete answer."
    assert [
        payload["max_output_tokens"] for payload in provider.session.payloads
    ] == [2048, 4096]


def test_opencode_fails_clearly_when_retry_is_still_truncated(monkeypatch):
    monkeypatch.setenv("OPENCODE_MAX_OUTPUT_TOKENS", "2048")
    provider = OpenCodeProvider("test-key")
    provider.session = FakeSession([
        FakeResponse(completion("Partial answer", "length")),
        FakeResponse(completion("Still partial", "length")),
    ])

    with pytest.raises(RuntimeError, match="after retry"):
        provider.generate_response("Explain a monthly budget.")
