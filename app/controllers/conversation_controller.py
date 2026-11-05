"""Conversation history endpoints."""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from app.core.auth import user_id_from_request
from app.core.database import get_db
from app.repositories.conversation_repository import ConversationRepository

router = APIRouter(prefix="/api/conversations", tags=["AI conversations"])


class NewConversation(BaseModel):
    title: str = Field(default="New chat", min_length=1, max_length=72)


class RenameConversation(BaseModel):
    title: str = Field(min_length=1, max_length=72)


class NewMessage(BaseModel):
    question: str = Field(min_length=3, max_length=1000)

@router.get("")
def list_conversations(request: Request, limit: int = 100):
    user_id = user_id_from_request(request)
    conn = get_db()
    try:
        return {"items": ConversationRepository(conn).list_for_user(user_id, limit)}
    finally:
        conn.close()

@router.post("", status_code=201)
def create_conversation(body: NewConversation, request: Request):
    user_id = user_id_from_request(request)
    conn = get_db()
    try:
        return {"conversation": ConversationRepository(conn).create(user_id, body.title)}
    finally:
        conn.close()

@router.get("/{conversation_id}")
def get_conversation(conversation_id: int, request: Request):
    user_id = user_id_from_request(request)
    conn = get_db()
    try:
        repo = ConversationRepository(conn)
        conversation = repo.get(user_id, conversation_id)
        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return {"conversation": conversation, "messages": repo.messages(user_id, conversation_id, 100)}
    finally:
        conn.close()

@router.patch("/{conversation_id}")
def rename_conversation(conversation_id: int, body: RenameConversation, request: Request):
    user_id = user_id_from_request(request)
    conn = get_db()
    try:
        conversation = ConversationRepository(conn).rename(user_id, conversation_id, body.title)
        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return {"conversation": conversation}
    finally:
        conn.close()

@router.delete("/{conversation_id}")
def delete_conversation(conversation_id: int, request: Request):
    user_id = user_id_from_request(request)
    conn = get_db()
    try:
        deleted = ConversationRepository(conn).delete(user_id, conversation_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return {"deleted": True}
    finally:
        conn.close()
