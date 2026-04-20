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

**Date handling:**
- If the year is not specified, infer it from the current date in context.
- If the requested date appears to have already passed this year, ask the user to confirm the intended year before proceeding.

## Execution

Once all fields are confirmed, send the following request and wait for the response:

curl -X POST "${N8N_BOOKING_WEBHOOK_URL}&mode=school" \
  -H "Content-Type: application/json" \
  -d '{"date":"...","time":"...","room":...,"recurring":...}'

Only confirm the booking to the user after receiving a success response from the webhook.
Include the full date with year (YYYY-MM-DD format rendered naturally) in the confirmation message.

## Language

Respond in the same language the user used.
