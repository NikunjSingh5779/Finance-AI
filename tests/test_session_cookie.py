import pytest

from app.core import session_cookie
from app.core.auth import validate_runtime_configuration

WEEK = 604800
REFRESH_TOKEN = "abcdEFGH1234-_xyz"
NOW = 1_800_000_000


@pytest.fixture(autouse=True)
def _secret(monkeypatch):
    monkeypatch.setenv("SESSION_COOKIE_SECRET", "unit-test-secret-" + "x" * 32)


def test_round_trip_returns_token_and_issue_time():
    value = session_cookie.encode_refresh_cookie(REFRESH_TOKEN, issued_at=NOW)

    token, issued_at = session_cookie.decode_refresh_cookie(value, now=NOW + 5)

    assert token == REFRESH_TOKEN
    assert issued_at == NOW


def test_encode_defaults_issue_time_to_now():
    value = session_cookie.encode_refresh_cookie(REFRESH_TOKEN)

    token, issued_at = session_cookie.decode_refresh_cookie(value)

    assert token == REFRESH_TOKEN
    assert abs(issued_at - session_cookie._now()) <= 5


def test_tampered_signature_is_rejected():
    value = session_cookie.encode_refresh_cookie(REFRESH_TOKEN, issued_at=NOW)
    flipped = value[:-1] + ("0" if value[-1] != "0" else "1")

    with pytest.raises(ValueError):
        session_cookie.decode_refresh_cookie(flipped, now=NOW)


def test_tampered_issue_time_is_rejected():
    value = session_cookie.encode_refresh_cookie(REFRESH_TOKEN, issued_at=NOW)
    version, encoded_token, _issued, signature = value.split(".")
    forged = ".".join([version, encoded_token, str(NOW + WEEK), signature])

    with pytest.raises(ValueError):
        session_cookie.decode_refresh_cookie(forged, now=NOW + WEEK)


@pytest.mark.parametrize("garbage", ["", "nope", "a.b", "v1.a.b.c.d", "v1..1."])
def test_malformed_value_is_rejected(garbage):
    with pytest.raises(ValueError):
        session_cookie.decode_refresh_cookie(garbage, now=NOW)


def test_cookie_older_than_seven_days_is_rejected():
    value = session_cookie.encode_refresh_cookie(REFRESH_TOKEN, issued_at=NOW)

    with pytest.raises(ValueError):
        session_cookie.decode_refresh_cookie(value, now=NOW + WEEK + 1)


def test_cookie_at_six_days_twenty_three_hours_is_accepted():
    value = session_cookie.encode_refresh_cookie(REFRESH_TOKEN, issued_at=NOW)

    token, _ = session_cookie.decode_refresh_cookie(
        value, now=NOW + 6 * 86400 + 23 * 3600
    )

    assert token == REFRESH_TOKEN


def test_cookie_from_the_future_is_rejected():
    value = session_cookie.encode_refresh_cookie(REFRESH_TOKEN, issued_at=NOW + 3600)

    with pytest.raises(ValueError):
        session_cookie.decode_refresh_cookie(value, now=NOW)


def test_cookie_signed_with_another_secret_is_rejected(monkeypatch):
    value = session_cookie.encode_refresh_cookie(REFRESH_TOKEN, issued_at=NOW)
    monkeypatch.setenv("SESSION_COOKIE_SECRET", "a-different-secret-" + "y" * 32)

    with pytest.raises(ValueError):
        session_cookie.decode_refresh_cookie(value, now=NOW)


def test_cookie_kwargs_are_httponly_lax_scoped_to_auth(monkeypatch):
    for name in ("APP_ENV", "ENVIRONMENT", "DEPLOYMENT_ENV", "RENDER",
                 "RENDER_SERVICE_ID", "RENDER_EXTERNAL_URL"):
        monkeypatch.delenv(name, raising=False)

    kwargs = session_cookie.cookie_kwargs()

    assert kwargs == {
        "httponly": True,
        "secure": False,
        "samesite": "lax",
        "path": "/auth",
        "max_age": WEEK,
    }


def test_cookie_kwargs_are_secure_in_production(monkeypatch):
    monkeypatch.setenv("RENDER", "true")

    assert session_cookie.cookie_kwargs()["secure"] is True


def _production_env(monkeypatch):
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x")
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@h/db")
    monkeypatch.delenv("AUTH_REQUIRED", raising=False)


def test_production_startup_requires_session_cookie_secret(monkeypatch):
    _production_env(monkeypatch)
    monkeypatch.delenv("SESSION_COOKIE_SECRET", raising=False)

    with pytest.raises(RuntimeError, match="SESSION_COOKIE_SECRET"):
        validate_runtime_configuration()


def test_production_startup_rejects_short_session_cookie_secret(monkeypatch):
    _production_env(monkeypatch)
    monkeypatch.setenv("SESSION_COOKIE_SECRET", "too-short")

    with pytest.raises(RuntimeError, match="SESSION_COOKIE_SECRET"):
        validate_runtime_configuration()


def test_production_startup_accepts_configured_secret(monkeypatch):
    _production_env(monkeypatch)
    monkeypatch.setenv("SESSION_COOKIE_SECRET", "s" * 40)

    validate_runtime_configuration()


def test_production_never_falls_back_to_the_development_secret(monkeypatch):
    _production_env(monkeypatch)
    monkeypatch.delenv("SESSION_COOKIE_SECRET", raising=False)

    with pytest.raises(RuntimeError):
        session_cookie.encode_refresh_cookie(REFRESH_TOKEN, issued_at=NOW)
