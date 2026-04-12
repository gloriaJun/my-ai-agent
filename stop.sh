#!/bin/bash
echo ">>> 모든 서비스를 중지합니다..."
docker compose down
docker compose -f docker-compose-nginx.yml down
echo ">>> 중지 완료."