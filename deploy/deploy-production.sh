#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_dir"

sh deploy/validate-production.sh .env

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker Engine and the Docker Compose plugin must be installed first." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but its daemon is not available to this user." >&2
  exit 1
fi

docker compose pull caddy coturn
docker compose build --pull signaling
docker compose up -d --remove-orphans

set -a
. ./.env
set +a

attempt=0
until curl --fail --silent --show-error "https://${SIGNALING_DOMAIN}/healthz" >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 24 ]; then
    echo "HTTPS health check failed. Inspect: docker compose logs caddy signaling" >&2
    exit 1
  fi
  sleep 5
done

docker compose ps
echo "JaMeet signaling is healthy at https://${SIGNALING_DOMAIN}"
