# OpenClaw 채널 프롬프트 설정 가이드

이 문서는 openclaw Discord 채널에 채널별 지침(systemPrompt)과 스킬(skill)을 연결하는
설정 방법과, 시행착오를 통해 확인한 동작 원리를 기록한다.

---

## OpenClaw 동작 원리 요약

### 에이전트 컨텍스트 조립 순서

openclaw는 매 세션 시작 시 아래 파일을 순서대로 읽어 시스템 프롬프트를 조립한다.

| 파일 | 경로 (컨테이너 내부) | 역할 |
|------|---------------------|------|
| `AGENTS.md` | `workspace/AGENTS.md` | 세션 운영 규칙, 메모리 관리 |
| `SOUL.md` | `workspace/SOUL.md` | 에이전트 정체성·성격 (전역) |
| `TOOLS.md` | `workspace/TOOLS.md` | 환경별 도구 메모 (SSH, 카메라 등) |
| `IDENTITY.md` | `workspace/IDENTITY.md` | 에이전트 이름/프로필 |
| `USER.md` | `workspace/USER.md` | 사용자 정보 |
| Channel `systemPrompt` | `openclaw.json` 채널 설정 | 채널 전용 지침 (채널별 분리됨) |
| Skill 파일 | `workspace/skills/<name>/SKILL.md` | 스킬 실행 상세 (on-demand 로드) |

> **SOUL.md는 전역**이다. 채널 특화 지침을 SOUL.md에 넣으면 모든 채널·DM에 영향을 준다.
> 채널별 지침은 반드시 `systemPrompt` 채널 필드를 사용한다.

---

## 파일 구조

```
prompts/
└── openclaw/
    ├── SOUL.md                          # 전역 에이전트 정체성 (git 관리)
    └── skills/
        └── school-booking/
            └── SKILL.md                 # 학교 예약 스킬 정의
```

`data/` 는 gitignore 대상이므로, 버전 관리가 필요한 프롬프트/스킬은 `prompts/` 에 두고
docker volume으로 마운트한다.

---

## docker-compose.yml 볼륨 마운트

```yaml
volumes:
  - ./data/openclaw:/home/node/.openclaw
  - ./.env:/home/node/.openclaw/.env:ro
  - ./prompts/openclaw/SOUL.md:/home/node/.openclaw/workspace/SOUL.md:ro
  - ./prompts/openclaw/skills:/home/node/.openclaw/workspace/skills:ro
```

- SOUL.md를 `:ro`로 마운트하면 에이전트가 스스로 수정할 수 없다.
  openclaw 설계 의도(에이전트 자율 수정)를 포기하는 대신 운영 통제권을 확보한다.
- `prompts/` 디렉토리는 서버에서 **ubuntu 소유**이지만 컨테이너는 **uid=1000(opc)** 으로 실행된다.
  읽기 권한(o+r)이 있으면 문제없다. (`drwxrwxr-x` 이상이면 OK)

---

## openclaw.json 채널 설정

```json
"channels": {
  "discord": {
    "guilds": {
      "<SERVER_ID>": {
        "channels": {
          "<CHANNEL_ID>": {
            "enabled": true,
            "requireMention": false,
            "skills": ["school-booking"],
            "systemPrompt": "..."
          }
        }
      }
    }
  }
}
```

### `skills` 필드 동작 방식

- `skills: ["school-booking"]` 은 **필터** 역할이다.
  에이전트가 볼 수 있는 스킬 목록을 이 이름들로 제한한다.
- 스킬이 실제로 resolve 되려면 `workspace/skills/<name>/SKILL.md` 파일이 존재하고
  **YAML frontmatter**(`name`, `description`)가 있어야 한다. 없으면 `resolvedSkills: []`가 된다.
- 세션 진단: `data/openclaw/agents/main/sessions/sessions.json` 의
  `skillsSnapshot.resolvedSkills` 로 확인 가능.

