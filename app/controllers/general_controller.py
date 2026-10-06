from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter(tags=["system"])

_STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
_INDEX_FILE = _STATIC_DIR / "index.html"


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/", response_class=HTMLResponse)
def serve_index():
    if not _INDEX_FILE.exists():
        return HTMLResponse(
            "<h1>FinanceAI API is running</h1><p>Frontend asset not found.</p>",
            status_code=503,
        )

    html = _INDEX_FILE.read_text(encoding="utf-8")
    html = html.replace(
        "</head>",
        '<link rel="stylesheet" href="/static/insights.css"></head>',
        1,
    )
    html = html.replace(
        "</body>",
        '<script src="/static/enhancements.js"></script></body>',
        1,
    )
    return HTMLResponse(content=html)
