---
name: school-booking
description: "Book, check, or cancel a school practice room or lesson room. Use when the user requests to reserve, book, schedule, list, check, or cancel a practice room or lesson room at school."
metadata:
  {
    "openclaw":
      {
        "emoji": "🏫",
        "requires": { "bins": ["curl"] }
      }
  }
---

# School Booking Skill

Handles school practice room and lesson room reservations: add, list, and delete.

---

## Action Mapping

Determine `action` from user intent:

| User intent | action |
|-------------|--------|
| 예약, 잡아줘, 신청, 등록 | `add` |
| 조회, 확인, 리스트, 목록, 뭐 있어 | `list` |
| 취소, 삭제 | `delete` |

All requests use: `POST "${N8N_BOOKING_WEBHOOK_URL}&mode=school&action={action}"`

---

## action=add (예약 등록)

### Required fields

| Field | Key  | Format     |
|-------|------|------------|
| Date  | date | YYYY-MM-DD |
| Time  | time | HH:MM (24h)|

If `date` or `time` is missing, ask the user before proceeding.

### Optional fields — include ONLY when explicitly stated by the user

| Field    | Key       | Format           | Default if omitted |
|----------|-----------|------------------|--------------------|
| Type     | type      | `lesson` / `practice` | `lesson`    |
| Duration | duration  | 30 / 60 / 90 / 120 (minutes) | omit |
| Room     | room      | integer          | omit               |
| Recurring| recurring | true / false     | false              |

**IMPORTANT:**
- Never ask for `room` or `recurring` — room is assigned automatically by the backend.
- Recurring defaults to false unless the user explicitly says "매주", "반복" or similar.
- "레슨실" → `type: lesson`, "연습실" → `type: practice`. Never put facility name in `room`.
- As soon as `date` and `time` are known, call the webhook immediately.

### Date / Time handling

- Infer year from current date in context if not specified.
- If the date appears to have already passed this year, ask the user to confirm the intended year.
- Convert 12-hour expressions to 24h: 오후 N시 → N+12:00 (오후 12시 → 12:00), 오전 N시 → N:00.
- Always include the day of week when expressing a date (e.g. 2026년 4월 22일 수).

### curl examples

```bash
# Minimum (date + time)
curl -X POST "${N8N_BOOKING_WEBHOOK_URL}&mode=school&action=add" \
  -H "Content-Type: application/json" \
  -d '{"date":"YYYY-MM-DD","time":"HH:MM"}'

# With type
curl -X POST "${N8N_BOOKING_WEBHOOK_URL}&mode=school&action=add" \
  -H "Content-Type: application/json" \
  -d '{"date":"YYYY-MM-DD","time":"HH:MM","type":"lesson"}'

# With room and duration
curl -X POST "${N8N_BOOKING_WEBHOOK_URL}&mode=school&action=add" \
  -H "Content-Type: application/json" \
  -d '{"date":"YYYY-MM-DD","time":"HH:MM","type":"lesson","room":2,"duration":60}'

# With recurring
curl -X POST "${N8N_BOOKING_WEBHOOK_URL}&mode=school&action=add" \
  -H "Content-Type: application/json" \
  -d '{"date":"YYYY-MM-DD","time":"HH:MM","recurring":true}'
```

Only confirm the booking if the response body contains a non-null `reservation_id`. If the response is empty, `reservation_id` is null or absent, or `status` is not `"ok"`, treat it as a failure and inform the user the booking did not go through (include the `message` field if present). Include in the confirmation message: full date with year and day of week (e.g. "2026년 4월 25일 토"), time range, duration, type (레슨실/연습실), room number (`room_number`), and reservation ID. Example: "2026년 4월 27일 월 오후 2시 30분부터 2시간 동안 레슨실 3호실 예약이 완료되었습니다. (예약 ID: 8)"

---

## action=list (예약 조회)

### Optional fields

| Field | Key  | Format     | Description        |
|-------|------|------------|--------------------|
| Date  | date | YYYY-MM-DD | Filter by date; omit for all reservations |

### curl examples

```bash
# All reservations
curl -X POST "${N8N_BOOKING_WEBHOOK_URL}&mode=school&action=list" \
  -H "Content-Type: application/json" \
  -d '{}'

# Filter by date
curl -X POST "${N8N_BOOKING_WEBHOOK_URL}&mode=school&action=list" \
  -H "Content-Type: application/json" \
  -d '{"date":"YYYY-MM-DD"}'
```

Present the results as a list. Start with the total count (e.g. "총 2건의 예약이 있습니다."). For each item show: reservation ID, date (YYYY년 M월 D일 요일), time range, type+room, and status. For type+room: map `facility_type` ("lesson"→레슨실, "practice"→연습실), then append room — if `room_number` is a digit string (e.g. "3") append "N호실" (e.g. "레슨실 3호실"); if `room_number` is "자동선택" append "(자동배정)". Use `status_kr` for status. Never output raw JSON. Example items: "- 예약 ID: 8, 날짜: 2026년 4월 27일 월, 시간: 14:30 - 16:30, 종류: 레슨실 3호실, 상태: 확정" or "- 예약 ID: 9, 날짜: 2026년 4월 28일 화, 시간: 16:30 - 18:00, 종류: 레슨실 (자동배정), 상태: 확정"

---

## action=delete (예약 취소)

### Required fields

| Field | Key | Format  |
|-------|-----|---------|
| Reservation ID | id | integer |

If the user does not provide an ID, call `action=list` first to retrieve reservations, then ask the user which one to cancel.

### curl example

```bash
curl -X POST "${N8N_BOOKING_WEBHOOK_URL}&mode=school&action=delete" \
  -H "Content-Type: application/json" \
  -d '{"id":3}'
```

Only confirm cancellation after receiving a success response from the webhook.

---

## Language

Respond in the same language the user used.
