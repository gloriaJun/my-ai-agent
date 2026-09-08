# 운영 중인 n8n에 CLI로 워크플로 올리고 실행하기

n8n MCP 없이 워크플로를 생성·발행·수동 실행하는 방법을 기록한다. 컨테이너 셸 접근만 있으면 되고
API 키가 필요 없다.

---

## 왜 CLI인가

`.mcp.json`의 `n8n-mcp` 엔드포인트(`/mcp-server/http`)는 nginx 로그상 **openclaw로 라우팅된다.**
n8n 워크플로 생성 수단이 아니다. n8n REST API(`/api/v1/workflows`)는 별도 API 키가 필요한데
(`Settings > n8n API`에서 발급), 키 없이 진행하려면 컨테이너 CLI가 유일한 경로다.

---

## 절차

### 1. SDK 소스에서 워크플로 JSON 생성

```bash
# CLI가 import 선언을 거부하므로 제거하고 넘긴다
grep -v "^import .* from '@n8n/workflow-sdk';" n8n/workflows/<name>.js > /tmp/<name>.js
npx --yes @n8n/workflow-sdk code-to-json /tmp/<name>.js
```

### 2. `id`는 반드시 채운다

`id` 없이 import하면 실패한다. n8n이 대신 채워주지 않는다.

```
SQLITE_CONSTRAINT: NOT NULL constraint failed: workflow_entity.id
```

기존 워크플로와 같은 16자 영숫자(nanoid 형태)를 미리 정해 SDK 소스에 박아둔다. 그러면 재import가
새 워크플로 생성이 아니라 **같은 워크플로 갱신**이 되어 몇 번을 돌려도 중복이 생기지 않는다.

```javascript
export default workflow('4YKsFlxif0Gidami', 'Sub-Fetch-Metrics')
```

### 3. import → publish

```bash
scp /tmp/<name>.json ocl:/tmp/
ssh ocl 'docker cp /tmp/<name>.json n8n:/tmp/wf.json && \
         docker exec n8n n8n import:workflow --input=/tmp/wf.json'
ssh ocl 'docker exec n8n n8n publish:workflow --id=<id>'
```

`import:workflow`는 기본으로 워크플로를 비활성 상태로 만든다(`--activeState=false`). JSON의
`active` 값을 따르게 하려면 `--activeState=fromJson`.

### 4. 수동 실행: 브로커 포트를 반드시 옮긴다

`n8n execute`는 별도 n8n 프로세스를 띄우기 때문에 **운영 인스턴스의 task broker 포트(5679)와
충돌한다.**

```
n8n Task Broker's port 5679 is already in use.
Do you have another instance of n8n running already?
```

포트를 겹치지 않게 지정하고, 브로커를 루프백에만 바인딩한다.

```bash
ssh ocl 'docker exec \
  -e N8N_RUNNERS_BROKER_PORT=5695 \
  -e N8N_RUNNERS_BROKER_LISTEN_ADDRESS=127.0.0.1 \
  n8n n8n execute --id=<id> --rawOutput > /tmp/exec.json'
```

`--rawOutput`을 붙여도 앞쪽에 로그 몇 줄이 섞이므로, 파싱할 때 첫 `{`부터 잘라 쓴다.

```python
raw = open('/tmp/exec.json').read()
d = json.loads(raw[raw.index('{'):])
run = d['data']['resultData']['runData']          # 노드 이름 -> 실행 결과
j = run['<마지막 노드>'][0]['data']['main'][0][0]['json']
```

노드별 실패는 `run['<노드>'][0]['data']['main'][0][0]['json']['error']`에 들어 있다.
`executionTime`으로 노드별 소요 시간도 볼 수 있어 성능 원인 추적에 쓸 만하다.

---

## 주의

- **삭제 명령이 없다.** `n8n` CLI에는 `delete:workflow`가 없다. UI나 REST API(API 키 필요),
  아니면 아래 SQLite 경로로 지워야 한다. 임시 워크플로는 이름에 `TMP` 접두어를 붙여 구분해 둔다
- `publish:workflow`는 "restart n8n for changes to take effect"를 출력한다. 스케줄·웹훅 트리거를
  가진 워크플로라면 실제로 재기동이 필요하다. 서브워크플로(`executeWorkflowTrigger`)는 부모가
  호출할 때 현재 정의를 읽으므로 해당하지 않는다
- 손으로 만든 워크플로 JSON은 노드 `id`나 `typeVersion`이 조금만 어긋나도
  `No active execution found`로 조용히 죽는다. 실험용 워크플로도 SDK를 거쳐 만드는 편이 빠르다

---

## 임시 워크플로 지우기

`workflow_entity`를 참조하는 테이블은 20개가 넘지만, 실제로 행이 생기는 것은 6개뿐이고 그중
4개는 `ON DELETE CASCADE`다. `workflow_statistics`만 FK가 없어 따로 지운다.

| 테이블 | on_delete |
|---|---|
| `shared_workflow` | CASCADE |
| `workflow_history` | CASCADE |
| `workflow_dependency` | CASCADE |
| `execution_entity` | CASCADE |
| `workflow_statistics` | FK 없음, 수동 삭제 |

```sql
PRAGMA foreign_keys=ON;
BEGIN IMMEDIATE;
DELETE FROM workflow_statistics WHERE workflowId='<id>';
DELETE FROM workflow_entity     WHERE id='<id>';
COMMIT;
```

컨테이너에 `sqlite3` CLI는 없지만 드라이버 모듈은 있다. n8n을 세울 필요 없이 WAL 위에서 그대로
쓴다. `busyTimeout`을 주고 `BEGIN IMMEDIATE`로 묶는다.

```bash
# 백업 먼저
docker exec n8n cp /home/node/.n8n/database.sqlite /tmp/db-backup.sqlite
docker cp n8n:/tmp/db-backup.sqlite /tmp/

# require 경로는 pnpm 해시가 붙으므로 먼저 찾는다
docker exec n8n sh -c 'find /usr/local/lib/node_modules/n8n/node_modules/.pnpm -maxdepth 1 -iname "*sqlite3*"'
```

지운 뒤에는 각 테이블의 잔여 행 수와 `n8n list:workflow`로 확인한다. 컨테이너 재기동은 필요 없다.
