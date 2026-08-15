#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_dir"

url="${PRODUCTION_SIGNALING_URL:-https://jameet-jwi8.onrender.com}"
case "$url" in
  https://*) ;;
  *) echo "Set PRODUCTION_SIGNALING_URL to the deployed HTTPS signaling origin." >&2; exit 1 ;;
esac
case "$url" in */) url=${url%/} ;; esac

export VITE_SIGNALING_URL="$url"
export VITE_ICE_TRANSPORT_POLICY=all
npm run package:mac:arm64 -w @musiczoom/desktop

if ! grep -R --fixed-strings "$url" apps/desktop/out/renderer/assets >/dev/null; then
  echo "Production signaling URL was not found in the renderer bundle." >&2
  exit 1
fi

echo "Production Apple Silicon DMG created in apps/desktop/release/."
echo "Baked signaling origin: $url"
