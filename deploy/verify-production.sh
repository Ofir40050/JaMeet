#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_dir"
sh deploy/validate-production.sh .env
set -a
. ./.env
set +a

resolve_ipv4() {
  if command -v dig >/dev/null 2>&1; then dig +short A "$1" | tail -n 1
  else getent ahostsv4 "$1" | awk 'NR == 1 { print $1 }'
  fi
}

signal_ip=$(resolve_ipv4 "$SIGNALING_DOMAIN")
turn_ip=$(resolve_ipv4 "$TURN_HOST")
[ "$signal_ip" = "$TURN_EXTERNAL_IP" ] || { echo "$SIGNALING_DOMAIN resolves to '$signal_ip', expected '$TURN_EXTERNAL_IP'" >&2; exit 1; }
[ "$turn_ip" = "$TURN_EXTERNAL_IP" ] || { echo "$TURN_HOST resolves to '$turn_ip', expected '$TURN_EXTERNAL_IP'" >&2; exit 1; }

curl --fail --silent --show-error "https://${SIGNALING_DOMAIN}/healthz" | grep -q '"ok":true'
curl --fail --silent --show-error \
  "https://${SIGNALING_DOMAIN}/socket.io/?EIO=4&transport=polling" | grep -q 'sid'

docker compose ps --status running
docker compose logs --tail=30 signaling caddy coturn

echo "DNS, HTTPS, the Socket.IO endpoint, and containers are healthy."
echo "Complete the TURN relay proof from a JaMeet build with VITE_ICE_TRANSPORT_POLICY=relay."
