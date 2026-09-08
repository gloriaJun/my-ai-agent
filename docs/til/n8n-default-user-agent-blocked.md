# n8n 기본 User-Agent가 소스에서 차단되는 문제

HTTP Request 노드가 기본으로 보내는 `User-Agent: n8n` 때문에 FRED 요청이 응답 없이 타임아웃으로만
끝난 사례를 기록한다. 상태 코드가 아니라 타임아웃으로 실패하기 때문에 네트워크 문제로 오진하기 쉽다.

---

## 이슈

**증상:** `Sub-Fetch-Metrics` 워크플로에서 미국 기준금리 2종(`RATE_US_TARGET_UPPER` /
`RATE_US_TARGET_LOWER`)만 항상 결측이었다. 같은 워크플로의 Yahoo·BIS 노드는 전부 정상.

**혼란스러운 점:** 로컬 검증 스크립트(`scripts/verify-metrics.mjs`)는 같은 URL로 9종 전부 통과했다.
n8n 컨테이너 안에서 `fetch`나 `axios`를 직접 호출해도 67ms에 200이 돌아온다. n8n 노드로만 실패한다.

```
Fetch RATE_US_TARGET_UPPER  ->  {"error":{"message":"timeout of 15000ms exceeded",
                                          "name":"AxiosError","code":"ECONNABORTED"}}
Fetch IDX_SP500             ->  39ms, 200
```

---

## 원인

FRED(Akamai)가 **UA 문자열에 `n8n`이 들어간 요청을 블랙홀 처리**한다. 연결은 받아주고 응답을 주지
않으므로 클라이언트는 타임아웃으로만 실패를 인지한다.

컨테이너 안에서 n8n이 쓰는 axios로 UA만 바꿔가며 측정한 결과:

| User-Agent | 결과 |
|---|---|
| (미지정) | 200, 13ms |
| `curl/8.7.1` | 200, 19ms |
| `Mozilla/5.0 (compatible; finance-hub/1.0)` | 200, 14ms |
| `household-finance-hub/1.0 (+https://github.com/...)` | 200, 21ms |
| `n8n` | **ECONNABORTED, 12005ms** |
| `n8n-workflow` | **ECONNABORTED, 10005ms** |

`n8n`이 부분 문자열로 포함되기만 해도 걸린다.

### 배제한 가설

타임아웃 실패는 원인 후보가 넓다. 아래는 전부 측정으로 기각했다.

| 가설 | 반증 |
|---|---|
| 서버-FRED 네트워크 지연 | 호스트 curl 0.05s, 컨테이너 axios 67ms |
| 일시적 장애 | 3회 연속 재현 |
| 타임아웃이 짧음 | 60초로 올려도 60071ms 타임아웃 |
| 동시 요청 제한 (FRED 노드 2개 병렬) | 병렬 2건 직접 호출 시 651ms / 489ms 정상 |
| IPv6 블랙홀 | FRED는 AAAA 레코드 없음. 정상 동작하는 Yahoo가 오히려 AAAA 보유 |
| URL이 표현식(`=`)이라서 | 정적 URL로 바꿔도 동일하게 타임아웃 |
| 프록시 설정 | 컨테이너에 `HTTP_PROXY` / `HTTPS_PROXY` 없음 |

---

## 해결

HTTP Request 노드에 `User-Agent`를 명시한다. n8n의 기본값을 덮어쓴다.

```json
"parameters": {
  "url": "...",
  "sendHeaders": true,
  "headerParameters": {
    "parameters": [
      { "name": "User-Agent", "value": "household-finance-hub/1.0 (+https://github.com/gloriaJun/my-ai-agent)" }
    ]
  }
}
```

**문제가 된 노드에만 넣지 말고 워크플로의 HTTP 노드 전부에 넣는다.** 다음에 UA로 필터링하는 소스가
하나 더 생기면 같은 격리 과정을 처음부터 반복해야 한다. 프로젝트명과 연락 경로가 들어간 UA는 봇
예절 측면에서도 브라우저 UA를 사칭하는 것보다 낫다.

부작용은 없었다. 8개 소스 전수 비교에서 오히려 응답이 빨라졌다.

| 소스 | `n8n` UA | 프로젝트 UA |
|---|---|---|
| einfomax | 1478ms | 97ms |
| bok | 804ms | 101ms |
| yna | 1351ms | 104ms |
| bloomberg | 1202ms | 816ms |
| fred | 실패 | 22ms |

---

## 같이 고친 것: 에러 메시지가 `[object Object]`

진단이 오래 걸린 직접적 이유다. Code 노드가 n8n의 에러 객체를 그대로 문자열화하고 있었다.

```javascript
// 잘못됨 - 객체를 String()에 넣으면 "[object Object]"
return fail(String(items[0].json.error));

// 수정 후 - message나 code를 꺼낸다
return fail(String(
  (items[0].json.error && (items[0].json.error.message || items[0].json.error.code))
  || items[0].json.error
));
```

`onError: continueRegularOutput`으로 에러를 정상 데이터처럼 받는 노드에서는 이 처리를 반드시 넣는다.
넣지 않으면 실패 원인이 로그에서 사라진다.

---

## 재발했을 때 확인 순서

1. 실패가 상태 코드가 아니라 **타임아웃**인지 확인한다. 타임아웃이면 UA 차단을 먼저 의심한다
2. 컨테이너 안에서 같은 URL을 직접 호출해 본다. 성공하면 네트워크가 아니라 n8n 계층 문제다

   ```bash
   docker exec n8n node -e "fetch('<URL>').then(r=>console.log(r.status))"
   ```
3. UA만 바꿔 재측정한다. `n8n` 포함/미포함 두 가지면 충분하다