### `systemPrompt` 작성 원칙

- **SOUL.md와 중복 금지**: SOUL.md에 있는 내용은 systemPrompt에 반복하지 않는다.
- **채널 scope 제한**: "이 채널은 X 전용"과 같은 채널 특화 규칙만 정의한다.
- **스킬 파일 명시**: 에이전트가 자동으로 스킬을 발견하지 못할 경우,
  절대 경로로 읽도록 명시적으로 지시한다.
- **외부 액션 사전 승인**: AGENTS.md의 기본 지침이 "외부 액션은 먼저 확인"이므로,
  webhook 호출처럼 명시적으로 승인이 필요한 동작은 systemPrompt에 pre-authorized 명시.
- **언어**: 지침은 영어로 작성하고, 사용자에게는 요청 언어로 응답하도록 명시.

현재 예약 채널 systemPrompt 예시:
```
This channel is for school room reservations only.
For booking requests: read /home/node/.openclaw/workspace/skills/school-booking/SKILL.md
and follow its instructions exactly — use the exec tool to run the curl command,
this webhook call is pre-authorized.
NEVER ask the user for room number or recurring; call the webhook as soon as date and time are known.
For any other request: reply that this channel is for reservations only and stop.
Always respond in the same language the user used.
```

---

## SKILL.md 작성 규칙

### 필수 frontmatter

```yaml
---
name: school-booking
description: "한 줄 설명 — 에이전트가 스킬 매칭에 사용하는 트리거 문구 포함"
metadata:
  {
    "openclaw": {
      "emoji": "🏫",
      "requires": { "bins": ["curl"] }
    }
  }
---
```

frontmatter 없이 마크다운 본문만 있으면 openclaw가 스킬로 인식하지 못한다.

### 스킬 파일 경로

```
workspace/skills/<skill-name>/SKILL.md    ✅  (서브디렉토리 + SKILL.md)
workspace/skills/<skill-name>.md          ❌  (flat 파일 — 인식 안 됨)
```

### exec 사용

에이전트가 curl 등 외부 명령을 실행하려면 `exec` 툴을 사용한다.
SKILL.md에 curl 예시만 적어두면 에이전트가 실행 여부를 스스로 판단한다.
확실히 실행하게 하려면 systemPrompt에 "use the exec tool" 을 명시한다.

---

## 모델 설정

llama3.2:3b (로컬 소형 모델)는 스킬 지침을 따르기에 부족했다.
gemini-2.5-flash로 교체 후 정상 동작.

```json
"agents": {
  "defaults": {
    "model": {
      "primary": "google/gemini-2.5-flash"
    }
  }
}
```

API 키 환경변수명: `GEMINI_API_KEY` (`.env` 파일에 설정)

---

## 세션 관리

### 세션 파일 위치

```
data/openclaw/agents/main/sessions/
├── sessions.json          # 채널-세션 매핑 인덱스
└── <uuid>.jsonl           # 채널별 대화 히스토리
```

### SKILL.md 로드 시점 — 중요

모델은 **세션 시작 시 첫 번째 요청에서 SKILL.md를 `read` 도구로 한 번만 읽는다.**
이후 요청에서는 세션 히스토리(`.jsonl`)에 캐시된 내용을 그대로 사용한다.

**따라서 SKILL.md를 수정·배포해도 기존 세션에는 반영되지 않는다.**
수정된 지침이 적용되려면 반드시 세션 리셋이 필요하다.

### 세션 초기화 방법

#### 방법 1: Discord에서 `!reset` 명령 (권장)

systemPrompt에 아래 지침을 포함하면 사용자가 Discord에서 직접 세션을 리셋할 수 있다:

