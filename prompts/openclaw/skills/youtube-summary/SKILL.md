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

YouTube 영상 URL을 받아 n8n을 통해 Gemini AI로 요약한 결과를 반환한다.

---

## Required fields

| Field | Key | Description |
|-------|-----|-------------|
| YouTube URL | url | 전체 YouTube URL (youtu.be 또는 youtube.com) |

URL이 없거나 YouTube URL이 아니면 제공을 요청한다.

---

## Execution

```bash
curl -s -X POST "${N8N_WEBHOOK_BASE_URL}?type=youtube&action=summarize" \
  -H "Content-Type: application/json" \
  --max-time 60 \
  -d '{"url":"<YouTube URL>"}'
```

**성공**: `status === "ok"` + `summary` 필드 존재 → summary를 그대로 출력.

**실패**: `status !== "ok"` → 요약에 실패했다고 안내. `message` 필드가 있으면 포함.

---

## Language

항상 한국어로 응답한다.
