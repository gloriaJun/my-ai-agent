---
name: youtube-summary
description: "Summarize a YouTube video given its URL. Use when the user shares a YouTube link and asks for a summary, overview, key points, or content breakdown."
metadata:
  {
    "openclaw":
      {
        "emoji": "▶️",
        "requires": { "bins": ["curl"] }
      }
  }
---

# YouTube Summary Skill

YouTube 영상 URL 또는 키워드를 받아 n8n을 통해 AI로 요약한 결과를 반환한다.

---

## Required fields

URL 또는 키워드 중 하나를 반드시 제공해야 한다.

| Field | Key | Description |
|-------|-----|-------------|
| YouTube URL | url | 전체 YouTube URL (youtu.be 또는 youtube.com) |
| 검색 키워드 | query | YouTube 영상을 검색할 키워드 (URL이 없을 때) |

둘 다 없으면 URL 또는 키워드를 요청한다.

---

## Execution

### URL로 요약

```bash
curl -s -X POST "${N8N_WEBHOOK_BASE_URL}?type=youtube&action=summarize" \
  -H "Content-Type: application/json" \
  --max-time 60 \
  -d '{"url":"<YouTube URL>"}'
```

### 키워드로 검색 후 요약

```bash
curl -s -X POST "${N8N_WEBHOOK_BASE_URL}?type=youtube&action=summarize" \
  -H "Content-Type: application/json" \
  --max-time 60 \
  -d '{"query":"<검색 키워드>"}'
```

**성공**: `status === "ok"` + `summary` 필드 존재 → summary를 그대로 출력.

**실패**: `status !== "ok"` → 요약에 실패했다고 안내. `message` 필드가 있으면 포함.

---

## Language

항상 한국어로 응답한다.
