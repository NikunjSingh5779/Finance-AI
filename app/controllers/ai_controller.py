import logging
import asyncio
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.auth import is_production
from app.core.database import get_db
from app.core.rate_limiter import check_rate_limit
from app.repositories.analytics_repository import AnalyticsRepository
from app.repositories.budget_repository import BudgetRepository
from app.repositories.transaction_repository import TransactionRepository
from app.services.ai_service import AIService

logger = logging.getLogger(__name__)
router = APIRouter(tags=["ai"])


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)

    @field_validator("content")
    @classmethod
    def normalize_content(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Message content cannot be blank.")
        return value


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(default_factory=list, max_length=20)
    question: str = Field(min_length=3, max_length=1000)

    @field_validator("question")
    @classmethod
    def normalize_question(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Question must contain at least 3 characters.")
        return value

    @model_validator(mode="after")
    def limit_total_context(self):
        total_characters = len(self.question) + sum(
            len(message.content) for message in self.messages
        )
        if total_characters > 12_000:
            raise ValueError(
                "Question and message history cannot exceed 12,000 characters."
            )
        return self


class ChatResponse(BaseModel):
    reply: str
    success: bool


def _build_service_context(conn) -> tuple[AIService, dict]:
    service = AIService()
    context = service.build_context(
        AnalyticsRepository(conn),
        TransactionRepository(conn),
        BudgetRepository(conn),
    )
    return service, context


def _load_service_context() -> tuple[AIService, dict]:
    """Run synchronous repository work outside the async request loop."""
    conn = get_db()
    try:
        return _build_service_context(conn)
    finally:
        conn.close()


async def _generate(request: ChatRequest) -> str:
    service, context = await asyncio.to_thread(_load_service_context)
    return await service.get_financial_advice(
        question=request.question,
        financial_context=context,
        conversation=[message.model_dump() for message in request.messages],
    )


@router.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest, raw_request: Request) -> ChatResponse:
    client_ip = raw_request.client.host if raw_request.client else "unknown"
    await asyncio.to_thread(check_rate_limit, client_ip)
    reply = await _generate(request)
    return ChatResponse(reply=reply, success=True)


@router.post("/ai/advice", response_model=dict)
async def ai_advice(request: ChatRequest, raw_request: Request) -> dict:
    client_ip = raw_request.client.host if raw_request.client else "unknown"
    await asyncio.to_thread(check_rate_limit, client_ip)
    return {"advice": await _generate(request), "success": True}


@router.post("/ai/advice-enhanced", response_model=dict)
async def enhanced_advice(request: ChatRequest, raw_request: Request) -> dict:
    client_ip = raw_request.client.host if raw_request.client else "unknown"
    await asyncio.to_thread(check_rate_limit, client_ip)
    reply = await _generate(request)
    return {"advice": reply, "success": True, "mode": "enhanced"}


@router.get("/ai/providers")
def provider_status():
    if is_production():
        raise HTTPException(status_code=404, detail="Not found")
    from app.providers.ai.discovery import get_provider_info

    return get_provider_info()


@router.get("/api/chat/test")
async def test_ai():
    if is_production():
        raise HTTPException(status_code=404, detail="Not found")
    try:
        service, context = await asyncio.to_thread(_load_service_context)
        reply = await service.get_financial_advice(
            "What finance topics can you help me with?",
            context,
        )
        return {"response": reply, "success": True}
    except Exception as exc:
        logger.warning("AI diagnostic failed: %s", exc)
        return {"response": "AI diagnostic failed.", "success": False}
