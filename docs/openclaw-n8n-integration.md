# OpenClaw × n8n 통합 설계

## 개요

Discord 예약 채널에서 수신된 메시지를 OpenClaw가 n8n webhook으로 전달하고,
n8n이 라우팅·처리·응답까지 전담하는 forwarder 구조다.

---

## 아키텍처

```
Discord → OpenClaw (forwarder) → n8n webhook (?type=booking)
                                        ↓
                                 switch node (의도 분류)
                                /         |          \
                         school_booking  studio_*   unknown
                           (현재)       (확장 예정)    ↓
                                                 "이 채널은 예약 관련
                                                  문의만 가능합니다"
```

### 방식 선택 근거

| 요구사항 | Forwarder (채택) | AI Tool Use |
|---|---|---|
| 예약 전용 채널 | 조건 없이 전달 | AI 판단 레이어 불필요 |
| 비예약 응답 차단 | n8n이 rejection 반환 | AI 프롬프트 의존, 우회 가능 |
| 확장성 | n8n switch node만 수정 | openclaw tool 정의도 수정 필요 |
| LLM 비용 | 없음 | 매 메시지마다 LLM 호출 |

---

## 확장 구조

예약 유형 추가 시 **openclaw 설정 변경 없이 n8n만 수정**한다.

```
현재:  ?type=booking → n8n switch → school_booking
확장:  ?type=booking → n8n switch → school_booking
                                 → studio_booking    ← n8n에만 추가
                                 → practice_booking  ← n8n에만 추가
```

---

## 설정 방법

### 1. openclaw.template.json

`channels.discord`에 `destinations` 섹션을 추가하고 채널에 연결한다.

```json
"channels": {
  "discord": {
    "enabled": true,
    "token": "${DISCORD_BOOKING_BOT_TOKEN}",
    "groupPolicy": "allowlist",
    "destinations": {
      "n8n_booking": {
        "type": "webhook",
        "url": "${N8N_BOOKING_WEBHOOK_URL}",
        "method": "POST"
      }
    },
    "guilds": {
      "__DISCORD_SERVER_ID__": {
        "requireMention": false,
        "channels": {
          "__DISCORD_BOOKING_CHANNEL_ID__": {
            "enabled": true,
            "requireMention": false,
            "destination": "n8n_booking"
          }
        }
      }
    }
  }
}
```

> **주의**: openclaw 공식 문서에서 `destinations` 필드의 네이티브 지원을 명시적으로 확인하지 못했다.
> 적용 후 `docker-compose logs -f openclaw`로 설정 파싱 오류 여부를 반드시 확인한다.

### 2. .env

```bash
N8N_BOOKING_WEBHOOK_URL=https://gloriajun.duckdns.org/webhook/my-ai-agent?type=booking
```

`type=booking` 파라미터로 n8n이 "예약 채널 진입점"임을 식별하고,
세부 유형 분류는 n8n switch node(AI 프롬프트)가 담당한다.

### 3. .env.example

`.env.example`에 아래 라인을 추가한다.

```bash
N8N_BOOKING_WEBHOOK_URL=https://<domain>/webhook/my-ai-agent?type=booking
```

### 4. render-openclaw-config.sh (필요 시)

템플릿에서 플레이스홀더를 사용하는 경우 치환 라인을 추가한다.

```bash
-e "s|__N8N_BOOKING_WEBHOOK_URL__|${N8N_BOOKING_WEBHOOK_URL}|g"
```

`${N8N_BOOKING_WEBHOOK_URL}` 형식을 openclaw가 `.env`에서 직접 읽는다면 이 단계는 불필요하다.

### 5. n8n 워크플로우

- **Webhook 트리거**: `POST /webhook/my-ai-agent` (`type=booking` 수신)
- **Switch 노드**: `n8n-switch-node-prompt.md` 프롬프트로 의도 분류
  - `school_booking` → school booking 워크플로우
  - `unknown` → `"이 채널은 예약 관련 문의만 가능합니다"` 반환
- **확장 시**: switch 노드에 신규 카테고리 추가

---

## 검증

1. `docker-compose restart openclaw` 후 로그에서 파싱 오류 없음 확인
2. Discord에서 예약 메시지 전송 → n8n 로그에서 webhook 수신 확인
3. Discord에서 비예약 메시지("안녕") 전송 → 안내 메시지 응답 확인

---

## 관련 파일

| 파일 | 역할 |
|---|---|
| `config/openclaw/openclaw.template.json` | destinations + channel destination 정의 |
| `scripts/render-openclaw-config.sh` | 환경 변수 → 설정 파일 치환 |
| `.env` / `.env.example` | `N8N_BOOKING_WEBHOOK_URL` 관리 |
| `prompts/n8n-switch-node-prompt.md` | n8n 의도 분류 프롬프트 |
| `prompts/n8n-school-booking-prompt.md` | 학교 예약 처리 프롬프트 |
