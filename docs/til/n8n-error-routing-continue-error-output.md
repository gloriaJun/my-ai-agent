# n8n 에러 라우팅 버그: continueErrorOutput과 커넥션 타입 불일치

Sub-Booking-School 워크플로우에서 API 400 에러가 발생했음에도 부모 워크플로우가 성공으로 응답한 버그의 원인 분석과 해결 방법을 기록한다.

---

## 이슈

**증상:** school 예약 API가 HTTP 400 (E011: 예약 불가 시간대)을 반환했지만, 서브워크플로우(`Sub-Booking-School`)가 에러 없이 종료되어 부모 워크플로우(`My-AI-Agent`)가 성공으로 응답함.

**발견 경위:** 실행 로그 ID#175에서 `BookingSchoolAdd` 노드가 `400 - "{\"status\":\"error\",\"error_code\":\"E011\",...}"` 에러를 받았음에도 `SubNormalizeError` → `Stop and Error` 노드가 실행되지 않은 것을 확인.

---

## 원인

### n8n의 에러 출력 경로 두 가지

n8n 노드의 에러 처리 방식은 `onError` 설정에 따라 출력 경로가 다르다.

| onError 설정 | 에러 라우팅 경로 | 설명 |
|-------------|----------------|------|
| (기본값) | `error` 타입 커넥션 | 별도 error 출력으로 라우팅 |
| `continueErrorOutput` | `main[1]` (두 번째 출력) | 정상 출력과 동일한 main 계열로 라우팅 |
| `continueRegularOutput` | `main[0]` (첫 번째 출력) | 에러를 정상 데이터처럼 취급 |

### 버그의 구조

`BookingSchoolAdd` 등 4개 HTTP 노드는 `onError: continueErrorOutput`으로 설정되어 있었다. 이 설정은 에러를 `main[1]`으로 라우팅한다.

그런데 `SubNormalizeError`로의 연결이 `error` 타입 커넥션으로 되어 있었다.

```json
// 잘못된 연결 (error 타입)
"BookingSchoolAdd": {
  "error": [[{"node":"SubNormalizeError","type":"main","index":0}]]
}
```

결과적으로:
- 에러 발생 → `continueErrorOutput`이 `main[1]`으로 라우팅
- `main[1]`에 연결된 노드 없음 → 워크플로우 조용히 종료
- `error` 타입 커넥션은 무시됨 (`continueErrorOutput` 모드에서는 사용 안 됨)
- 서브워크플로우 출력이 비어있고, 부모는 이를 성공으로 해석

### 영향받은 노드 (4개)

- `BookingSchoolAdd`
- `BookingSchoolList`
- `BookingSchoolConfirm`
- `BookingSchoolCancel`

---

## 해결

### 연결 타입 수정

`error` 타입 커넥션을 `main[1]` 커넥션으로 변경한다.

```json
// 수정 후 (main[1])
"BookingSchoolAdd": {
  "main": [
    [],
    [{"node":"SubNormalizeError","type":"main","index":0}]
  ]
}
```

### n8n SDK에서 올바른 작성법

SDK로 워크플로우를 작성할 때 `.onError()` 메서드는 `error` 타입 커넥션을 생성한다. `continueErrorOutput` 노드의 에러 경로는 반드시 `.output(1).to()` 를 사용해야 한다.

```javascript
// ❌ 잘못된 방법 — error 타입 커넥션 생성됨
httpNode.onError(errorHandler);

// ✅ 올바른 방법 — main[1] 커넥션 생성됨
httpNode.output(1).to(errorHandler);
```

switch/ifElse의 onCase 내부에서도 동일하게 적용한다:

```javascript
.to(bookingSwitch
  .onCase(0, httpNode.output(1).to(errorHandler))
  .onCase(1, otherHttpNode.output(1).to(errorHandler)));
```

트리거처럼 체인 외부에서 연결할 때는 `export default` 앞에 사이드 이펙트로 선언한다:

```javascript
// export 전 사이드 이펙트
subTrigger.output(1).to(errorHandler);
errorHandler.to(stopAndError);

export default workflow('id', 'name')
  .add(subTrigger)
  .to(nextNode);
```

### SubNormalizeError 코드 개선

API 에러가 Axios raw string(`"400 - \"{...json...}\""`) 형태로 전달되므로, 내부 JSON을 파싱해 실제 API 메시지를 추출하도록 수정했다.

```javascript
const axiosMsg = rawErr.message ?? '';
const match = axiosMsg.match(/^\d+ - "(.+)"$/);
if (match) {
  try {
    const inner = JSON.parse(match[1]);
    message = inner.message || cleanMsg(axiosMsg);
  } catch {
    message = cleanMsg(axiosMsg);
  }
}
```
