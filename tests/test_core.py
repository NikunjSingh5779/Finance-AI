import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

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


# ── Bug 2 regression tests ──────────────────────────────────────────────────

def test_ask_ai_non_json_404_returns_clean_error(monkeypatch):
    """A non-JSON 404 from the provider must produce a readable error, not a raw exception."""
    import ai_provider

    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-test-fake")
    monkeypatch.delenv("OPENCODE_ZEN_API_KEY", raising=False)
    monkeypatch.delenv("CLAUDE_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    fake_404 = MagicMock()
    fake_404.ok = False
    fake_404.status_code = 404
    fake_404.text = "Not Found"
    fake_404.headers = {"content-type": "text/plain"}

    fake_ok = MagicMock()
    fake_ok.ok = True
    fake_ok.status_code = 200
    fake_ok.headers = {"content-type": "application/json"}
    fake_ok.json.return_value = {
        "choices": [{"message": {"content": "Hello from fallback"}}]
    }

    # Model list fetch also goes through requests.get — return empty so static fallback is used
    fake_models_resp = MagicMock()
    fake_models_resp.ok = False

    call_count = {"n": 0}

    def fake_post(url, **kwargs):
        call_count["n"] += 1
        # First few calls (dead models) return 404; last call (auto) returns ok
        model = kwargs.get("json", {}).get("model", "")
        if model == "openrouter/auto" or call_count["n"] >= 5:
            return fake_ok
        return fake_404

    with patch("ai_provider.requests.post", side_effect=fake_post), \
         patch("ai_provider.requests.get", return_value=fake_models_resp):
        result = ai_provider.ask_ai("system", "user question")

    # Must not contain the raw "non-JSON response" string from the old code
    assert "non-JSON response" not in result
    # Must eventually return a real answer via the working fallback
    assert "Hello from fallback" in result


def test_ask_ai_valid_opencode_response_extracts_text(monkeypatch):
    """A well-formed OpenCode-style JSON response must return the message content string."""
    import ai_provider

    monkeypatch.setenv("OPENCODE_ZEN_API_KEY", "test-opencode-key")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("CLAUDE_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    fake_resp = MagicMock()
    fake_resp.ok = True
    fake_resp.status_code = 200
    fake_resp.headers = {"content-type": "application/json"}
    fake_resp.json.return_value = {
        "choices": [{"message": {"content": "Your budget allocation looks optimal."}}]
    }

    fake_models_resp = MagicMock()
    fake_models_resp.ok = True
    fake_models_resp.json.return_value = {
        "data": [
            {"id": "big-pickle", "pricing": {"prompt": "0"}},
            {"id": "deepseek-v4-flash-free", "pricing": {"prompt": "0"}},
            {"id": "paid-model", "pricing": {"prompt": "0.001"}}
        ]
    }

    with patch("ai_provider.requests.post", return_value=fake_resp), \
         patch("ai_provider.requests.get", return_value=fake_models_resp):
        result = ai_provider.ask_ai("You are a financial advisor.", "Analyze my budget")

    assert result == "Your budget allocation looks optimal."


def test_ask_ai_opencode_free_model_detection(monkeypatch):
    """OpenCode should correctly identify free models from the /v1/models API."""
    import ai_provider

    monkeypatch.setenv("OPENCODE_ZEN_API_KEY", "test-key")

    fake_models_resp = MagicMock()
    fake_models_resp.ok = True
    fake_models_resp.json.return_value = {
        "data": [
            {"id": "big-pickle", "pricing": {"prompt": "0"}},
            {"id": "mimo-v2.5-free", "pricing": {"prompt": "0"}},
            {"id": "expensive-model", "pricing": {"prompt": "0.01"}},
            {"id": "another-free-model", "pricing": {"prompt": "0"}},
        ]
    }

    with patch("ai_provider.requests.get", return_value=fake_models_resp):
        models = ai_provider._get_opencode_models("test-key")

    # Should return free models plus auto fallback
    expected_free_models = ["big-pickle", "mimo-v2.5-free", "another-free-model", "auto"]
    assert models == expected_free_models


def test_ask_ai_opencode_fallback_on_model_fetch_failure(monkeypatch):
    """When OpenCode model fetch fails, should use static fallback list."""
    import ai_provider

    monkeypatch.setenv("OPENCODE_ZEN_API_KEY", "test-key")

    # Simulate API failure
    fake_models_resp = MagicMock()
    fake_models_resp.ok = False

    with patch("ai_provider.requests.get", return_value=fake_models_resp):
        models = ai_provider._get_opencode_models("test-key")

    # Should return static fallback
    assert models == ai_provider._OPENCODE_FREE_FALLBACK
    assert "auto" in models


def test_provider_priority_order(monkeypatch):
    """Test that provider priority follows OPENCODE → OPENROUTER → CLAUDE → OPENAI order."""
    import ai_provider

    # Set all keys to test priority
    monkeypatch.setenv("OPENCODE_ZEN_API_KEY", "opencode-key")
    monkeypatch.setenv("OPENROUTER_API_KEY", "openrouter-key")
    monkeypatch.setenv("CLAUDE_API_KEY", "claude-key")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-key")

    provider, key = ai_provider._load_key()
    assert provider == "opencode"
    assert key == "opencode-key"

    # Test fallback when OpenCode is missing
    monkeypatch.delenv("OPENCODE_ZEN_API_KEY")
    provider, key = ai_provider._load_key()
    assert provider == "openrouter"
    assert key == "openrouter-key"
