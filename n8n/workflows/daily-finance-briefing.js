// Workflow ID: AW7B5uY2hilrEVJr (Daily Finance Briefing)
// 지표(Sub-Fetch-Metrics)와 기사(Sub-Fetch-Market-Signals)를 모아 섹션 2·3·4를 LLM으로 만들고,
// Slack 채널 C0C019Q28Q3 에 메인 1건 + 답글 4건으로 보낸다.
//
// 섹션 1은 LLM을 거치지 않는다. 수치는 지어낼 여지를 두지 않는다.
// Slack 발송은 n8n이 한다. OpenClaw에 맡기면 재시도와 실행 이력이 사라진다.
// 스케줄 트리거는 t05에서 붙인다. 지금은 수동 실행 전용이다.
//
// 파일은 SDK 파서(제한된 AST 인터프리터) 때문에 리터럴로 펼쳐 둔다.
// 커밋 전 bash scripts/validate-workflows.sh 로 확인할 것.
import { workflow, node, trigger } from '@n8n/workflow-sdk';


const manualTrigger = trigger({
  type: "n8n-nodes-base.manualTrigger",
  version: 1,
  config: {"name": "When Run Manually", "position": [0, 0], "parameters": {}},
  output: [{}]
});

const fetchMetrics = node({
  type: "n8n-nodes-base.executeWorkflow",
  version: 1.3,
  config: {"name": "Fetch Metrics", "parameters": {"workflowId": {"__rl": true, "value": "4YKsFlxif0Gidami", "mode": "id", "cachedResultName": "Sub-Fetch-Metrics"}, "options": {"waitForSubWorkflow": true}}, "position": [224, -120]},
  output: [{ metrics: [], _count: 0 }]
});

const fetchSignals = node({
  type: "n8n-nodes-base.executeWorkflow",
  version: 1.3,
  config: {"name": "Fetch Market Signals", "parameters": {"workflowId": {"__rl": true, "value": "Y1E4O6YiZHh5ulUC", "mode": "id", "cachedResultName": "Sub-Fetch-Market-Signals"}, "options": {"waitForSubWorkflow": true}}, "position": [224, 120]},
  output: [{ rss_items: [], _count: 0 }]
});

const mergeInputs = node({
  type: "n8n-nodes-base.merge",
  version: 3,
  config: {"name": "Merge Inputs", "parameters": {"numberInputs": 2}, "position": [448, 0]},
  output: [{}]
});

