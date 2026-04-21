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

Discord 길드/채널 ID는 `config/openclaw/openclaw.template.json`에 템플릿으로 관리하고,
실행 전에 `.env` 값으로 `data/openclaw/openclaw.json`을 렌더링합니다.

```bash
sh ./scripts/render-openclaw-config.sh
```

- 템플릿 키: `__DISCORD_SERVER_ID__`, `__DISCORD_BOOKING_CHANNEL_ID__`
- `.env` 필수 값: `DISCORD_SERVER_ID`, `DISCORD_BOOKING_CHANNEL_ID`
- `setup.sh` / `scripts/ctl.sh start|restart` 실행 시 자동 렌더링됩니다.

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
ollama pull llama3.2:3b
```

### DOCKER 컨테이너 실행

````bash
docker-compose up -d --build

## 📂 폴더 구조

- `data/`: 각 서비스의 설정 및 모델 데이터 저장 (Persistence)
- `Dockerfile.*`: 서비스별 커스텀 실행 환경 정의
- `/workspace`: 실제 작업 파일이 위치하는 로컬의 연결 경로



## 🛠 운영 스크립트

컨테이너 관리, 로그 조회, 배포, OpenClaw 페어링 등 모든 운영 작업은 `scripts/ctl.sh`로 수행합니다.

```bash
bash ./scripts/ctl.sh help
```

명령어 목록 및 사용법은 스크립트 상단 주석을 참고하세요.
