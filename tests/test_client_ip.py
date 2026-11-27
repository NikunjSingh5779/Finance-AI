"""The per-IP auth rate limit must see the real client, not Render's proxy.

uvicorn only honours ``X-Forwarded-For`` from peers listed in
``--forwarded-allow-ips`` (default ``127.0.0.1``). Behind Render the peer is
never localhost, so without that flag every user shares one rate-limit bucket.
These tests read the flags from the Dockerfile's real ``CMD`` and run the same
``ProxyHeadersMiddleware`` uvicorn would, so they fail if the flags are dropped.
"""

import re
import shlex
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.controllers import auth_controller
from app.main import app

DOCKERFILE = Path(__file__).resolve().parent.parent / "Dockerfile"
FORWARDED_FOR = {"X-Forwarded-For": "203.0.113.7, 10.0.0.1"}


def _uvicorn_args() -> list[str]:
    text = DOCKERFILE.read_text(encoding="utf-8")
    command = re.search(r"^CMD\s+\[(.*)\]\s*$", text, flags=re.MULTILINE)
    assert command, "Dockerfile has no exec-form CMD"
    script = re.findall(r'"((?:[^"\\]|\\.)*)"', command.group(1))[-1]
    return shlex.split(script.replace("${PORT:-8000}", "8000"))


def _flag_value(args: list[str], name: str, default: str | None = None) -> str | None:
    for index, argument in enumerate(args):
        if argument == name and index + 1 < len(args):
            return args[index + 1]
        if argument.startswith(name + "="):
            return argument.split("=", 1)[1]
    return default


def test_dockerfile_cmd_enables_proxy_headers_for_the_render_proxy():
    args = _uvicorn_args()

    assert "--no-proxy-headers" not in args
    assert _flag_value(args, "--forwarded-allow-ips") == "*"


@pytest.fixture
def seen_ips(monkeypatch, tmp_path):
    captured = []

    async def fake_sign_in(email, password):
        return {
            "access_token": "access.jwt.token",
            "refresh_token": "r" * 40,
            "expires_in": 900,
            "user": {"id": "11111111-1111-1111-1111-111111111111"},
        }

    monkeypatch.setenv("DB_PATH", str(tmp_path / "client-ip.db"))
    monkeypatch.setenv("SESSION_COOKIE_SECRET", "client-ip-secret-" + "k" * 32)
    monkeypatch.setattr(auth_controller, "sign_in", fake_sign_in)
    monkeypatch.setattr(
        auth_controller, "check_rate_limit", lambda client_ip: captured.append(client_ip)
    )
    return captured


def _client_behind_uvicorn_proxy_headers() -> TestClient:
    trusted = _flag_value(_uvicorn_args(), "--forwarded-allow-ips", "127.0.0.1")
    return TestClient(ProxyHeadersMiddleware(app, trusted_hosts=trusted))


def test_login_rate_limit_uses_the_forwarded_client_address(seen_ips):
    with _client_behind_uvicorn_proxy_headers() as client:
        response = client.post(
            "/auth/login",
            json={"email": "a@b.co", "password": "Secret123!"},
            headers=FORWARDED_FOR,
        )

    assert response.status_code == 200
    assert seen_ips == ["203.0.113.7"]


def test_rate_limit_falls_back_to_the_socket_address_without_the_header(seen_ips):
    with _client_behind_uvicorn_proxy_headers() as client:
        client.post(
            "/auth/login",
            json={"email": "a@b.co", "password": "Secret123!"},
        )

    assert seen_ips == ["testclient"]
