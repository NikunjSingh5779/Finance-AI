from app.controllers.general_controller import serve_index


def test_production_root_redirects_to_netlify(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv(
        "PUBLIC_APP_URL",
        "https://finance-ai-z0z6.netlify.app",
    )

    response = serve_index()

    assert response.status_code == 307
    assert response.headers["location"] == "https://finance-ai-z0z6.netlify.app"


def test_local_root_keeps_serving_static_frontend(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "false")

    response = serve_index()

    assert response.status_code == 200
    assert "FinanceAI" in response.body.decode("utf-8")
