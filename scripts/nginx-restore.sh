#!/usr/bin/env bash
set -euo pipefail

REMOTE="${REMOTE_HOST:-ocl}"
SRC="$(cd "$(dirname "$0")/../config/nginx" && pwd)/proxy-host.json"

[ -f "$SRC" ] || { echo "❌ Not found: $SRC (먼저 nginx-backup을 실행하세요)"; exit 1; }

echo ">>> 설정 파일을 서버(${REMOTE})로 전송 중..."
scp "$SRC" "${REMOTE}:/tmp/npm-restore.json"

echo ">>> SQLite 업데이트 중..."
ssh "$REMOTE" "python3 -c \"
import sqlite3, json, os
with open('/tmp/npm-restore.json') as f:
    data = json.load(f)
path = os.path.expanduser('~/my-ai-agent/data/nginx/config/database.sqlite')
conn = sqlite3.connect(path)
cur = conn.cursor()
for h in data['proxy_hosts']:
    cur.execute(
        'UPDATE proxy_host SET advanced_config=?, http2_support=? WHERE id=?',
        (h['advanced_config'], h['http2_support'], h['id'])
    )
conn.commit()
conn.close()
print('SQLite updated: ' + str(len(data['proxy_hosts'])) + ' host(s)')
\""

echo ">>> nginx 설정 재로드 중..."
ssh "$REMOTE" "docker exec nginx-proxy nginx -s reload"
echo "✅ nginx reloaded on ${REMOTE}"
