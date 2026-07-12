# OpenClaw GPT(Codex) 로그인: 헤드리스 서버에서 인증 코드 노출

## 문제

헤드리스 리눅스 서버의 openclaw 컨테이너에서 ChatGPT 구독 OAuth로 OpenAI Codex 백엔드에 로그인하려 했으나 두 지점에서 막힘.

1. `--provider openai`로 로그인하면 계속 `Enter OpenAI API key`만 요구. API 키가 아니라 ChatGPT 구독 로그인을 원하는데 방법이 없음.
2. 올바른 provider를 찾아 device-code 로그인을 실행해도 실제 코드가 `[shown on the local device only]`로 마스킹되어 출력됨. 코드를 알 수 없으니 로그인 불가.

전제: openclaw는 원격 서버에서 Docker 컨테이너(`ghcr.io/openclaw/openclaw:latest`, 버전 2026.4.29)로만 돌고, 호스트에 CLI가 없어 모든 명령은 `docker exec [-it] openclaw openclaw <args>` 형태.

## 원인

### 1. provider id가 다름 (openai vs openai-codex)

`openai` provider(`/app/extensions/openai/openai-provider.ts`, `PROVIDER_ID="openai"`)는 `api-key` 인증 방식만 노출한다. 그래서 항상 API 키만 요구.

ChatGPT/Codex OAuth 로그인은 별도 provider id `openai-codex`(`/app/extensions/openai/openai-codex-provider.ts`, `PROVIDER_ID="openai-codex"`, label "OpenAI Codex")에 있다. 이 provider는 두 방식을 노출한다.

- `oauth` ("OpenAI Codex Browser Login"): localhost 브라우저 콜백
- `device-code` ("OpenAI Codex Device Pairing"): URL + 디바이스 코드, 헤드리스 친화적

`openai-codex` provider는 공식 `codex` 플러그인이 활성화되어야만 등록된다.

### 2. isRemoteEnvironment()의 headless-linux 분기 (코드 마스킹의 핵심)

`openai-codex-provider.ts`(약 388행)의 device-code 출력부는 다음과 같이 동작한다.

```ts
const codeLine = ctx.isRemote
  ? "Code: [shown on the local device only]"
  : `Code: ${userCode}`;
```

`ctx.isRemote`가 true면 코드를 의도적으로 마스킹한다(코드가 로컬 데스크톱 디바이스에 뜬다고 가정하는데, 헤드리스 서버에는 그 디바이스가 없음).

`ctx.isRemote`는 `isRemoteEnvironment()`(dist 번들 `remote-env-*.js`)에서 온다.

```js
function isRemoteEnvironment() {
  if (process.env.SSH_CLIENT || process.env.SSH_TTY || process.env.SSH_CONNECTION) return true;
  if (process.env.REMOTE_CONTAINERS || process.env.CODESPACES) return true;
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY && !isWSLEnv()) return true;
  return false;
}
```

핵심: `docker exec`는 호스트의 SSH_* 환경변수를 컨테이너로 전달하지 않는다. 컨테이너 내부에서 `SSH_CLIENT` / `SSH_TTY` / `SSH_CONNECTION` / `REMOTE_CONTAINERS` / `CODESPACES`가 모두 unset, 리눅스에서 `DISPLAY` / `WAYLAND_DISPLAY`도 unset임을 확인했다. 따라서 세 번째 분기("linux && no DISPLAY && no WAYLAND_DISPLAY && not WSL")만 발동해 **SSH 여부와 무관하게 컨테이너는 항상 remote로 판정**되고, 코드가 항상 마스킹된다.

## 해결

### 1. codex 플러그인 활성화

```bash
docker exec openclaw openclaw config set plugins.entries.codex.enabled true
bash ./scripts/ctl.sh restart openclaw
```

`config set` 값은 OpenClaw 자체 auth/config 상태에 저장되어 재시작 후에도 유지된다. 다만 영속적인 설정을 위해서는 codex를 config 템플릿에도 넣어야 하며, 이 단계는 보류했다.

### 2. DISPLAY 주입 후 device-code 로그인

세 번째 분기를 무력화하려면 비어 있지 않은 `DISPLAY`를 exec에 주입하면 된다. 그러면 `isRemoteEnvironment()`가 false → `ctx.isRemote` false → 실제 코드가 출력된다.

```bash
docker exec -it -e DISPLAY=:0 openclaw openclaw models auth login --provider openai-codex --method device-code
```

`DISPLAY=:0`이 세 번째 분기의 `!process.env.DISPLAY` 조건을 깨뜨리는 것이 요점이다(그 외 분기는 이미 전부 unset). remote가 아니게 되면 플로우가 컨테이너 내부에서 브라우저 자동 실행도 시도하지만, 컨테이너에 브라우저가 없어 "open manually" 라인만 로그로 남길 뿐 무해하다. 이제 `Code: <userCode>`가 실제 값으로 출력된다.

코드 확보 후: 로컬 브라우저에서 https://auth.openai.com/codex/device 를 열고 ChatGPT에 로그인한 뒤 코드를 입력한다. 계정 인증(ChatGPT 비밀번호/OAuth)은 사람이 브라우저에서 직접 처리한다.

## 확인

```bash
docker exec openclaw openclaw models list --provider openai-codex
# openai-codex/gpt-5.5 ... Local Auth: yes

docker exec openclaw openclaw models status
# openai-codex 아래 OAuth 프로필 + usage window 표시
```

OAuth 토큰은 `~/.openclaw/agents/main/agent/auth-profiles.json`에 저장되며 재시작 후에도 유지된다.

## 정리

| 문제 | 원인 | 해결 |
|---|---|---|
| API 키만 요구 | `openai` provider는 `api-key` 방식만 노출 | codex 플러그인 활성화 후 `--provider openai-codex` 사용 |
| 헤드리스에서 device-code 방식 없음 | `openai-codex` provider 미등록 | `plugins.entries.codex.enabled true` |
| 인증 코드 마스킹 | `docker exec`가 SSH_* 미전달 → headless-linux 분기로 항상 remote 판정 | `-e DISPLAY=:0` 주입으로 remote 판정 해제 |
