"""Authentication and user-context helpers for FinanceAI."""

from __future__ import annotations

import os
import uuid
from urllib.parse import quote
from contextvars import ContextVar, Token
from typing import Any

import jwt
import httpx
from fastapi import HTTPException, Request
from jwt import PyJWKClient


_user_id: ContextVar[str | None] = ContextVar("financeai_user_id", default=None)
_jwks_client: PyJWKClient | None = None


class AuthProviderError(RuntimeError):
    """Raised when Supabase Auth cannot complete an operation."""


def auth_required() -> bool:
    configured = bool(os.getenv("SUPABASE_URL"))
    value = os.getenv("AUTH_REQUIRED")
    if value is None:
        return configured
    return value.strip().lower() in {"1", "true", "yes", "on"}


def set_user_id(user_id: str) -> Token:
    return _user_id.set(user_id)


def reset_user_id(token: Token) -> None:
    _user_id.reset(token)


def get_current_user_id() -> str | None:
    return _user_id.get()


def _dev_user_id() -> str:
    raw = os.getenv("DEV_USER_ID", "00000000-0000-0000-0000-000000000001")
    try:
        return str(uuid.UUID(raw))
    except ValueError as exc:
        raise RuntimeError("DEV_USER_ID must be a valid UUID") from exc


def _supabase_url() -> str:
    value = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    if not value:
        raise AuthProviderError("SUPABASE_URL is not configured")
    return value


def _publishable_key() -> str:
    value = (
        os.getenv("SUPABASE_PUBLISHABLE_KEY")
        or os.getenv("SUPABASE_ANON_KEY")
        or ""
    ).strip()
    if not value:
        raise AuthProviderError(
            "SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY) is not configured"
        )
    return value


def _jwks_client_instance() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        url = os.getenv("SUPABASE_JWKS_URL", "").strip() or (
            f"{_supabase_url()}/auth/v1/.well-known/jwks.json"
        )
        _jwks_client = PyJWKClient(url, cache_jwk_set=True, lifespan=600)
    return _jwks_client


def verify_access_token(token: str) -> dict[str, Any]:
    """Verify a Supabase access JWT locally and return its claims."""
    if not token:
        raise ValueError("Missing access token")

    try:
        header = jwt.get_unverified_header(token)
        algorithm = header.get("alg")
        if not algorithm:
            raise ValueError("JWT is missing its signing algorithm")

        issuer = f"{_supabase_url()}/auth/v1"
        secret = os.getenv("SUPABASE_JWT_SECRET", "").strip()

        if algorithm == "HS256" and secret:
            claims = jwt.decode(
                token,
                secret,
                algorithms=["HS256"],
                audience="authenticated",
                issuer=issuer,
            )
        else:
            signing_key = _jwks_client_instance().get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                signing_key.key,
                algorithms=["ES256", "RS256", "EdDSA"],
                audience="authenticated",
                issuer=issuer,
            )

        user_id = claims.get("sub")
        if not user_id:
            raise ValueError("JWT does not contain a user id")

        uuid.UUID(str(user_id))
        if claims.get("role") not in {None, "authenticated"}:
            raise ValueError("JWT role is not authenticated")
        return claims
    except Exception as exc:
        raise ValueError("Invalid or expired authentication token") from exc


def user_id_from_request(request: Request) -> str:
    authorization = request.headers.get("authorization", "")
    if not authorization.lower().startswith("bearer "):
        if auth_required():
            raise HTTPException(status_code=401, detail="Authentication required")
        return _dev_user_id()

    token = authorization.split(" ", 1)[1].strip()
    try:
        claims = verify_access_token(token)
        return str(uuid.UUID(str(claims["sub"])))
    except ValueError as exc:
        if auth_required():
            raise HTTPException(status_code=401, detail=str(exc)) from exc
        return _dev_user_id()


def current_user_from_request(request: Request) -> str:
    return user_id_from_request(request)


