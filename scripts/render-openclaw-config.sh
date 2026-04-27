#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE_PATH="${ROOT_DIR}/config/openclaw/openclaw.template.json"
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

: "${SLACK_BOT_TOKEN:?SLACK_BOT_TOKEN is required in .env}"
: "${SLACK_SIGNING_SECRET:?SLACK_SIGNING_SECRET is required in .env}"

mkdir -p "$(dirname "${OUTPUT_PATH}")"
cp "${TEMPLATE_PATH}" "${OUTPUT_PATH}"

echo "Rendered: ${OUTPUT_PATH}"
