from http.cookies import SimpleCookie

import httpx
import pytest
from fastapi.testclient import TestClient

from app.controllers import auth_controller
from app.core.auth import AuthProviderError
from app.core.rate_limiter import reset_rate_limiter
from app.core.session_cookie import decode_refresh_cookie, encode_refresh_cookie
from app.main import app

ORIGIN = {"Origin": "http://localhost:3000"}
BAD_ORIGIN = {"Origin": "https://evil.example"}
OLD_REFRESH = "o" * 40
NEW_REFRESH = "n" * 40
WEEK = 604800
USER = {"id": "11111111-1111-1111-1111-111111111111", "email": "a@b.co"}


def _session(refresh_token=NEW_REFRESH):
    return {
        "access_token": "access.jwt.token",
        "refresh_token": refresh_token,
        "expires_in": 900,
        "user": USER,
    }


class Calls:
    def __init__(self):
        self.refresh = []
        self.sign_out = []
        self.sign_out_all = []


@pytest.fixture
def calls():
    return Calls()


@pytest.fixture
def client(monkeypatch, calls):
    monkeypatch.setenv("SESSION_COOKIE_SECRET", "flow-test-secret-" + "z" * 32)
    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "1000")
    # Controller-level only: app startup stays in local mode (SQLite), while
    # logout paths behave as they do when Supabase auth is enforced.
    monkeypatch.setattr(auth_controller, "auth_required", lambda: True)
    for name in ("RENDER", "RENDER_SERVICE_ID", "RENDER_EXTERNAL_URL", "APP_ENV"):
        monkeypatch.delenv(name, raising=False)

    async def fake_sign_in(email, password):
        return _session()

    async def fake_sign_up(email, password, name=None, redirect_to=None):
        return {"user": USER, "session": _session()}

    async def fake_refresh(refresh_token):
        calls.refresh.append(refresh_token)
        return _session()

    async def fake_sign_out(token):
        calls.sign_out.append(token)

    async def fake_sign_out_all(token):
        calls.sign_out_all.append(token)

    async def fake_exchange(auth_code, code_verifier):
        return _session()

    async def fake_verify(token_hash, token_type):
        return _session()

    monkeypatch.setattr(auth_controller, "sign_in", fake_sign_in)
    monkeypatch.setattr(auth_controller, "sign_up", fake_sign_up)
    monkeypatch.setattr(auth_controller, "refresh_session", fake_refresh)
    monkeypatch.setattr(auth_controller, "sign_out", fake_sign_out)
    monkeypatch.setattr(auth_controller, "sign_out_all", fake_sign_out_all)
    monkeypatch.setattr(auth_controller, "exchange_google_oauth_code", fake_exchange)
    monkeypatch.setattr(auth_controller, "verify_email_token", fake_verify)
    reset_rate_limiter()
    with TestClient(app) as test_client:
        yield test_client
    reset_rate_limiter()


def _cookie_header(value):
    return {"Cookie": f"fa_rt={value}"}


def _set_cookies(response):
    return response.headers.get_list("set-cookie")


def _fa_rt_value(response):
    for header in _set_cookies(response):
        if header.startswith("fa_rt="):
            morsel = SimpleCookie()
            morsel.load(header)
            return morsel["fa_rt"].value
    return None


def _assert_cleared(response):
    headers = [h for h in _set_cookies(response) if h.startswith("fa_rt=")]
    assert headers, "expected a Set-Cookie clearing fa_rt"
    assert "Max-Age=0" in headers[0]
    assert "Path=/auth" in headers[0]


def _assert_no_session_cookie_change(response):
    assert not any(h.startswith("fa_rt=") for h in _set_cookies(response))


def test_login_sets_cookie_and_hides_refresh_token(client):
    response = client.post(
        "/auth/login", json={"email": "a@b.co", "password": "Secret123!"}
    )

    assert response.status_code == 200
    body = response.json()
    assert "refresh_token" not in body
    assert body["access_token"] == "access.jwt.token"
    assert body["expires_in"] == 900
    token, _ = decode_refresh_cookie(_fa_rt_value(response))
    assert token == NEW_REFRESH
    cookie = _set_cookies(response)[0]
    assert "HttpOnly" in cookie and "Path=/auth" in cookie
    assert "SameSite=lax" in cookie and f"Max-Age={WEEK}" in cookie


