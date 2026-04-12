#!/bin/bash

# 색상 정의
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# 1. 액션 선택 (Action Selection)
echo -e "${BLUE}=======================================${NC}"
echo -e "${BLUE}       AI 서버 서비스 관리 도구        ${NC}"
echo -e "${BLUE}=======================================${NC}"
echo "1) START   (서비스 시작)"
echo "2) RESTART (서비스 재시작)"
echo "3) STOP    (서비스 중지)"
echo "q) QUIT    (나가기)"
read -p "명령을 선택하세요: " ACTION_CHOICE

case $ACTION_CHOICE in
    1) ACTION="up -d" ;;
    2) ACTION="restart" ;;
    3) ACTION="stop" ;;
    q|Q) exit 0 ;;
    *) echo "잘못된 선택입니다."; exit 1 ;;
esac

# 2. 대상 선택 (Target Selection)
echo -e "\n${GREEN}대상을 선택하세요:${NC}"
echo "--- 서비스별 ---"
echo "1) n8n"
echo "2) openclaw"
echo "3) nginx (Nginx Proxy Manager)"
echo "--- 파일(그룹)별 ---"
echo "4) 메인 앱 그룹 (n8n + openclaw)"
echo "5) 프록시 그룹 (Nginx 전용)"
echo "6) 전체 서비스 (ALL)"

read -p "번호를 선택하세요: " TARGET_CHOICE

# 네트워크 자동 생성 확인
docker network create proxy-net 2>/dev/null || true

case $TARGET_CHOICE in
    1) docker compose -f docker-compose.yml $ACTION n8n ;;
    2) docker compose -f docker-compose.yml $ACTION openclaw ;;
    3) docker compose -f docker-compose-nginx.yml $ACTION nginx-proxy ;;
    4) docker compose -f docker-compose.yml $ACTION ;;
    5) docker compose -f docker-compose-nginx.yml $ACTION ;;
    6) 
       docker compose -f docker-compose.yml $ACTION
       docker compose -f docker-compose-nginx.yml $ACTION
       ;;
    *) echo "잘못된 선택입니다."; exit 1 ;;
esac

echo -e "\n${BLUE}>>> 작업이 완료되었습니다!${NC}"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"