const buildSections = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {"name": "Build Sections", "parameters": {"mode": "runOnceForAllItems", "jsCode": "\n// 섹션 1은 LLM을 거치지 않는다. 수집 결과를 그대로 렌더한다.\n// 정렬 로직은 scripts/preview-briefing.mjs와 같아야 한다. 한쪽만 고치면 미리보기와 실제가 어긋난다.\nvar metricsJson = null, signalsJson = null;\nfor (var i = 0; i < items.length; i++) {\n  var j = items[i].json || {};\n  if (j.metrics) metricsJson = j;\n  if (j.rss_items) signalsJson = j;\n}\nif (!metricsJson) throw new Error('metrics payload missing from merge');\nif (!signalsJson) throw new Error('rss payload missing from merge');\n\n// 기사가 없는데 프롬프트는 \"2건을 고르라\"고 요구한다. 그대로 두면 모델이 지어낸다.\n// 섹션 1만 보내도록 우회하지 않고 멈추는 쪽을 택했다. 조용히 반쪽 브리핑이 나가는 편이 더 나쁘다.\nvar MIN_ARTICLES = 3;\nvar articles = signalsJson.rss_items || [];\nif (articles.length < MIN_ARTICLES) {\n  throw new Error('only ' + articles.length + ' article(s) collected, need ' + MIN_ARTICLES +\n    '; refusing to let the model invent them. empty sources=' + JSON.stringify(signalsJson._emptySources || []) +\n    ' fetch errors=' + JSON.stringify(signalsJson._fetchErrors || []));\n}\n\nvar by = {};\nfor (var k = 0; k < metricsJson.metrics.length; k++) by[metricsJson.metrics[k].metric_code] = metricsJson.metrics[k];\nvar REQUIRED = ['FX_USDKRW','FX_JPY100KRW','RATE_KR_BASE','RATE_US_TARGET_UPPER','RATE_US_TARGET_LOWER','RATE_JP_POLICY','IDX_KOSPI','IDX_SP500','IDX_NASDAQ'];\nvar absent = [];\nfor (var r = 0; r < REQUIRED.length; r++) if (!by[REQUIRED[r]]) absent.push(REQUIRED[r]);\nif (absent.length) throw new Error('metric missing: ' + absent.join(','));\n\nfunction num(v, d) { return v.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d }); }\nfunction arrow(d) { return d > 0 ? '▲' : (d < 0 ? '▼' : ''); }\nfunction width(str) {\n  var w = 0;\n  var chars = Array.from(str);\n  for (var i = 0; i < chars.length; i++) {\n    var cp = chars[i].codePointAt(0);\n    var wide = cp >= 0x1100 && (cp <= 0x115f || (cp >= 0x2e80 && cp <= 0xa4cf) ||\n      (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||\n      (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) ||\n      (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1f9ff));\n    w += wide ? 2 : 1;\n  }\n  return w;\n}\nfunction padR(s, w) { return s + ' '.repeat(Math.max(0, w - width(s))); }\nfunction padL(s, w) { return ' '.repeat(Math.max(0, w - width(s))) + s; }\nfunction moveCell(m) {\n  if (m.delta === null) return '';\n  if (m.delta === 0) return ' (보합)';\n  var abs = arrow(m.delta) + num(Math.abs(m.delta), m.decimals);\n  if (m.delta_pct === null) return ' (' + abs + ')';\n  return ' (' + abs + ', ' + (m.delta_pct > 0 ? '+' : '') + m.delta_pct.toFixed(2) + '%)';\n}\n// 주말은 결측이 아니다. 직전 영업일과 비교해야 월요일에 전 지표가 결측으로 잡히지 않는다.\nfunction prevBusinessDay(iso) {\n  var d = new Date(iso + 'T00:00:00Z');\n  do { d.setUTCDate(d.getUTCDate() - 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);\n  return d.toISOString().slice(0, 10);\n}\nfunction renderGroup(title, rows) {\n  var labelW = 0, valueW = 0, i;\n  for (i = 0; i < rows.length; i++) {\n    labelW = Math.max(labelW, width(rows[i].label));\n    valueW = Math.max(valueW, width(rows[i].value));\n  }\n  var out = ['[' + title + ']'];\n  for (i = 0; i < rows.length; i++) {\n    out.push('• ' + rows[i].flag + ' ' + padR(rows[i].label, labelW) + ' : ' + padL(rows[i].value, valueW) + rows[i].move);\n  }\n  return out;\n}\n\nvar kst = new Date(Date.now() + 9 * 3600000);\nvar dow = ['일','월','화','수','목','금','토'][kst.getUTCDay()];\nvar dateLabel = kst.toISOString().slice(0, 10) + ' (' + dow + ')';\n\nvar fxRows = [\n  { flag: by.FX_USDKRW.flag, label: '원/달러', value: num(by.FX_USDKRW.value, by.FX_USDKRW.decimals) + '원', move: moveCell(by.FX_USDKRW) },\n  { flag: by.FX_JPY100KRW.flag, label: '원/100엔', value: num(by.FX_JPY100KRW.value, by.FX_JPY100KRW.decimals) + '원', move: moveCell(by.FX_JPY100KRW) }\n];\nvar idxRows = [\n  { flag: by.IDX_KOSPI.flag, label: by.IDX_KOSPI.label, value: num(by.IDX_KOSPI.value, by.IDX_KOSPI.decimals), move: moveCell(by.IDX_KOSPI) },\n  { flag: by.IDX_SP500.flag, label: 'S&P 500', value: num(by.IDX_SP500.value, by.IDX_SP500.decimals), move: moveCell(by.IDX_SP500) },\n  { flag: by.IDX_NASDAQ.flag, label: by.IDX_NASDAQ.label, value: num(by.IDX_NASDAQ.value, by.IDX_NASDAQ.decimals), move: moveCell(by.IDX_NASDAQ) }\n];\n\nvar body = [];\nvar g, gi;\ng = renderGroup('환율', fxRows);\nfor (gi = 0; gi < g.length; gi++) body.push(g[gi]);\nbody.push('');\ng = renderGroup('증시', idxRows);\nfor (gi = 0; gi < g.length; gi++) body.push(g[gi]);\nbody.push('');\nbody.push('[기준금리]');\nbody.push('• ' + by.RATE_KR_BASE.flag + ' 한국 ' + by.RATE_KR_BASE.value.toFixed(2) + '%' +\n  ' | ' + by.RATE_US_TARGET_UPPER.flag + ' 미국 ' +\n  by.RATE_US_TARGET_LOWER.value.toFixed(2) + '~' + by.RATE_US_TARGET_UPPER.value.toFixed(2) + '%' +\n  ' | ' + by.RATE_JP_POLICY.flag + ' 일본 ' + by.RATE_JP_POLICY.value.toFixed(2) + '%');\n\nvar section1 = '📈 실시간 주요 지표\\n```\\n' + body.join('\\n') + '\\n```';\n\n// 기준일 단서는 직전 거래일을 건너뛴 지표에만 붙인다. 매일 붙으면 소음이 된다.\nvar gapped = [];\nfor (var m2 = 0; m2 < metricsJson.metrics.length; m2++) {\n  var mm = metricsJson.metrics[m2];\n  if (mm.prev_as_of && mm.unit !== 'percent' && mm.prev_as_of !== prevBusinessDay(mm.as_of)) gapped.push(mm);\n}\nif (gapped.length) {\n  var byDate = {};\n  for (var q = 0; q < gapped.length; q++) {\n    var key = gapped[q].prev_as_of.slice(5);\n    if (!byDate[key]) byDate[key] = [];\n    byDate[key].push(gapped[q].label.replace(/ 환율$/, ''));\n  }\n  var parts = [];\n  for (var d2 in byDate) parts.push(byDate[d2].join('·') + '은 ' + d2 + ' 종가 기준');\n  section1 += '\\n_※ ' + parts.join(', ') + ' (직전 거래일 데이터 없음)_';\n}\nsection1 += '\\n_출처: Yahoo Finance · FRED · BIS · 한국은행_';\n\n// LLM 재료. 웹 검색을 쓰지 않으므로 여기 담긴 것이 전부다.\nvar metricLines = [];\nfor (var p = 0; p < metricsJson.metrics.length; p++) {\n  var x = metricsJson.metrics[p];\n  metricLines.push('- ' + x.label + ': ' + x.value + (x.unit === 'percent' ? '%' : '') +\n    ' (as_of ' + x.as_of + (x.delta === null ? ', 전일대비 없음' : ', 전일대비 ' + x.delta + (x.delta_pct === null ? '' : ' / ' + x.delta_pct + '%')) + ')');\n}\n// 수집 단계에서 HTML 엔티티를 원문자로 디코드하므로 제목에 < > & 가 실제로 들어온다.\n// 그대로 두면 섹션 4의 <URL|제목> 링크 문법이 깨진다.\nfunction slackEscape(t) {\n  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');\n}\nvar newsLines = [];\nvar feed = articles.slice(0, 20);\nfor (var n = 0; n < feed.length; n++) {\n  newsLines.push((n + 1) + '. [' + feed[n].source + '] ' + slackEscape(feed[n].title) + ' | ' + feed[n].url);\n}\n\nvar prompt = [\n  '당신은 경제 브리핑 작성자입니다. 아래 자료만 사용해 한국어로 작성하세요.',\n  '자료에 없는 수치나 사건을 지어내지 마세요. 웹 검색을 하지 마세요.',\n  '',\n  '## 오늘 지표 (' + dateLabel + ')',\n  metricLines.join('\\n'),\n  '',\n  '## 오늘 수집한 기사 (최근 24시간, ' + signalsJson._count + '건 중 상위 ' + feed.length + '건)',\n  newsLines.join('\\n'),\n  '',\n  '## 출력 형식',\n  '아래 키를 가진 JSON 객체 하나만 출력하세요. 코드 펜스나 설명을 덧붙이지 마세요.',\n  '{',\n  '  \"section2\": \"현시점 시장 이슈. 위 기사에서 오늘 시장을 움직인 흐름 2~3가지를 골라 각각 한 문단으로. 불릿 사용. 지표 수치와 연결해 설명. 300자 내외.\",',\n  '  \"section3\": \"초보자 눈높이 요약. 불릿 정확히 3개로 오늘 숫자가 \\'왜 중요한지\\'를 설명할 것 - 숫자만 되풀이하지 말고 각 줄이 영향이나 결과까지 말할 것. 전문용어는 괄호로 풀어 쓸 것. 그 다음 줄은 불릿 없이 \\'한 줄 비유: ...\\' 형식으로, 금융을 모르는 사람이 아는 일상 사물이나 상황에 빗댄 문장 하나. 예시: \\'환율은 수입 물가에 조용히 붙는 할증료 같다.\\' 오늘 시장 상황을 그대로 다시 말하는 문장은 비유가 아니므로 쓰지 말 것.\",',\n  '  \"section4\": \"오늘 체크할 뉴스 Top 2. 위 기사 중 2건을 고르고, 각 항목을 두 줄로 쓸 것. 첫 줄은 \\'1. <URL|제목>\\' 형식의 Slack 링크, 둘째 줄은 \\'   → \\'로 시작하는 한 줄 이유. 제목을 두 번 쓰지 말 것. 반드시 자료에 있는 URL만 쓸 것.\"',\n  '}'\n].join('\\n');\n\nreturn [{ json: {\n  date_label: dateLabel,\n  section1: section1,\n  prompt: prompt,\n  _metric_count: metricsJson._count,\n  _rss_count: signalsJson._count,\n  _rss_used: feed.length,\n  _empty_sources: signalsJson._emptySources || [],\n  _fetch_errors: signalsJson._fetchErrors || []\n} }];\n"}, "position": [672, 0]},
  output: [{ date_label: '', section1: '', prompt: '' }]
});

