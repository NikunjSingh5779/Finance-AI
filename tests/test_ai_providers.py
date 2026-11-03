import os

from app.providers.ai.discovery import get_provider_info


def test_omniroute_defaults_to_auto(monkeypatch):
    monkeypatch.setenv("OMNIROUTE_API_KEY", "sk-test")
    monkeypatch.delenv("OMNIROUTE_COMBO_NAME", raising=False)
    monkeypatch.delenv("OMNIROUTE_MODEL", raising=False)
    monkeypatch.delenv("OPENCODE_ZEN_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    info = get_provider_info()

    assert info["omniroute"]["configured"] is True
    assert info["omniroute"]["model"] == "auto"
    assert info["selected"] == "OmniRouteProvider"


def test_omniroute_explicit_combo_wins(monkeypatch):
    monkeypatch.setenv("OMNIROUTE_API_KEY", "sk-test")
    monkeypatch.setenv("OMNIROUTE_COMBO_NAME", "fable")
    monkeypatch.setenv("OMNIROUTE_MODEL", "ignored")
    monkeypatch.delenv("OPENCODE_ZEN_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    info = get_provider_info()

    assert info["omniroute"]["model"] == "fable"
    assert info["selected"] == "OmniRouteProvider"
