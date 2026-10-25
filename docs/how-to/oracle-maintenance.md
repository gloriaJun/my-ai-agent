# Oracle 서비스 백업과 정리

n8n이 매주 일요일 04:00(`Asia/Seoul`)에 백업을 요청하고, 호스트의 systemd 작업이 독립적으로 실행한다. Google Drive `oracle-backups/`에는 검증된 최신 백업 1개를 남긴다.

## 백업 범위

| 서비스 | 복구 데이터 |
|---|---|
| n8n | SQLite DB, encryption key를 포함한 환경설정, binaryData, 워크플로 소스, Dockerfile·Compose |
| Nginx Proxy Manager | DB·설정, Let's Encrypt 인증서와 키, Compose |
| ricetta | DB·이미지 등 data, `.env`, 앱 소스와 공통 빌드 파일 |
| kw-booking | 예약 DB, `.env`, `preferences.yaml`, 앱 소스와 공통 빌드 파일 |

컨테이너·네트워크 복구 메타데이터도 압축 파일에 포함한다. 로그, 캐시, `node_modules`, `.next`, 오래된 `.bak` 파일은 제외한다. rclone OAuth 설정은 별도로 보관하며 백업에 포함하지 않는다.

## 실행과 보존

1. n8n의 **Oracle Weekly Backup**이 요청 파일을 원자적으로 생성한다.
2. systemd.path가 호스트 작업을 시작한다. 사전 점검을 통과한 뒤 네 서비스를 중지해 snapshot을 생성하고 재시작한다.
3. 서비스 상태, 압축 파일과 SQLite 무결성을 검사한다.
4. 날짜·UUID가 포함된 `.pending` 파일을 Drive에 업로드하고 MD5·크기를 대조한다. 검증 후 최종 이름으로 바꾸고 다시 확인한다.
5. 검증에 성공하면 전용 이름 규칙에 맞는 이전 백업과 로컬 임시 파일을 정리한다. 이전 Drive 파일은 기본 동작에 따라 휴지통으로 이동한다. 다른 파일이나 전체 휴지통은 건드리지 않는다.
6. 이번 달 정리에 아직 성공하지 않았다면 Docker 캐시·미사용 이미지·과거 로그를 정리한다.
7. **Oracle Backup Report**가 5분마다 결과를 확인해 기존 운영 알림 Slack 채널로 보고한다. 성공 응답을 받은 뒤에만 보고 완료를 기록한다.

snapshot 동안에는 네 서비스가 중지되며, NPM을 통한 다른 서비스의 외부 접속도 잠시 끊길 수 있다.

월간 정리는 최근 7일 이내 사용한 build cache를 보존한다. 이미지는 어떤 컨테이너에서도 참조하지 않는 것만 삭제하며, 사용하지 않는 rollback 이미지도 대상이다. 로그는 7일 이전 journal·회전 파일만 삭제한다. 월간 실행이므로 정리 사이에 보존 기간보다 오래된 로그가 쌓일 수 있다. 서비스 데이터·볼륨·DB 내부 실행 이력은 삭제하지 않는다.

## 설치

기존 워크플로를 다시 import하면 비활성 상태가 되므로 설치 변경 뒤에는 `--activate`까지 실행하고 등록 상태를 확인한다.

Oracle 호스트에 Python 3, Docker, rclone이 필요하다. 파일은 `/home/ubuntu/my-ai-agent`에서 실행하며, rclone remote `gdrive`는 root 계정으로 인증한다.

```bash
sudo bash scripts/install-oracle-maintenance.sh --install-only
sudo bash scripts/install-oracle-maintenance.sh --activate
```

`--install-only`는 호스트 설정과 비활성 n8n 워크플로를 설치한다. `--activate`는 Drive 접근을 확인한 뒤 감시와 워크플로를 활성화하고 n8n을 재시작한다. 기존 `/etc/oracle-maintenance/config.json`은 덮어쓰지 않는다.

Google 재인증은 SSH 터널을 통해 브라우저에서 진행한다. 인증 설정·토큰을 채팅이나 git에 넣지 않는다.

```bash
# Mac에서 켜둔다.
ssh -N -L 53682:127.0.0.1:53682 ocl

# 다른 터미널에서 실행하고 표시된 로컬 URL로 접속한다.
ssh -t ocl 'sudo rclone --config /root/.config/rclone/rclone.conf config reconnect gdrive:'
```

## 확인과 복구

```bash
sudo python3 scripts/oracle-maintenance.py status
systemctl status oracle-maintenance.path oracle-maintenance.service
sudo journalctl -u oracle-maintenance.service --since '1 week ago'
docker ps --format '{{.Names}} {{.Status}}'
```

수동 백업도 n8n의 **Oracle Weekly Backup**에서 실행한다. n8n을 쓸 수 없다면 아래 명령으로 동일한 요청을 생성한다.

```bash
sudo python3 - <<'PY'
import datetime, json, os, pathlib, uuid
root = pathlib.Path('/var/lib/oracle-maintenance/requests')
temporary = root / (uuid.uuid4().hex + '.tmp')
temporary.write_text(json.dumps({
    'request_id': str(uuid.uuid4()),
    'requested_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
}))
try:
    os.link(temporary, root / 'start.json')
finally:
    temporary.unlink()
PY
```

백업 중 비정상 종료하면 `ExecStopPost`가 기록된 중지 대상을 재시작한다. 전원이 꺼졌다면 다음 부팅 시 복구 service가 먼저 실행된다. 수동 복구 명령도 반복 실행할 수 있다.

```bash
sudo python3 scripts/oracle-maintenance.py recover
```

업로드·검증이 실패하면 기존 Drive 백업을 보존하고 월간 정리를 건너뛴다. 이번 실행의 미검증 원격 파일 삭제를 시도하며, Drive가 응답하지 않으면 남을 수 있다. 로컬 임시 snapshot은 정리한다. 강제 종료로 남은 로컬 파일도 복구 과정에서 정리한다. 상태 파일의 `phase`와 systemd journal로 실패 단계를 확인한다.

복원할 때는 Drive의 최신 파일을 내려받아 압축 파일을 검사하고, 대상 컨테이너를 중지한 뒤 상대 경로를 `/home/ubuntu` 아래에 펼친다. `recovery/metadata.json`에 이미지·환경설정·네트워크 정보가, `recovery/etc/`에 자동화 설정이 들어 있다. DB와 n8n encryption key는 같은 백업의 것을 사용한다. 원래 uid/gid·파일 모드·인증서 symlink를 유지해 Compose를 기동한 뒤 health와 HTTP 응답을 확인한다.

## 검증

원본 서버를 변경하지 않는 별도 서버 전체 복원 시험은 아직 수행하지 않았다. 최초 적용 시에는 실제 백업의 업로드·다운로드 해시, SQLite 무결성, 로그 제외와 필수 파일, 자동 결과 보고 및 서비스 상태를 확인했다.

```bash
python3 scripts/test-oracle-maintenance.py
node scripts/verify-oracle-maintenance.mjs
bash -n scripts/install-oracle-maintenance.sh
```

[rclone Google Drive](https://rclone.org/drive/) · [Docker prune](https://docs.docker.com/engine/manage-resources/pruning/)