const callLlm = node({
  type: "n8n-nodes-base.executeWorkflow",
  version: 1.3,
  config: {"name": "Call Sub-LLM-Call", "parameters": {"workflowId": {"__rl": true, "value": "EfSRIKhn13Bsybm0", "mode": "id", "cachedResultName": "Sub-LLM-Call"}, "options": {"waitForSubWorkflow": true}}, "position": [896, 0]},
  output: [{ text: '' }]
});

const parseSections = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {"name": "Parse Sections", "parameters": {"mode": "runOnceForAllItems", "jsCode": "\n// 레포의 다른 코드 노드와 같이 items로 읽는다. $json은 다중 아이템에서 조용히 첫 건만 쓴다.\nvar text = (items[0] && items[0].json && items[0].json.text) || '';\n// 모델이 코드 펜스를 붙이는 경우가 있어 첫 중괄호부터 마지막 중괄호까지 잘라낸다.\nvar start = text.indexOf('{');\nvar end = text.lastIndexOf('}');\nif (start < 0 || end <= start) throw new Error('no json object in llm output: ' + text.slice(0, 300));\nvar parsed;\ntry { parsed = JSON.parse(text.slice(start, end + 1)); }\ncatch (e) { throw new Error('llm json parse failed: ' + e.message + ' | ' + text.slice(start, start + 300)); }\n\n// truthy 검사만 하면 모델이 배열이나 객체를 내보냈을 때 통과하고\n// String()이 \"[object Object]\"를 만들어 그대로 게시된다.\nvar KEYS = ['section2', 'section3', 'section4'];\nvar bad = [];\nfor (var ki = 0; ki < KEYS.length; ki++) {\n  var v = parsed[KEYS[ki]];\n  if (typeof v !== 'string' || v.trim().length < 20) {\n    bad.push(KEYS[ki] + '=' + String(JSON.stringify(v)).slice(0, 120));\n  }\n}\nif (bad.length) throw new Error('llm section not a usable string: ' + bad.join(' | '));\n\nvar built = $('Build Sections').first().json;\nreturn [{ json: {\n  main_text: '📊 오늘의 데일리 경제 & 시장 브리핑 — ' + built.date_label,\n  s1: built.section1,\n  s2: '🔥 현시점 시장 이슈\\n\\n' + String(parsed.section2).trim(),\n  s3: '💡 초보자 눈높이 요약\\n\\n' + String(parsed.section3).trim(),\n  s4: '📰 오늘 체크할 뉴스 Top 2\\n\\n' + String(parsed.section4).trim()\n} }];\n"}, "position": [1120, 0]},
  output: [{ main_text: '', s1: '', s2: '', s3: '', s4: '' }]
});