def test_signup_with_session_sets_cookie(client):
    response = client.post(
        "/auth/signup",
        json={"email": "a@b.co", "password": "Secret123!"},
        headers=ORIGIN,
    )

    assert response.status_code == 200
    assert "refresh_token" not in response.json()
    assert response.json()["requires_email_confirmation"] is False
    assert _fa_rt_value(response)


def test_signup_awaiting_confirmation_sets_no_cookie(client, monkeypatch):
    async def no_session(email, password, name=None, redirect_to=None):
        return {"user": USER, "session": None}

    monkeypatch.setattr(auth_controller, "sign_up", no_session)

    response = client.post(
        "/auth/signup",
        json={"email": "a@b.co", "password": "Secret123!"},
        headers=ORIGIN,
    )

    assert response.status_code == 200
    assert response.json()["requires_email_confirmation"] is True
    _assert_no_session_cookie_change(response)


def test_google_exchange_and_email_verify_use_the_cookie(client):
    exchange = client.post(
        "/auth/google/exchange",
        json={"auth_code": "code-12345", "code_verifier": "v" * 43},
    )
    verify = client.post(
        "/auth/email/verify", json={"token_hash": "h" * 24, "type": "signup"}
    )

    for response in (exchange, verify):
        assert response.status_code == 200
        assert "refresh_token" not in response.json()
        assert _fa_rt_value(response)


def test_refresh_with_valid_cookie_rotates_without_extending_the_cap(client, calls):
    import time

    issued_at = int(time.time()) - 3 * 86400
    cookie = encode_refresh_cookie(OLD_REFRESH, issued_at=issued_at)

    response = client.post("/auth/refresh", headers={**ORIGIN, **_cookie_header(cookie)})

    assert response.status_code == 200
    body = response.json()
    assert body["access_token"] == "access.jwt.token"
    assert "refresh_token" not in body
    assert calls.refresh == [OLD_REFRESH]
    token, reissued = decode_refresh_cookie(_fa_rt_value(response))
    assert token == NEW_REFRESH
    assert reissued == issued_at, "refresh rotation must not slide the 7-day cap"


def test_refresh_with_expired_cookie_is_401_and_clears_it(client, calls):
    import time

    cookie = encode_refresh_cookie(
        OLD_REFRESH, issued_at=int(time.time()) - 8 * 86400
    )

    response = client.post("/auth/refresh", headers={**ORIGIN, **_cookie_header(cookie)})

    assert response.status_code == 401
    _assert_cleared(response)
    assert calls.refresh == []


def test_refresh_with_tampered_cookie_is_401_and_clears_it(client, calls):
    cookie = encode_refresh_cookie(OLD_REFRESH)
    tampered = cookie[:-1] + ("0" if cookie[-1] != "0" else "1")

    response = client.post(
        "/auth/refresh", headers={**ORIGIN, **_cookie_header(tampered)}
    )

    assert response.status_code == 401
    _assert_cleared(response)
    assert calls.refresh == []


def test_refresh_without_any_credentials_is_401(client, calls):
    response = client.post("/auth/refresh", headers=ORIGIN)

    assert response.status_code == 401
    assert calls.refresh == []


@pytest.mark.parametrize("path", ["/auth/refresh", "/auth/logout", "/auth/logout-all"])
def test_cookie_endpoints_reject_untrusted_or_missing_origin(client, calls, path):
    cookie = encode_refresh_cookie(OLD_REFRESH)

    bad = client.post(path, headers={**BAD_ORIGIN, **_cookie_header(cookie)})
    missing = client.post(path, headers=_cookie_header(cookie))

    assert bad.status_code == 403
    assert missing.status_code == 403
    assert calls.refresh == [] and calls.sign_out == [] and calls.sign_out_all == []


def test_refresh_provider_rejection_is_401_and_clears_cookie(
    client, calls, monkeypatch
):
    async def rejected(refresh_token):
        raise AuthProviderError("Invalid Refresh Token: Already Used", status_code=400)

    monkeypatch.setattr(auth_controller, "refresh_session", rejected)
    cookie = encode_refresh_cookie(OLD_REFRESH)

    response = client.post("/auth/refresh", headers={**ORIGIN, **_cookie_header(cookie)})

    assert response.status_code == 401
    _assert_cleared(response)


