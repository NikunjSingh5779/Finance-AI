from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.core.database import init_db
from app.core.rate_limiter import reset_rate_limiter
from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    db_file = tmp_path / "finance-test.db"
    monkeypatch.setenv("DB_PATH", str(db_file))
    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "100")
    init_db()
    reset_rate_limiter()
    with TestClient(app) as test_client:
        yield test_client
    reset_rate_limiter()


def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_transaction_crud_and_validation(client):
    invalid = client.post(
        "/transactions",
        json={
            "type": "invalid",
            "amount": 100,
            "description": "Bad",
            "category": "Misc",
            "date": "2026-01-01",
        },
    )
    assert invalid.status_code == 422

    created = client.post(
        "/transactions",
        json={
            "type": "income",
            "amount": 1200,
            "description": "Salary",
            "category": "Salary",
            "date": "2026-01-01",
        },
    )
    assert created.status_code == 201
    txn = created.json()
    txn_id = txn["id"]

    listed = client.get("/transactions")
    assert listed.status_code == 200
    assert any(item["id"] == txn_id for item in listed.json())

    updated = client.put(
        f"/transactions/{txn_id}",
        json={"amount": 1500, "description": "Updated salary"},
    )
    assert updated.status_code == 200
    assert updated.json()["amount"] == 1500
    assert updated.json()["description"] == "Updated salary"

    deleted = client.delete(f"/transactions/{txn_id}")
    assert deleted.status_code == 200

    missing = client.delete(f"/transactions/{txn_id}")
    assert missing.status_code == 404


def test_account_balance_and_relationship_rules(client):
    created = client.post(
        "/accounts",
        json={"name": "Savings", "balance": 1000, "type": "savings"},
    )
    assert created.status_code == 201
    account = created.json()
    account_id = account["id"]
    assert account["balance"] == 1000
    assert account["current_balance"] == 1000

    income = client.post(
        "/transactions",
        json={
            "type": "income",
            "amount": 500,
            "description": "Deposit",
            "category": "Salary",
            "date": "2026-01-01",
            "account_id": account_id,
        },
    )
    assert income.status_code == 201

    expense = client.post(
        "/transactions",
        json={
            "type": "expense",
            "amount": 125,
            "description": "Food",
            "category": "Food",
            "date": "2026-01-02",
            "account_id": account_id,
        },
    )
    assert expense.status_code == 201

    account_view = client.get(f"/accounts/{account_id}")
    assert account_view.status_code == 200
    assert account_view.json()["balance"] == 1000
    assert account_view.json()["current_balance"] == 1375

    bad_account = client.post(
        "/transactions",
        json={
            "type": "expense",
            "amount": 10,
            "description": "Bad account",
            "category": "Misc",
            "date": "2026-01-03",
            "account_id": 999999,
        },
    )
    assert bad_account.status_code == 422

    blocked_delete = client.delete(f"/accounts/{account_id}")
    assert blocked_delete.status_code == 409


def test_account_edit_does_not_double_count_transactions(client):
    created = client.post(
        "/accounts",
        json={"name": "Checking", "balance": 1000, "type": "checking"},
    )
    account_id = created.json()["id"]

    client.post(
        "/transactions",
        json={
            "type": "income",
            "amount": 250,
            "description": "Income",
            "category": "Salary",
            "date": "2026-01-01",
            "account_id": account_id,
        },
    )

    before = client.get(f"/accounts/{account_id}").json()
    assert before["current_balance"] == 1250

    updated = client.put(
        f"/accounts/{account_id}",
        json={"name": "Main Checking", "balance": before["balance"], "type": "checking"},
    )
    assert updated.status_code == 200
    assert updated.json()["balance"] == 1000
    assert updated.json()["current_balance"] == 1250


def test_budget_upsert_and_status(client):
    first = client.post(
        "/budgets",
        json={"category": "Food", "limit_amt": 500},
    )
    assert first.status_code == 201

    second = client.post(
        "/budgets",
        json={"category": "Food", "limit_amt": 750},
    )
    assert second.status_code == 201
    assert second.json()["limit_amt"] == 750

    current_month = date.today().replace(day=2).isoformat()
    txn = client.post(
        "/transactions",
        json={
            "type": "expense",
            "amount": 100,
            "description": "Lunch",
            "category": "Food",
            "date": current_month,
        },
    )
    assert txn.status_code == 201

    status = client.get("/budgets/Food/status")
    assert status.status_code == 200
    status_payload = status.json()
    assert status_payload["spent"] == 100
    assert status_payload["limit"] == 750

    updated = client.put("/budgets/Food", json={"limit_amt": 900})
    assert updated.status_code == 200
    assert updated.json()["limit_amt"] == 900


def test_summary_period_and_forecast(client):
    today = date.today()
    current = today.replace(day=2).isoformat()

    client.post(
        "/transactions",
        json={
            "type": "income",
            "amount": 3000,
            "description": "Salary",
            "category": "Salary",
            "date": current,
        },
    )
    client.post(
        "/transactions",
        json={
            "type": "expense",
            "amount": 1000,
            "description": "Rent",
            "category": "Housing",
            "date": current,
        },
    )

    summary = client.get("/summary?period=1m")
    assert summary.status_code == 200
    payload = summary.json()
    assert payload["income"] == 3000
    assert payload["expense"] == 1000
    assert payload["period"] == "1m"

    invalid_period = client.get("/summary?period=7m")
    assert invalid_period.status_code == 422

    forecast = client.get("/predict-expense")
    assert forecast.status_code == 422


def test_insights_endpoints(client):
    today = date.today()
    for month_offset, amount in ((2, 100), (1, 105), (0, 110)):
        month = today.month - month_offset
        year = today.year
        while month <= 0:
            month += 12
            year -= 1
        txn_date = f"{year:04d}-{month:02d}-05"
        response = client.post(
            "/transactions",
            json={
                "type": "expense",
                "amount": amount,
                "description": "Streaming Service",
                "category": "Subscriptions",
                "date": txn_date,
            },
        )
        assert response.status_code == 201

    health = client.get("/api/insights/health")
    assert health.status_code == 200
    assert 0 <= health.json()["score"] <= 100

    recurring = client.get("/api/insights/recurring")
    assert recurring.status_code == 200
    assert "items" in recurring.json()

    anomalies = client.get("/api/insights/anomalies")
    assert anomalies.status_code == 200
    assert "items" in anomalies.json()


def test_ai_without_provider_returns_controlled_error(client, monkeypatch):
    monkeypatch.delenv("OMNIROUTE_API_KEY", raising=False)
    monkeypatch.delenv("OPENCODE_ZEN_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    response = client.post(
        "/ai/advice",
        json={"question": "How can I improve my savings?", "messages": []},
    )
    assert response.status_code == 503
    assert "provider" in response.json()["detail"].lower()
