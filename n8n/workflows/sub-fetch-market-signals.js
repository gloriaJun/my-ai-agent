// Sub-Fetch-Market-Signals
// 경제 브리핑용 RSS 5종을 모아 24시간 이내 기사만 남기고 키워드로 잡음을 거른다.
// 반환: { rss_items: [{ source, title, url, published_at, snippet }], _count,
//         _droppedByKeyword, _fetchErrors, _emptySources }
//
// 이 파일은 SDK 파서가 읽는다. map/함수선언/헬퍼 같은 런타임 로직을 쓸 수 없어
// 모든 노드를 리터럴로 펼쳐 둔다. 런타임 로직은 전부 code 노드 안에 있다.
//
// 레포 선례(daily-tech-news.js)와 다른 점: fetch 노드에 onError:'continueRegularOutput'을
// 건다. 피드 하나가 죽어도 배치 전체가 멈추면 안 되고, n8n이 흘려보낸 error 필드를
// 파서가 _fetchError로 변환한다.
//
// 새 워크플로라 아직 n8n ID가 없다. 생성 후 workflow(...) 첫 인자를 실제 ID로 교체한다.
import { workflow, node, trigger, merge } from '@n8n/workflow-sdk';

const whenCalled = trigger({
  type: "n8n-nodes-base.executeWorkflowTrigger",
  version: 1.1,
  config: {"name":"When Called by Another Workflow","position":[0,400],"parameters":{"inputSource":"passthrough"}},
  output: [{}]
});

const fetch0 = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.2,
  config: {"name":"Fetch MOFE 일일경제지표","onError":"continueRegularOutput","parameters":{"url":"https://mofe.go.kr/com/detailRssTagService.do?bbsId=MOSFBBS_000000000045","options":{"response":{"response":{"responseFormat":"text"}},"timeout":15000}},"position":[224,0]},
  output: [{ data: '<raw feed text>' }]
});

const parse0 = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {"name":"Parse MOFE 일일경제지표","parameters":{"mode":"runOnceForAllItems","jsCode":"const SOURCE = \"MOFE\"; const MAX = 25;\nfunction decodeOnce(s) {\n  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '\"')\n          .replace(/&#39;/g, \"'\").replace(/&apos;/g, \"'\").replace(/&nbsp;/g, ' ')\n          .replace(/&amp;/g, '&');\n}\n// 연합인포맥스는 &amp;quot; 처럼 이중 인코딩한다. 2회까지만 푼다 -\n// 무제한으로 풀면 본문이 의도적으로 쓴 &amp; 가 깨진다.\nfunction decodeEntities(s) {\n  var once = decodeOnce(s);\n  return /&(lt|gt|quot|amp|apos|#39|nbsp);/.test(once) ? decodeOnce(once) : once;\n}\nfunction getText(block, tag) {\n  var open = '<' + tag + '>';\n  var oi = block.indexOf(open);\n  if (oi < 0) return '';\n  var start = oi + open.length;\n  var end = block.indexOf('</' + tag + '>', start);\n  if (end < 0) return '';\n  var raw = block.substring(start, end).trim();\n  if (raw.indexOf('<![CDATA[') === 0) {\n    var ce = raw.lastIndexOf(']]>');\n    raw = ce >= 0 ? raw.substring(9, ce) : raw.substring(9);\n  }\n  return raw.trim();\n}\nfunction toIso(raw) {\n  if (!raw) return '';\n  var s = raw.trim();\n  var m14 = s.match(/^(\\d{4})(\\d{2})(\\d{2})(\\d{2})(\\d{2})(\\d{2})$/);\n  if (m14) {\n    return new Date(m14[1] + '-' + m14[2] + '-' + m14[3] + 'T' + m14[4] + ':' + m14[5] + ':' + m14[6] + '+09:00').toISOString();\n  }\n  var mSpace = s.match(/^(\\d{4}-\\d{2}-\\d{2})[ T](\\d{2}:\\d{2}:\\d{2})$/);\n  if (mSpace) {\n    return new Date(mSpace[1] + 'T' + mSpace[2] + '+09:00').toISOString();\n  }\n  var d = new Date(s);\n  return isNaN(d.getTime()) ? '' : d.toISOString();\n}\nif (items[0] && items[0].json && items[0].json.error) {\n  return [{ json: { _fetchError: true, source: SOURCE, message: String(items[0].json.error) } }];\n}\nvar data = items[0] && items[0].json ? items[0].json.data : null;\nif (!data) {\n  return [{ json: { _fetchError: true, source: SOURCE, message: 'empty response' } }];\n}\nvar out = [];\nvar blocks = data.split('</item>');\nfor (var i = 0; i < blocks.length && out.length < MAX; i++) {\n  var si = blocks[i].lastIndexOf('<item>');\n  if (si < 0) continue;\n  var b = blocks[i].substring(si);\n  var title = decodeEntities(getText(b, 'title'));\n  var url = getText(b, 'link');\n  if (!title || !url) continue;\n  var desc = decodeEntities(getText(b, 'description')).replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim();\n  out.push({ json: {\n    source: SOURCE,\n    title: title,\n    url: url,\n    published_at: toIso(getText(b, 'pubDate')),\n    snippet: desc.substring(0, 300)\n  } });\n}\nif (out.length === 0) {\n  return [{ json: { _sourceEmpty: true, source: SOURCE, message: 'parsed item count: 0' } }];\n}\nreturn out;\n"},"position":[448,0]},
  output: [{ source: 'X', title: 'T', url: 'https://example.com', published_at: '', snippet: '' }]
});

