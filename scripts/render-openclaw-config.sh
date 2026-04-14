#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE_PATH="${ROOT_DIR}/data/openclaw/openclaw.template.json"
OUTPUT_PATH="${ROOT_DIR}/data/openclaw/openclaw.json"
ENV_PATH="${ROOT_DIR}/.env"

if [ ! -f "${TEMPLATE_PATH}" ]; then
  echo "Template not found: ${TEMPLATE_PATH}" >&2
  exit 1
fi

if [ -f "${ENV_PATH}" ]; then
  set -a
  # shellcheck disable=SC1090
  . "${ENV_PATH}"
  set +a
fi

: "${DISCORD_SERVER_ID:?DISCORD_SERVER_ID is required in .env}"
: "${DISCORD_BOOKING_CHANNEL_ID:?DISCORD_BOOKING_CHANNEL_ID is required in .env}"

mkdir -p "$(dirname "${OUTPUT_PATH}")"

sed \
  -e "s/__DISCORD_SERVER_ID__/${DISCORD_SERVER_ID}/g" \
  -e "s/__DISCORD_BOOKING_CHANNEL_ID__/${DISCORD_BOOKING_CHANNEL_ID}/g" \
  "${TEMPLATE_PATH}" > "${OUTPUT_PATH}"

echo "Rendered: ${OUTPUT_PATH}"
