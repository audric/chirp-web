from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = BASE_DIR / "uploads"

UPLOAD_DIR.mkdir(exist_ok=True)

# Max upload size in bytes (10 MB)
MAX_UPLOAD_SIZE = 10 * 1024 * 1024

# Converted file download tokens expire after this many seconds
DOWNLOAD_TOKEN_EXPIRE = 600
