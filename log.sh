#!/bin/bash

# 색상 정의
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}=======================================${NC}"
echo -e "${BLUE}   AI 에이전트 서비스 로그 모니터링   ${NC}"
echo -e "${BLUE}=======================================${NC}"

# 1. 실행 중인 컨테이너 목록 출력
echo -e "${YELLOW}현재 실행 중인 컨테이너:${NC}"
docker ps --format "table {{.Names}}\t{{.Status}}"

echo -e "\n${GREEN}어떤 서비스의 로그를 확인할까요? (번호 선택)${NC}"
echo "1) n8n (자동화 워크플로우)"
echo "2) openclaw (디스코드 AI 봇)"
echo "3) kw-booking (예약 API)"
echo "4) nginx-proxy (프록시 서버)"
echo "5) 전체 로그 실시간 보기 (Combined)"
echo "q) 종료"

read -p "선택: " choice

case $choice in
    1) docker logs -f n8n ;;
    2) docker logs -f openclaw ;;
    3) docker logs -f kw-booking ;;
    4) docker logs -f nginx-proxy ;;
    5) docker compose logs -f --tail=100 ;;
    q) exit 0 ;;
    *) echo "잘못된 선택입니다." ;;
esac