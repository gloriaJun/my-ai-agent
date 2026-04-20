# School Booking Skill

Handles school practice room and lesson room reservations.

## Required Information

Collect all of the following before executing:

| Field       | Key       | Format       |
|-------------|-----------|--------------|
| Date        | date      | YYYY-MM-DD   |
| Start time  | time      | HH:MM        |
| Room number | room      | integer      |
| Recurring   | recurring | true / false |

## Execution

Once all fields are confirmed, send the following request:

curl -X POST "${N8N_BOOKING_WEBHOOK_URL}&mode=school" \
  -H "Content-Type: application/json" \
  -d '{"date":"...","time":"...","room":...,"recurring":...}'

## Language

Respond in the same language the user used.