const postMain = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.2,
  config: {"name": "Post Main", "parameters": {"method": "POST", "url": "https://slack.com/api/chat.postMessage", "sendHeaders": true, "headerParameters": {"parameters": [{"name": "Authorization", "value": "=Bearer {{ $env.SLACK_BOT_TOKEN }}"}, {"name": "Content-Type", "value": "application/json; charset=utf-8"}]}, "sendBody": true, "contentType": "json", "specifyBody": "json", "jsonBody": "={{ JSON.stringify({ channel: \"C0C019Q28Q3\", text: $('Parse Sections').first().json.main_text, unfurl_links: false, unfurl_media: false }) }}", "options": {"timeout": 15000}}, "retryOnFail": true, "maxTries": 3, "waitBetweenTries": 2000, "position": [1568, 0]},
  output: [{ ok: true, ts: '' }]
});

const checkMainPost = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {"name": "Check Main Post", "parameters": {"mode": "runOnceForAllItems", "jsCode": "\n// Slack은 channel_not_found·not_in_channel·msg_too_long을 HTTP 200 + ok:false로 준다.\n// HTTP 노드는 이를 성공으로 보고, ts가 undefined가 되면 JSON.stringify가 thread_ts 키를\n// 통째로 떨어뜨려 답글 4건이 채널 최상위로 나간다. 답글을 보내기 전에 여기서 막는다.\nvar r = (items[0] && items[0].json) || {};\nif (r.ok !== true) throw new Error('chat.postMessage rejected the main post: ' + JSON.stringify(r).slice(0, 300));\nif (!r.ts) throw new Error('chat.postMessage returned no ts; replies would leak to the channel');\nreturn items;\n"}, "position": [1568, 200]},
  output: [{ ok: true, ts: '' }]
});

