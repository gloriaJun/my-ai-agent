#!/bin/bash

# 색상 정의
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

render_openclaw_config_if_needed() {
    if [ -f "./scripts/render-openclaw-config.sh" ] && [ -f "./config/openclaw/openclaw.template.json" ]; then
        chmod +x ./scripts/render-openclaw-config.sh
        ./scripts/render-openclaw-config.sh >/dev/null
    fi
}

# 도움말 출력
show_help() {
    echo -e "${BLUE}Usage:${NC} sh ./ctl.sh [COMMAND]"
    echo -e ""
    echo -e "${YELLOW}Commands:${NC}"
    echo -e "  ${GREEN}start${NC}   : 컨테이너 시작"
    echo -e "  ${GREEN}stop${NC}    : 컨테이너 중지"
    echo -e "  ${GREEN}restart${NC} : 컨테이너 재시작"
    echo -e "  ${GREEN}pair-list${NC} : OpenClaw 페어링 상태 조회(원격)"
    echo -e "  ${GREEN}approve-pair${NC} : OpenClaw 최신 pending 페어링 승인(원격)"
    echo -e "  ${GREEN}nginx-backup${NC} : nginx 설정을 서버에서 가져와 config/nginx/에 저장"
    echo -e "  ${GREEN}nginx-restore${NC} : config/nginx/의 설정을 서버에 적용하고 reload"
    echo -e "  ${GREEN}help${NC}    : 도움말 보기"
}

# 컨테이너 선택 함수
select_container() {
    local filter=$1
    echo -e "${YELLOW}--- 대상 컨테이너 선택 ---${NC}"
    
    # 컨테이너 목록 가져오기
    IFS=$'\n' containers=($(docker ps -a --format "{{.Names}}"))
    
    if [ ${#containers[@]} -eq 0 ]; then
        echo -e "${RED}생성된 컨테이너가 없습니다.${NC}"
        exit 1
    fi

    # 목록 출력 및 상태 표시
    for i in "${!containers[@]}"; do
        status=$(docker inspect --format='{{.State.Status}}' "${containers[$i]}")
        printf "%2d) %-25s [%s]\n" $((i+1)) "${containers[$i]}" "$status"
    done
    echo -e " a) ${BLUE}ALL (Docker Compose 전체)${NC}"
    echo " q) 종료"

    read -p "번호 또는 메뉴 선택: " choice

    if [[ $choice == "q" ]]; then exit 0; fi
    if [[ $choice == "a" ]]; then
        selected_name="ALL"
        return
    fi

    if [[ $choice -gt 0 && $choice -le ${#containers[@]} ]]; then
        selected_name="${containers[$((choice-1))]}"
    else
        echo -e "${RED}잘못된 선택입니다.${NC}"
        exit 1
    fi
}

# 메인 로직
case "$1" in
    start)
        render_openclaw_config_if_needed
        select_container
        if [ "$selected_name" == "ALL" ]; then
            docker compose up -d
        else
            docker start "$selected_name"
        fi
        ;;
        
    stop)
        select_container
        if [ "$selected_name" == "ALL" ]; then
            docker compose stop
        else
            docker stop "$selected_name"
        fi
        ;;
        
    restart)
        render_openclaw_config_if_needed
        select_container
        if [ "$selected_name" == "ALL" ]; then
            docker compose restart
        else
            docker restart "$selected_name"
        fi
        ;;

    pair-list)
        REMOTE_HOST="${REMOTE_HOST:-ocl}"
        echo -e "${YELLOW}>>> 원격 OpenClaw 페어링 상태 조회: ${REMOTE_HOST}${NC}"
        ssh "$REMOTE_HOST" "docker exec openclaw node dist/index.js devices list"
        ;;

    nginx-backup)
        bash scripts/nginx-backup.sh
        ;;

    nginx-restore)
        bash scripts/nginx-restore.sh
        ;;

    approve-pair)
        REMOTE_HOST="${REMOTE_HOST:-ocl}"
        echo -e "${YELLOW}>>> 원격 OpenClaw 최신 pending 요청 확인: ${REMOTE_HOST}${NC}"

        request_id=$(
            ssh "$REMOTE_HOST" \
            "docker exec openclaw node dist/index.js devices approve --latest 2>/dev/null \
            | sed -n 's/^Approve this exact request with: openclaw devices approve //p' \
            | head -n1"
        )

        if [ -z "$request_id" ]; then
            echo -e "${RED}승인할 pending 요청이 없습니다.${NC}"
            exit 1
        fi

        echo -e "${BLUE}요청 ID:${NC} ${request_id}"
        echo -e "${YELLOW}>>> pending 요청 승인 실행${NC}"
        ssh "$REMOTE_HOST" "docker exec openclaw node dist/index.js devices approve ${request_id}"
        echo -e "${YELLOW}>>> 승인 후 상태 확인${NC}"
        ssh "$REMOTE_HOST" "docker exec openclaw node dist/index.js devices list"
        ;;

    help|*)
        show_help
        ;;
esac

echo -e "${GREEN}>>> 명령 수행 완료!${NC}"
