import json
import time

import pytest

from app.providers.ai.base import FreeModelConfigurationError
from app.providers.ai.groq import GROQ_FREE_MODELS, GroqProvider
from app.providers.ai.nvidia_nim import NvidiaNimProvider
from app.providers.ai.openrouter import OpenRouterProvider


@pytest.fixture(autouse=True)
def reset_openrouter_runtime_state():
    from app.providers.ai import openrouter as openrouter_module

    with openrouter_module._FREE_MODEL_STATE_LOCK:
        openrouter_module._FREE_MODEL_COOLDOWNS.clear()
    previous_rotation = openrouter_module._FREE_MODEL_ROTATION_INDEX
    openrouter_module._FREE_MODEL_ROTATION_INDEX = 0
    yield
    with openrouter_module._FREE_MODEL_STATE_LOCK:
        openrouter_module._FREE_MODEL_COOLDOWNS.clear()
    openrouter_module._FREE_MODEL_ROTATION_INDEX = previous_rotation


class FakeResponse:
    def __init__(self, payload, *, status_code=200, text="", headers=None):
        self._payload = payload
        self.status_code = status_code
        self.ok = 200 <= status_code < 300
        self.text = text
        self.headers = headers or {}

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





class SequenceSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.posts = []
        self.headers = {}

    def post(self, url, json, timeout, **kwargs):
        self.posts.append((url, json, kwargs))
        return self.responses.pop(0)


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


def test_groq_uses_only_free_models_and_falls_back_after_rate_limit(monkeypatch):
    monkeypatch.setenv("GROQ_MODEL", GROQ_FREE_MODELS[0])
    provider = GroqProvider("test-key")
    provider.session = SequenceSession([
        FakeResponse({}, status_code=429, text="rate limited", headers={"Retry-After": "60"}),
        FakeResponse({
            "choices": [{
                "message": {"content": "Use a budget and track weekly spending."},
                "finish_reason": "stop",
            }]
        }),
    ])

    result = provider.generate_response("How should I start budgeting?")

    assert result == "Use a budget and track weekly spending."
    assert [item[1]["model"] for item in provider.session.posts] == [
        "openai/gpt-oss-120b",
        "openai/gpt-oss-20b",
    ]
    assert all("max_tokens" not in item[1] for item in provider.session.posts)
    assert provider.session.posts[0][0] == (
        "https://api.groq.com/openai/v1/chat/completions"
    )


def test_groq_rejects_models_outside_the_free_allowlist(monkeypatch):
    monkeypatch.setenv("GROQ_MODEL", "llama-3.3-70b-versatile")
    provider = GroqProvider("test-key")

    assert not provider.is_available()
    with pytest.raises(FreeModelConfigurationError, match="free-model allowlist"):
        provider.generate_response("Explain a budget.")


def test_nvidia_nim_is_blocked_in_production_without_an_enterprise_license(monkeypatch):
    monkeypatch.setenv("NVIDIA_NIM_API_KEY", "test-key")
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.delenv("NVIDIA_NIM_PRODUCTION_LICENSED", raising=False)

    provider = NvidiaNimProvider("test-key")
    assert not provider.is_available()

    monkeypatch.setenv("NVIDIA_NIM_PRODUCTION_LICENSED", "true")
    assert provider.is_available()


def test_nvidia_nim_uses_configured_chat_endpoint_without_a_token_cap(monkeypatch):
    monkeypatch.setenv("NVIDIA_NIM_MODEL", "openai/gpt-oss-20b")
    monkeypatch.setenv("NVIDIA_NIM_MODELS", "openai/gpt-oss-20b")
    monkeypatch.delenv("AUTH_REQUIRED", raising=False)
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.delenv("NVIDIA_NIM_PRODUCTION_LICENSED", raising=False)

    provider = NvidiaNimProvider("test-key")
    provider.session = SequenceSession([
        FakeResponse({
            "choices": [{
                "message": {"content": "Build an emergency fund first."},
                "finish_reason": "stop",
            }]
        })
    ])

    assert provider.generate_response("How should I start saving?") == (
        "Build an emergency fund first."
    )
    url, payload, _ = provider.session.posts[0]
    assert url == "https://integrate.api.nvidia.com/v1/chat/completions"
    assert payload["model"] == "openai/gpt-oss-20b"
    assert "max_tokens" not in payload


