"""API routes: radio listing, detection, conversion, download."""

import os
import secrets
import time

from fastapi import APIRouter, Form, HTTPException, UploadFile

from app import converter
from app.config import DOWNLOAD_TOKEN_EXPIRE, MAX_UPLOAD_SIZE, UPLOAD_DIR

router = APIRouter(prefix="/api", tags=["api"])

# In-memory map of download tokens -> (file_path, expires_at)
_download_tokens: dict[str, tuple[str, float]] = {}


def _save_upload(upload: UploadFile) -> str:
    """Save uploaded file to UPLOAD_DIR, return path."""
    data = upload.file.read()
    if len(data) > MAX_UPLOAD_SIZE:
        raise HTTPException(413, "File too large")
    if not data:
        raise HTTPException(400, "Empty file")
    filename = f"{secrets.token_hex(8)}_{upload.filename or 'upload.img'}"
    path = str(UPLOAD_DIR / filename)
    with open(path, "wb") as f:
        f.write(data)
    return path


def _create_download_token(file_path: str) -> str:
    token = secrets.token_urlsafe(32)
    expires = time.time() + DOWNLOAD_TOKEN_EXPIRE
    _download_tokens[token] = (file_path, expires)
    return token


@router.get("/radios")
def list_radios():
    """Return all supported radios grouped by vendor."""
    return converter.get_supported_radios()


@router.post("/detect")
def detect_radio(file: UploadFile):
    """Upload a file and auto-detect the source radio."""
    path = _save_upload(file)
    try:
        vendor, model = converter.detect_source_radio(path)
        return {"vendor": vendor, "model": model, "upload_path": path}
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.post("/convert")
def convert_radio(
    file: UploadFile | None = None,
    upload_path: str | None = Form(None),
    dest_vendor: str = Form(""),
    dest_model: str = Form(""),
    source_vendor: str | None = Form(None),
    source_model: str | None = Form(None),
):
    """Convert an uploaded radio image to a different radio format."""
    if not dest_vendor or not dest_model:
        raise HTTPException(400, "dest_vendor and dest_model are required")

    # Use previously uploaded file or new upload
    if upload_path and os.path.exists(upload_path):
        source_path = upload_path
    elif file:
        source_path = _save_upload(file)
    else:
        raise HTTPException(400, "No file provided")

    try:
        result = converter.convert(
            source_path,
            dest_vendor,
            dest_model,
            source_vendor=source_vendor,
            source_model=source_model,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"Conversion failed: {exc}")

    token = _create_download_token(result.output_path)

    return {
        "download_url": f"/api/download/{token}",
        "source_vendor": result.source_vendor,
        "source_model": result.source_model,
        "dest_vendor": result.dest_vendor,
        "dest_model": result.dest_model,
        "converted": result.converted,
        "skipped": result.skipped,
        "warnings": result.warnings,
    }


@router.get("/download/{token}")
def download_file(token: str):
    """Download a converted file by token."""
    from fastapi.responses import FileResponse

    entry = _download_tokens.get(token)
    if not entry:
        raise HTTPException(404, "Download link not found or expired")

    file_path, expires = entry
    if time.time() > expires:
        _download_tokens.pop(token, None)
        raise HTTPException(410, "Download link expired")

    if not os.path.exists(file_path):
        raise HTTPException(404, "File not found")

    filename = os.path.basename(file_path)
    return FileResponse(
        file_path,
        media_type="application/octet-stream",
        filename=f"converted_{filename}",
    )
