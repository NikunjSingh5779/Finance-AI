import logging

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.core.rate_limiter import check_rate_limit
from app.repositories.analytics_repository import AnalyticsRepository
from app.repositories.budget_repository import BudgetRepository
from app.repositories.transaction_repository import TransactionRepository
from app.services.ai_service import AIService

logger = logging.getLogger(__name__)
router = APIRouter(tags=["ai"])


class ChatMessage(BaseModel):
    role: str
    content: str = Field(max_length=4000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(default_factory=list)
    question: str = Field(min_length=3, max_length=1000)


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


async def _generate(request: ChatRequest) -> str:
    conn = get_db()
    try:
        service, context = _build_service_context(conn)
        return await service.get_financial_advice(
            question=request.question,
            financial_context=context,
            conversation=[message.model_dump() for message in request.messages],
        )
    finally:
        conn.close()


@router.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest, raw_request: Request) -> ChatResponse:
    client_ip = raw_request.client.host if raw_request.client else "unknown"
    check_rate_limit(client_ip)
    reply = await _generate(request)
    return ChatResponse(reply=reply, success=True)


@router.post("/ai/advice", response_model=dict)
async def ai_advice(request: ChatRequest, raw_request: Request) -> dict:
    client_ip = raw_request.client.host if raw_request.client else "unknown"
    check_rate_limit(client_ip)
    return {"advice": await _generate(request), "success": True}


@router.post("/ai/advice-enhanced", response_model=dict)
async def enhanced_advice(request: ChatRequest, raw_request: Request) -> dict:
    client_ip = raw_request.client.host if raw_request.client else "unknown"
    check_rate_limit(client_ip)
    reply = await _generate(request)
    return {"advice": reply, "success": True, "mode": "enhanced"}


@router.get("/ai/providers")
def provider_status():
    from app.providers.ai.discovery import get_provider_info

    return get_provider_info()


@router.get("/api/chat/test")
async def test_ai():
    conn = get_db()
    try:
        service, context = _build_service_context(conn)
        reply = await service.get_financial_advice(
            "Say hello and confirm FinanceAI is working.",
            context,
        )
        return {"response": reply, "success": True}
    except Exception as exc:
        logger.warning("AI diagnostic failed: %s", exc)
        return {"response": str(exc), "success": False}
    finally:
        conn.close()
