#!/bin/bash
#
# ctl.sh — 컨테이너 통합 관리 스크립트
#
# Usage: bash ./scripts/ctl.sh [COMMAND] [CONTAINER]
#
#   CONTAINER를 지정하면 메뉴 없이 즉시 실행됩니다.
#   예) bash ./scripts/ctl.sh start n8n
#       bash ./scripts/ctl.sh log openclaw
#
# Commands:
#   start          컨테이너 시작 (ALL 선택 시 docker compose up -d)
#   stop           컨테이너 중지 (ALL 선택 시 docker compose stop)
#   restart        컨테이너 재시작 (ALL 선택 시 docker compose restart)
#   log            실시간 로그 보기 (docker logs -f)
#   exec           컨테이너 내부 명령 실행 또는 셸 접속
#                    명령어 미입력 시 /bin/bash → /bin/sh 순으로 접속
#   pair-list      OpenClaw 페어링 상태 조회 (원격: $REMOTE_HOST, 기본값 ocl)
#   approve-pair   OpenClaw 최신 pending 페어링 자동 승인 (원격)
#   nginx-backup   서버에서 nginx proxy_host 설정을 config/nginx/proxy-host.json으로 백업
#   nginx-restore  config/nginx/proxy-host.json을 서버에 복원하고 nginx reload
#   reset-session  원격 OpenClaw 세션 파일 초기화 (sessions/*.jsonl 삭제)
#   deploy         git push 후 원격 서버에 pull & docker compose up -d
#   help           도움말 보기
#
# 환경 변수:
#   REMOTE_HOST    원격 서버 SSH 호스트 (기본값: ocl)

# 색상 정의
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# 경로 정의
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

# 고정 서비스 목록
SERVICES=("n8n" "openclaw" "nginx-proxy")

render_openclaw_config_if_needed() {
    local script="$SCRIPT_DIR/render-openclaw-config.sh"
    local template="$REPO_DIR/config/openclaw/openclaw.template.json"
    if [ -f "$script" ] && [ -f "$template" ]; then
        chmod +x "$script"
        "$script" >/dev/null
    fi
}

# 도움말 출력
show_help() {
    echo -e "${BLUE}Usage:${NC} sh ./scripts/ctl.sh [COMMAND] [CONTAINER]"
    echo -e ""
    echo -e "  CONTAINER를 지정하면 메뉴 없이 즉시 실행됩니다."
    echo -e "  예) sh ./scripts/ctl.sh start n8n"
    echo -e "      sh ./scripts/ctl.sh log openclaw"
    echo -e ""
    echo -e "${YELLOW}Commands:${NC}"
    echo -e "  ${GREEN}start${NC}        : 컨테이너 시작"
    echo -e "  ${GREEN}stop${NC}         : 컨테이너 중지"
    echo -e "  ${GREEN}restart${NC}      : 컨테이너 재시작"
    echo -e "  ${GREEN}log${NC}          : 실시간 컨테이너 로그 보기"
    echo -e "  ${GREEN}exec${NC}         : 컨테이너 내부 명령 실행 또는 셸 접속"
    echo -e "  ${GREEN}pair-list${NC}    : OpenClaw 페어링 상태 조회(원격)"
    echo -e "  ${GREEN}approve-pair${NC} : OpenClaw 최신 pending 페어링 승인(원격)"
    echo -e "  ${GREEN}nginx-backup${NC} : nginx 설정을 서버에서 가져와 config/nginx/에 저장"
    echo -e "  ${GREEN}nginx-restore${NC}: config/nginx/의 설정을 서버에 적용하고 reload"
    echo -e "  ${GREEN}reset-session${NC}: OpenClaw 세션 파일 초기화(원격)"
    echo -e "  ${GREEN}deploy${NC}       : git push 후 원격 서버에 pull & 컨테이너 재시작"
    echo -e "  ${GREEN}help${NC}         : 도움말 보기"
}

# 컨테이너 상태 색상 레이블 반환
get_status_label() {
    local state=$1
    case "$state" in
        running)    echo -e "${GREEN}started${NC}" ;;
        exited)     echo -e "${RED}stopped${NC}" ;;
        restarting) echo -e "${YELLOW}restarting${NC}" ;;
        paused)     echo -e "${YELLOW}paused${NC}" ;;
        *)          echo -e "${BLUE}not created${NC}" ;;
    esac
}