const fetch1 = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.2,
  config: {"name":"Fetch BOK 보도자료","onError":"continueRegularOutput","parameters":{"url":"https://www.bok.or.kr/portal/bbs/B0000552/news.rss?menuNo=200690","options":{"response":{"response":{"responseFormat":"text"}},"timeout":15000}},"position":[224,200]},
  output: [{ data: '<raw feed text>' }]
});

const parse1 = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {"name":"Parse BOK 보도자료","parameters":{"mode":"runOnceForAllItems","jsCode":"const SOURCE = \"BOK\"; const MAX = 25;\nfunction decodeOnce(s) {\n  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '\"')\n          .replace(/&#39;/g, \"'\").replace(/&apos;/g, \"'\").replace(/&nbsp;/g, ' ')\n          .replace(/&amp;/g, '&');\n}\n// 연합인포맥스는 &amp;quot; 처럼 이중 인코딩한다. 2회까지만 푼다 -\n// 무제한으로 풀면 본문이 의도적으로 쓴 &amp; 가 깨진다.\nfunction decodeEntities(s) {\n  var once = decodeOnce(s);\n  return /&(lt|gt|quot|amp|apos|#39|nbsp);/.test(once) ? decodeOnce(once) : once;\n}\nfunction getText(block, tag) {\n  var open = '<' + tag + '>';\n  var oi = block.indexOf(open);\n  if (oi < 0) return '';\n  var start = oi + open.length;\n  var end = block.indexOf('</' + tag + '>', start);\n  if (end < 0) return '';\n  var raw = block.substring(start, end).trim();\n  if (raw.indexOf('<![CDATA[') === 0) {\n    var ce = raw.lastIndexOf(']]>');\n    raw = ce >= 0 ? raw.substring(9, ce) : raw.substring(9);\n  }\n  return raw.trim();\n}\nfunction toIso(raw) {\n  if (!raw) return '';\n  var s = raw.trim();\n  var m14 = s.match(/^(\\d{4})(\\d{2})(\\d{2})(\\d{2})(\\d{2})(\\d{2})$/);\n  if (m14) {\n    return new Date(m14[1] + '-' + m14[2] + '-' + m14[3] + 'T' + m14[4] + ':' + m14[5] + ':' + m14[6] + '+09:00').toISOString();\n  }\n  var mSpace = s.match(/^(\\d{4}-\\d{2}-\\d{2})[ T](\\d{2}:\\d{2}:\\d{2})$/);\n  if (mSpace) {\n    return new Date(mSpace[1] + 'T' + mSpace[2] + '+09:00').toISOString();\n  }\n  var d = new Date(s);\n  return isNaN(d.getTime()) ? '' : d.toISOString();\n}\nif (items[0] && items[0].json && items[0].json.error) {\n  return [{ json: { _fetchError: true, source: SOURCE, message: String(items[0].json.error) } }];\n}\nvar data = items[0] && items[0].json ? items[0].json.data : null;\nif (!data) {\n  return [{ json: { _fetchError: true, source: SOURCE, message: 'empty response' } }];\n}\nvar out = [];\nvar blocks = data.split('</item>');\nfor (var i = 0; i < blocks.length && out.length < MAX; i++) {\n  var si = blocks[i].lastIndexOf('<item>');\n  if (si < 0) continue;\n  var b = blocks[i].substring(si);\n  var title = decodeEntities(getText(b, 'title'));\n  var url = getText(b, 'link');\n  if (!title || !url) continue;\n  var desc = decodeEntities(getText(b, 'description')).replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim();\n  out.push({ json: {\n    source: SOURCE,\n    title: title,\n    url: url,\n    published_at: toIso(getText(b, 'pubDate')),\n    snippet: desc.substring(0, 300)\n  } });\n}\nif (out.length === 0) {\n  return [{ json: { _sourceEmpty: true, source: SOURCE, message: 'parsed item count: 0' } }];\n}\nreturn out;\n"},"position":[448,200]},
  output: [{ source: 'X', title: 'T', url: 'https://example.com', published_at: '', snippet: '' }]
});

