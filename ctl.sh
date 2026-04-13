#!/bin/bash

# 색상 정의
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# 도움말 출력
show_help() {
    echo -e "${BLUE}Usage:${NC} sh ./ctl.sh [COMMAND]"
    echo -e ""
    echo -e "${YELLOW}Commands:${NC}"
    echo -e "  ${GREEN}start${NC}   : 컨테이너 시작"
    echo -e "  ${GREEN}stop${NC}    : 컨테이너 중지"
    echo -e "  ${GREEN}restart${NC} : 컨테이너 재시작"
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
        select_container
        if [ "$selected_name" == "ALL" ]; then
            docker-compose up -d
        else
            docker start "$selected_name"
        fi
        ;;
        
    stop)
        select_container
        if [ "$selected_name" == "ALL" ]; then
            docker-compose stop
        else
            docker stop "$selected_name"
        fi
        ;;
        
    restart)
        select_container
        if [ "$selected_name" == "ALL" ]; then
            docker-compose restart
        else
            docker restart "$selected_name"
        fi
        ;;

    help|*)
        show_help
        ;;
esac

echo -e "${GREEN}>>> 명령 수행 완료!${NC}"