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
ollama pull gemma4:e4b-it-q4_K_M
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
````

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
