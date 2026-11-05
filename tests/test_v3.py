"""FinanceAI V3 authentication and AI history regression tests."""

from __future__ import annotations

from pathlib import Path
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


def test_recurring_schedule_can_be_created_and_listed(v3_client):
    payload = {
        "name": "Netflix",
        "amount": 499,
        "type": "expense",
        "category": "subscription",
        "frequency": "monthly",
        "next_due_date": "2026-11-06",
        "account_id": None,
    }

    created = v3_client.post("/recurring", json=payload)

    assert created.status_code == 201
    item = created.json()
    assert item["name"] == "Netflix"
    assert item["amount"] == 499
    assert item["frequency"] == "monthly"
    assert item["is_active"] is True

    listed = v3_client.get("/recurring")
    assert listed.status_code == 200
    assert [entry["id"] for entry in listed.json()] == [item["id"]]


def test_recurring_inline_handler_is_exported_to_the_pwa():
    root = Path(__file__).resolve().parents[1]
    html = (root / "app" / "static" / "index.html").read_text(
        encoding="utf-8"
    )
    script = (root / "app" / "static" / "app.js").read_text(
        encoding="utf-8"
    )

    assert 'onclick="createRecurringItem()"' in html
    exports = script.split("Object.assign(window,", 1)[1].split("});", 1)[0]
    assert "createRecurringItem," in exports


def test_recurring_archive_preserves_history_and_restore_stays_paused(v3_client):
    created = v3_client.post(
        "/recurring",
        json={
            "name": "Netflix",
            "amount": 499,
            "type": "expense",
            "category": "subscription",
            "frequency": "monthly",
            "next_due_date": "2026-11-05",
            "account_id": None,
        },
    )
    assert created.status_code == 201
    item_id = created.json()["id"]

    payment = v3_client.post(
        f"/recurring/{item_id}/record",
        json={"due_date": "2026-11-05"},
    )
    assert payment.status_code == 201
    assert v3_client.get("/transactions/count").json()["count"] == 1

    archived = v3_client.put(
        f"/recurring/{item_id}",
        json={"is_archived": True},
    )
    assert archived.status_code == 200
    assert archived.json()["is_archived"] is True
    assert archived.json()["is_active"] is False
    assert v3_client.get("/recurring").json() == []

    history_view = v3_client.get("/recurring?include_archived=true")
    assert history_view.status_code == 200
    assert len(history_view.json()) == 1
    assert history_view.json()[0]["id"] == item_id
    assert history_view.json()[0]["last_recorded_due_date"] == "2026-11-05"
    assert v3_client.get("/transactions/count").json()["count"] == 1

    restored = v3_client.put(
        f"/recurring/{item_id}",
        json={"is_archived": False},
    )
    assert restored.status_code == 200
    assert restored.json()["is_archived"] is False
    assert restored.json()["is_active"] is False
    assert [item["id"] for item in v3_client.get("/recurring").json()] == [
        item_id
    ]


def test_new_transactions_appear_before_older_entries_by_creation_time(v3_client):
    future_dated = v3_client.post(
        "/transactions",
        json={
            "type": "expense",
            "amount": 1200,
            "description": "Future dated existing item",
            "category": "bills",
            "date": "2026-12-31",
        },
    )
    assert future_dated.status_code == 201

    just_added = v3_client.post(
        "/transactions",
        json={
            "type": "expense",
            "amount": 499,
            "description": "Just added subscription",
            "category": "subscriptions",
            "date": "2026-11-05",
        },
    )
    assert just_added.status_code == 201

    listed = v3_client.get("/transactions?skip=0&limit=10")
    assert listed.status_code == 200
    assert listed.json()[0]["id"] == just_added.json()["id"]
    assert listed.json()[0]["description"] == "Just added subscription"

def test_auth_unauthorized_response_includes_cors_headers(v3_client, monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    origin = "https://finance-ai-61h.pages.dev"

    response = v3_client.get(
        "/transactions",
        headers={"Origin": origin},
    )

    assert response.status_code == 401
    assert response.headers["access-control-allow-origin"] == origin
