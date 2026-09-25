import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from ai_provider import ask_ai

logger = logging.getLogger(__name__)
router = APIRouter()


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    question: str


class ChatResponse(BaseModel):
    reply: str
    success: bool


SYSTEM_PROMPT = """You are a helpful personal finance assistant. Your role is to provide practical financial advice and spending suggestions based on user questions.

When a user asks about spending money (e.g., "how can I spend my 10k on Shimla?"), provide:
1. Budget breakdown suggestions
2. Specific spending categories (accommodation, food, transport, activities, etc.)
3. Money-saving tips for that destination
4. Estimated costs based on typical prices
5. Practical recommendations

When asked about financial planning, budgeting, or money management:
- Provide actionable advice
- Consider the Indian financial context (INR, common expenses, etc.)
- Be practical and considerate of different income levels
- Suggest ways to track spending
- Recommend budgeting strategies

Always be helpful, non-judgmental, and focused on the user's financial goals."""


@router.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    """
    Chat endpoint for financial advice and spending suggestions.
    """
    try:
        if not request.question:
            raise HTTPException(status_code=400, detail="Question is required")

        # Build conversation context from message history
        conversation_context = ""
        if request.messages:
            for msg in request.messages:
                role = "Assistant" if msg.role == "assistant" else "User"
                conversation_context += f"{role}: {msg.content}\n"

        # Combine context with current question
        full_message = (conversation_context + f"User: {request.question}") if conversation_context else request.question

        # Call AI model with system prompt
        response = ask_ai(
            system_message=SYSTEM_PROMPT,
            user_message=full_message,
            max_tokens=1024,
        )

        if not response:
            raise HTTPException(status_code=500, detail="Failed to get response from AI model")

        return ChatResponse(reply=response, success=True)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in chat endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
