from fastapi import APIRouter
from fastapi.responses import FileResponse
from pathlib import Path

router = APIRouter()
INDEX_FILE = Path(__file__).resolve().parent.parent / "index.html"


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/")
def serve_index():
    return FileResponse(INDEX_FILE)
