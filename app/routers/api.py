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

# In-memory set of valid upload paths (created by _save_upload)
_valid_uploads: set[str] = set()


def _sanitize_filename(filename: str | None) -> str:
    """Strip path components and dangerous characters from a filename."""
    if not filename:
        return "upload.img"
    # Take only the final component (no directory traversal)
    name = os.path.basename(filename)
    # Remove any remaining suspicious characters
    name = "".join(c for c in name if c.isalnum() or c in "._-")
    return name or "upload.img"


def _save_upload(upload: UploadFile) -> str:
    """Save uploaded file to UPLOAD_DIR, return path."""
    data = upload.file.read()
    if len(data) > MAX_UPLOAD_SIZE:
        raise HTTPException(413, "File too large")
    if not data:
        raise HTTPException(400, "Empty file")
    safe_name = _sanitize_filename(upload.filename)
    filename = f"{secrets.token_hex(8)}_{safe_name}"
    path = str(UPLOAD_DIR / filename)
    with open(path, "wb") as f:
        f.write(data)
    _valid_uploads.add(path)
    return path


def _validate_upload_path(upload_path: str) -> str:
    """Validate that an upload_path was created by us and is inside UPLOAD_DIR."""
    # Resolve to absolute path to prevent traversal
    resolved = os.path.realpath(upload_path)
    upload_dir = str(UPLOAD_DIR.resolve())
    if not resolved.startswith(upload_dir + os.sep):
        raise HTTPException(400, "Invalid upload path")
    if resolved not in _valid_uploads:
        raise HTTPException(400, "Invalid upload path")
    if not os.path.exists(resolved):
        raise HTTPException(400, "Upload file not found")
    return resolved


def _create_download_token(file_path: str) -> str:
    token = secrets.token_urlsafe(32)
    expires = time.time() + DOWNLOAD_TOKEN_EXPIRE
    _download_tokens[token] = (file_path, expires)
    return token


def _cleanup_expired_tokens():
    """Remove expired tokens and their files."""
    now = time.time()
    expired = [t for t, (_, exp) in _download_tokens.items() if now > exp]
    for t in expired:
        file_path, _ = _download_tokens.pop(t)
        try:
            os.unlink(file_path)
        except OSError:
            pass


@router.get("/radios")
def list_radios():
    """Return all supported radios grouped by vendor."""
    return converter.get_supported_radios()


@router.get("/stock-configs")
def list_stock_configs():
    """Return available CHIRP stock/preset memory lists."""
    return converter.get_stock_configs()


@router.post("/detect")
def detect_radio(file: UploadFile):
    """Upload a file and auto-detect the source radio."""
    path = _save_upload(file)
    try:
        vendor, model = converter.detect_source_radio(path)
        # Return an opaque upload ID (just the filename, not full path)
        upload_id = os.path.basename(path)
        return {"vendor": vendor, "model": model, "upload_id": upload_id}
    except ValueError as exc:
        # Clean up on failure
        try:
            os.unlink(path)
            _valid_uploads.discard(path)
        except OSError:
            pass
        raise HTTPException(400, str(exc))


@router.post("/convert")
def convert_radio(
    file: UploadFile | None = None,
    upload_id: str | None = Form(None),
    stock_config: str | None = Form(None),
    dest_vendor: str = Form(""),
    dest_model: str = Form(""),
    source_vendor: str | None = Form(None),
    source_model: str | None = Form(None),
):
    """Convert an uploaded radio image to a different radio format."""
    if not dest_vendor or not dest_model:
        raise HTTPException(400, "dest_vendor and dest_model are required")

    # Clean up expired tokens/files periodically
    _cleanup_expired_tokens()

    # Resolve source file: stock config, upload_id from prior detect, or new upload
    stock_source = False
    if stock_config:
        try:
            source_path = converter.get_stock_config_path(stock_config)
            stock_source = True
        except ValueError as exc:
            raise HTTPException(400, str(exc))
    elif upload_id:
        safe_id = os.path.basename(upload_id)
        source_path = _validate_upload_path(str(UPLOAD_DIR / safe_id))
    elif file:
        source_path = _save_upload(file)
    else:
        raise HTTPException(400, "No file provided")

    try:
        # Stock configs are CHIRP CSV files
        if stock_source:
            source_vendor = "Generic"
            source_model = "CSV"
        result = converter.convert(
            source_path,
            dest_vendor,
            dest_model,
            source_vendor=source_vendor,
            source_model=source_model,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception:
        raise HTTPException(500, "Conversion failed")

    # Clean up source upload
    try:
        os.unlink(source_path)
        _valid_uploads.discard(source_path)
    except OSError:
        pass

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
        try:
            os.unlink(file_path)
        except OSError:
            pass
        raise HTTPException(410, "Download link expired")

    if not os.path.exists(file_path):
        raise HTTPException(404, "File not found")

    filename = os.path.basename(file_path)
    return FileResponse(
        file_path,
        media_type="application/octet-stream",
        filename=f"converted_{filename}",
    )
