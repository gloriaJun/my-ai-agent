#!/usr/bin/env bash
set -euo pipefail

REMOTE="${REMOTE_HOST:-ocl}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$SCRIPT_DIR/../config/nginx"
mkdir -p "$OUT_DIR"

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
\"" > "$OUT_DIR/proxy-host.json"

echo "✅ Backup saved: config/nginx/proxy-host.json"
