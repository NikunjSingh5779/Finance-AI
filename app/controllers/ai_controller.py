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


def _ai_service(conn) -> AIService:
    return AIService()


def _context(conn) -> dict:
    return _ai_service(conn).build_context(
        AnalyticsRepository(conn),
        TransactionRepository(conn),
        BudgetRepository(conn),
    )


@router.post("/api/chat", response_model=ChatResponse)
@router.post("/ai/advice", response_model=dict)
async def chat(request: ChatRequest, raw_request: Request):
    client_ip = raw_request.client.host if raw_request.client else "unknown"
    check_rate_limit(client_ip)

    conn = get_db()
    try:
        service = _ai_service(conn)
        context = service.build_context(
            AnalyticsRepository(conn),
            TransactionRepository(conn),
            BudgetRepository(conn),
        )
        history = [message.model_dump() for message in request.messages]
        reply = await service.get_financial_advice(
            question=request.question,
            financial_context=context,
            conversation=history,
        )
        if request.messages:
            return ChatResponse(reply=reply, success=True)
        return {"advice": reply, "success": True}
    finally:
        conn.close()


@router.post("/ai/advice-enhanced", response_model=dict)
async def enhanced_advice(request: ChatRequest, raw_request: Request):
    client_ip = raw_request.client.host if raw_request.client else "unknown"
    check_rate_limit(client_ip)

    conn = get_db()
    try:
        service = _ai_service(conn)
        context = service.build_context(
            AnalyticsRepository(conn),
            TransactionRepository(conn),
            BudgetRepository(conn),
        )
        context["mode"] = "enhanced"
        reply = await service.get_financial_advice(
            question=request.question,
            financial_context=context,
            conversation=[m.model_dump() for m in request.messages],
        )
        return {"advice": reply, "success": True}
    finally:
        conn.close()


@router.get("/ai/providers")
def provider_status():
    from app.providers.ai.discovery import get_provider_info

    return get_provider_info()


@router.get("/api/chat/test")
def test_ai():
    conn = get_db()
    try:
        service = _ai_service(conn)
        context = service.build_context(
            AnalyticsRepository(conn),
            TransactionRepository(conn),
            BudgetRepository(conn),
        )
        # Reuse the regular service so diagnostics exercise the real provider path.
        import asyncio

        reply = asyncio.run(
            service.get_financial_advice(
                "Say hello and confirm FinanceAI is working.",
                context,
            )
        )
        return {"response": reply, "success": True}
    except Exception as exc:
        logger.warning("AI diagnostic failed: %s", exc)
        return {"response": str(exc), "success": False}
    finally:
        conn.close()
