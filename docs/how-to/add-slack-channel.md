# 새 Slack 채널 추가 체크리스트

신규 채널에 OpenClaw 페르소나 + n8n 스킬 웹훅을 붙이는 전체 절차 (Slack / Socket Mode 기준).
채널별 OpenClaw 설정 원리는 `openclaw-channel-prompt-setup.md` 참고.

---

## 1. Slack 앱 설정

1. [api.slack.com/apps](https://api.slack.com/apps) → `Dotori` 선택
2. 새 채널을 Slack 워크스페이스에 생성하고 봇(`Dotori`)을 초대
3. 채널 우클릭 → 채널 ID 복사 (예: `C0B06QW9MQU`)

---

## 2. OpenClaw 채널 블록 추가 (1-point 수정)

`config/openclaw/openclaw.template.json`의 `channels.slack.channels`에 블록 추가:

```json
"C<NEW_CHANNEL_ID>": {
  "enabled": true,
  "requireMention": false,
  "skills": ["<skill-name>"],
  "systemPrompt": "..."
}
```

- `requireMention: false` — 멘션 없이 채널 메시지에 응답 (채널 전용 봇)
- 채널 ID를 직접 기입 (환경변수 불필요)

> **.env는 건드리지 않는다.** 채널 ID는 민감 정보가 아니므로 템플릿에 직접 기입.

---

## 3. OpenClaw 스킬 파일

```
prompts/openclaw/skills/<skill-name>/SKILL.md
```

- **frontmatter 필수** (`name`, `description`, `metadata.openclaw`)
- `description`에 사용자 trigger 문구 포함 (에이전트가 스킬 매칭에 사용)
- curl 예시는 `POST "${N8N_WEBHOOK_BASE_URL}?type=<type>&mode=<mode>&action={action}"` 형태
- n8n webhook 파라미터 구조는 기존 스킬 파일 참고

스킬 파일 상세 규칙 → `openclaw-channel-prompt-setup.md` §4

---

## 4. n8n 워크플로우

### 4-1. Sub-워크플로우 생성

`executeWorkflowTrigger` → 처리 노드들 → 응답 구조:

```
executeTrigger (onError: continueErrorOutput)
  ↓
DataNode (Code, onError: continueErrorOutput)  ← 입력 검증, action 파싱
  ↓
ActionSwitch (switchCase)
  ├─ case 0 → 처리 노드 A (onError: continueErrorOutput)
  └─ case 1 → 처리 노드 B (onError: continueErrorOutput)
  ↓ (error outputs → SubNormalizeError)
SubNormalizeError (Code)
  ↓
Stop and Error  ← errorMessage: expr('{{ $json.errorPayload }}')
```

### 4-2. My-AI-Agent 라우팅 업데이트

ModeFilter의 `routeMap`에 새 타입/모드 추가:

```javascript
const routeMap = {
  "booking": { "school": 0 },
  "news":    { "detail": 1 },
  "<type>":  { "<mode>": 2 }   // ← 추가
};
```

RouteMap switch `numberOutputs` 증가 + 새 case 추가:
```javascript
routeMapSwitch
  .onCase(0, callBookingSchool.to(successResponse))
  .onCase(1, callNewsDetail.to(successResponse))
  .onCase(2, callNewSub.to(successResponse))   // ← 추가
```

### 4-3. n8n UI 수동 설정 (SDK로 불가)

Sub-워크플로우 Settings 탭:
- **Error Workflow**: `ThAqXteh1LGZZoXt` (Error Alert 워크플로우 ID)
- **Caller Policy**: Same owner

---

## 5. 배포 순서

```
1. 커밋 & 푸시 (또는 deploy 명령)
   bash ./scripts/ctl.sh deploy

2. n8n 워크플로우 활성화 (UI 또는 MCP publish_workflow)

3. OpenClaw 재시작 (채널 설정 반영)
   bash ./scripts/ctl.sh restart openclaw

4. 스킬 로드 확인
   sudo cat ~/my-ai-agent/data/openclaw/agents/main/sessions/sessions.json
   → resolvedSkills에 새 스킬명 확인
```

> `deploy`는 `git pull + docker compose up -d`만 실행. OpenClaw는 별도 재시작 필요.

---

## 6. 검증 체크리스트

- [ ] Slack 채널에 멘션 없이 메시지 전송 → OpenClaw가 **스레드**로 응답 확인
- [ ] 스킬 트리거 요청 → n8n Sub-워크플로우 실행 확인
- [ ] 의도적 에러 발생 → Alert 채널(`C0B0XQP5CF2`)에 에러 메시지 확인
- [ ] 기존 채널(예약 채널 등) 동작 영향 없음 확인
