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

Only confirm the booking after receiving a success response. Include the full date with year (e.g. "2026년 4월 25일") in the confirmation message.

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

Present the results as a list. For each item show: reservation ID, date (YYYY년 M월 D일), time range, type (레슨실/연습실), and status. Never output raw JSON.

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
