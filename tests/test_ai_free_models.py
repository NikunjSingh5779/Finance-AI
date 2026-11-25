import pytest

from app.providers.ai.base import FreeModelConfigurationError
from app.providers.ai.omniroute import OmniRouteProvider
from app.providers.ai.opencode import OpenCodeProvider
from app.providers.ai.openrouter import OpenRouterProvider


class FakeResponse:
    def __init__(self, payload, *, status_code=200, text="", headers=None):
        self._payload = payload
        self.status_code = status_code
        self.ok = 200 <= status_code < 300
        self.text = text
        self.headers = headers or {}

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


def test_openrouter_official_free_router_uses_only_catalogue_verified_fallbacks(monkeypatch):
    monkeypatch.setenv("OPENROUTER_MODEL", "openrouter/free")
    monkeypatch.delenv("OPENROUTER_FREE_MODELS", raising=False)
    provider = OpenRouterProvider("test-key")

    class FreeRouterSession(RouterSession):
        def get(self, url, timeout):
            assert url.endswith("/models")
            return FakeResponse({"data": [
                {"id": "paid/model", "pricing": {"prompt": "0.001", "completion": "0.002"}},
                {"id": "verified/free-a", "pricing": {"prompt": "0", "completion": "0"}},
                {"id": "verified/free-b", "pricing": {"prompt": "0", "completion": "0"}},
            ]})

    provider.session = FreeRouterSession([])
    assert provider._free_model_candidates() == [
        "openrouter/free", "verified/free-a", "verified/free-b"
    ]


def test_openrouter_empty_free_router_completion_falls_back_to_verified_free_model(monkeypatch):
    monkeypatch.setenv("OPENROUTER_MODEL", "openrouter/free")
    provider = OpenRouterProvider("test-key")

    class FallbackSession(RouterSession):
        def get(self, url, timeout):
            return FakeResponse({"data": [
                {"id": "paid/model", "pricing": {"prompt": "0.001", "completion": "0.002"}},
                {"id": "verified/free", "pricing": {"prompt": "0", "completion": "0"}},
            ]})

        def post(self, url, json, timeout, **kwargs):
            if json["model"] == "openrouter/free":
                return FakeResponse({"choices": [{"message": {"content": ""}}]})
            assert json["model"] == "verified/free"
            return FakeResponse({"choices": [{
                "message": {"content": "Start by setting a weekly savings target."},
                "finish_reason": "stop",
            }]})

    provider.session = FallbackSession([])
    assert provider.generate_response("How can I improve savings?") == (
        "Start by setting a weekly savings target."
    )


def test_openrouter_free_router_streams_with_verified_free_catalogue_fallback(monkeypatch):
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
            return FakeResponse({"data": [
                {"id": "verified/free", "pricing": {"prompt": "0", "completion": "0"}},
            ]})

        def post(self, url, json, timeout, **kwargs):
            assert json["model"] == "openrouter/free"
            return StreamResponse()

    session = FreeRouterSession()
    provider.session = session
    assert "".join(provider.stream_response("Explain savings.")) == "Free response"
    assert session.get_calls == 1


def test_openrouter_rotates_a_larger_catalogue_of_verified_free_fallbacks(monkeypatch):
    from app.providers.ai import openrouter as openrouter_module

    monkeypatch.setenv("OPENROUTER_MODEL", "openrouter/free")
    monkeypatch.setenv("OPENROUTER_MAX_FREE_FALLBACKS", "6")
    with openrouter_module._FREE_MODEL_STATE_LOCK:
        openrouter_module._FREE_MODEL_COOLDOWNS.clear()
    monkeypatch.setattr(openrouter_module, "_FREE_MODEL_ROTATION_INDEX", 0)

    models = [
        {"id": f"verified/free-{index}", "pricing": {"prompt": "0", "completion": "0"}}
        for index in range(1, 9)
    ]
    models.append({
        "id": "paid/model",
        "pricing": {"prompt": "0.001", "completion": "0"},
    })
    provider = OpenRouterProvider("test-key")
    provider.session = RouterSession(models)

    first = provider._free_model_candidates()
    second = provider._free_model_candidates()

    assert len(first) == 7  # official router plus six catalogue fallbacks
    assert "verified/free-6" in first
    assert "paid/model" not in first
    assert first[1:] != second[1:]
    assert all(model.startswith("verified/free-") or model == "openrouter/free"
               for model in first)


def test_openrouter_rate_limited_router_is_cooled_down_for_the_next_request(monkeypatch):
    from app.providers.ai import openrouter as openrouter_module

    monkeypatch.setenv("OPENROUTER_MODEL", "openrouter/free")
    monkeypatch.delenv("OPENROUTER_MAX_FREE_FALLBACKS", raising=False)
    with openrouter_module._FREE_MODEL_STATE_LOCK:
        openrouter_module._FREE_MODEL_COOLDOWNS.clear()
    monkeypatch.setattr(openrouter_module, "_FREE_MODEL_ROTATION_INDEX", 0)

    models = [
        {"id": "verified/free-a", "pricing": {"prompt": "0", "completion": "0"}},
        {"id": "verified/free-b", "pricing": {"prompt": "0", "completion": "0"}},
    ]

    class ThrottledRouterSession(RouterSession):
        def __init__(self):
            super().__init__(models)
            self.attempted_models = []

        def post(self, url, json, timeout, **kwargs):
            model = json["model"]
            self.attempted_models.append(model)
            if model == "openrouter/free":
                return FakeResponse(
                    {},
                    status_code=429,
                    text="rate limited",
                    headers={"Retry-After": "120"},
                )
            return FakeResponse({
                "choices": [{
                    "message": {"content": "A verified free response."},
                    "finish_reason": "stop",
                }]
            })

    session = ThrottledRouterSession()
    first_provider = OpenRouterProvider("test-key")
    first_provider.session = session
    assert first_provider.generate_response("Explain savings.") == (
        "A verified free response."
    )
    assert session.attempted_models[:2] == ["openrouter/free", "verified/free-a"]

    with openrouter_module._FREE_MODEL_STATE_LOCK:
        cooldown_left = (
            openrouter_module._FREE_MODEL_COOLDOWNS["openrouter/free"]
            - __import__("time").monotonic()
        )
    assert 110 <= cooldown_left <= 120

    attempted_before_second_request = len(session.attempted_models)
    second_provider = OpenRouterProvider("test-key")
    second_provider.session = session
    assert second_provider.generate_response("Explain an emergency fund.") == (
        "A verified free response."
    )
    second_attempts = session.attempted_models[attempted_before_second_request:]
    assert second_attempts
    assert "openrouter/free" not in second_attempts
