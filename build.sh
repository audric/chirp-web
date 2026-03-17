#!/bin/bash
# Build chirp-web Docker image (downloads chirp source from GitHub)
set -e

CHIRP_REPO="https://github.com/kk7ds/chirp.git"
CHIRP_BRANCH="master"

echo "Building Docker image..."
docker compose build \
    --build-arg CHIRP_REPO="$CHIRP_REPO" \
    --build-arg CHIRP_BRANCH="$CHIRP_BRANCH"

echo "Done. Run with: docker compose up"
