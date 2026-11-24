"""Regression tests for the free AI provider latency budget."""

from app.services.ai_service import _bounded_int_setting


def test_ai_provider_timeout_defaults_allow_slow_free_first_token(monkeypatch):
    monkeypatch.delenv("AI_PROVIDER_TOTAL_TIMEOUT_SECONDS", raising=False)
    monkeypatch.delenv("AI_PROVIDER_ATTEMPT_TIMEOUT_SECONDS", raising=False)

    assert _bounded_int_setting(
        "AI_PROVIDER_TOTAL_TIMEOUT_SECONDS", 60, minimum=10, maximum=90
    ) == 60
    assert _bounded_int_setting(
        "AI_PROVIDER_ATTEMPT_TIMEOUT_SECONDS", 30, minimum=5, maximum=60
    ) == 30


def test_ai_provider_timeout_settings_are_bounded(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER_TOTAL_TIMEOUT_SECONDS", "999")
    monkeypatch.setenv("AI_PROVIDER_ATTEMPT_TIMEOUT_SECONDS", "1")

    assert _bounded_int_setting(
        "AI_PROVIDER_TOTAL_TIMEOUT_SECONDS", 60, minimum=10, maximum=90
    ) == 90
    assert _bounded_int_setting(
        "AI_PROVIDER_ATTEMPT_TIMEOUT_SECONDS", 30, minimum=5, maximum=60
    ) == 5
