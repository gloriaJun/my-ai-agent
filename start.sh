#!/bin/bash

# 색상 정의
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}>>> 통합 서버 기동을 시작합니다...${NC}"

# 1. 공용 네트워크 확인 및 생성
if [ ! "$(docker network ls | grep proxy-net)" ]; then
  echo -e "${GREEN}>>> proxy-net 네트워크가 없어서 새로 생성합니다...${NC}"
  docker network create proxy-net
else
  echo -e ">>> proxy-net 네트워크가 이미 존재합니다."
fi

# 2. Nginx Proxy Manager 기동
echo -e "${BLUE}>>> [1/2] Nginx Proxy Manager를 기동합니다...${NC}"
docker compose -f docker-compose-nginx.yml up -d

# 3. 메인 애플리케이션(n8n, OpenClaw, kw-booking) 기동
echo -e "${BLUE}>>> [2/2] 메인 애플리케이션들을 기동합니다...${NC}"
docker compose up -d

echo -e "${GREEN}>>> 모든 서비스가 정상적으로 기동되었습니다!${NC}"
echo -e "${BLUE}>>> 현재 실행 중인 컨테이너 상태:${NC}"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"