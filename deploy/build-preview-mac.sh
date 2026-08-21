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

echo "Building local preview macOS PKG installer (unsigned)..."
npm run build -w @jameet/shared
npm run package:mac:preview -w @jameet/desktop

if [ ! -f "apps/desktop/release/JaMeet-Preview-Unsigned.pkg" ]; then
  echo "Preview package JaMeet-Preview-Unsigned.pkg was not created in apps/desktop/release/" >&2
  exit 1
fi

echo "Local preview Apple Silicon PKG installer created at apps/desktop/release/JaMeet-Preview-Unsigned.pkg"
echo "Notice: This preview package is for local testing only and is not notarized."
echo "Baked signaling origin: $url"
