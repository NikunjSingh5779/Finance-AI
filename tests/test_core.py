import pytest
from fastapi.testclient import TestClient

from database import init_db
from main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    db_file = tmp_path / "test.db"
    monkeypatch.setenv("DB_PATH", str(db_file))
    init_db()
    with TestClient(app) as test_client:
        yield test_client


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_add_and_list_transaction(client):
    resp = client.post(
        "/transactions",
        json={
            "type": "income",
            "amount": 1200,
            "description": "Salary",
            "category": "Job",
            "date": "2024-01-01"
        },
    )
    assert resp.status_code == 201
    txn = resp.json()
    assert txn["amount"] == 1200
    assert txn["description"] == "Salary"

    resp = client.get("/transactions")
    assert resp.status_code == 200
    data = resp.json()
    assert any(t["description"] == "Salary" for t in data)


def test_summary_calculation(client):
    client.post("/transactions", json={
        "type": "income", "amount": 2500, "description": "Freelance", "category": "Job", "date": "2024-02-01"
    })
    client.post("/transactions", json={
        "type": "expense", "amount": 800, "description": "Rent", "category": "Housing", "date": "2024-02-02"
    })
    resp = client.get("/summary")
    assert resp.status_code == 200
    summary = resp.json()
    assert summary["income"] == 2500
    assert summary["expense"] == 800
    assert summary["savings_rate"] == round((2500 - 800) / 2500 * 100, 1)


def test_add_transaction_validation(client):
    # Invalid type (Pydantic returns 422)
    resp = client.post("/transactions", json={
        "type": "invalid", "amount": 100, "description": "Test", "category": "Misc", "date": "2024-01-01"
    })
    assert resp.status_code == 422

    # Negative amount
    resp = client.post("/transactions", json={
        "type": "expense", "amount": -50, "description": "Test", "category": "Misc", "date": "2024-01-01"
    })
    assert resp.status_code == 422

    # Zero amount
    resp = client.post("/transactions", json={
        "type": "expense", "amount": 0, "description": "Test", "category": "Misc", "date": "2024-01-01"
    })
    assert resp.status_code == 422


def test_delete_transaction(client):
    resp = client.post("/transactions", json={
        "type": "expense", "amount": 50, "description": "DeleteMe", "category": "Test", "date": "2024-01-01"
    })
    txn_id = resp.json()["id"]

    resp = client.delete(f"/transactions/{txn_id}")
    assert resp.status_code == 200
    assert resp.json()["deleted"] == txn_id

    # 404 on second delete
    resp = client.delete(f"/transactions/{txn_id}")
    assert resp.status_code == 404


def test_budget_set_and_list(client):
    resp = client.post("/budgets", json={"category": "Food", "limit_amt": 500})
    assert resp.status_code == 201
    assert resp.json()["category"] == "Food"

    resp = client.get("/budgets")
    assert resp.status_code == 200
    data = resp.json()
    assert any(b["category"] == "Food" for b in data)


def test_budget_upsert(client):
    resp = client.post("/budgets", json={"category": "Food", "limit_amt": 300})
    assert resp.status_code == 201
    assert resp.json()["limit_amt"] == 300

    # Upsert same category with new limit
    resp = client.post("/budgets", json={"category": "Food", "limit_amt": 500})
    assert resp.status_code == 201
    assert resp.json()["limit_amt"] == 500


def test_delete_budget(client):
    client.post("/budgets", json={"category": "Transport", "limit_amt": 200})
    resp = client.delete("/budgets/Transport")
    assert resp.status_code == 200

    resp = client.delete("/budgets/Transport")
    assert resp.status_code == 404


def test_accounts_crud(client):
    # Create account
    resp = client.post("/accounts", json={"name": "Savings", "balance": 1000.0, "type": "savings"})
    assert resp.status_code == 201
    acc = resp.json()
    assert acc["name"] == "Savings"
    assert acc["type"] == "savings"
    acc_id = acc["id"]

    # List accounts
    resp = client.get("/accounts")
    assert resp.status_code == 200
    assert any(a["id"] == acc_id for a in resp.json())

    # Update account
    resp = client.put(f"/accounts/{acc_id}", json={"name": "Emergency Fund", "balance": 1500.0, "type": "savings"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Emergency Fund"

    # Delete account
    resp = client.delete(f"/accounts/{acc_id}")
    assert resp.status_code == 200
    assert resp.json()["deleted"] == acc_id

    # 404 on delete again
    resp = client.delete(f"/accounts/{acc_id}")
    assert resp.status_code == 404


def test_predict_expense_not_enough_data(client):
    resp = client.get("/predict-expense")
    assert resp.status_code == 200
    assert resp.json()["prediction"] == "Not enough data"


def test_predict_expense_with_data(client):
    for i in range(5):
        client.post(
            "/transactions",
            json={
                "type": "expense",
                "amount": 100 * (i + 1),
                "description": f"Exp{i}",
                "category": "Misc",
                "date": f"2024-0{i+1}-01",
            },
        )
    resp = client.get("/predict-expense")
    assert resp.status_code == 200
    assert "predicted_expense" in resp.json()


def test_market_endpoints_structure(client):
    # Test fallback responses or error handling when yfinance is queried
    resp = client.get("/api/market/AAPL")
    assert resp.status_code in (200, 404, 503)

    resp = client.get("/api/market/search?q=Apple")
    assert resp.status_code in (200, 503)
