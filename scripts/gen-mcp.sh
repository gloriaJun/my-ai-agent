#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

ENV_FILE="$ROOT_DIR/.mcp.env"
TEMPLATE="$ROOT_DIR/.mcp.json.template"
OUTPUT="$ROOT_DIR/.mcp.json"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found. Copy .mcp.env.example and fill in the values."
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

sed "s|\${N8N_TOKEN}|${N8N_TOKEN}|g" "$TEMPLATE" > "$OUTPUT"
echo "Generated $OUTPUT"