const fetch2 = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.2,
  config: {"name":"Fetch 연합인포맥스","onError":"continueRegularOutput","parameters":{"url":"https://news.einfomax.co.kr/rss/allArticle.xml","options":{"response":{"response":{"responseFormat":"text"}},"timeout":15000}},"position":[224,400]},
  output: [{ data: '<raw feed text>' }]
});

const parse2 = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {"name":"Parse 연합인포맥스","parameters":{"mode":"runOnceForAllItems","jsCode":"const SOURCE = \"EINFOMAX\"; const MAX = 25;\nfunction decodeOnce(s) {\n  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '\"')\n          .replace(/&#39;/g, \"'\").replace(/&apos;/g, \"'\").replace(/&nbsp;/g, ' ')\n          .replace(/&amp;/g, '&');\n}\n// 연합인포맥스는 &amp;quot; 처럼 이중 인코딩한다. 2회까지만 푼다 -\n// 무제한으로 풀면 본문이 의도적으로 쓴 &amp; 가 깨진다.\nfunction decodeEntities(s) {\n  var once = decodeOnce(s);\n  return /&(lt|gt|quot|amp|apos|#39|nbsp);/.test(once) ? decodeOnce(once) : once;\n}\nfunction getText(block, tag) {\n  var open = '<' + tag + '>';\n  var oi = block.indexOf(open);\n  if (oi < 0) return '';\n  var start = oi + open.length;\n  var end = block.indexOf('</' + tag + '>', start);\n  if (end < 0) return '';\n  var raw = block.substring(start, end).trim();\n  if (raw.indexOf('<![CDATA[') === 0) {\n    var ce = raw.lastIndexOf(']]>');\n    raw = ce >= 0 ? raw.substring(9, ce) : raw.substring(9);\n  }\n  return raw.trim();\n}\nfunction toIso(raw) {\n  if (!raw) return '';\n  var s = raw.trim();\n  var m14 = s.match(/^(\\d{4})(\\d{2})(\\d{2})(\\d{2})(\\d{2})(\\d{2})$/);\n  if (m14) {\n    return new Date(m14[1] + '-' + m14[2] + '-' + m14[3] + 'T' + m14[4] + ':' + m14[5] + ':' + m14[6] + '+09:00').toISOString();\n  }\n  var mSpace = s.match(/^(\\d{4}-\\d{2}-\\d{2})[ T](\\d{2}:\\d{2}:\\d{2})$/);\n  if (mSpace) {\n    return new Date(mSpace[1] + 'T' + mSpace[2] + '+09:00').toISOString();\n  }\n  var d = new Date(s);\n  return isNaN(d.getTime()) ? '' : d.toISOString();\n}\nif (items[0] && items[0].json && items[0].json.error) {\n  return [{ json: { _fetchError: true, source: SOURCE, message: String(items[0].json.error) } }];\n}\nvar data = items[0] && items[0].json ? items[0].json.data : null;\nif (!data) {\n  return [{ json: { _fetchError: true, source: SOURCE, message: 'empty response' } }];\n}\nvar out = [];\nvar blocks = data.split('</item>');\nfor (var i = 0; i < blocks.length && out.length < MAX; i++) {\n  var si = blocks[i].lastIndexOf('<item>');\n  if (si < 0) continue;\n  var b = blocks[i].substring(si);\n  var title = decodeEntities(getText(b, 'title'));\n  var url = getText(b, 'link');\n  if (!title || !url) continue;\n  var desc = decodeEntities(getText(b, 'description')).replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim();\n  out.push({ json: {\n    source: SOURCE,\n    title: title,\n    url: url,\n    published_at: toIso(getText(b, 'pubDate')),\n    snippet: desc.substring(0, 300)\n  } });\n}\nif (out.length === 0) {\n  return [{ json: { _sourceEmpty: true, source: SOURCE, message: 'parsed item count: 0' } }];\n}\nreturn out;\n"},"position":[448,400]},
  output: [{ source: 'X', title: 'T', url: 'https://example.com', published_at: '', snippet: '' }]
});

