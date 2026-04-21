# School Booking Bot 테스트 가이드

openclaw Discord 예약 봇의 동작을 검증하는 테스트 시나리오와 확인 방법을 기록한다.

---

## 사전 확인

```bash
# openclaw / n8n 컨테이너 정상 기동 확인
docker ps | grep -E 'openclaw|n8n'

# openclaw 최근 로그 확인 (에러 여부)
docker logs openclaw --tail 30
```

---

## 테스트 채널

Discord **#booking** 채널에서 메시지 전송.

---

## 1. 예약 등록 (action=add)

### 1-1. 기본 (날짜 + 시간만)

| 입력 | `4월 25일 오후 5시 레슨실 예약해줘` |
|------|--------------------------------------|
| 기대 동작 | 호실/반복 묻지 않고 즉시 webhook 호출 |
| webhook body | `{"date":"2026-04-25","time":"17:00","type":"lesson"}` |
| query param | `&mode=school&action=add` |

### 1-2. 연습실 지정

| 입력 | `내일 오전 10시 연습실 예약해줘` |
|------|----------------------------------|
| webhook body | `{"date":"<내일>","time":"10:00","type":"practice"}` |

### 1-3. 호실 명시

| 입력 | `4월 30일 오후 3시 2번 연습실 예약해줘` |
|------|------------------------------------------|
| webhook body | `{"date":"2026-04-30","time":"15:00","type":"practice","room":2}` |

### 1-4. 반복 예약

| 입력 | `매주 금요일 오후 6시 레슨실 예약해줘` |
|------|----------------------------------------|
| webhook body | `{"date":"<next friday>","time":"18:00","type":"lesson","recurring":true}` |

**확인 포인트:**
- 봇이 호실을 묻지 않고 바로 curl 실행
- n8n Execution Log에서 `query.action = add` 확인
- 봇 응답에 예약 날짜(년 포함)와 시간 표기

---

## 2. 예약 조회 (action=list)

### 2-1. 전체 목록

| 입력 | `예약 목록 보여줘` 또는 `예약 현황 알려줘` |
|------|---------------------------------------------|
| webhook body | `{}` |
| query param | `&mode=school&action=list` |

### 2-2. 날짜 필터

| 입력 | `4월 25일 예약 조회해줘` |
|------|--------------------------|
| webhook body | `{"date":"2026-04-25"}` |

**확인 포인트:**
- n8n에서 `query.action = list` 분기 처리
- 봇이 결과를 목록 형태로 표시 (raw JSON 출력 금지)
- 예약 ID, 날짜, 시간, 시설 유형, 상태 포함 여부

---

## 3. 예약 취소 (action=delete)

### 3-1. ID 지정 취소

| 입력 | `3번 예약 취소해줘` |
|------|----------------------|
| webhook body | `{"id":3}` |
| query param | `&mode=school&action=delete` |

### 3-2. ID 모를 때

| 입력 | `예약 취소하고 싶어` |
|------|----------------------|
| 기대 동작 | 봇이 먼저 `action=list` 호출 → 목록 제시 → 취소할 항목 선택 요청 |

**확인 포인트:**
- n8n에서 `query.action = delete` 분기 처리
- 취소 성공 응답 후 확인 메시지

---

## 4. 채널 범위 제한 확인

| 입력 | `오늘 날씨 어때?` |
|------|-------------------|
| 기대 응답 | "이 채널은 예약 전용입니다" 류의 거절 메시지 |
| 비기대 응답 | 날씨 정보 제공, webhook 호출 |

---

## 5. n8n 실행 로그 확인

n8n 대시보드 → **Executions** 탭에서 확인.

| 확인 항목 | 위치 |
|-----------|------|
| webhook 수신 여부 | Webhook 노드 output |
| `query.action` 값 | Webhook 노드 → `query` 필드 |
| Switch 분기 결과 | Switch 노드 output |
| body 데이터 | Webhook 노드 → `body` 필드 |

### 예상 query 구조

```json
{
  "mode": "school",
  "action": "add"
}
```

---

## 6. 세션/설정 관련 트러블슈팅

세션 캐시, 스킬 미로드, 권한 문제 등은 [`openclaw-channel-prompt-setup.md`](../how-to/openclaw-channel-prompt-setup.md) 트러블슈팅 섹션을 참고한다.
