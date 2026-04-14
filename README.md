# 🚀 Local AI Agent System

Ollama(뇌), n8n(지휘자), OpenClaw(수행 비서)를 이용하여 도커로 구성하기 위한 레포 입니다.

## 🔗 접속 정보 (Local Endpoints)

각 서비스의 대시보드 및 API에 아래 주소로 접속할 수 있습니다.

| 서비스명         | 목적                               | 접속 주소                                        |
| :--------------- | :--------------------------------- | :----------------------------------------------- |
| **Ollama API**   | LLM 모델 추론 및 관리 API (Native) | [http://localhost:11434](http://localhost:11434) |
| **n8n 대시보드** | 워크플로우 설계 및 자동화 관리     | [http://localhost:5678](http://localhost:5678)   |
| **OpenClaw API** | 에이전트 인터페이스 및 외부 연동   | [http://localhost:18789](http://localhost:18789) |

## 📂 폴더 구조

- `data/`: 각 서비스의 설정 및 모델 데이터 (Persistence)
- `Dockerfile.*`: 서비스별 커스텀 실행 환경 (Python 포함)
- `/workspace`: 실제 작업 파일이 위치하는 GitHubPrivate 연결 경로

## ⚙️ OpenClaw 설정 템플릿

Discord 길드/채널 ID는 `data/openclaw/openclaw.template.json`에 템플릿으로 관리하고,
실행 전에 `.env` 값으로 `data/openclaw/openclaw.json`을 렌더링합니다.

```bash
sh ./scripts/render-openclaw-config.sh
```

- 템플릿 키: `__DISCORD_SERVER_ID__`, `__DISCORD_BOOKING_CHANNEL_ID__`
- `.env` 필수 값: `DISCORD_SERVER_ID`, `DISCORD_BOOKING_CHANNEL_ID`
- `setup.sh` / `ctl.sh start|restart` 실행 시 자동 렌더링됩니다.

## 🛠 설치 및 운영 가이드

### Native Ollama 설치 (필수)

도커 실행 전, 맥북 본체에 Ollama를 설치하고 설정을 완료해야 합니다.

```bash
# 1. 설치
brew install ollama

# 2. 서비스 시작 (부팅 시 자동 실행)
brew services start ollama

# 3. 외부 접속 허용 설정 (Docker와의 통신용)
launchctl setenv OLLAMA_HOST "0.0.0.0"
launchctl setenv OLLAMA_ORIGINS "*"
brew services restart ollama
```

### 모델 다운로드

```bash
ollama pull gemma4:e4b
```

### DOCKER 컨테이너 실행

````bash
docker-compose up -d --build

## 📂 폴더 구조

- `data/`: 각 서비스의 설정 및 모델 데이터 저장 (Persistence)
- `Dockerfile.*`: 서비스별 커스텀 실행 환경 정의
- `/workspace`: 실제 작업 파일이 위치하는 로컬의 연결 경로


## 🛠 실행 및 운영 명령어

### 1. 시스템 시작 (최초 실행 및 업데이트 시)

새로운 설정을 반영하거나 이미지를 새로 빌드하며 실행합니다.

```bash
docker-compose up -d --build
```

OpenClaw 이미지 업데이트를 실제 실행 컨테이너에 반영하려면, 아래처럼 재생성이 필요합니다.

```bash
docker compose up -d --force-recreate openclaw
```

주의:
- `--force-recreate`는 컨테이너를 다시 만드는 옵션이며, Ollama 모델 파일을 자동 업데이트하지 않습니다.
- Ollama 모델 업데이트는 `ollama pull <모델명>`을 별도로 실행해야 합니다.

### 2. 시스템 중지

```bash
docker-compose down
```

### 3. 로그 확인

```bash
# 전체 로그 확인
docker-compose logs -f

# 특정 서비스(예: openclaw) 로그만 확인
docker-compose logs -f openclaw
```

### 4. 시스템 커맨드 실행

```bash
docker exec -it <container_name> bash
```

## 🔐 OpenClaw 페어링 승인 절차 (원격 서버)

`https://<도메인>/openclaw`로 접속할 때 브라우저 프로필이 바뀌면, OpenClaw에서 새 디바이스로 인식되어 pairing 승인이 필요할 수 있습니다.

### 1. 현재 pairing 상태 조회

```bash
sh ./ctl.sh pair-list
```

기본 원격 호스트는 `ocl`이며, 다른 호스트를 쓰려면:

```bash
REMOTE_HOST=<your-host> sh ./ctl.sh pair-list
```

### 2. 최신 pending 요청 자동 승인

```bash
sh ./ctl.sh approve-pair
```

동작 방식:
- `devices approve --latest`로 최신 요청 ID 추출
- 해당 `requestId`를 `devices approve <requestId>`로 실제 승인
- 승인 후 `devices list`로 결과 확인

다른 호스트를 쓰려면:

```bash
REMOTE_HOST=<your-host> sh ./ctl.sh approve-pair
```
