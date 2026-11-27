"""Regression tests pinning the persistent-session requirements.

Before the cookie-broker change, ``/auth/login`` returned the Supabase refresh
token in the JSON body (so the browser had to keep it in localStorage) and set
no cookie. These tests describe the required behaviour.
"""

import pytest
from fastapi.testclient import TestClient

from app.controllers import auth_controller
from app.core.rate_limiter import reset_rate_limiter
from app.main import app

FAKE_REFRESH_TOKEN = "r" * 40
FAKE_SESSION = {
    "access_token": "access.jwt.token",
    "refresh_token": FAKE_REFRESH_TOKEN,
    "expires_in": 900,
    "user": {"id": "11111111-1111-1111-1111-111111111111", "email": "a@b.co"},
}


@pytest.fixture
def client(monkeypatch):
    async def fake_sign_in(email, password):
        return dict(FAKE_SESSION)

    # The controller imports ``sign_in`` by name, so patch it there.
    monkeypatch.setattr(auth_controller, "sign_in", fake_sign_in)
    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "100")
    reset_rate_limiter()
    with TestClient(app) as test_client:
        yield test_client
    reset_rate_limiter()


def _login(client):
    return client.post(
        "/auth/login",
        json={"email": "a@b.co", "password": "Secret123!"},
    )


def test_login_response_has_no_refresh_token_in_body(client):
    response = _login(client)

    assert response.status_code == 200
    body = response.json()
    assert "refresh_token" not in body
    assert body["access_token"] == FAKE_SESSION["access_token"]


def test_login_sets_httponly_cookie(client):
    response = _login(client)

    set_cookie = response.headers.get("set-cookie", "")
    assert "fa_rt=" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "Max-Age=604800" in set_cookie