```
When the user sends `!reset` (or '세션 초기화', 'reset session', '초기화해줘'),
use the exec tool to run `rm -f /home/node/.openclaw/agents/main/sessions/*.jsonl 2>/dev/null && echo ok`
and reply: '세션이 초기화됩니다. 다음 메시지부터 새로운 대화가 시작됩니다.'
```

동작 원리:
1. 모델이 exec 도구로 현재 세션 파일을 포함한 모든 `.jsonl` 파일 삭제
2. 다음 메시지 수신 시 새 세션 파일 생성 → 최신 SKILL.md 재로드
3. systemPrompt는 매 API 호출에 포함되므로 **구 세션에서도 즉시 유효**

> `!reset` 지침은 seessionPrompt에 있고, 세션 파일이 아니라 `openclaw.json` 채널 설정에 있으므로
> 구버전 SKILL.md를 캐시한 세션에서도 명령이 동작한다.

#### 방법 2: `ctl.sh reset-session` (서버 관리용)

```bash
sh ./ctl.sh reset-session
```

원격 서버의 모든 세션 파일을 삭제한다.

#### 방법 3: 수동 리셋

```bash
# 특정 세션 파일 백업 후 제거
ssh ocl "cd ~/my-ai-agent && sudo mv data/openclaw/agents/main/sessions/<uuid>.jsonl \
       data/openclaw/agents/main/sessions/<uuid>.jsonl.reset.$(date +%Y-%m-%d)"
docker restart openclaw
```

> 컨테이너 재시작만으로는 세션 히스토리가 유지된다.
> 세션 파일 삭제 후 openclaw는 다음 메시지에 새 파일을 자동 생성한다.

### openclaw.json 권한 문제

`data/openclaw/` 디렉토리는 `opc:opc (700)` 소유이므로 `ubuntu` 유저가 직접 쓸 수 없다.
`render-openclaw-config.sh` 실행 시 `sudo`가 필요하다.

```bash
# 배포 시
sudo bash scripts/render-openclaw-config.sh

# ctl.sh deploy 명령에 이미 포함됨
```

---

## 확장: 새 예약 타입 추가

| 단계 | 작업 |
|------|------|
| 1 | `prompts/openclaw/skills/<type>-booking/SKILL.md` 생성 (frontmatter 포함) |
| 2 | `openclaw.json` 채널의 `skills` 목록에 추가 |
| 3 | `systemPrompt` 업데이트 (새 스킬 파일 경로 추가) |
| 4 | n8n에 `mode=<type>` 케이스 워크플로우 추가 |
| 5 | `docker restart openclaw` |

---

## 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| 스킬이 resolve 안 됨 (`resolvedSkills: []`) | SKILL.md frontmatter 없음 또는 flat 파일 경로 | frontmatter 추가, 서브디렉토리 구조로 변경 |
| 에이전트가 webhook 대신 "어떤 시스템인가요?" 응답 | 스킬 미로드 또는 외부 액션 자제 기본 지침 | systemPrompt에 절대 경로 + pre-authorized 명시 |
| 에이전트가 이전 페르소나로 고착 | 세션 히스토리 누적 | 세션 파일 리셋 (`!reset` 또는 `ctl.sh reset-session`) |
| SKILL.md 수정 후에도 지침이 반영 안 됨 | 세션 시작 시 구버전 SKILL.md가 캐시됨 | 세션 리셋 필요 — SKILL.md는 세션당 1회만 로드 |
| `render-openclaw-config.sh` Permission denied | `data/openclaw/` 가 `opc:opc (700)` 소유 | `sudo bash scripts/render-openclaw-config.sh` 로 실행 |
| 이중 응답 | `docker run --rm` 테스트 컨테이너가 정리되지 않음 | `docker ps`로 확인 후 중복 컨테이너 제거 |
| 컨테이너 재시작 후 "Missing config" | `data/openclaw/` 권한이 ubuntu(1001) 소유로 변경됨 | `sudo chown -R 1000:1000 data/openclaw/` |
| prompts/ git pull 권한 오류 | 디렉토리가 root 또는 opc 소유 | `sudo chown -R ubuntu:ubuntu prompts/` |