const fetch3 = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.2,
  config: {"name":"Fetch 연합뉴스 market","onError":"continueRegularOutput","parameters":{"url":"https://www.yna.co.kr/rss/market.xml","options":{"response":{"response":{"responseFormat":"text"}},"timeout":15000}},"position":[224,600]},
  output: [{ data: '<raw feed text>' }]
});

const parse3 = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {"name":"Parse 연합뉴스 market","parameters":{"mode":"runOnceForAllItems","jsCode":"const SOURCE = \"YNA_MARKET\"; const MAX = 25;\nfunction decodeOnce(s) {\n  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '\"')\n          .replace(/&#39;/g, \"'\").replace(/&apos;/g, \"'\").replace(/&nbsp;/g, ' ')\n          .replace(/&amp;/g, '&');\n}\n// 연합인포맥스는 &amp;quot; 처럼 이중 인코딩한다. 2회까지만 푼다 -\n// 무제한으로 풀면 본문이 의도적으로 쓴 &amp; 가 깨진다.\nfunction decodeEntities(s) {\n  var once = decodeOnce(s);\n  return /&(lt|gt|quot|amp|apos|#39|nbsp);/.test(once) ? decodeOnce(once) : once;\n}\nfunction getText(block, tag) {\n  var open = '<' + tag + '>';\n  var oi = block.indexOf(open);\n  if (oi < 0) return '';\n  var start = oi + open.length;\n  var end = block.indexOf('</' + tag + '>', start);\n  if (end < 0) return '';\n  var raw = block.substring(start, end).trim();\n  if (raw.indexOf('<![CDATA[') === 0) {\n    var ce = raw.lastIndexOf(']]>');\n    raw = ce >= 0 ? raw.substring(9, ce) : raw.substring(9);\n  }\n  return raw.trim();\n}\nfunction toIso(raw) {\n  if (!raw) return '';\n  var s = raw.trim();\n  var m14 = s.match(/^(\\d{4})(\\d{2})(\\d{2})(\\d{2})(\\d{2})(\\d{2})$/);\n  if (m14) {\n    return new Date(m14[1] + '-' + m14[2] + '-' + m14[3] + 'T' + m14[4] + ':' + m14[5] + ':' + m14[6] + '+09:00').toISOString();\n  }\n  var mSpace = s.match(/^(\\d{4}-\\d{2}-\\d{2})[ T](\\d{2}:\\d{2}:\\d{2})$/);\n  if (mSpace) {\n    return new Date(mSpace[1] + 'T' + mSpace[2] + '+09:00').toISOString();\n  }\n  var d = new Date(s);\n  return isNaN(d.getTime()) ? '' : d.toISOString();\n}\nif (items[0] && items[0].json && items[0].json.error) {\n  return [{ json: { _fetchError: true, source: SOURCE, message: String(items[0].json.error) } }];\n}\nvar data = items[0] && items[0].json ? items[0].json.data : null;\nif (!data) {\n  return [{ json: { _fetchError: true, source: SOURCE, message: 'empty response' } }];\n}\nvar out = [];\nvar blocks = data.split('</item>');\nfor (var i = 0; i < blocks.length && out.length < MAX; i++) {\n  var si = blocks[i].lastIndexOf('<item>');\n  if (si < 0) continue;\n  var b = blocks[i].substring(si);\n  var title = decodeEntities(getText(b, 'title'));\n  var url = getText(b, 'link');\n  if (!title || !url) continue;\n  var desc = decodeEntities(getText(b, 'description')).replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim();\n  out.push({ json: {\n    source: SOURCE,\n    title: title,\n    url: url,\n    published_at: toIso(getText(b, 'pubDate')),\n    snippet: desc.substring(0, 300)\n  } });\n}\nif (out.length === 0) {\n  return [{ json: { _sourceEmpty: true, source: SOURCE, message: 'parsed item count: 0' } }];\n}\nreturn out;\n"},"position":[448,600]},
  output: [{ source: 'X', title: 'T', url: 'https://example.com', published_at: '', snippet: '' }]
});

