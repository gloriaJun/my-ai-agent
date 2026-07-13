# OpenClaw Codex(ChatGPT OAuth) 로그인: 헤드리스 서버

헤드리스 리눅스 서버의 openclaw 컨테이너에서 ChatGPT 구독 OAuth로 Codex 백엔드에 로그인하는 방법. 호스트에 브라우저가 없고 명령은 `docker exec [-it] openclaw openclaw <args>` 형태.

## 방법 (2026.6)

1. **codex 플러그인 활성** (템플릿 `plugins.entries.codex.enabled: true`). 2026.6에서 codex는 default-disabled 플러그인이라, 꺼져 있으면 provider auth flow와 app-server가 안 뜬다.

2. **device-code 로그인** - provider는 `codex`가 아니라 **`openai`**:
   ```bash
   docker exec -it openclaw openclaw models auth login --provider openai --device-code
   ```

3. 출력된 URL(`https://auth.openai.com/codex/device`) + 코드를 **로컬 브라우저에서 ChatGPT 계정으로 승인**. 계정 인증(비밀번호/OAuth)은 사람이 직접 처리한다.

`--device-code`는 코드를 **평문으로 출력**(헤드리스 친화)하므로 별도 우회가 필요 없다. 토큰은 데이터 볼륨(`~/.openclaw/agents/main/agent`의 sqlite)에 저장되어 재시작/재배포에도 유지된다.

## 주의

- **provider는 `openai`다.** 런타임 401 에러는 `Re-authenticate with: openclaw models auth login --provider 'codex'`라고 안내하지만 부정확하다. `codex`는 모델 카탈로그 네임스페이스일 뿐 auth provider가 아니라서, `--provider codex`로는 auth flow가 뜨지 않고 "Default model available"만 출력하고 종료된다.
- 모델 참조는 `codex/gpt-5.4-mini`, `codex/gpt-5.5` 형태(구버전 `openai-codex/*`는 폐기).

## 확인

```bash
docker exec openclaw openclaw models list | grep 'codex/'
# codex/gpt-5.4-mini ... Auth: yes

# 게이트웨이 실호출 (헤더 없이 → 기본 에이전트 primary가 codex)
docker exec openclaw sh -c 'curl -sS http://localhost:18789/v1/chat/completions \
  -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN" -H "Content-Type: application/json" \
  -d "{\"model\":\"openclaw/default\",\"messages\":[{\"role\":\"user\",\"content\":\"ok\"}],\"max_tokens\":20}"'
# http 200 + content "ok"
```

## 2026.4.x 참고 (구버전, 현재는 불필요)

구버전(2026.4.x)에서는 두 가지 함정이 있었다.

1. **provider id가 `openai-codex`**였다 (`openai`는 api-key 방식만 노출). 로그인은 `--provider openai-codex --method device-code`.
2. **device-code 코드가 헤드리스에서 마스킹**(`Code: [shown on the local device only]`)됐다. 원인은 `isRemoteEnvironment()`의 headless-linux 분기 - `docker exec`가 호스트 SSH_* 환경변수를 컨테이너로 전달하지 않아, "linux && no DISPLAY" 조건만으로 항상 remote로 판정됐다. `docker exec -it -e DISPLAY=:0 ...`로 `DISPLAY`를 주입해 우회했다.

2026.6은 provider를 `openai`로 통합하고 `--device-code`가 코드를 평문 출력하도록 바뀌어, 이 우회가 모두 불필요해졌다.

전체 2026.6 셋업/업그레이드 절차와 gotcha는 [[openclaw-2026.6-setup]] 참고.
