#!/bin/sh
set -eu

external_ip="${TURN_EXTERNAL_IP}"
if [ -n "${TURN_PRIVATE_IP:-}" ] && [ "${TURN_PRIVATE_IP}" != "${TURN_EXTERNAL_IP}" ]; then
  external_ip="${TURN_EXTERNAL_IP}/${TURN_PRIVATE_IP}"
fi

set -- \
  --fingerprint \
  --use-auth-secret \
  "--static-auth-secret=${TURN_SHARED_SECRET}" \
  "--realm=${TURN_REALM}" \
  "--server-name=${TURN_REALM}" \
  "--external-ip=${external_ip}" \
  "--listening-port=${TURN_PORT:-3478}" \
  "--min-port=${TURN_MIN_PORT:-49160}" \
  "--max-port=${TURN_MAX_PORT:-49200}" \
  --no-cli --no-multicast-peers --no-loopback-peers --stale-nonce=600

if [ -n "${TURN_PRIVATE_IP:-}" ]; then
  set -- "$@" "--relay-ip=${TURN_PRIVATE_IP}"
fi

if [ "${TURN_TLS_ENABLED:-false}" = "true" ]; then
  set -- "$@" "--tls-listening-port=${TURN_TLS_PORT:-5349}" "--cert=${TURN_TLS_CERT_FILE:-/certs/fullchain.pem}" "--pkey=${TURN_TLS_KEY_FILE:-/certs/privkey.pem}"
else
  set -- "$@" --no-tls --no-dtls
fi

exec turnserver "$@"
