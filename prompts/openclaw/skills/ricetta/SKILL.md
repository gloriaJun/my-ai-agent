---
name: ricetta
description: "Save an Instagram or YouTube recipe link into the ricetta archive after confirming the details in the thread, or find saved recipes that match the ingredients on hand. Use when the user shares a recipe link or lists ingredients they have."
metadata:
  {
    "openclaw":
      {
        "emoji": "🍳",
        "requires": { "bins": ["curl"] }
      }
  }
---

# Ricetta Skill

Two-way access to the ricetta recipe archive over its HTTP API (curl only, no
webhook in between).

- `register`: turn a recipe link into a saved recipe, confirmed in the thread first
- `match`: find saved recipes that use the ingredients the user has

Two env values, and they are not interchangeable:

- `${RICETTA_URL}` - where the API is called (`http://ricetta:8080`, inside
  `proxy-net`). Every curl below uses this.
- `${RICETTA_PUBLIC_URL}` - what a link in a Slack reply must point at
  (`https://ricetta.gloriajun.duckdns.org`). The internal host does not resolve
  from a phone, so never paste `${RICETTA_URL}` into a reply.

`Authorization: Bearer ${RICETTA_API_TOKEN}` is required on every call. The token
is a PAT issued from ricetta's account screen; a 401 means it was rotated, so say
so instead of retrying.

## Action Mapping

| User intent | action |
|---|---|
| 인스타/유튜브/네이버 블로그 레시피 링크를 붙여넣음, 저장해줘, 넣어줘 | `register` |
| 재료를 나열하고 뭐 만들지 물어봄, "냉장고에 X 있어", 재료로 찾아줘 | `match` |

A link plus ingredients in one message is a `register`. Ingredients with no link
is a `match`.

## action=register

Never save without the user's confirmation in the thread. The archive rejects a
second save of the same link, so a wrong save has to be deleted by hand on the web.

### 1. Extract

```bash
curl -s -X POST "${RICETTA_URL}/api/extract" \
  -H "Authorization: Bearer ${RICETTA_API_TOKEN}" \
  -H "content-type: application/json" \
  -d '{"url":"https://www.instagram.com/p/..."}' \
  --max-time 30
```

Returns `{ draft, suggestions }`. `draft` carries `title`, `captionRaw`,
`sourceType`, `sourceUrl`, `authorHandle`, `postedAt` and image candidates;
`suggestions` carries `categorySlug`, `categoryScore`, `tags`, `ingredients`.

Failures come back as `{code, message}`. Show the message and stop - every one of
them means the link cannot be read, not that the save failed:

| code | HTTP | what to say |
|---|---|---|
| `INVALID_URL` | 400 | 인스타그램 게시물·릴, 유튜브 영상, 네이버 블로그 글 링크만 넣을 수 있다고 알린다 |
| `OG_EMPTY` | 502 | 원본에서 내용을 못 가져왔다고 알리고, 캡션을 직접 붙여 달라고 한다 |
| `API_KEY_MISSING` | 500 | 유튜브 API 키 설정 문제라고 알린다 |
| `RATE_LIMITED` | 429 | 원본이 잠시 막았으니 몇 분 뒤 다시 하자고 한다 |
| `IMAGE_FETCH_FAILED` / `UPSTREAM_ERROR` | 502 | 원본 연결 실패를 알린다 |

### 2. Structure the caption

`captionRaw` is the post's text as published. Read it and produce:

- 요리명: `draft.title` if it names a dish; otherwise take it from the caption.
  An Instagram `og:title` is the account's display name, so never save that as
  the dish name - ask the user instead.
- 재료: `{name, amount, unit}` rows. `amount` is a number or null. `unit` must be
  one of ricetta's units, or one of `약간 / 조금 / 취향껏 / 적당히 / 한 꼬집 / 넉넉히`
  when the caption gives no number. Never write the amount into `name` - the name
  is the search key, and "양파 약간" as a name makes that row unfindable.
- 조리법: numbered steps, one per line.
- 카테고리·태그: start from `suggestions` and adjust from the caption.

**An empty caption is a normal outcome, not a failure.** Some posts carry the
recipe inside the images and leave the caption to the handle alone - `captionRaw`
comes back a line or two long, `suggestions.ingredients` empty and
`categoryScore` 0. Say that the post's text holds no recipe, ask the user to
paste the text (or dictate it), and build the recipe from what they send. Never
fill 재료 or 조리법 from the dish name, the account, or general knowledge.

A naver post reaches the same place a second way: ricetta parses only
SmartEditor ONE, so an old-editor post comes back HTTP 200 with an empty
`captionRaw` and `warnings: ["OG_EMPTY"]`. Treat that warning as the case above,
not as a failure - `title` and the photo did arrive, so only the text is missing.

### 2b. When one link holds several recipes

A single post can list a dozen recipes (a "베스트 12" infographic, a weekly menu).
ricetta ties one `source_url` to one recipe - the column is unique - so the second
save under the same link comes back 409. Do not pick one silently and do not
retry the rest.

Ask in the thread instead:

> 이 링크에서 레시피 N개를 찾았어요. ricetta는 링크 하나에 레시피 하나만 출처로 묶을 수
> 있어요. 어떻게 할까요?
> 1. 전부 직접 등록으로 저장 (원본 링크는 메모에 남겨요)
> 2. 하나만 골라 인스타 출처로 저장

