import pytest

from app.providers.ai.base import FreeModelConfigurationError
from app.providers.ai.omniroute import OmniRouteProvider
from app.providers.ai.opencode import OpenCodeProvider
from app.providers.ai.openrouter import OpenRouterProvider


class FakeResponse:
    def __init__(self, payload, *, status_code=200, text=""):
        self._payload = payload
        self.status_code = status_code
        self.ok = 200 <= status_code < 300
        self.text = text

    def json(self):
        return self._payload


class RouterSession:
    def __init__(self, models, response=None):
        self.models = models
        self.response = response or FakeResponse(
            {
                "choices": [
                    {
                        "message": {"content": "Verified free reply."},
                        "finish_reason": "stop",
                    }
                ]
            }
        )
        self.headers = {}
        self.posts = []

    def get(self, url, timeout):
        return FakeResponse({"data": self.models})

    def post(self, url, json, timeout, **kwargs):
        self.posts.append((url, json, kwargs))
        return self.response


def test_openrouter_rejects_paid_configured_model_before_generation_or_stream(monkeypatch):
    monkeypatch.setenv("OPENROUTER_MODEL", "paid/model")
    provider = OpenRouterProvider("test-key")
    session = RouterSession(
        [
            {
                "id": "paid/model",
                "pricing": {"prompt": "0.001", "completion": "0.002"},
            }
        ]
    )
    provider.session = session

    with pytest.raises(FreeModelConfigurationError, match="pricing metadata"):
        provider.generate_response("Explain a budget.")
    with pytest.raises(FreeModelConfigurationError, match="pricing metadata"):
        list(provider.stream_response("Explain a budget."))

    assert session.posts == []


def test_openrouter_accepts_currently_zero_priced_model(monkeypatch):
    monkeypatch.setenv("OPENROUTER_MODEL", "verified/free")
    monkeypatch.delenv("OPENROUTER_FREE_MODELS", raising=False)
    provider = OpenRouterProvider("test-key")
    session = RouterSession(
        [
            {
                "id": "verified/free",
                "pricing": {"prompt": "0", "completion": "0"},
            }
        ]
    )
    provider.session = session

    assert provider.generate_response("Explain a budget.") == "Verified free reply."
    assert session.posts[0][1]["model"] == "verified/free"


def test_openrouter_needs_exact_allowlist_when_pricing_cannot_be_checked(monkeypatch):
    monkeypatch.setenv("OPENROUTER_MODEL", "gateway/free-route")
    monkeypatch.delenv("OPENROUTER_FREE_MODELS", raising=False)
    provider = OpenRouterProvider("test-key")

    class UnavailableMetadataSession(RouterSession):
        def get(self, url, timeout):
            return FakeResponse({}, status_code=503)

    provider.session = UnavailableMetadataSession([])

    with pytest.raises(FreeModelConfigurationError, match="OPENROUTER_FREE_MODELS"):
        provider.generate_response("Explain a budget.")


def test_opencode_and_omniroute_fail_closed_without_exact_free_allowlists(monkeypatch):
    monkeypatch.delenv("OPENCODE_FREE_MODELS", raising=False)
    opencode = OpenCodeProvider("test-key")
    assert not opencode.is_available()
    with pytest.raises(FreeModelConfigurationError):
        opencode.generate_response("Explain a budget.")
    with pytest.raises(FreeModelConfigurationError):
        list(opencode.stream_response("Explain a budget."))

    monkeypatch.delenv("OMNIROUTE_FREE_COMBOS", raising=False)
    omniroute = OmniRouteProvider("test-key", "https://gateway.example/v1", "free-combo")
    assert not omniroute.is_available()
    with pytest.raises(FreeModelConfigurationError):
        omniroute.generate_response("Explain a budget.")
    with pytest.raises(FreeModelConfigurationError):
        list(omniroute.stream_response("Explain a budget."))


def test_openrouter_free_router_is_allowed_without_model_catalog_lookup(monkeypatch):
    monkeypatch.setenv("OPENROUTER_MODEL", "openrouter/free")
    monkeypatch.delenv("OPENROUTER_FREE_MODELS", raising=False)
    provider = OpenRouterProvider("test-key")

    class FreeRouterSession(RouterSession):
        def __init__(self):
            super().__init__([])
            self.get_calls = 0

        def get(self, url, timeout):
            self.get_calls += 1
            raise AssertionError("The dedicated free router must not need /models metadata")

    session = FreeRouterSession()
    provider.session = session

    assert provider._free_model_candidates() == ["openrouter/free"]
    assert session.get_calls == 0


def test_openrouter_free_router_streams_without_pricing_catalog_lookup(monkeypatch):
    monkeypatch.setenv("OPENROUTER_MODEL", "openrouter/free")
    monkeypatch.delenv("OPENROUTER_FREE_MODELS", raising=False)
    provider = OpenRouterProvider("test-key")

    class StreamResponse(FakeResponse):
        def __init__(self):
            super().__init__({}, status_code=200)
            self.closed = False

        def iter_lines(self, decode_unicode=True):
            yield 'data: {"choices":[{"delta":{"content":"Free "},"finish_reason":null}]}'
            yield 'data: {"choices":[{"delta":{"content":"response"},"finish_reason":null}]}'
            yield "data: [DONE]"

        def close(self):
            self.closed = True

    class FreeRouterSession(RouterSession):
        def __init__(self):
            super().__init__([])
            self.get_calls = 0

        def get(self, url, timeout):
            self.get_calls += 1
            raise AssertionError("The dedicated free router must not need /models metadata")

        def post(self, url, json, timeout, **kwargs):
            assert json["model"] == "openrouter/free"
            return StreamResponse()

    session = FreeRouterSession()
    provider.session = session
    assert "".join(provider.stream_response("Explain savings.")) == "Free response"
    assert session.get_calls == 0
