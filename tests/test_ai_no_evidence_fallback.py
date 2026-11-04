import asyncio

from app.services.ai_service import AIService


def test_ipo_question_returns_clean_fallback_when_search_is_irrelevant(monkeypatch):
    class EmptyResearcher:
        async def search_and_fetch(self, *args, **kwargs):
            return [], []

    monkeypatch.setattr(
        "app.services.ai_service.get_web_researcher",
        lambda: EmptyResearcher(),
    )
    monkeypatch.setattr(AIService, "_provider_candidates", lambda self: [])

    reply = asyncio.run(
        AIService().get_financial_advice(
            "When is the Jio IPO?",
            financial_context={},
            conversation=[],
        )
    )

    assert "couldn't verify" in reply.lower()
    assert "unrelated search results" in reply.lower()
    assert "Sources" not in reply
