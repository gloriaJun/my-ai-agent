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

채널 목적과 허용 스킬을 `systemPrompt` + `skills`로 정의한다.

```json
"__DISCORD_BOOKING_CHANNEL_ID__": {
  "enabled": true,
  "requireMention": false,
  "skills": ["school-booking", "sports-booking", "camping-booking"],
  "systemPrompt": "이 채널은 예약 전용입니다. 예약 종류를 파악하고 필요한 정보를 모두 수집한 뒤 적합한 스킬을 호출하세요. 예약과 무관한 요청에는 응답하지 마세요."
}
```

### 예약별 도구 정의 (`data/openclaw/workspace/skills/`)

각 예약 타입별 SKILL.md 파일로 수집 정보, webhook URL, JSON 구조를 정의한다.

```
data/openclaw/workspace/
└── skills/
    ├── school-booking.md
    ├── sports-booking.md
    └── camping-booking.md
```

SKILL.md 구조 예시 (`school-booking.md`):

```markdown
# 학교 예약 스킬

학교 연습실/레슨실 예약을 처리한다.

## 수집 정보
- 날짜 (date: YYYY-MM-DD)
- 시간 (time: HH:MM)
- 실 번호 (room: 숫자)
- 반복 여부 (recurring: true/false)

## 실행
모든 정보 수집 완료 후:

curl -X POST "${N8N_BOOKING_WEBHOOK_URL}?type=booking&mode=school" \
  -H "Content-Type: application/json" \
  -d '{"date":"...","time":"...","room":...,"recurring":...}'
```

---

## 확장 패턴

새 예약 타입 추가 시 변경 범위:

| 변경 대상 | 작업 |
|---|---|
| `openclaw.template.json` | `skills` 목록에 새 스킬명 추가, `systemPrompt` 업데이트 |
| `workspace/skills/` | `{new}-booking.md` 생성 |
| n8n | `mode={new}` 케이스 워크플로우 추가 |

openclaw 재시작 없이 SKILL.md 파일 추가만으로 스킬 확장 가능.

---

## 관련 파일

| 파일 | 역할 |
|---|---|
| `config/openclaw/openclaw.template.json` | 채널 설정, systemPrompt, skills 목록 |
| `data/openclaw/workspace/skills/` | 예약 타입별 SKILL.md |
| `docs/openclaw-n8n-integration.md` | 이전 Forwarder 패턴 설계 (대체됨) |