const fetch4 = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.2,
  config: {"name":"Fetch Bloomberg markets","onError":"continueRegularOutput","parameters":{"url":"https://feeds.bloomberg.com/markets/news.rss","options":{"response":{"response":{"responseFormat":"text"}},"timeout":15000}},"position":[224,800]},
  output: [{ data: '<raw feed text>' }]
});

const parse4 = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {"name":"Parse Bloomberg markets","parameters":{"mode":"runOnceForAllItems","jsCode":"const SOURCE = \"BLOOMBERG\"; const MAX = 25;\nfunction decodeOnce(s) {\n  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '\"')\n          .replace(/&#39;/g, \"'\").replace(/&apos;/g, \"'\").replace(/&nbsp;/g, ' ')\n          .replace(/&amp;/g, '&');\n}\n// 연합인포맥스는 &amp;quot; 처럼 이중 인코딩한다. 2회까지만 푼다 -\n// 무제한으로 풀면 본문이 의도적으로 쓴 &amp; 가 깨진다.\nfunction decodeEntities(s) {\n  var once = decodeOnce(s);\n  return /&(lt|gt|quot|amp|apos|#39|nbsp);/.test(once) ? decodeOnce(once) : once;\n}\nfunction getText(block, tag) {\n  var open = '<' + tag + '>';\n  var oi = block.indexOf(open);\n  if (oi < 0) return '';\n  var start = oi + open.length;\n  var end = block.indexOf('</' + tag + '>', start);\n  if (end < 0) return '';\n  var raw = block.substring(start, end).trim();\n  if (raw.indexOf('<![CDATA[') === 0) {\n    var ce = raw.lastIndexOf(']]>');\n    raw = ce >= 0 ? raw.substring(9, ce) : raw.substring(9);\n  }\n  return raw.trim();\n}\nfunction toIso(raw) {\n  if (!raw) return '';\n  var s = raw.trim();\n  var m14 = s.match(/^(\\d{4})(\\d{2})(\\d{2})(\\d{2})(\\d{2})(\\d{2})$/);\n  if (m14) {\n    return new Date(m14[1] + '-' + m14[2] + '-' + m14[3] + 'T' + m14[4] + ':' + m14[5] + ':' + m14[6] + '+09:00').toISOString();\n  }\n  var mSpace = s.match(/^(\\d{4}-\\d{2}-\\d{2})[ T](\\d{2}:\\d{2}:\\d{2})$/);\n  if (mSpace) {\n    return new Date(mSpace[1] + 'T' + mSpace[2] + '+09:00').toISOString();\n  }\n  var d = new Date(s);\n  return isNaN(d.getTime()) ? '' : d.toISOString();\n}\nif (items[0] && items[0].json && items[0].json.error) {\n  return [{ json: { _fetchError: true, source: SOURCE, message: String(items[0].json.error) } }];\n}\nvar data = items[0] && items[0].json ? items[0].json.data : null;\nif (!data) {\n  return [{ json: { _fetchError: true, source: SOURCE, message: 'empty response' } }];\n}\nvar out = [];\nvar blocks = data.split('</item>');\nfor (var i = 0; i < blocks.length && out.length < MAX; i++) {\n  var si = blocks[i].lastIndexOf('<item>');\n  if (si < 0) continue;\n  var b = blocks[i].substring(si);\n  var title = decodeEntities(getText(b, 'title'));\n  var url = getText(b, 'link');\n  if (!title || !url) continue;\n  var desc = decodeEntities(getText(b, 'description')).replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim();\n  out.push({ json: {\n    source: SOURCE,\n    title: title,\n    url: url,\n    published_at: toIso(getText(b, 'pubDate')),\n    snippet: desc.substring(0, 300)\n  } });\n}\nif (out.length === 0) {\n  return [{ json: { _sourceEmpty: true, source: SOURCE, message: 'parsed item count: 0' } }];\n}\nreturn out;\n"},"position":[448,800]},
  output: [{ source: 'X', title: 'T', url: 'https://example.com', published_at: '', snippet: '' }]
});