def test_legacy_opencode_and_omniroute_environment_keys_are_ignored(monkeypatch):
    from app.providers.ai.discovery import get_ai_providers, reset_provider_cache

    for name in (
        "NVIDIA_NIM_API_KEY",
        "GROQ_API_KEY",
        "OPENROUTER_API_KEY",
        "OPENROUTER_MODEL",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("OPENCODE_ZEN_API_KEY", "legacy-key")
    monkeypatch.setenv("OMNIROUTE_API_KEY", "legacy-key")
    providers = get_ai_providers(force_refresh=True)

    assert providers == []
    reset_provider_cache()


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
            assert "max_tokens" not in json
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


def test_openrouter_request_timeout_respects_remaining_attempt_budget(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER_ATTEMPT_TIMEOUT_SECONDS", "60")

    connect_timeout, read_timeout = OpenRouterProvider._request_timeout(4.0)

    assert connect_timeout >= 1
    assert read_timeout <= 10
    assert connect_timeout + read_timeout < 4.0
    with pytest.raises(TimeoutError, match="attempt budget exhausted"):
        OpenRouterProvider._request_timeout(2.0)


def test_openrouter_empty_router_response_is_cooled_down_across_requests(monkeypatch):
    from app.providers.ai import openrouter as openrouter_module

    monkeypatch.setenv("OPENROUTER_MODEL", "openrouter/free")
    models = [
        {"id": "verified/free", "pricing": {"prompt": "0", "completion": "0"}},
    ]

    class EmptyRouterSession(RouterSession):
        def __init__(self):
            super().__init__(models)
            self.attempted = []

        def post(self, url, json, timeout, **kwargs):
            self.attempted.append(json["model"])
            if json["model"] == "openrouter/free":
                return FakeResponse({"choices": [{"message": {"content": ""}}]})
            return FakeResponse({
                "choices": [{
                    "message": {"content": "A working free response."},
                    "finish_reason": "stop",
                }]
            })

    session = EmptyRouterSession()
    first = OpenRouterProvider("test-key")
    first.session = session
    assert first.generate_response("Explain a monthly budget.") == (
        "A working free response."
    )
    assert session.attempted[:2] == ["openrouter/free", "verified/free"]

    with openrouter_module._FREE_MODEL_STATE_LOCK:
        remaining = (
            openrouter_module._FREE_MODEL_COOLDOWNS["openrouter/free"]
            - time.monotonic()
        )
    assert 110 <= remaining <= 120

    before = len(session.attempted)
    second = OpenRouterProvider("test-key")
    second.session = session
    assert second.generate_response("Explain an emergency fund.") == (
        "A working free response."
    )
    assert "openrouter/free" not in session.attempted[before:]


def test_openrouter_completion_has_no_application_token_cap(monkeypatch):
    monkeypatch.setenv("OPENROUTER_MODEL", "verified/free")
    session = RouterSession([
        {
            "id": "verified/free",
            "pricing": {"prompt": "0", "completion": "0"},
        }
    ])
    provider = OpenRouterProvider("test-key")
    provider.session = session

    assert provider.generate_response("Explain savings.") == "Verified free reply."
    _, request_body, request_kwargs = session.posts[0]
    assert "max_tokens" not in request_body
    assert request_kwargs.get("stream") is True


def test_openrouter_json_body_reader_enforces_wall_clock_deadline():
    class SlowBodyResponse:
        def iter_content(self, chunk_size=1024):
            time.sleep(0.02)
            yield b'{"choices": []}'

    deadline = time.monotonic() + 0.01
    with pytest.raises(TimeoutError, match="wall-clock deadline"):
        OpenRouterProvider._read_json_response(SlowBodyResponse(), deadline)
