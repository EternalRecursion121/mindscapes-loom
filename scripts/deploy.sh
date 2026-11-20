#!/usr/bin/env bash
# Build and publish to https://mains.in.net/mindscapes/loom/ (served statically by the mains.in.net Node app).
set -euo pipefail
cd "$(dirname "$0")/.."
DEST=/var/www/arg/mains.in.net/mindscapes/loom
npm run build
mkdir -p "$DEST"
rm -rf "$DEST/assets"
cp -r dist/. "$DEST/"
echo "deployed -> https://mains.in.net/mindscapes/loom/"
