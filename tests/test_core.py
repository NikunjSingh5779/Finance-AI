import os
import pytest
from fastapi.testclient import TestClient
import sqlite3


def create_test_app(db_path):
    os.environ["DB_PATH"] = db_path
    import importlib
    import main
    importlib.reload(main)
    from main import app, init_db
    init_db()
    return TestClient(app)


@pytest.fixture
def client(tmp_path):
    db_file = tmp_path / "test.db"
    yield create_test_app(str(db_file))


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
            "desc": "Salary",
            "category": "Job",
            "date": "2024-01-01"
        },
    )
    assert resp.status_code == 201
    txn = resp.json()
    assert txn["amount"] == 1200

    resp = client.get("/transactions")
    assert resp.status_code == 200
    data = resp.json()
    assert any(t["desc"] == "Salary" for t in data)


def test_summary_calculation(client):
    client.post("/transactions", json={
        "type": "income", "amount": 2500, "desc": "Freelance", "category": "Job", "date": "2024-02-01"
    })
    client.post("/transactions", json={
        "type": "expense", "amount": 800, "desc": "Rent", "category": "Housing", "date": "2024-02-02"
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
        "type": "invalid", "amount": 100, "desc": "Test", "category": "Misc", "date": "2024-01-01"
    })
    assert resp.status_code == 422

    # Negative amount
    resp = client.post("/transactions", json={
        "type": "expense", "amount": -50, "desc": "Test", "category": "Misc", "date": "2024-01-01"
    })
    assert resp.status_code == 422

    # Zero amount
    resp = client.post("/transactions", json={
        "type": "expense", "amount": 0, "desc": "Test", "category": "Misc", "date": "2024-01-01"
    })
    assert resp.status_code == 422


def test_delete_transaction(client):
    resp = client.post("/transactions", json={
        "type": "expense", "amount": 50, "desc": "DeleteMe", "category": "Test", "date": "2024-01-01"
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


def test_predict_expense_not_enough_data(client):
    resp = client.get("/predict-expense")
    assert resp.status_code == 200
    assert resp.json()["prediction"] == "Not enough data"


def test_predict_expense_with_data(client):
    for i in range(5):
        client.post("/transactions", json={
            "type": "expense", "amount": 100 * (i + 1), "desc": f"Exp{i}", "category": "Misc", "date": f"2024-0{i+1}-01"
        })
    resp = client.get("/predict-expense")
    assert resp.status_code == 200
    assert "predicted_expense" in resp.json()