- **1을 고르면** each recipe is saved with `"sourceType":"manual"` and **no
  `sourceUrl` field at all**, with the original link written into `memo`. That is
  what `manual` means here - not "a human typed it" but "ricetta's adapter did not
  fetch it", which is exactly the case when the text came from the user rather
  than the caption. Leaving `sourceUrl` out is what lets several rows coexist.
- **2를 고르면** that one recipe keeps `sourceType`·`sourceUrl` from `draft` and the
  rest are not saved.
- Confirm every recipe's summary before saving, one message listing all of them is
  fine. Save them one call at a time and report which succeeded.

**Judge each recipe on its own.** Recipes arriving in one batch share nothing but
the source: 카테고리 and 태그 come from that dish and its own steps, so decide them
per recipe rather than copying the first one's answer across the batch. Equally,
never leave a recipe's 카테고리 or 태그 empty just because the batch was long - a
row saved with neither is indistinguishable from one nobody has looked at yet.
Put every recipe's 카테고리·태그 in the confirmation summary so the user sees all of
them side by side, and ask when a dish gives you no basis to decide.

### 2c. Keep the link the user gave

`/api/extract` fills `sourceUrl` by itself, but a manual save does not - and a link
the user pasted in the thread is the only record of where the recipe came from.
Never drop it.

- **Saving one recipe**: put that link in `sourceUrl` even when `sourceType` is
  `manual`. The detail screen then shows the source icon and the link.
- **Saving several from one link**: `source_url` is unique, so only one row could
  hold it and the rest would 409. Write the link into every recipe's `memo`
  instead (`원본: <link>`) and leave `sourceUrl` out of all of them - one row
  quietly owning the link while its siblings look source-less is worse than none.
- The link counts whether it arrived with this message or earlier in the thread.
  Images uploaded with no link at all are the only case with nothing to record.

### 3. Confirm in the thread

Post 요리명 / 카테고리 / 태그 / 재료 / 조리법 as a readable summary and ask whether
to save it. Wait for the user's reply. Apply any correction they give and, if the
change is large, show the summary again. Only "yes" proceeds - silence does not.

### 4. Save

```bash
curl -s -X POST "${RICETTA_URL}/api/recipes" \
  -H "Authorization: Bearer ${RICETTA_API_TOKEN}" \
  -H "content-type: application/json" \
  -d '{"sourceType":"instagram","sourceUrl":"...","title":"...","categorySlug":"korean",
       "tags":["밀프렙"],"ingredients":[{"name":"계란","amount":2,"unit":"개"}],
       "steps":"1. ...\n2. ...","captionRaw":"...","authorHandle":"...","postedAt":"...",
       "mainPhoto":{"imageKey":"naver/someone-224309791509.jpg"}}' \
  --max-time 20
```

- `sourceType`·`sourceUrl`·`captionRaw`·`authorHandle`·`postedAt`는 `draft`의 값을
  그대로 싣는다. 사람이 고칠 대상이 아니다.
- **`mainPhoto` was missing until 2026-09-03, so every recipe saved from Slack
  landed without a photo** - all three sources, not just naver. Send
  `{"imageKey": draft.imageKey}` when the draft has one (instagram and naver
  re-host their bytes), otherwise `{"imageUrl": draft.imageCandidates[0].url}`
  (youtube hotlinks, and its first candidate is the uploader's own thumbnail).
  Never send both fields, and send neither when the draft has no photo at all.
- **`categorySlug` is optional and you only send it when there is evidence.** If
  `suggestions.categoryScore` is 0 the classifier matched no keyword at all, so
  omit the field: the recipe lands in `분류 없음`, which the web screen shows as a
  queue to sort out later. Sending `기타` instead makes it look like a human chose it.
- 201: reply with 요리명 and `${RICETTA_PUBLIC_URL}/recipes/<id>`.
- 409 `DUPLICATE_SOURCE_URL`: the body carries `recipeId`. Say it is already saved
  and link to it. Do not try to save it again.
- 400: show `message`, say what to fix, and ask again.

## action=match

```bash
curl -sG "${RICETTA_URL}/api/recipes" \
  --data-urlencode "ingredient=계란" \
  --data-urlencode "ingredient=애호박" \
  -H "Authorization: Bearer ${RICETTA_API_TOKEN}" \
  --max-time 20
```

One `ingredient` parameter per ingredient. Send the plain names the user said -
the archive expands synonyms itself (계란/달걀, 대파/파), so do not translate or
normalize them yourself.

Results are ordered by `matchedIngredientCount`, the number of the user's
ingredients that recipe uses. Take the top 3 and fetch each one's detail for the
steps and the original link:

```bash
curl -s "${RICETTA_URL}/api/recipes/<id>" \
  -H "Authorization: Bearer ${RICETTA_API_TOKEN}" --max-time 20
```

Reply per recipe with 요리명, 겹친 재료, 부족한 재료, 조리법 요약, `sourceUrl` (없으면
`${RICETTA_PUBLIC_URL}/recipes/<id>`). Empty list: say nothing matched and name the
ingredients that were searched, so a typo is visible. 400
`INVALID_INGREDIENT_QUERY`: ask which ingredient to look for.

## Rules

- Always respond in Korean.
- Never invent a recipe, an ingredient, or a step. Everything comes from the API
  response or the caption; if it is not there, say so.
- Never save without an explicit confirmation in the thread.
- Buttons and modals are not used here - confirmation is a thread reply.