# 컨테이너 선택 함수
# $1: show_all ("true"|"false"), 기본값 "true"
# $2: 미리 지정된 컨테이너명 (비대화형 모드)
select_container() {
    local show_all="${1:-true}"
    local preset="$2"

    if [ -n "$preset" ]; then
        selected_name="$preset"
        return
    fi

    echo -e "${YELLOW}--- 대상 컨테이너 선택 ---${NC}"

    for i in "${!SERVICES[@]}"; do
        local name="${SERVICES[$i]}"
        local state
        state=$(docker inspect --format='{{.State.Status}}' "$name" 2>/dev/null)
        local label
        label=$(get_status_label "$state")
        printf "%2d) %-20s " $((i+1)) "$name"
        echo -e "[${label}]"
    done

    if [ "$show_all" = "true" ]; then
        echo -e " a) ${BLUE}ALL (Docker Compose 전체)${NC}"
    fi
    echo " q) 종료"

    read -p "번호 또는 메뉴 선택: " choice

    if [[ $choice == "q" ]]; then exit 0; fi
    if [[ $choice == "a" && "$show_all" = "true" ]]; then
        selected_name="ALL"
        return
    fi

    if [[ $choice -gt 0 && $choice -le ${#SERVICES[@]} ]]; then
        selected_name="${SERVICES[$((choice-1))]}"
    else
        echo -e "${RED}잘못된 선택입니다.${NC}"
        exit 1
    fi
}

# 메인 로직
case "$1" in
    start)
        render_openclaw_config_if_needed
        select_container "true" "$2"
        if [ "$selected_name" == "ALL" ]; then
            docker compose --project-directory "$REPO_DIR" up -d
        else
            docker start "$selected_name"
        fi
        ;;

    stop)
        select_container "true" "$2"
        if [ "$selected_name" == "ALL" ]; then
            docker compose --project-directory "$REPO_DIR" stop
        else
            docker stop "$selected_name"
        fi
        ;;

    restart)
        render_openclaw_config_if_needed
        select_container "true" "$2"
        if [ "$selected_name" == "ALL" ]; then
            docker compose --project-directory "$REPO_DIR" restart
        else
            docker restart "$selected_name"
        fi
        ;;

    log)
        select_container "false" "$2"
        echo -e "${GREEN}>>> ${selected_name} 로그 실시간 추적 시작...${NC}"
        docker logs -f "$selected_name"
        ;;

    exec)
        select_container "false" "$2"
        state=$(docker inspect --format='{{.State.Status}}' "$selected_name")
        if [ "$state" != "running" ]; then
            echo -e "${RED}에러: '${selected_name}' 실행 중 아님 (현재: $state)${NC}"
            exit 1
        fi
        echo -e "${YELLOW}실행할 명령어를 입력하세요 (예: cat /path/to/file)${NC}"
        read -p "명령어 (미입력 시 셸 접속): " user_cmd
        if [ -z "$user_cmd" ]; then
            echo -e "${GREEN}>>> ${selected_name} 내부 셸 접속 중...${NC}"
            docker exec -it "$selected_name" /bin/bash 2>/dev/null || docker exec -it "$selected_name" /bin/sh
        else
            echo -e "${GREEN}>>> ${selected_name} 에서 명령어 실행: ${user_cmd}${NC}"
            docker exec -it "$selected_name" sh -c "$user_cmd"
        fi
        ;;

    pair-list)
        REMOTE_HOST="${REMOTE_HOST:-ocl}"
        echo -e "${YELLOW}>>> 원격 OpenClaw 페어링 상태 조회: ${REMOTE_HOST}${NC}"
        ssh "$REMOTE_HOST" "docker exec openclaw node dist/index.js devices list"
        ;;

    nginx-backup)
        bash "$SCRIPT_DIR/nginx.sh" backup
        ;;

    nginx-restore)
        bash "$SCRIPT_DIR/nginx.sh" restore
        ;;

    reset-session)
        REMOTE_HOST="${REMOTE_HOST:-ocl}"
        echo -e "${YELLOW}>>> 원격 OpenClaw 세션 초기화: ${REMOTE_HOST}${NC}"
        ssh "$REMOTE_HOST" "cd ~/my-ai-agent && sudo rm -f data/openclaw/agents/main/sessions/*.jsonl && echo '세션 파일 삭제 완료'"
        ;;

    deploy)
        echo -e "${YELLOW}>>> 원격 서버에 배포 중...${NC}"
        git -C "$REPO_DIR" push
        ssh "${REMOTE_HOST:-ocl}" "cd ~/my-ai-agent && git pull --rebase && sudo bash scripts/render-openclaw-config.sh && docker compose up -d"
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
