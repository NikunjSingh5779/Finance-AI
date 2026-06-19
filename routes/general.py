from fastapi import APIRouter
from fastapi.responses import FileResponse

router = APIRouter()


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/")
def serve_index():
    return FileResponse("index.html")
