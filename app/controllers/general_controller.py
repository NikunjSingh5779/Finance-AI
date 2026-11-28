import os
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import HTMLResponse, RedirectResponse

from app.core.auth import auth_required

router = APIRouter(tags=["system"])

_STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
_INDEX_FILE = _STATIC_DIR / "index.html"
_PUBLIC_APP_URL = "https://finance-ai-61h.pages.dev"


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/", response_class=HTMLResponse)
def serve_index():
    # In production, Cloudflare Pages is the only public frontend (it proxies
    # the API so the session cookie is first-party). Redirect anyone opening
    # the Render service URL to it. PUBLIC_APP_URL overrides the default.
    if auth_required():
        public_url = os.getenv("PUBLIC_APP_URL", _PUBLIC_APP_URL).strip()
        return RedirectResponse(url=public_url, status_code=307)

    # Keep the local development workflow unchanged.
    if not _INDEX_FILE.exists():
        return HTMLResponse(
            "<h1>FinanceAI API is running</h1><p>Frontend asset not found.</p>",
            status_code=503,
        )

    return HTMLResponse(content=_INDEX_FILE.read_text(encoding="utf-8"))