const postSection1 = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.2,
  config: {"name": "Post Section 1", "parameters": {"method": "POST", "url": "https://slack.com/api/chat.postMessage", "sendHeaders": true, "headerParameters": {"parameters": [{"name": "Authorization", "value": "=Bearer {{ $env.SLACK_BOT_TOKEN }}"}, {"name": "Content-Type", "value": "application/json; charset=utf-8"}]}, "sendBody": true, "contentType": "json", "specifyBody": "json", "jsonBody": "={{ JSON.stringify({ channel: \"C0C019Q28Q3\", text: $('Parse Sections').first().json.s1, unfurl_links: false, unfurl_media: false, thread_ts: $('Post Main').first().json.ts, reply_broadcast: false }) }}", "options": {"timeout": 15000}}, "retryOnFail": true, "maxTries": 3, "waitBetweenTries": 2000, "position": [1792, 0]},
  output: [{ ok: true, ts: '' }]
});

const postSection2 = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.2,
  config: {"name": "Post Section 2", "parameters": {"method": "POST", "url": "https://slack.com/api/chat.postMessage", "sendHeaders": true, "headerParameters": {"parameters": [{"name": "Authorization", "value": "=Bearer {{ $env.SLACK_BOT_TOKEN }}"}, {"name": "Content-Type", "value": "application/json; charset=utf-8"}]}, "sendBody": true, "contentType": "json", "specifyBody": "json", "jsonBody": "={{ JSON.stringify({ channel: \"C0C019Q28Q3\", text: $('Parse Sections').first().json.s2, unfurl_links: false, unfurl_media: false, thread_ts: $('Post Main').first().json.ts, reply_broadcast: false }) }}", "options": {"timeout": 15000}}, "retryOnFail": true, "maxTries": 3, "waitBetweenTries": 2000, "position": [2016, 0]},
  output: [{ ok: true, ts: '' }]
});

