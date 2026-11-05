"""Authentication endpoints backed by Supabase Auth."""

import os
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field, field_validator

from app.core.auth import (
    AuthProviderError,
    auth_required,
    sign_in,
    sign_out,
    sign_up,
    refresh_session,
    start_google_oauth,
    exchange_google_oauth_code,
    sign_out_all,
    request_password_reset,
    verify_email_token,
    update_user_password,
    user_id_from_request,
)
from app.core.rate_limiter import check_rate_limit


router = APIRouter(prefix="/auth", tags=["auth"])


def _validate_password_value(password: str) -> str:
    if len(password) < 8:
        raise ValueError("Password must contain at least 8 characters.")
    if not any(character.isdigit() for character in password):
        raise ValueError("Password must contain at least one number.")
    if not any(not character.isalnum() and not character.isspace() for character in password):
        raise ValueError("Password must contain at least one special character.")
    return password


class SignUpRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str | None = Field(default=None, max_length=100)

    @field_validator("password")
    @classmethod
    def password_strength(cls, value: str) -> str:
        return _validate_password_value(value)


class SignInRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=20, max_length=4096)


class PasswordRecoveryRequest(BaseModel):
    email: EmailStr


class VerifyEmailRequest(BaseModel):
    token_hash: str = Field(min_length=20, max_length=4096)
    type: str = Field(pattern=r"^(signup|email|recovery)$")


class PasswordUpdateRequest(BaseModel):
    password: str = Field(min_length=8, max_length=128)

    @field_validator("password")
    @classmethod
    def password_strength(cls, value: str) -> str:
        return _validate_password_value(value)


class GoogleOAuthStartRequest(BaseModel):
    code_challenge: str = Field(
        min_length=43,
        max_length=43,
        pattern=r"^[A-Za-z0-9_-]{43}$",
    )


class GoogleOAuthExchangeRequest(BaseModel):
    auth_code: str = Field(min_length=8, max_length=2048)
    code_verifier: str = Field(
        min_length=43,
        max_length=128,
        pattern=r"^[A-Za-z0-9._~-]+$",
    )


@router.get("/config")
def auth_config() -> dict:
    return {
        "required": auth_required(),
        "configured": bool(
            os.getenv("SUPABASE_URL")
            and (
                os.getenv("SUPABASE_PUBLISHABLE_KEY")
                or os.getenv("SUPABASE_ANON_KEY")
            )
        ),
    }


@router.post("/google/start")
async def google_oauth_start(
    request: GoogleOAuthStartRequest,
    raw_request: Request,
) -> dict:
    client_ip = raw_request.client.host if raw_request.client else "unknown"
    check_rate_limit(client_ip)

    origin = raw_request.headers.get("origin", "").strip().rstrip("/")
    allowed_origins = {
        value.strip().rstrip("/")
        for value in os.getenv("CORS_ORIGINS", "").split(",")
        if value.strip()
    }
    parsed_origin = urlsplit(origin)
    valid_origin_shape = (
        parsed_origin.scheme in {"https", "http"}
        and bool(parsed_origin.netloc)
        and not parsed_origin.path
        and not parsed_origin.query
        and not parsed_origin.fragment
        and parsed_origin.username is None
        and parsed_origin.password is None
    )
    is_local_origin = (
        parsed_origin.scheme == "http"
        and parsed_origin.hostname in {"localhost", "127.0.0.1"}
    )
    if not valid_origin_shape or (origin not in allowed_origins and not is_local_origin):
        raise HTTPException(status_code=400, detail="This app origin is not allowed for Google sign-in.")

    redirect_to = origin + "/"
    try:
        url = await start_google_oauth(redirect_to, request.code_challenge)
        return {"url": url}
    except AuthProviderError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/google/native/start")
async def google_native_oauth_start(
    request: GoogleOAuthStartRequest,
    raw_request: Request,
) -> dict:
    client_ip = raw_request.client.host if raw_request.client else "unknown"
    check_rate_limit(client_ip)
    redirect_to = os.getenv(
        "MOBILE_AUTH_REDIRECT_URL",
        "financeai://auth/callback",
    ).strip()
    parsed = urlsplit(redirect_to)
    if parsed.scheme != "financeai" or not parsed.netloc:
        raise HTTPException(status_code=500, detail="Native Google sign-in redirect is not configured.")
    try:
        url = await start_google_oauth(redirect_to, request.code_challenge)
        return {"url": url}
    except AuthProviderError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/google/exchange")
async def google_oauth_exchange(
    request: GoogleOAuthExchangeRequest,
    raw_request: Request,
) -> dict:
    client_ip = raw_request.client.host if raw_request.client else "unknown"
    check_rate_limit(client_ip)
    try:
        result = await exchange_google_oauth_code(
            request.auth_code,
            request.code_verifier,
        )
        session = result.get("session") or result
        return {
            "user": result.get("user"),
            "access_token": session.get("access_token"),
            "refresh_token": session.get("refresh_token"),
            "expires_in": session.get("expires_in"),
        }
    except AuthProviderError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/signup")