async def _supabase_request(
    method: str,
    path: str,
    *,
    access_token: str | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    headers = {
        "apikey": _publishable_key(),
        "Content-Type": "application/json",
    }
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"

    async with httpx.AsyncClient(
        base_url=f"{_supabase_url()}/auth/v1",
        timeout=httpx.Timeout(15.0, connect=5.0),
        headers=headers,
    ) as client:
        response = await client.request(method, path, json=payload or {})
        try:
            body = response.json()
        except ValueError:
            body = {"msg": response.text[:300]}

    if not response.is_success:
        message = (
            body.get("msg")
            or body.get("error_description")
            or body.get("message")
            or body.get("error")
            or "Supabase Auth request failed"
        )
        raise AuthProviderError(str(message))

    return body


async def sign_up(
    email: str,
    password: str,
    name: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "email": email,
        "password": password,
    }
    if name:
        payload["data"] = {"name": name}
    return await _supabase_request("POST", "/signup", payload=payload)


async def sign_in(email: str, password: str) -> dict[str, Any]:
    return await _supabase_request(
        "POST",
        "/token?grant_type=password",
        payload={"email": email, "password": password},
    )


async def refresh_session(refresh_token: str) -> dict[str, Any]:
    return await _supabase_request(
        "POST",
        "/token?grant_type=refresh_token",
        payload={"refresh_token": refresh_token},
    )


async def sign_out(access_token: str) -> None:
    """Revoke only this device's session; other devices stay signed in."""
    await _supabase_request(
        "POST",
        "/logout?scope=local",
        access_token=access_token,
    )


async def sign_out_all(access_token: str) -> None:
    """Explicitly revoke every session for the current user."""
    await _supabase_request(
        "POST",
        "/logout?scope=global",
        access_token=access_token,
    )


async def request_password_reset(email: str, redirect_to: str) -> dict[str, Any]:
    from urllib.parse import quote

    return await _supabase_request(
        "POST",
        "/recover?redirect_to=" + quote(redirect_to, safe=""),
        payload={"email": email},
    )


async def verify_email_token(token_hash: str, token_type: str) -> dict[str, Any]:
    return await _supabase_request(
        "POST",
        "/verify",
        payload={"token_hash": token_hash, "type": token_type},
    )


async def update_user_password(access_token: str, password: str) -> dict[str, Any]:
    return await _supabase_request(
        "PUT",
        "/user",
        access_token=access_token,
        payload={"password": password},
    )


async def start_google_oauth(redirect_to: str, code_challenge: str) -> str:
    """Return the provider authorization URL for a browser PKCE flow."""
    params = {
        "provider": "google",
        "redirect_to": redirect_to,
        "code_challenge": code_challenge,
        "code_challenge_method": "s256",
    }
    headers = {"apikey": _publishable_key()}

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(15.0, connect=5.0),
        follow_redirects=False,
        headers=headers,
    ) as client:
        response = await client.get(
            f"{_supabase_url()}/auth/v1/authorize",
            params=params,
        )

    location = response.headers.get("location")
    if response.is_redirect and location:
        return location

    try:
        body = response.json()
    except ValueError:
        body = {}

    message = (
        body.get("msg")
        or body.get("message")
        or body.get("error_description")
        or body.get("error")
        or "Google sign-in could not be started"
    )
    if response.status_code in {400, 404}:
        message = (
            "Google sign-in is not enabled in Supabase yet. Configure the Google "
            "provider in Authentication → Sign In / Providers."
        )
    raise AuthProviderError(str(message))


async def exchange_google_oauth_code(
    auth_code: str,
    code_verifier: str,
) -> dict[str, Any]:
    """Exchange a Supabase PKCE authorization code for a user session."""
    return await _supabase_request(
        "POST",
        "/token?grant_type=pkce",
        payload={
            "auth_code": auth_code,
            "code_verifier": code_verifier,
        },
    )
