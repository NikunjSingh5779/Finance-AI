"""Regression coverage for streaming-to-completion AI provider fallback."""

import pytest

from app.services.ai_service import AIService


class StreamUnavailableProvider:
    def stream_response(self, prompt):
        raise RuntimeError("stream endpoint unavailable")

    def generate_response(self, prompt):
        return "Your savings rate is 20 percent."


class PartialStreamFailureProvider:
    def stream_response(self, prompt):
        yield "Partial answer"
        raise RuntimeError("connection dropped")

    def generate_response(self, prompt):
        raise AssertionError("Do not append a second answer after partial output")


@pytest.mark.asyncio
async def test_provider_stream_failure_falls_back_to_completion(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER_TOTAL_TIMEOUT_SECONDS", "60")
    monkeypatch.setenv("AI_PROVIDER_ATTEMPT_TIMEOUT_SECONDS", "30")
    received = []

    async def on_delta(value):
        received.append(value)

    service = AIService.__new__(AIService)
    result = await service._generate_with_budget(
        [StreamUnavailableProvider()],
        "How can I improve savings?",
        on_delta,
    )

    assert result == "Your savings rate is 20 percent."
    assert received == ["Your savings rate is 20 percent."]


@pytest.mark.asyncio
async def test_partial_stream_failure_does_not_duplicate_completion(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER_TOTAL_TIMEOUT_SECONDS", "60")
    monkeypatch.setenv("AI_PROVIDER_ATTEMPT_TIMEOUT_SECONDS", "30")
    service = AIService.__new__(AIService)

    with pytest.raises(Exception, match="ended early"):
        await service._generate_with_budget(
            [PartialStreamFailureProvider()],
            "How can I improve savings?",
            None,
        )