def test_second_concurrent_refresh_with_a_used_token_maps_to_401(
    client, calls, monkeypatch
):
    """Documents why the client must single-flight refreshes (Task 6)."""
    outcomes = iter([_session(), None])

    async def first_ok_then_already_used(refresh_token):
        calls.refresh.append(refresh_token)
        outcome = next(outcomes)
        if outcome is None:
            raise AuthProviderError("Already Used", status_code=400)
        return outcome

    monkeypatch.setattr(auth_controller, "refresh_session", first_ok_then_already_used)
    cookie = encode_refresh_cookie(OLD_REFRESH)
    headers = {**ORIGIN, **_cookie_header(cookie)}

    first = client.post("/auth/refresh", headers=headers)
    second = client.post("/auth/refresh", headers=headers)

    assert first.status_code == 200
    assert second.status_code == 401


@pytest.mark.parametrize("status", [429, 500, 502, 503])
def test_refresh_transient_provider_failure_keeps_the_cookie(
    client, monkeypatch, status
):
    async def flaky(refresh_token):
        raise AuthProviderError("upstream unavailable", status_code=status)

    monkeypatch.setattr(auth_controller, "refresh_session", flaky)
    cookie = encode_refresh_cookie(OLD_REFRESH)

    response = client.post("/auth/refresh", headers={**ORIGIN, **_cookie_header(cookie)})

    assert response.status_code == (429 if status == 429 else 503)
    _assert_no_session_cookie_change(response)


def test_refresh_network_failure_is_503_and_keeps_the_cookie(client, monkeypatch):
    async def unreachable(refresh_token):
        raise httpx.ConnectTimeout("cold start")

    monkeypatch.setattr(auth_controller, "refresh_session", unreachable)
    cookie = encode_refresh_cookie(OLD_REFRESH)

    response = client.post("/auth/refresh", headers={**ORIGIN, **_cookie_header(cookie)})

    assert response.status_code == 503
    _assert_no_session_cookie_change(response)


def test_legacy_body_refresh_token_is_accepted_once_for_migration(client, calls):
    import time

    before = int(time.time())

    response = client.post(
        "/auth/refresh", json={"refresh_token": OLD_REFRESH}, headers=ORIGIN
    )

    assert response.status_code == 200
    assert calls.refresh == [OLD_REFRESH]
    _, issued_at = decode_refresh_cookie(_fa_rt_value(response))
    assert before <= issued_at <= int(time.time()) + 1


def test_cookie_takes_precedence_over_a_body_token(client, calls):
    cookie = encode_refresh_cookie(OLD_REFRESH)

    client.post(
        "/auth/refresh",
        json={"refresh_token": "b" * 40},
        headers={**ORIGIN, **_cookie_header(cookie)},
    )

    assert calls.refresh == [OLD_REFRESH]


def test_logout_clears_cookie_and_signs_out_the_device(client, calls):
    cookie = encode_refresh_cookie(OLD_REFRESH)

    response = client.post(
        "/auth/logout",
        headers={**ORIGIN, **_cookie_header(cookie), "Authorization": "Bearer abc.def.ghi"},
    )

    assert response.status_code == 200
    _assert_cleared(response)
    assert calls.sign_out == ["abc.def.ghi"]


def test_logout_without_bearer_still_clears_cookie(client, calls):
    response = client.post("/auth/logout", headers=ORIGIN)

    assert response.status_code == 200
    _assert_cleared(response)
    assert calls.sign_out == []


def test_logout_all_revokes_every_session_and_clears_cookie(client, calls):
    response = client.post(
        "/auth/logout-all",
        headers={**ORIGIN, "Authorization": "Bearer abc.def.ghi"},
    )

    assert response.status_code == 200
    _assert_cleared(response)
    assert calls.sign_out_all == ["abc.def.ghi"]


def test_cors_allows_credentials_for_trusted_origins(client):
    cookie = encode_refresh_cookie(OLD_REFRESH)

    response = client.post("/auth/refresh", headers={**ORIGIN, **_cookie_header(cookie)})

    assert response.headers.get("access-control-allow-credentials") == "true"
    assert response.headers.get("access-control-allow-origin") == ORIGIN["Origin"]
