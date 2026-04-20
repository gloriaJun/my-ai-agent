# nginx Proxy Configuration for openclaw

NPM(nginx proxy manager)에서 `/openclaw` prefix 경로로 openclaw 게이트웨이를 서빙하기 위한 nginx 설정 가이드.

## 아키텍처

```
Browser → nginx (443) → openclaw:18789
         location = /openclaw   (WebSocket + GET)
         location /openclaw/    (UI, assets, API)
```

## openclaw 설정 요구사항

`data/openclaw/openclaw.json`의 `controlUi.basePath`가 nginx 경로와 일치해야 한다.

```json
{
  "gateway": {
    "controlUi": {
      "basePath": "/openclaw/",
      "allowedOrigins": ["*", "https://<domain>"]
    }
  }
}
```

> 템플릿 수정 후 반드시 render 스크립트를 실행해야 런타임 config에 반영된다.
> `data/openclaw/` 디렉토리 소유자(`opc`)와 SSH 유저(`ubuntu`)가 다른 경우 `sudo` 필요.

```bash
sudo bash scripts/render-openclaw-config.sh
docker compose restart openclaw
```

## nginx Location 블록

NPM `proxy_host.advanced_config` (SQLite) 및 `data/nginx/config/nginx/proxy_host/1.conf`에 적용.

```nginx
set $upstream_oc openclaw;

# /openclaw (trailing slash 없음): WebSocket 연결 및 일반 GET 처리
# - WebSocket: openclaw가 101로 응답
# - 일반 GET: openclaw가 302로 /openclaw/ redirect
location = /openclaw {
    proxy_pass http://$upstream_oc:18789;

    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
}

# /openclaw/ (prefix): UI, assets, API 요청 처리
# rewrite 없이 전체 경로를 그대로 upstream에 전달 (basePath prefix 보존)
location /openclaw/ {
    proxy_pass http://$upstream_oc:18789;

    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

### 핵심 규칙

| 항목 | 설정 | 이유 |
|------|------|------|
| `location = /openclaw` | `proxy_pass` (redirect 아님) | UI의 WebSocket URL이 `wss://domain/openclaw` (slash 없음)이므로 301 반환 시 WS 1006 발생 |
| rewrite 없음 | 경로 그대로 전달 | `basePath: "/openclaw/"` 설정 시 openclaw가 `/openclaw/` prefix 포함 경로를 처리함 |
| `proxy_http_version 1.1` | HTTP/1.1 강제 | WebSocket Upgrade는 HTTP/1.1 전용 메커니즘 |
| `Connection "upgrade"` | 항상 설정 | WebSocket 업그레이드 헤더 전달 |

## HTTP/2 비활성화

NPM의 HTTP/2를 비활성화해야 WebSocket이 정상 동작한다.

**원인**: `http2 on;` 설정 시 Chrome이 HTTP/2로 연결 → HTTP/2에서는 `Upgrade` 헤더가 무시됨 → nginx가 WS 요청을 일반 GET으로 처리 → openclaw HTML 200 반환 → WebSocket 1006

### 방법 1: NPM SQLite 업데이트 (영구 반영)

```python
import sqlite3
conn = sqlite3.connect('data/nginx/config/database.sqlite')
cur = conn.cursor()
cur.execute('UPDATE proxy_host SET http2_support=0 WHERE id=1')
conn.commit()
conn.close()
```

### 방법 2: 1.conf 직접 수정 (즉시 적용)

`data/nginx/config/nginx/proxy_host/1.conf`에서 `http2 on;` 라인 제거 후 nginx reload.

> **주의**: NPM 재시작 시 SQLite 기반으로 1.conf가 재생성됨.
> 두 방법을 **반드시 함께** 적용해야 영구 반영된다.

```bash
docker exec nginx-proxy nginx -s reload
```

## NPM Advanced Config 업데이트

NPM UI 없이 SQLite로 직접 advanced_config를 수정할 때 사용하는 Python 패턴.
NPM 컨테이너에는 `sqlite3` CLI가 없으므로 호스트에서 Python으로 접근한다.

```python
import sqlite3

new_config = """set $upstream_oc openclaw;

location = /openclaw {
    proxy_pass http://$upstream_oc:18789;
    ...
}

location /openclaw/ {
    proxy_pass http://$upstream_oc:18789;
    ...
}"""

conn = sqlite3.connect('data/nginx/config/database.sqlite')
cur = conn.cursor()
cur.execute('UPDATE proxy_host SET advanced_config=? WHERE id=1', (new_config,))
conn.commit()
conn.close()
```

## 검증

```bash
# 1. HTTP 접근 확인 (200)
curl -o /dev/null -w "%{http_code}\n" -s https://domain/openclaw/

# 2. WebSocket 업그레이드 확인 (101)
curl --http1.1 -si \
  -H 'Upgrade: websocket' \
  -H 'Connection: Upgrade' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  -H 'Sec-WebSocket-Version: 13' \
  https://domain/openclaw \
  | head -3
# → HTTP/1.1 101 Switching Protocols

# 3. ALPN 확인 (http/1.1이어야 함)
echo | openssl s_client -connect domain:443 -alpn h2,http/1.1 2>&1 | grep 'ALPN protocol'
# → ALPN protocol: http/1.1
```
