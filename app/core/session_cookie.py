"""Signed, 7-day-capped cookie that carries the Supabase refresh token.

The cookie value is ``v1.<b64url(refresh_token)>.<issued_at>.<hex hmac>``. The
HMAC covers ``refresh_token|issued_at`` so neither can be altered. ``issued_at``
is the moment the user originally logged in; refresh rotation re-issues the
cookie with the *same* ``issued_at`` so the 7-day cap never slides.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import os
import time

from app.core.auth import is_production

SESSION_COOKIE_NAME = "fa_rt"
SESSION_MAX_AGE_SECONDS = 604800  # 7 days
MIN_SECRET_LENGTH = 32

_VERSION = "v1"
_DEV_SECRET = "financeai-local-development-session-secret-not-for-production"


def _now() -> int:
    return int(time.time())


def _secret() -> bytes:
    value = os.getenv("SESSION_COOKIE_SECRET", "").strip()
    if value:
        return value.encode("utf-8")
    if is_production():
        raise RuntimeError("SESSION_COOKIE_SECRET is required in production")
    return _DEV_SECRET.encode("utf-8")


def _sign(refresh_token: str, issued_at: int) -> str:
    message = f"{refresh_token}|{issued_at}".encode("utf-8")
    return hmac.new(_secret(), message, hashlib.sha256).hexdigest()


def encode_refresh_cookie(refresh_token: str, issued_at: int | None = None) -> str:
    issued = _now() if issued_at is None else int(issued_at)
    encoded = base64.urlsafe_b64encode(refresh_token.encode("utf-8")).decode("ascii")
    return ".".join(
        [_VERSION, encoded.rstrip("="), str(issued), _sign(refresh_token, issued)]
    )


def decode_refresh_cookie(value: str, now: int | None = None) -> tuple[str, int]:
    """Return ``(refresh_token, issued_at)`` or raise ``ValueError``."""
    parts = (value or "").split(".")
    if len(parts) != 4 or parts[0] != _VERSION or not parts[1] or not parts[2]:
        raise ValueError("Malformed session cookie")

    _, encoded, issued_text, signature = parts
    try:
        issued_at = int(issued_text)
        padded = encoded + "=" * (-len(encoded) % 4)
        refresh_token = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
    except (ValueError, UnicodeError, binascii.Error) as exc:
        raise ValueError("Malformed session cookie") from exc
    if not refresh_token:
        raise ValueError("Malformed session cookie")

    expected = _sign(refresh_token, issued_at)
    if not hmac.compare_digest(expected, signature):
        raise ValueError("Invalid session cookie signature")

    current = _now() if now is None else int(now)
    if issued_at > current:
        raise ValueError("Session cookie was issued in the future")
    if current - issued_at > SESSION_MAX_AGE_SECONDS:
        raise ValueError("Session cookie has expired")

    return refresh_token, issued_at


def cookie_kwargs() -> dict:
    return {
        "httponly": True,
        "secure": is_production(),
        "samesite": "lax",
        "path": "/auth",
        "max_age": SESSION_MAX_AGE_SECONDS,
    }
