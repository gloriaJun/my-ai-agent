# 예약 채널 설계

## 아키텍처

Pattern 2: openclaw가 AI Agent로 동작하고 n8n이 실행 엔진 역할을 담당한다.

```
Discord #예약 채널
        ↓
openclaw (대화 관리 + 분류 + JSON 조립)
  - 자연어 대화, 다회성 질문으로 정보 수집
  - 예약 타입 판단 (school / sports / camping)
  - 구조화 JSON 조립 완료 후 SKILL 호출
        ↓ POST /webhook/my-ai-agent?type=booking&mode={school|sports|camping}
        Body: { 구조화된 예약 JSON }
        ↓
n8n Switch (?mode= 값으로 단순 라우팅, AI 판단 없음)
  ├─ mode=school   → 학교 예약 워크플로우
  ├─ mode=sports   → 체육센터 워크플로우
  └─ mode=camping  → 캠핑장 워크플로우
        ↓
각 워크플로우: 구조화 JSON → 예약 API 호출 → 결과 반환
        ↓
openclaw → 자연어 응답 → Discord
```

---

## 쿼리 파라미터

| 파라미터 | 값 | 설명 |
|---|---|---|
| `type` | `booking` | 채널 카테고리. 미래 확장 시 `reminder`, `alert` 등 추가 |
| `mode` | `school` \| `sports` \| `camping` | 예약 세부 타입 |

n8n Switch 노드는 `?mode=` 값만 보고 라우팅한다. AI 판단 없음.

---

## 역할 분리

| 컴포넌트 | 역할 |
|---|---|
| openclaw | 대화, 맥락 유지, 정보 수집, 타입 분류, JSON 조립 |
| n8n Switch | `?mode=` 값만 보고 단순 라우팅 |
| n8n 워크플로우 | 구조화 JSON → 예약 API 실행 |

---

## openclaw 지침 위치

### 채널 행동 정의 (`openclaw.template.json`)

채널 scope 제한과 언어 지시만 `systemPrompt`에 정의한다.
수집 항목·webhook 호출 등 실행 상세는 skill 파일에 위임하여 중복을 피한다.

```json
"__DISCORD_BOOKING_CHANNEL_ID__": {
  "enabled": true,
  "requireMention": false,
  "skills": ["school-booking"],
  "systemPrompt": "This channel is for school room reservations only. For any other request, reply briefly that this channel is for reservations only and stop. Always respond in the same language the user used."
}
```

**systemPrompt 작성 원칙:**
- 채널 scope 제한 (off-topic 차단)과 언어 지시만 기술한다
- skill 파일에 이미 정의된 내용은 반복하지 않는다
- 지침은 영어로 작성하고, 사용자에게는 요청 언어로 응답하도록 명시한다

### 예약별 도구 정의 (`prompts/openclaw/skills/`)

각 예약 타입별 skill 파일로 수집 정보, webhook URL, JSON 구조를 정의한다.
`data/` 와 분리하여 소스로 관리하고, docker volume으로 컨테이너 workspace에 마운트한다.

```
prompts/openclaw/
└── skills/
    ├── school-booking.md       ← 구현됨
    ├── sports-booking.md       ← 미구현 (확장 예정)
    └── camping-booking.md      ← 미구현 (확장 예정)
```

**skill 파일 구조 (`school-booking/SKILL.md`):**

```markdown
---
name: school-booking
description: "Handles school practice room and lesson room reservations"
metadata:
  {
    "openclaw": {
      "emoji": "🏫",
      "requires": { "bins": ["curl"] }
    }
  }
---

# School Booking Skill

Handles school practice room and lesson room reservations.

## Required Information

| Field       | Key       | Format       |
|-------------|-----------|--------------|
| Date        | date      | YYYY-MM-DD   |
| Start time  | time      | HH:MM        |
| Room number | room      | integer      |
| Recurring   | recurring | true / false |

## Execution

curl -X POST "${N8N_BOOKING_WEBHOOK_URL}&mode=school" \
  -H "Content-Type: application/json" \
  -d '{"date":"...","time":"...","room":...,"recurring":...}'

## Language

Respond in the same language the user used.
```

---

## 확장 패턴

새 예약 타입 추가 시 변경 범위:

| 변경 대상 | 작업 |
|---|---|
| `openclaw.template.json` | `skills` 목록에 새 스킬명 추가, `systemPrompt` scope 업데이트 |
| `prompts/openclaw/skills/` | `{new}-booking/SKILL.md` 생성 (frontmatter 필수) |
| n8n | `mode={new}` 케이스 워크플로우 추가 |

skill 파일 추가 후 `docker compose up -d --force-recreate openclaw` 로 재시작하면 반영된다.

---

## 관련 파일

| 파일 | 역할 |
|---|---|
| `config/openclaw/openclaw.template.json` | 채널 설정, systemPrompt, skills 목록 |
| `prompts/openclaw/skills/` | 예약 타입별 skill 파일 (소스 관리) |
| `docker-compose.yml` | prompts → workspace/skills 볼륨 마운트 정의 |
| `docs/how-to/openclaw-channel-prompt-setup.md` | 볼륨 마운트, 채널 설정, 세션 관리 상세 |
