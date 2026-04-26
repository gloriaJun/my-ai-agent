# 새 Discord 채널 추가 체크리스트

신규 채널에 OpenClaw 페르소나 + n8n 스킬 웹훅을 붙이는 전체 절차.
채널별 OpenClaw 설정 원리는 `openclaw-channel-prompt-setup.md` 참고.

---

## 1. 환경변수 (3-point 동시 수정)

세 파일을 항상 함께 수정한다. 하나라도 빠지면 렌더링 또는 런타임에 실패한다.

| 파일 | 수정 내용 |
|------|-----------|
| `.env.example` | `DISCORD_<NAME>_CHANNEL_ID=` 추가 (값은 비워둠) |
| `scripts/render-openclaw-config.sh` | `: "${DISCORD_<NAME>_CHANNEL_ID:?...}"` 검증 + `sed` 치환 줄 추가 |
| `config/openclaw/openclaw.template.json` | `"__DISCORD_<NAME>_CHANNEL_ID__"` 채널 블록 추가 |

### openclaw.template.json 채널 블록 템플릿

```json
"__DISCORD_<NAME>_CHANNEL_ID__": {
  "enabled": true,
  "requireMention": false,
  "skills": ["<skill-name>"],
  "systemPrompt": "..."
}
```

`requireMention: false` — 멘션 없이도 채널 메시지에 응답. 채널 전용 봇으로 쓸 때 사용.

---

## 2. OpenClaw 스킬 파일

```
prompts/openclaw/skills/<skill-name>/SKILL.md
```

- **frontmatter 필수** (`name`, `description`, `metadata.openclaw`)
- `description`에 사용자 trigger 문구 포함 (에이전트가 스킬 매칭에 사용)
- curl 예시는 `POST "${N8N_<NAME>_WEBHOOK_URL}&action={action}"` 형태
- webhook URL은 `.env`의 환경변수로 참조

스킬 파일 상세 규칙 → `openclaw-channel-prompt-setup.md` §4

---

## 3. n8n 워크플로우

### 3-1. Sub-워크플로우 생성

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

**에러 전파 패턴**: 모든 에러 출력 → SubNormalizeError → Stop and Error

SubNormalizeError 코드 패턴:
```javascript
const cleanMsg = (s) => (s ?? '').replace(/\s*\[line \d+\]$/, '').trim();
const rawErr = $json.error ?? '';
const msg = typeof rawErr === 'string' ? cleanMsg(rawErr) : cleanMsg(rawErr.message);
const errorPayload = JSON.stringify({ error: { code: 500, message: msg, source: '<sub-name>' } });
return { errorPayload };
```

### 3-2. My-AI-Agent 라우팅 업데이트

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

새 executeWorkflow 노드 에러 출력 연결:
```javascript
callNewSub.output(1).to(normalizeError);
```

> **SDK `.settings()` 사용 불가** — `errorWorkflow`, `callerPolicy`는 n8n UI에서 수동 설정.

### 3-3. n8n UI 수동 설정 (SDK로 불가)

Sub-워크플로우 Settings 탭:
- **Error Workflow**: `ThAqXteh1LGZZoXt` (Error Alert 워크플로우 ID)
- **Caller Policy**: Same owner

스케줄/독립 워크플로우는 Error Workflow만 설정 (Caller Policy 불필요).

---

## 4. 배포 순서

```
1. 원격 서버 .env 수정
   DISCORD_<NAME>_CHANNEL_ID=<실제_채널_ID>

2. 커밋 & 푸시 (또는 deploy 명령)
   bash ./scripts/ctl.sh deploy

3. n8n 워크플로우 활성화 (UI 또는 MCP publish_workflow)

4. OpenClaw 재시작 (채널 설정 반영)
   bash ./scripts/ctl.sh restart openclaw

5. 스킬 로드 확인
   sudo cat ~/my-ai-agent/data/openclaw/agents/main/sessions/sessions.json
   → resolvedSkills에 새 스킬명 확인
```

> `deploy`는 `git pull + docker compose up -d`만 실행. OpenClaw는 별도 재시작 필요.

---

## 5. 검증 체크리스트

- [ ] Discord 채널에 멘션 없이 메시지 전송 → OpenClaw 응답 확인
- [ ] 스킬 트리거 요청 → n8n Sub-워크플로우 실행 확인
- [ ] 의도적 에러 발생 → 알림 채널(`1496337784426856458`)에 에러 메시지 확인
- [ ] 기존 채널(예약 채널 등) 동작 영향 없음 확인
