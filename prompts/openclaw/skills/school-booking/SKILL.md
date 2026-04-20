---
name: school-booking
description: "Book a school practice room or lesson room. Use when the user requests to reserve, book, or schedule a practice room or lesson room at school."
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

Handles school practice room and lesson room reservations.

## Required Information

Collect the following before executing:

| Field      | Key  | Format     | Required |
|------------|------|------------|----------|
| Date       | date | YYYY-MM-DD | ✅ |
| Start time | time | HH:MM      | ✅ |

**Optional fields:**

| Field       | Key       | Format       | Default if omitted |
|-------------|-----------|--------------|-------------------|
| Room number | room      | integer      | omit from payload |
| Recurring   | recurring | true / false | false             |

**IMPORTANT: Never ask the user for room number or recurring.**
- Room assignment is handled automatically by the backend — sending without `room` is correct and expected.
- Recurring defaults to false unless the user explicitly says "매주", "반복" or similar.
- As soon as date and time are known, call the webhook immediately.

**Date handling:**
- If the year is not specified, infer it from the current date in context.
- If the requested date appears to have already passed this year, ask the user to confirm the intended year before proceeding.

## Execution

Once all fields are confirmed, send the following request and wait for the response:

Build the JSON payload with required fields only, adding optional fields if provided:

# Minimum payload (date + time only)
curl -X POST "${N8N_BOOKING_WEBHOOK_URL}&mode=school" \
  -H "Content-Type: application/json" \
  -d '{"date":"YYYY-MM-DD","time":"HH:MM","recurring":false}'

# With room number
curl -X POST "${N8N_BOOKING_WEBHOOK_URL}&mode=school" \
  -H "Content-Type: application/json" \
  -d '{"date":"YYYY-MM-DD","time":"HH:MM","room":1,"recurring":false}'

# With recurring
curl -X POST "${N8N_BOOKING_WEBHOOK_URL}&mode=school" \
  -H "Content-Type: application/json" \
  -d '{"date":"YYYY-MM-DD","time":"HH:MM","recurring":true}'

Only confirm the booking to the user after receiving a success response from the webhook.
Include the full date with year (YYYY-MM-DD format rendered naturally) in the confirmation message.

## Language

Respond in the same language the user used.
