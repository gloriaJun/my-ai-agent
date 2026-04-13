#!/bin/bash

# 색상 정의
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# 도움말 출력 함수
show_help() {
    echo -e "${BLUE}Usage:${NC} sh ./command.sh [COMMAND]"
    echo -e ""
    echo -e "${YELLOW}Commands:${NC}"
    echo -e "  ${GREEN}log${NC}   : 실시간 컨테이너 로그 보기 (tailing)"
    echo -e "  ${GREEN}exec${NC}  : 컨테이너 내부 셸 접속 (/bin/bash or /bin/sh)"
    echo -e "  ${GREEN}help${NC}  : 사용 가능한 명령어 안내"
    echo -e ""
    echo -e "${YELLOW}Example:${NC}"
    echo -e "  sh ./command.sh log"
}

# 컨테이너 선택 함수 (동적 생성)
select_container() {
    echo -e "${YELLOW}--- 현재 존재하는 모든 컨테이너 목록 (All) ---${NC}"
    
    # 컨테이너 이름을 배열로 가져오기
    IFS=$'\n' containers=($(docker ps -a --format "{{.Names}}"))
    
    if [ ${#containers[@]} -eq 0 ]; then
        echo -e "${RED}생성된 컨테이너가 없습니다.${NC}"
        exit 1
    fi

    # 목록 출력
    for i in "${!containers[@]}"; do
        status=$(docker inspect --format='{{.State.Status}}' "${containers[$i]}")
        printf "%2d) %-25s [%s]\n" $((i+1)) "${containers[$i]}" "$status"
    done
    echo " q) 종료"

    read -p "번호 선택: " choice

    if [[ $choice == "q" ]]; then
        exit 0
    fi

    # 유효성 검사 및 선택된 컨테이너 이름 반환
    if [[ $choice -gt 0 && $choice -le ${#containers[@]} ]]; then
        selected_name="${containers[$((choice-1))]}"
    else
        echo -e "${RED}잘못된 선택입니다.${NC}"
        exit 1
    fi
}

# 메인 로직
case "$1" in
    log)
        echo -e "${BLUE}로그를 확인할 컨테이너를 선택하세요.${NC}"
        select_container
        echo -e "${GREEN}>>> ${selected_name} 로그 실시간 추적 시작...${NC}"
        docker logs -f "$selected_name"
        ;;
        
    exec)
        echo -e "${BLUE}접속할 컨테이너를 선택하세요.${NC}"
        select_container
        
        # 실행 중인지 확인
        state=$(docker inspect --format='{{.State.Running}}' "$selected_name")
        if [ "$state" == "false" ]; then
            echo -e "${RED}에러: '${selected_name}' 컨테이너가 실행 중이 아닙니다.${NC}"
            exit 1
        fi

        echo -e "${GREEN}>>> ${selected_name} 내부 접속 중...${NC}"
        # bash 시도 후 실패 시 sh로 시도
        docker exec -it "$selected_name" /bin/bash 2>/dev/null || docker exec -it "$selected_name" /bin/sh
        ;;
        
    help|*)
        show_help
        ;;
esac