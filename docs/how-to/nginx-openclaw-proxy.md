# nginx Proxy Configuration for OpenClaw

NPM(nginx proxy manager)에서 메인 도메인 root를 OpenClaw 게이트웨이로 서빙하기 위한 설정 가이드.

## 아키텍처

```text
Browser     -> nginx (443) -> openclaw:18789
                location /  (Control UI, assets, API)

Slack Event -> nginx (443) -> POST /slack/events -> openclaw:18789
```

n8n은 별도 subdomain으로 분리한다.

```text
n8n.gloriajun.duckdns.org -> n8n:5678
```

## NPM Proxy Host

메인 도메인 Proxy Host는 Advanced Config 없이 기본 proxy 설정만 사용한다.

```text
Domain Names: gloriajun.duckdns.org
Scheme: http
Forward Hostname/IP: openclaw
Forward Port: 18789
Websockets Support: ON
SSL: wildcard certificate
Force SSL: ON
Advanced Config: empty
```

n8n Proxy Host는 별도로 둔다.

```text
Domain Names: n8n.gloriajun.duckdns.org
Scheme: http
Forward Hostname/IP: n8n
Forward Port: 5678
Websockets Support: ON
SSL: wildcard certificate
Force SSL: ON
Advanced Config: empty
```

## OpenClaw 설정 요구사항

`data/openclaw/openclaw.json`의 `controlUi.basePath`와 Slack `webhookPath`가 root 도메인 기준이어야 한다.

```json
{
  "gateway": {
    "controlUi": {
      "basePath": "/",
      "allowedOrigins": ["https://gloriajun.duckdns.org"]
    }
  },
  "channels": {
    "slack": {
      "webhookPath": "/slack/events"
    }
  }
}
```

템플릿 수정 후 런타임 config를 다시 렌더링하고 OpenClaw를 재시작한다.

```bash
sudo bash scripts/render-openclaw-config.sh
docker compose up -d openclaw
```

n8n 공개 URL 변경 후에는 n8n도 재시작한다.

```bash
docker compose up -d n8n
```

## 검증

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://gloriajun.duckdns.org/health
curl -sS -o /dev/null -w "%{http_code}\n" https://gloriajun.duckdns.org/
curl -sS -o /dev/null -w "%{http_code}\n" https://n8n.gloriajun.duckdns.org/healthz
```

Slack App의 Event Subscriptions Request URL은 아래 값으로 맞춘다.

```text
https://gloriajun.duckdns.org/slack/events
```