const mergeFeeds = merge({
  version: 3,
  config: {"name":"Merge Feeds","parameters":{"numberInputs":5},"position":[672,400]}
});

const filterDedupe = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {"name":"Filter & Dedupe","parameters":{"mode":"runOnceForAllItems","jsCode":"\nconst PRIORITY = { MOFE: 0, BOK: 1, EINFOMAX: 2, YNA_MARKET: 3, BLOOMBERG: 4 };\nconst ALWAYS_PASS = new Set(['MOFE', 'BOK']);\nconst WINDOW_MS = 24 * 60 * 60 * 1000;\nconst MAX_TOTAL = 30;\nconst MAX_PER_SOURCE = 8;\nconst KEYWORDS = [\n  '환율', '달러-원', '엔-원', '원/달러', '위안', '외환', '환시', '역외', '숏커버',\n  '금리', '기준금리', '금통위', '국고', '국채', '채권', '크레디트', '통화정책', '완화', '긴축',\n  '연준', 'fed', 'fomc', '월러', '파월', '워시', '한국은행', '일본은행', 'boj', 'ecb', '중앙은행',\n  '물가', '인플레', 'cpi', '소비자물가', '경상수지', '무역수지', '수출', '성장률', 'gdp', '고용', '실업',\n  '코스피', '코스닥', '증시', '주가', '지수', '외국인', '기관', '수급', '반도체',\n  '나스닥', 's&p', '다우', '뉴욕증시', '국제유가', '유가', '원자재',\n  'exchange rate', 'currency', 'won', 'yen', 'dollar', 'rate hike', 'rate cut', 'rates',\n  'inflation', 'treasury', 'bond', 'yield', 'stocks', 'equities', 'index', 'markets',\n  'nasdaq', 'kospi', 'central bank', 'tariff', 'oil', 'commodities', 'economy', 'growth',\n];\nfunction isRelevant(row) {\n  // [표] 로 시작하는 기사는 시세표라 서술형 섹션에 쓸 수 없다. 수치는 섹션 1이 담당한다.\n  if (/^\\[표/.test(row.title)) return false;\n  if (ALWAYS_PASS.has(row.source)) return true;\n  var hay = (row.title + ' ' + (row.snippet || '')).toLowerCase();\n  for (var i = 0; i < KEYWORDS.length; i++) {\n    if (hay.indexOf(KEYWORDS[i]) >= 0) return true;\n  }\n  return false;\n}\nfunction tokens(t) {\n  var norm = t.toLowerCase().replace(/[^\\p{L}\\p{N}]+/gu, ' ').trim();\n  return new Set(norm.split(' ').filter(function (w) { return w.length > 1; }));\n}\nfunction jaccard(a, b) {\n  if (a.size === 0 || b.size === 0) return 0;\n  var inter = 0;\n  a.forEach(function (w) { if (b.has(w)) inter++; });\n  return inter / (a.size + b.size - inter);\n}\nvar fetchErrors = [];\nvar emptySources = [];\nvar dropped = 0;\nvar buckets = new Map();\nvar now = Date.now();\nfor (var k = 0; k < items.length; k++) {\n  var j = items[k].json;\n  if (j._fetchError === true) { fetchErrors.push({ source: j.source, message: j.message }); continue; }\n  if (j._sourceEmpty === true) { emptySources.push({ source: j.source, message: j.message }); continue; }\n  if (!j.published_at) continue;\n  var t = Date.parse(j.published_at);\n  if (isNaN(t) || now - t > WINDOW_MS || t > now + 60000) continue;\n  if (!isRelevant(j)) { dropped++; continue; }\n  if (!buckets.has(j.source)) buckets.set(j.source, []);\n  buckets.get(j.source).push(j);\n}\nbuckets.forEach(function (list) {\n  list.sort(function (a, b) { return Date.parse(b.published_at) - Date.parse(a.published_at); });\n});\nvar sources = Array.from(buckets.keys()).sort(function (a, b) {\n  return (PRIORITY[a] === undefined ? 9 : PRIORITY[a]) - (PRIORITY[b] === undefined ? 9 : PRIORITY[b]);\n});\nvar cursor = {}, taken = {}, kept = [], keptTokens = [];\nvar seenUrl = new Set();\nsources.forEach(function (s) { cursor[s] = 0; taken[s] = 0; });\nvar progressed = true;\nwhile (kept.length < MAX_TOTAL && progressed) {\n  progressed = false;\n  for (var si = 0; si < sources.length; si++) {\n    var s = sources[si];\n    if (kept.length >= MAX_TOTAL) break;\n    if (taken[s] >= MAX_PER_SOURCE) continue;\n    var list = buckets.get(s);\n    var i = cursor[s];\n    while (i < list.length) {\n      var r = list[i]; i++;\n      if (seenUrl.has(r.url)) continue;\n      var tk = tokens(r.title);\n      var dup = keptTokens.some(function (kt) { return jaccard(tk, kt) >= 0.7; });\n      if (dup) continue;\n      seenUrl.add(r.url);\n      keptTokens.push(tk);\n      kept.push(r);\n      taken[s] = taken[s] + 1;\n      progressed = true;\n      break;\n    }\n    cursor[s] = i;\n  }\n}\nkept.sort(function (a, b) { return Date.parse(b.published_at) - Date.parse(a.published_at); });\nreturn [{ json: { rss_items: kept, _count: kept.length, _droppedByKeyword: dropped, _fetchErrors: fetchErrors, _emptySources: emptySources } }];\n"},"position":[896,400]},
  output: [{ rss_items: [], _count: 0, _droppedByKeyword: 0, _fetchErrors: [], _emptySources: [] }]
});

export default workflow('SUB_FETCH_MARKET_SIGNALS_ID', 'Sub-Fetch-Market-Signals')
  .add(whenCalled)
  .to(fetch0.to(parse0.to(mergeFeeds.input(0))))
  .add(whenCalled)
  .to(fetch1.to(parse1.to(mergeFeeds.input(1))))
  .add(whenCalled)
  .to(fetch2.to(parse2.to(mergeFeeds.input(2))))
  .add(whenCalled)
  .to(fetch3.to(parse3.to(mergeFeeds.input(3))))
  .add(whenCalled)
  .to(fetch4.to(parse4.to(mergeFeeds.input(4))))
  .add(mergeFeeds)
  .to(filterDedupe);