async def signup(request: SignUpRequest, raw_request: Request) -> dict:
    client_ip = raw_request.client.host if raw_request.client else "unknown"
    check_rate_limit(client_ip)
    try:
        redirect_to = _allowed_redirect_origin(raw_request)
        result = await sign_up(request.email, request.password, request.name, redirect_to)
        session = result.get("session") or {}
        return {
            "user": result.get("user"),
            "access_token": session.get("access_token"),
            "refresh_token": session.get("refresh_token"),
            "expires_in": session.get("expires_in"),
            "requires_email_confirmation": not bool(session.get("access_token")),
        }
    except AuthProviderError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/signup/native")
async def signup_native(request: SignUpRequest, raw_request: Request) -> dict:
    check_rate_limit(raw_request.client.host if raw_request.client else "unknown")
    redirect_to = os.getenv(
        "MOBILE_AUTH_REDIRECT_URL",
        "financeai://auth/callback",
    ).strip()
    parsed = urlsplit(redirect_to)
    if parsed.scheme != "financeai" or not parsed.netloc:
        raise HTTPException(status_code=500, detail="Native email verification redirect is not configured.")
    try:
        result = await sign_up(request.email, request.password, request.name, redirect_to)
        session = result.get("session") or {}
        return {
            "user": result.get("user"),
            "access_token": session.get("access_token"),
            "refresh_token": session.get("refresh_token"),
            "expires_in": session.get("expires_in"),
            "requires_email_confirmation": not bool(session.get("access_token")),
        }
    except AuthProviderError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/login")
async def login(request: SignInRequest, raw_request: Request) -> dict:
    client_ip = raw_request.client.host if raw_request.client else "unknown"
    check_rate_limit(client_ip)
    try:
        result = await sign_in(request.email, request.password)
        session = result.get("session") or result
        return {
            "user": result.get("user"),
            "access_token": session.get("access_token"),
            "refresh_token": session.get("refresh_token"),
            "expires_in": session.get("expires_in"),
        }
    except AuthProviderError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/refresh")
async def refresh(request: RefreshRequest, raw_request: Request) -> dict:
    client_ip = raw_request.client.host if raw_request.client else "unknown"
    check_rate_limit(client_ip)
    try:
        result = await refresh_session(request.refresh_token)
        session = result.get("session") or result
        return {
            "user": result.get("user"),
            "access_token": session.get("access_token"),
            "refresh_token": session.get("refresh_token"),
            "expires_in": session.get("expires_in"),
        }
    except AuthProviderError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@router.post("/logout")
async def logout(raw_request: Request) -> dict:
    authorization = raw_request.headers.get("authorization", "")
    token = authorization.split(" ", 1)[1].strip() if authorization.lower().startswith("bearer ") else ""
    if token and auth_required():
        try:
            await sign_out(token)
        except AuthProviderError:
            pass
    return {"success": True}


@router.post("/logout-all")
async def logout_all(raw_request: Request) -> dict:
    authorization = raw_request.headers.get("authorization", "")
    token = authorization.split(" ", 1)[1].strip() if authorization.lower().startswith("bearer ") else ""
    if not token or not auth_required():
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        await sign_out_all(token)
    except AuthProviderError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    return {"success": True}


def _allowed_redirect_origin(raw_request: Request) -> str:
    origin = raw_request.headers.get("origin", "").strip().rstrip("/")
    allowed = {
        item.strip().rstrip("/")
        for item in os.getenv("CORS_ORIGINS", "").split(",")
        if item.strip()
    }
    parsed = urlsplit(origin)
    local = parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}
    if not origin or (origin not in allowed and not local):
        raise HTTPException(status_code=400, detail="This app origin is not allowed.")
    return origin + "/"


@router.post("/password/recovery")
async def password_recovery(
    request: PasswordRecoveryRequest,
    raw_request: Request,
) -> dict:
    check_rate_limit(raw_request.client.host if raw_request.client else "unknown")
    redirect_to = _allowed_redirect_origin(raw_request)
    try:
        await request_password_reset(request.email, redirect_to)
    except AuthProviderError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"success": True, "message": "If that email is registered, a recovery link has been sent."}


@router.post("/email/verify")
async def verify_email(request: VerifyEmailRequest, raw_request: Request) -> dict:
    check_rate_limit(raw_request.client.host if raw_request.client else "unknown")
    try:
        result = await verify_email_token(request.token_hash, request.type)
        session = result.get("session") or result
        return {
            "user": result.get("user"),
            "access_token": session.get("access_token"),
            "refresh_token": session.get("refresh_token"),
            "expires_in": session.get("expires_in"),
        }
    except AuthProviderError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/password/update")
async def password_update(request: PasswordUpdateRequest, raw_request: Request) -> dict:
    authorization = raw_request.headers.get("authorization", "")
    token = authorization.split(" ", 1)[1].strip() if authorization.lower().startswith("bearer ") else ""
    if not token:
        raise HTTPException(status_code=401, detail="A valid recovery session is required.")
    try:
        user_id_from_request(raw_request)
        await update_user_password(token, request.password)
        return {"success": True}
    except (AuthProviderError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/me")
def me(raw_request: Request) -> dict:
    user_id = user_id_from_request(raw_request)
    return {"id": user_id}
