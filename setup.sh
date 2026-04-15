#!/bin/bash

# 1. 네트워크 및 폴더 준비
docker network create ai-agent-network 2>/dev/null || true
mkdir -p ./data/ollama ./data/n8n ./data/openclaw

# OpenClaw 설정 템플릿 렌더링 (.env -> openclaw.json)
if [ -f "./scripts/render-openclaw-config.sh" ] && [ -f "./config/openclaw/openclaw.template.json" ]; then
    chmod +x ./scripts/render-openclaw-config.sh
    ./scripts/render-openclaw-config.sh
fi

# 2. Ollama 서비스를 먼저 기동 (OpenClaw 설정 시 응답할 수 있도록)
echo "Starting Ollama first for configuration..."
docker-compose up -d ollama

echo "Waiting for Ollama to wake up..."
# Ollama가 응답할 때까지 최대 30초 대기
for i in {1..30}; do
    if curl -s http://localhost:11434/api/tags > /dev/null; then
        echo "Ollama is ready!"
        break
    fi
    echo "Waiting... ($i/30)"
    sleep 2
done

# 3. OpenClaw 초기 온보딩 (Ollama가 켜진 상태에서 실행)
if [ ! -f "./data/openclaw/openclaw.json" ]; then
    echo "Starting OpenClaw Onboarding..."
    # 네트워크를 함께 연결해줘야 ollama 주소를 찾을 수 있습니다.
    docker run --rm -it \
      --network ai-agent-network \
      -v "$(pwd)/data/openclaw:/home/node/.openclaw" \
      ghcr.io/openclaw/openclaw:latest \
      node dist/index.js onboard --mode local --no-install-daemon
else
    echo "OpenClaw config already exists."
fi

# 4. 나머지 모든 서비스 기동
echo "Starting all services..."
docker-compose up -d

# 5. 모델 다운로드
echo "Pulling AI Model (llama3.2:3b)..."
docker exec -it ollama ollama pull llama3.2:3b

echo "Success! http://localhost:18789"
