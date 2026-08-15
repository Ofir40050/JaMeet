#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
env_file="${1:-${repo_dir}/.env}"

if [ ! -f "$env_file" ]; then
  echo "Missing production environment: $env_file" >&2
  echo "Copy deploy/production.env.example to .env and replace every placeholder." >&2
  exit 1
fi

set -a
# This file is controlled by the server administrator and contains only KEY=VALUE entries.
. "$env_file"
set +a

required="SIGNALING_DOMAIN TURN_HOST TURN_REALM TURN_EXTERNAL_IP TURN_SHARED_SECRET"
for name in $required; do
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then echo "$name is required" >&2; exit 1; fi
  case "$value" in
    *example.com*|*yourdomain.com*|203.0.113.10|replace-*) echo "$name still contains a placeholder" >&2; exit 1 ;;
  esac
done

case "$SIGNALING_DOMAIN" in http://*|https://*|*/*) echo "SIGNALING_DOMAIN must be a hostname without a scheme or path" >&2; exit 1 ;; esac
case "$TURN_HOST" in http://*|https://*|*/*) echo "TURN_HOST must be a hostname without a scheme or path" >&2; exit 1 ;; esac
if [ "${#TURN_SHARED_SECRET}" -lt 32 ]; then echo "TURN_SHARED_SECRET must be at least 32 characters" >&2; exit 1; fi
if [ "${NODE_ENV:-}" != "production" ]; then echo "NODE_ENV must be production" >&2; exit 1; fi
if [ "${ALLOWED_ORIGINS:-}" != "musiczoom-app://bundle" ]; then echo "ALLOWED_ORIGINS must include musiczoom-app://bundle" >&2; exit 1; fi

echo "Production environment is structurally valid."
