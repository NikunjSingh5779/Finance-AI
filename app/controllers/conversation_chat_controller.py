"""AI message generation for saved conversations."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from app.core.auth import get_current_user_id, user_id_from_request
from app.core.database import get_db
from app.core.rate_limiter import check_rate_limit
from app.repositories.analytics_repository import AnalyticsRepository
from app.repositories.budget_repository import BudgetRepository
from app.repositories.conversation_repository import ConversationRepository
from app.repositories.transaction_repository import TransactionRepository
from app.services.ai_service import AIService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/conversations", tags=["AI conversations"])


class ChatTurn(BaseModel):
    question: str = Field(min_length=3, max_length=1000)

    @field_validator("question")
    @classmethod
    def normalize_question(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Question must contain at least 3 characters.")
        return value


def _request_owner_id(request: Request) -> str:
    """Reuse the middleware-verified subject and avoid a second JWT check."""
    return get_current_user_id() or user_id_from_request(request)


def _prepare_turn(
    owner_id: str,
    conversation_id: int,
    question: str,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Persist the user turn and read context on one worker-thread connection."""
    conn = get_db()
    try:
        repo = ConversationRepository(conn)
        if repo.get(owner_id, conversation_id) is None:
            raise HTTPException(status_code=404, detail="Conversation not found")

        repo.add_message(
            owner_id,
            conversation_id,
            "user",
            question,
            title_from_first_message=True,
        )
        history = repo.messages(owner_id, conversation_id, 20)
        assistant = AIService()
        context = assistant.build_context(
            AnalyticsRepository(conn),
            TransactionRepository(conn),
            BudgetRepository(conn),
        )
        return history, context
    finally:
        conn.close()


def _save_assistant_reply(
    owner_id: str,
    conversation_id: int,
    reply: str,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """Write a complete response on a fresh connection after generation."""
    conn = get_db()
    try:
        repo = ConversationRepository(conn)
        message = repo.add_message(owner_id, conversation_id, "assistant", reply)
        return message, repo.get(owner_id, conversation_id)
    finally:
        conn.close()


async def _prepare_ai_request(
    conversation_id: int,
    body: ChatTurn,
    request: Request,
) -> tuple[str, list[dict[str, Any]], dict[str, Any]]:
    client_ip = request.client.host if request.client else "unknown"
    await asyncio.to_thread(check_rate_limit, client_ip)
    owner_id = _request_owner_id(request)
    history, context = await asyncio.to_thread(
        _prepare_turn,
        owner_id,
        conversation_id,
        body.question,
    )
    return owner_id, history, context


def _sse_event(event: str, payload: dict[str, Any]) -> str:
    return (
        f"event: {event}\n"
        f"data: {json.dumps(payload, ensure_ascii=False, separators=(',', ':'))}\n\n"
    )


@router.post("/{conversation_id}/messages")
async def send_message(conversation_id: int, body: ChatTurn, request: Request):
    owner_id, history, context = await _prepare_ai_request(
        conversation_id, body, request
    )
    assistant = AIService()
    reply = await assistant.get_financial_advice(
        question=body.question,
        financial_context=context,
        conversation=[
            {"role": item["role"], "content": item["content"]}
            for item in history
        ],
    )
    message, conversation = await asyncio.to_thread(
        _save_assistant_reply,
        owner_id,
        conversation_id,
        reply,
    )
    return {
        "success": True,
        "reply": reply,
        "message": message,
        "conversation": conversation,
    }


@router.post("/{conversation_id}/messages/stream")
async def stream_message(conversation_id: int, body: ChatTurn, request: Request):
    """Stream assistant deltas and persist one complete reply when finished."""
    owner_id, history, context = await _prepare_ai_request(
        conversation_id, body, request
    )
    assistant = AIService()
    conversation = [
        {"role": item["role"], "content": item["content"]}
        for item in history
    ]

    async def event_stream():
        chunks: list[str] = []
        try:
            async for delta in assistant.stream_financial_advice(
                question=body.question,
                financial_context=context,
                conversation=conversation,
            ):
                if not delta:
                    continue
                chunks.append(delta)
                yield _sse_event("delta", {"text": delta})

            reply = "".join(chunks).strip()
            if not reply:
                raise RuntimeError("AI generation completed without a reply")

            message, saved_conversation = await asyncio.to_thread(
                _save_assistant_reply,
                owner_id,
                conversation_id,
                reply,
            )
            yield _sse_event(
                "done",
                {
                    "reply": reply,
                    "message": message,
                    "conversation": saved_conversation,
                },
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Streaming AI response failed")
            yield _sse_event(
                "error",
                {"detail": "AI is unavailable. Please retry shortly."},
            )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
