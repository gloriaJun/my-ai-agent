#!/usr/bin/env bash
# Usage: nginx.sh <backup|restore> [REMOTE_HOST=ocl]
#   backup   서버의 nginx proxy_host 설정을 config/nginx/proxy-host.json으로 백업
#   restore  백업 파일을 서버에 복원하고 nginx reload
set -euo pipefail

REMOTE="${REMOTE_HOST:-ocl}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$SCRIPT_DIR/../config/nginx/proxy-host.json"

usage() {
  echo "Usage: $(basename "$0") <backup|restore>"
  echo "  backup   서버(${REMOTE})의 nginx 설정을 로컬로 백업"
  echo "  restore  로컬 설정을 서버(${REMOTE})에 복원 및 reload"
}

cmd_backup() {
  mkdir -p "$(dirname "$CONFIG")"
  echo ">>> 서버(${REMOTE})에서 nginx 설정 백업 중..."
  ssh "$REMOTE" "python3 -c \"
import sqlite3, json, os
path = os.path.expanduser('~/my-ai-agent/data/nginx/config/database.sqlite')
conn = sqlite3.connect(path)
cur = conn.cursor()
cur.execute('''
  SELECT id, domain_names, forward_scheme, forward_host, forward_port,
         advanced_config, http2_support, ssl_forced
  FROM proxy_host ORDER BY id
''')
cols = ['id','domain_names','forward_scheme','forward_host','forward_port',
        'advanced_config','http2_support','ssl_forced']
rows = [dict(zip(cols, r)) for r in cur.fetchall()]
print(json.dumps({'proxy_hosts': rows}, indent=2))
conn.close()
\"" > "$CONFIG"
  echo "✅ Backup saved: config/nginx/proxy-host.json"
}

cmd_restore() {
  [ -f "$CONFIG" ] || { echo "❌ Not found: $CONFIG (먼저 backup을 실행하세요)"; exit 1; }
  echo ">>> 설정 파일을 서버(${REMOTE})로 전송 중..."
  scp "$CONFIG" "${REMOTE}:/tmp/npm-restore.json"
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
}

case "${1:-}" in
  backup)  cmd_backup ;;
  restore) cmd_restore ;;
  *)       usage; exit 1 ;;
esac
