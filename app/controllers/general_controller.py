from fastapi import APIRouter
from fastapi.responses import FileResponse
from pathlib import Path

router = APIRouter()


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/")
def serve_index():
    # Serve index.html from the static directory
    static_dir = Path(__file__).parent.parent / "static"
    index_file = static_dir / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    else:
        return {"message": "Finance AI API is running"}