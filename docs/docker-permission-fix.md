# Docker 컨테이너 권한 충돌 해결

## 문제

서버에서 `docker-compose` 재시작 또는 `setup.sh` 실행 후 502 에러가 반복 발생.

## 원인

서버의 두 사용자 간 uid 불일치.

```
ubuntu (uid=1001)  ← SSH 접속, docker-compose 실행, git pull
opc    (uid=1000)  ← data/ 디렉토리 소유자
컨테이너 node      ← uid=1000 으로 실행
```

ubuntu(1001)가 `setup.sh` 또는 관리 명령으로 `data/` 하위에 파일/디렉토리를 생성하면
소유자가 1001이 되고, 컨테이너(1000)는 해당 파일에 접근 불가 → 서비스 크래시 → 502.

컨테이너 user를 1001로 바꾸는 방법은 불가. n8n의 `/home/node`가 `drwxr--r--` (740)이라
uid=1001로 컨테이너를 실행하면 홈 디렉토리 traverse 자체가 불가능하기 때문.

## 해결

ubuntu를 gid=1000(opc 그룹)에 추가하고, `data/` 에 setgid + 그룹 쓰기를 설정.
이후 ubuntu가 생성하는 모든 파일/디렉토리가 gid=1000을 상속하여 컨테이너가 항상 접근 가능.

```bash
# 1. ubuntu를 opc 그룹(gid=1000)에 추가
sudo usermod -aG opc ubuntu

# 2. data/ 하위 전체를 1000:1000 소유로 정리
sudo chown -R 1000:1000 ~/my-ai-agent/data/

# 3. setgid + 그룹 rwx 설정 → 새 파일/디렉토리가 gid=1000 상속
sudo chmod -R 2775 ~/my-ai-agent/data/

# 4. ubuntu 기본 umask를 002로 변경 (신규 파일에 그룹 쓰기 허용)
echo 'umask 002' >> ~/.bashrc

# 5. 재로그인 (그룹 변경 반영)
```

## 적용 후 상태

```
drwxrwsr-x  n8n/        (uid=1000, gid=1000, setgid)
drwxrwsr-x  openclaw/   (uid=1000, gid=1000, setgid)
```

`s` 비트(setgid)가 붙어 있으면 정상 적용된 상태.

## 효과

| 변경 | 효과 |
|---|---|
| ubuntu → opc 그룹 추가 | ubuntu가 gid=1000으로 파일 접근 가능 |
| `data/` setgid (2775) | ubuntu가 만든 파일/디렉토리가 자동으로 gid=1000 상속 |
| `umask 002` | ubuntu가 만드는 파일에 그룹 write 권한 자동 부여 |

이후 `git pull`, `setup.sh`, `docker-compose restart` 등을 ubuntu로 실행해도
컨테이너(uid=1000)가 항상 해당 파일에 접근 가능.

---

## 추가 사례: openclaw 컨테이너 EACCES 오류 (2026-04-21)

### 증상

```
EACCES: permission denied, mkdir '/home/node/.openclaw/agents/main/sessions'
EACCES: permission denied, mkdir '/home/node/.openclaw/workspace'
```

### 원인

`docker-compose.yml`의 openclaw 서비스에 `user` 지시어가 없어 컨테이너 기본 유저로 실행됨.
`./data/openclaw`가 UID 1000이 아닌 유저 소유일 경우 서브디렉토리 생성 실패.

### 해결

**1. docker-compose.yml에 `user` 지시어 추가** (n8n과 동일하게 적용):

```yaml
openclaw:
  image: ghcr.io/openclaw/openclaw:latest
  user: "1000:1000"   # 추가
  ...
```

**2. 서버에서 data/openclaw 소유권 일회성 정리**:

```bash
sudo chown -R 1000:1000 ~/my-ai-agent/data/openclaw
docker compose up -d openclaw
```

> `data/` 전체에 이미 setgid(2775)가 적용되어 있다면 소유권 정리 후 재발하지 않음.
