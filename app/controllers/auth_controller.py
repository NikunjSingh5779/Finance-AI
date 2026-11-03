"""Authentication endpoints backed by Supabase Auth."""

import os

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from app.core.auth import (
    AuthProviderError,
    auth_required,
    sign_in,
    sign_out,
    sign_up,
    refresh_session,
    user_id_from_request,
)
from app.core.rate_limiter import check_rate_limit


router = APIRouter(prefix="/auth", tags=["auth"])


class SignUpRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str | None = Field(default=None, max_length=100)


class SignInRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=20, max_length=4096)


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


@router.post("/signup")
async def signup(request: SignUpRequest, raw_request: Request) -> dict:
    client_ip = raw_request.client.host if raw_request.client else "unknown"
    check_rate_limit(client_ip)
    try:
        result = await sign_up(request.email, request.password, request.name)
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
        raise ValueError(str(exc)) from exc


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


@router.get("/me")
def me(raw_request: Request) -> dict:
    user_id = user_id_from_request(raw_request)
    return {"id": user_id}
