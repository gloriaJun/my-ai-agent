#!/bin/bash

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 1. 네트워크 및 폴더 준비
docker network create proxy-net 2>/dev/null || true
mkdir -p "$ROOT_DIR/data/n8n" "$ROOT_DIR/data/openclaw"

# OpenClaw 설정 템플릿 렌더링 (.env -> openclaw.json)
if [ -f "$ROOT_DIR/scripts/render-openclaw-config.sh" ] && [ -f "$ROOT_DIR/config/openclaw/openclaw.template.json" ]; then
    "$ROOT_DIR/scripts/render-openclaw-config.sh"
fi

# 2. OpenClaw 초기 온보딩
if [ ! -f "$ROOT_DIR/data/openclaw/openclaw.json" ]; then
    echo "Starting OpenClaw Onboarding..."
    docker run --rm -it \
      --network proxy-net \
      -v "$ROOT_DIR/data/openclaw:/home/node/.openclaw" \
      ghcr.io/openclaw/openclaw:latest \
      node dist/index.js onboard --mode local --no-install-daemon
else
    echo "OpenClaw config already exists."
fi

# 3. 모든 서비스 기동
echo "Starting all services..."
docker compose -f "$ROOT_DIR/docker-compose.yml" up -d

# 4. 모델 다운로드
echo "Pulling AI Model (llama3.2:3b)..."
ollama pull llama3.2:3b

echo "Success! http://localhost:18789"
