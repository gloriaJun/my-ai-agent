# OpenClaw 2026.6 셋업 / 업그레이드 체크리스트와 gotcha

OpenClaw를 2026.4.x → 2026.6.11로 올리면서 선언적 config(템플릿)만으로는 복구되지 않는 지점이 여러 개 드러났다. 2026.6은 모델 참조/provider/플러그인/채널/인증 상당 부분을 **CLI 런타임 상태**(데이터 볼륨)로 관리한다. 신규 서버 구성이나 볼륨 초기화 시 아래 수동 스텝이 필요하다.

전제: openclaw는 원격 서버 Docker 컨테이너(`ghcr.io/openclaw/openclaw:latest`)로만 돌고, 명령은 `docker exec [-it] openclaw openclaw <args>` 형태.

## 셋업 체크리스트 (신규/업그레이드 후)

1. **codex 플러그인 활성** - 템플릿에 반영됨 (`config/openclaw/openclaw.template.json`)
   ```json
   "plugins": { "entries": { "codex": { "enabled": true } } }
   ```
   codex는 2026.6에서 default-disabled 플러그인이라, 꺼져 있으면 `codex/*` 모델의 provider auth flow와 app-server가 안 뜬다.

2. **Slack 채널 설치** - 플러그인 바이너리 + 계정은 CLI 런타임 상태(템플릿으로 재현 불가). `.env`의 `SLACK_BOT_TOKEN`/`SLACK_SIGNING_SECRET`을 씀:
   ```bash
   docker exec openclaw openclaw channels add --channel slack --use-env
   ```
   설치 후 재시작하면 `[slack] http mode listening at /openclaw/slack/events`가 뜨고 채널이 로드된다. 템플릿에는 신뢰/활성만 고정한다:
   ```json
   "plugins": { "allow": ["slack"], "entries": { "slack": { "enabled": true } } }
   ```
   `channels.slack` 블록(채널별 systemPrompt/skills)은 그대로 유지 - 플러그인이 이 config 항목을 읽는다.

3. **Codex OAuth 로그인** - 브라우저 승인이 필요해 자동화 불가(사람이 직접):
   ```bash
   docker exec -it openclaw openclaw models auth login --provider openai --device-code
   ```
   출력된 URL(`https://auth.openai.com/codex/device`) + 코드를 로컬 브라우저에서 ChatGPT 계정으로 승인. 토큰은 데이터 볼륨(agent sqlite)에 저장되어 재시작/재배포에도 유지된다.

## 2026.6 gotcha (2026.4.x 대비 변경점)

| 항목 | 2026.4.x | 2026.6 |
|---|---|---|
| Codex 모델 ref | `openai-codex/gpt-5.5` | **`codex/gpt-5.5`** (openai-codex 폐기) |
| provider api 값 | `"api": "openai"` | enum 강제: `openai-completions`\|`openai-responses`\|... (`"openai"`는 무효 → 기동 크래시) |
| codex / slack | 기본 동작 | **default-disabled 플러그인** (명시 활성 필요) |
| Codex 인증 provider | `--provider openai-codex --method device-code` | **`--provider openai --device-code`** (provider가 openai로 통합; codex는 카탈로그 네임스페이스) |
| device-code 코드 표시 | 헤드리스에서 마스킹 → `-e DISPLAY=:0` 우회 필요 | `--device-code`가 평문 출력 (DISPLAY 트릭 불필요) |
| 채널 구성 | `channels.slack` config만으로 동작 | 플러그인 설치 + `channels add` CLI 필요 |
| `tools.profile` 값 | - | `minimal`\|`coding`\|`messaging`\|`full` (`none` 없음) |

## 인증 provider 통합 주의

런타임 401 에러 메시지는 `Re-authenticate with: openclaw models auth login --provider 'codex'`라고 안내하지만 **부정확**하다. `codex`는 모델 카탈로그 네임스페이스일 뿐 auth provider가 아니라서 `--provider codex`로는 auth flow가 뜨지 않고 "Default model available"만 출력하고 종료된다. 실제 인증 provider는 `openai`다 (`--provider openai --device-code`).

## 다중 에이전트 (참고)

named agent는 `agents.list: [{id, name, workspace, agentDir, model, tools:{profile}, skills:[]}]`로 정의. `agents add` CLI는 openclaw.json의 `agents.list`에 기록하나 **재렌더로 삭제**되므로, durable하게 하려면 템플릿에 직접 넣어야 한다. auth는 read-through 상속(로컬 프로필 없으면 default 에이전트 것을 재사용)이라 secondary 에이전트에 재로그인 불필요.

## 성능

기계적 스킬(예약 등) 응답 지연을 줄이려면 기본 에이전트 추론을 끈다 (템플릿 `agents.defaults`):
```json
"thinkingDefault": "off"
```
상대 날짜("이번 주 목요일") 해석 정확도는 thinking off로도 유지됨을 확인했다.

## 참고

- Codex(ChatGPT OAuth) 로그인 상세: [[openclaw-codex-oauth-login]]
