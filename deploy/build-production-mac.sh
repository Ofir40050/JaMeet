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

# Remove stale official installer before any build steps begin; failure MUST stop the release
stale_pkg="apps/desktop/release/JaMeet-Installer.pkg"
if [ -f "$stale_pkg" ]; then
  echo "Removing stale official installer: $stale_pkg"
  rm -f "$stale_pkg" || {
    echo "Error: Failed to remove stale official installer at $stale_pkg" >&2
    exit 1
  }
fi

echo "Building official macOS production PKG installer..."
npm run build -w @jameet/shared
npm run package:mac:pkg -w @jameet/desktop

if ! grep -R --fixed-strings "$url" apps/desktop/out/renderer/assets >/dev/null; then
  echo "Production signaling URL was not found in the renderer bundle." >&2
  exit 1
fi

if [ ! -f "apps/desktop/bin/jameet-screen-capture" ]; then
  echo "Native ScreenCaptureKit helper binary was not compiled into apps/desktop/bin/" >&2
  exit 1
fi

if [ ! -f "apps/desktop/release/JaMeet-Installer.pkg" ]; then
  echo "Official JaMeet-Installer.pkg was not created in apps/desktop/release/" >&2
  exit 1
fi

echo "Official production Apple Silicon PKG installer created at apps/desktop/release/JaMeet-Installer.pkg"
echo "Includes: JaMeet.app (/Applications) and JaMeetRemote.driver (/Library/Audio/Plug-Ins/HAL)"
echo "Baked signaling origin: $url"

