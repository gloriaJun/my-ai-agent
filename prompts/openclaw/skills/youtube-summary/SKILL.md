---
name: youtube-summary
description: "Summarize a YouTube video, or search/manage YouTube channel subscriptions for monitoring. Use when the user shares a YouTube link, asks for a summary, wants to find reliable YouTube channels, or wants to register/manage channel monitoring."
metadata:
  {
    "openclaw":
      {
        "emoji": "▶️",
        "requires": { "bins": ["curl"] }
      }
  }
---

# YouTube Skill

YouTube 영상 요약, 채널 검색, 모니터링 구독/해제/목록 조회를 처리한다.

---

## Actions

| action | mode | 필수 필드 | 설명 |
|---|---|---|---|
| `summarize` | `summary` | `url` 또는 `query` | 영상 URL 또는 키워드로 요약 |
| `search-channels` | `channel` | `query` | 키워드로 YouTube 채널 검색 |
| `subscribe` | `channel` | `channel_id` 또는 `channel_handle`, `channel_name`, `slack_thread_ts` | 채널 모니터링 등록 |
| `unsubscribe` | `channel` | `channel_id` | 채널 모니터링 해제 |
| `list-subscriptions` | `channel` | (없음) | 모니터링 중인 채널 목록 조회 |

---

## Execution

### 영상 요약 (URL)

```bash
curl -s -X POST "${N8N_WEBHOOK_BASE_URL}?type=youtube&mode=summary&action=summarize" \
  -H "Content-Type: application/json" \
  --max-time 60 \
  -d '{"url":"<YouTube URL>"}'
```

### 영상 요약 (키워드 검색)

```bash
curl -s -X POST "${N8N_WEBHOOK_BASE_URL}?type=youtube&mode=summary&action=summarize" \
  -H "Content-Type: application/json" \
  --max-time 60 \
  -d '{"query":"<검색 키워드>"}'
```

### 채널 검색

```bash
curl -s -X POST "${N8N_WEBHOOK_BASE_URL}?type=youtube&mode=channel&action=search-channels" \
  -H "Content-Type: application/json" \
  --max-time 30 \
  -d '{"query":"<검색 키워드>"}'
```

**성공**: `status === "ok"` + `channels` 배열 존재 → 채널 목록 출력.  
각 항목: `channel_name`, `channel_handle`, `channel_id`, `channel_url`, `description`

### 채널 모니터링 등록

`subscribe` 시 `slack_thread_ts`는 현재 Slack 메시지의 `thread_ts` (또는 `message_ts`)를 전달한다.  
이후 새 영상 알림이 이 스레드에 리플라이된다.

```bash
curl -s -X POST "${N8N_WEBHOOK_BASE_URL}?type=youtube&mode=channel&action=subscribe" \
  -H "Content-Type: application/json" \
  --max-time 15 \
  -d '{"channel_id":"<UC...>","channel_name":"<채널명>","channel_handle":"<@handle>","slack_thread_ts":"<thread_ts>"}'
```

`channel_id`를 모르는 경우 `channel_handle`만 전달해도 됨 (자동 조회):

```bash
curl -s -X POST "${N8N_WEBHOOK_BASE_URL}?type=youtube&mode=channel&action=subscribe" \
  -H "Content-Type: application/json" \
  --max-time 30 \
  -d '{"channel_handle":"@fireship","channel_name":"Fireship","slack_thread_ts":"<thread_ts>"}'
```

**성공**: `status === "ok"` + `message` 필드 존재

### 채널 모니터링 해제

```bash
curl -s -X POST "${N8N_WEBHOOK_BASE_URL}?type=youtube&mode=channel&action=unsubscribe" \
  -H "Content-Type: application/json" \
  --max-time 15 \
  -d '{"channel_id":"<UC...>"}'
```

**성공**: `status === "ok"` + `message` 필드 존재

### 모니터링 목록 조회

```bash
curl -s -X POST "${N8N_WEBHOOK_BASE_URL}?type=youtube&mode=channel&action=list-subscriptions" \
  -H "Content-Type: application/json" \
  --max-time 15 \
  -d '{}'
```

**성공**: `status === "ok"` + `channels` 배열 (또는 빈 목록 메시지)

---

## Response Handling

**성공**: `status === "ok"` → 결과 필드 출력  
**실패**: `status !== "ok"` → 실패 안내. `message` 필드가 있으면 포함.

---

## Agent Behavior

- **채널 검색 후 모니터링 등록**: 검색 결과를 사용자에게 보여준 뒤, 사용자가 특정 채널을 지정하면 subscribe 호출
- **subscribe 시 slack_thread_ts**: 반드시 현재 메시지의 `thread_ts` 또는 `message_ts`를 그대로 전달
- **새 영상 알림**: 등록된 채널에 새 영상이 올라오면 매일 09:30 KST에 자동으로 이 스레드에 알림이 온다고 안내

---

## Language

항상 한국어로 응답한다.
