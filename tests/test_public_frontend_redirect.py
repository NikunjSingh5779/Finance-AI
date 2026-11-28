from app.controllers.general_controller import serve_index
from app.main import serve_service_worker


PAGES_URL = "https://finance-ai-61h.pages.dev"


def test_production_root_redirects_to_cloudflare_pages_by_default(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.delenv("PUBLIC_APP_URL", raising=False)

    response = serve_index()

    assert response.status_code == 307
    assert response.headers["location"] == PAGES_URL


def test_production_root_redirect_can_be_overridden(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv("PUBLIC_APP_URL", "https://app.example.com")

    response = serve_index()

    assert response.headers["location"] == "https://app.example.com"


def test_local_root_keeps_serving_static_frontend(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "false")

    response = serve_index()

    assert response.status_code == 200
    assert "FinanceAI" in response.body.decode("utf-8")


def test_service_worker_is_served_with_root_scope():
    response = serve_service_worker()

    assert response.media_type == "application/javascript"
    assert response.headers["service-worker-allowed"] == "/"
    assert response.headers["cache-control"] == "no-cache"
