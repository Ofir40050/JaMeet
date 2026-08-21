#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${1:-"${SCRIPT_DIR}/dist"}"
TARGET_ARCH="${2:-}"
DRIVER_BUNDLE="${OUTPUT_DIR}/JaMeetRemote.driver"
MACOS_DIR="${DRIVER_BUNDLE}/Contents/MacOS"

echo "Building macOS JaMeet Remote AudioServerPlugIn bundle..."
mkdir -p "${MACOS_DIR}"

cp "${SCRIPT_DIR}/Info.plist" "${DRIVER_BUNDLE}/Contents/Info.plist"

if [ -n "${TARGET_ARCH}" ]; then
  clang -O2 -Wall -Wextra \
    -arch "${TARGET_ARCH}" \
    -bundle \
    -fvisibility=hidden \
    -framework CoreFoundation \
    -framework CoreAudio \
    -I"${SCRIPT_DIR}" \
    -I"${SCRIPT_DIR}/../bridge" \
    "${SCRIPT_DIR}/JaMeetRemoteDriver.c" \
    "${SCRIPT_DIR}/../bridge/jameet_remote_bridge.c" \
    "${SCRIPT_DIR}/../bridge/jameet_remote_transport_posix.c" \
    -o "${MACOS_DIR}/JaMeetRemote"
else
  clang -O2 -Wall -Wextra \
    -bundle \
    -fvisibility=hidden \
    -framework CoreFoundation \
    -framework CoreAudio \
    -I"${SCRIPT_DIR}" \
    -I"${SCRIPT_DIR}/../bridge" \
    "${SCRIPT_DIR}/JaMeetRemoteDriver.c" \
    "${SCRIPT_DIR}/../bridge/jameet_remote_bridge.c" \
    "${SCRIPT_DIR}/../bridge/jameet_remote_transport_posix.c" \
    -o "${MACOS_DIR}/JaMeetRemote"
fi

echo "Successfully built ${DRIVER_BUNDLE}"
