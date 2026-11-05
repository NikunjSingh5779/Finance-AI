"""FinanceAI V3 authentication and AI history regression tests."""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.auth import AuthProviderError, sign_out
from app.core.database import init_db
from app.core.rate_limiter import reset_rate_limiter
from app.controllers.auth_controller import PasswordUpdateRequest, SignUpRequest
from app.main import app


@pytest.fixture
def v3_client(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "finance-v3-test.db"))
    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "100")
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("AUTH_REQUIRED", raising=False)
    monkeypatch.setenv("DEV_USER_ID", "00000000-0000-0000-0000-000000000001")
    init_db()
    reset_rate_limiter()
    with TestClient(app) as client:
        yield client
    reset_rate_limiter()


def test_v3_password_policy_requires_length_number_and_special_character():
    valid = "securePass9!"
    assert SignUpRequest(email="v3@example.com", password=valid).password == valid
    assert PasswordUpdateRequest(password=valid).password == valid

    for invalid in ("short1!", "password!", "password123"):
        with pytest.raises(ValidationError):
            SignUpRequest(email="v3@example.com", password=invalid)


def test_v3_refresh_provider_errors_return_401(v3_client, monkeypatch):
    async def fail_refresh(_token):
        raise AuthProviderError("Refresh token expired")

    monkeypatch.setattr("app.controllers.auth_controller.refresh_session", fail_refresh)
    response = v3_client.post(
        "/auth/refresh",
        json={"refresh_token": "r" * 32},
    )
    assert response.status_code == 401
    assert "Refresh token expired" in response.json()["detail"]


def test_v3_local_signout_uses_device_scope(monkeypatch):
    calls = []

    async def capture(method, path, **kwargs):
        calls.append((method, path, kwargs))
        return {}

    monkeypatch.setattr("app.core.auth._supabase_request", capture)
    import asyncio

    asyncio.run(sign_out("access-token"))
    assert calls[0][0] == "POST"
    assert calls[0][1] == "/logout?scope=local"


def test_v3_conversation_messages_persist_and_are_owner_scoped(
    v3_client,
    monkeypatch,
):
    class FakeAIService:
        def build_context(self, *_args):
            return {}

        async def get_financial_advice(self, question, financial_context, conversation):
            assert financial_context == {}
            assert conversation[-1] == {"role": "user", "content": question}
            return "A saved FinanceAI answer."

    monkeypatch.setattr(
        "app.controllers.conversation_chat_controller.AIService",
        FakeAIService,
    )

    created = v3_client.post("/api/conversations", json={"title": "New chat"})
    assert created.status_code == 201
    conversation_id = created.json()["conversation"]["id"]

    reply = v3_client.post(
        f"/api/conversations/{conversation_id}/messages",
        json={"question": "How can I improve savings?"},
    )
    assert reply.status_code == 200
    assert reply.json()["reply"] == "A saved FinanceAI answer."
    assert reply.json()["conversation"]["title"] == "How can I improve savings?"

    restored = v3_client.get(f"/api/conversations/{conversation_id}")
    assert restored.status_code == 200
    assert [item["role"] for item in restored.json()["messages"]] == [
        "user",
        "assistant",
    ]
    assert restored.json()["messages"][1]["content"] == "A saved FinanceAI answer."

    other_user_id = str(uuid4())
    monkeypatch.setenv("DEV_USER_ID", other_user_id)
    assert v3_client.get("/api/conversations").json()["items"] == []
    assert v3_client.get(f"/api/conversations/{conversation_id}").status_code == 404
    assert v3_client.delete(f"/api/conversations/{conversation_id}").status_code == 404


def test_v3_conversation_rename_and_delete_are_persistent(v3_client):
    created = v3_client.post("/api/conversations", json={"title": "First chat"})
    conversation_id = created.json()["conversation"]["id"]

    renamed = v3_client.patch(
        f"/api/conversations/{conversation_id}",
        json={"title": "Travel planning"},
    )
    assert renamed.status_code == 200
    assert renamed.json()["conversation"]["title"] == "Travel planning"

    deleted = v3_client.delete(f"/api/conversations/{conversation_id}")
    assert deleted.status_code == 200
    assert deleted.json()["deleted"] is True
    assert v3_client.get(f"/api/conversations/{conversation_id}").status_code == 404