const postSection3 = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.2,
  config: {"name": "Post Section 3", "parameters": {"method": "POST", "url": "https://slack.com/api/chat.postMessage", "sendHeaders": true, "headerParameters": {"parameters": [{"name": "Authorization", "value": "=Bearer {{ $env.SLACK_BOT_TOKEN }}"}, {"name": "Content-Type", "value": "application/json; charset=utf-8"}]}, "sendBody": true, "contentType": "json", "specifyBody": "json", "jsonBody": "={{ JSON.stringify({ channel: \"C0C019Q28Q3\", text: $('Parse Sections').first().json.s3, unfurl_links: false, unfurl_media: false, thread_ts: $('Post Main').first().json.ts, reply_broadcast: false }) }}", "options": {"timeout": 15000}}, "retryOnFail": true, "maxTries": 3, "waitBetweenTries": 2000, "position": [2240, 0]},
  output: [{ ok: true, ts: '' }]
});

const postSection4 = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.2,
  config: {"name": "Post Section 4", "parameters": {"method": "POST", "url": "https://slack.com/api/chat.postMessage", "sendHeaders": true, "headerParameters": {"parameters": [{"name": "Authorization", "value": "=Bearer {{ $env.SLACK_BOT_TOKEN }}"}, {"name": "Content-Type", "value": "application/json; charset=utf-8"}]}, "sendBody": true, "contentType": "json", "specifyBody": "json", "jsonBody": "={{ JSON.stringify({ channel: \"C0C019Q28Q3\", text: $('Parse Sections').first().json.s4, unfurl_links: false, unfurl_media: false, thread_ts: $('Post Main').first().json.ts, reply_broadcast: false }) }}", "options": {"timeout": 15000}}, "retryOnFail": true, "maxTries": 3, "waitBetweenTries": 2000, "position": [2464, 0]},
  output: [{ ok: true, ts: '' }]
});

const verifyThread = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {"name": "Verify Thread", "parameters": {"mode": "runOnceForAllItems", "jsCode": "\nvar NODES = ['Post Main', 'Post Section 1', 'Post Section 2', 'Post Section 3', 'Post Section 4'];\nvar main = $('Post Main').first().json;\nvar results = [];\nvar failures = [];\nfor (var i = 0; i < NODES.length; i++) {\n  var r = $(NODES[i]).first().json;\n  var ok = r && r.ok === true;\n  if (!ok) failures.push(NODES[i] + ': ' + ((r && r.error) || 'no ok flag'));\n  results.push({ node: NODES[i], ok: !!ok, ts: r ? r.ts : null, thread_ts: r ? (r.message && r.message.thread_ts) || null : null });\n}\n// 답글 4건은 메인의 ts를 thread_ts로 가져야 한다. 다르면 스레드가 갈라진 것이다.\nvar detached = [];\nfor (var k = 1; k < results.length; k++) {\n  if (results[k].thread_ts !== main.ts) detached.push(results[k].node + ' thread_ts=' + results[k].thread_ts);\n}\nif (failures.length) throw new Error('slack post failed -> ' + failures.join(' | '));\nif (detached.length) throw new Error('reply not in main thread (main ts=' + main.ts + ') -> ' + detached.join(' | '));\nreturn [{ json: { ok_count: results.length, main_ts: main.ts, results: results } }];\n"}, "position": [2688, 0]},
  output: [{ ok_count: 5, main_ts: '', results: [] }]
});

export default workflow('AW7B5uY2hilrEVJr', 'Daily Finance Briefing')
  .add(manualTrigger)
  .to(fetchMetrics.to(mergeInputs.input(0)))
  .add(manualTrigger)
  .to(fetchSignals.to(mergeInputs.input(1)))
  .add(mergeInputs)
  .to(buildSections)
  .to(callLlm)
  .to(parseSections)
  .to(postMain)
  .to(checkMainPost)
  .to(postSection1)
  .to(postSection2)
  .to(postSection3)
  .to(postSection4)
  .to(verifyThread);
