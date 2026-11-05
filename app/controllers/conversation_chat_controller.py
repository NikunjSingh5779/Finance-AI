"""AI message generation for saved conversations."""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from app.core.auth import user_id_from_request
from app.core.database import get_db
from app.core.rate_limiter import check_rate_limit
from app.repositories.analytics_repository import AnalyticsRepository
from app.repositories.budget_repository import BudgetRepository
from app.repositories.conversation_repository import ConversationRepository
from app.repositories.transaction_repository import TransactionRepository
from app.services.ai_service import AIService

router = APIRouter(prefix="/api/conversations", tags=["AI conversations"])


class ChatTurn(BaseModel):
    question: str = Field(min_length=3, max_length=1000)

@router.post("/{conversation_id}/messages")
async def send_message(conversation_id: int, body: ChatTurn, request: Request):
    check_rate_limit(request.client.host if request.client else "unknown")
    owner_id = user_id_from_request(request)
    conn = get_db()
    try:
        repo = ConversationRepository(conn)
        if repo.get(owner_id, conversation_id) is None:
            raise HTTPException(status_code=404, detail="Conversation not found")
        question = body.question.strip()
        repo.add_message(owner_id, conversation_id, "user", question, title_from_first_message=True)
        history = repo.messages(owner_id, conversation_id, 20)
        assistant = AIService()
        context = assistant.build_context(
            AnalyticsRepository(conn),
            TransactionRepository(conn),
            BudgetRepository(conn),
        )
        reply = await assistant.get_financial_advice(
            question=question,
            financial_context=context,
            conversation=[{"role": item["role"], "content": item["content"]} for item in history],
        )
        message = repo.add_message(owner_id, conversation_id, "assistant", reply)
        return {
            "success": True,
            "reply": reply,
            "message": message,
            "conversation": repo.get(owner_id, conversation_id),
        }
    finally:
        conn.close()
