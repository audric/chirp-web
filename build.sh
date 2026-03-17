#!/bin/bash
# Copy chirp source into build context (Docker can't COPY from outside context)
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHIRP_SRC="${SCRIPT_DIR}/../chirp"

echo "Copying chirp source into build context..."
rsync -a --delete \
    --exclude='.git' \
    --exclude='__pycache__' \
    --exclude='*.pyc' \
    --exclude='.tox' \
    --exclude='*.egg-info' \
    "$CHIRP_SRC/" "$SCRIPT_DIR/chirp-src/"

echo "Building Docker image..."
docker compose build

echo "Cleaning up..."
rm -rf "$SCRIPT_DIR/chirp-src"

echo "Done. Run with: docker compose up"
