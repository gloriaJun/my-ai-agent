// Sub-Fetch-Market-Signals
// 경제 브리핑용 RSS 5종을 모아 24시간 이내 기사만 남긴다.
// 반환: { rss_items: [{ source, title, url, published_at, snippet }], _fetchErrors: [] }
//
// 레포 선례(daily-tech-news.js)와 다른 점 하나: fetch 노드에 onError:'continueRegularOutput'을
// 건다. 피드 하나가 죽어도 배치 전체가 멈추지 않아야 하고, 그 경우 n8n이 error 필드를 담은
// 아이템을 그대로 흘려보내 파서가 _fetchError로 변환한다.
// 새 워크플로라 아직 n8n ID가 없다. MCP 세션에서 create_workflow_from_code로 만든 뒤
// 아래 workflow(...) 첫 인자를 실제 ID로 교체한다.
import { workflow, node, trigger, merge } from '@n8n/workflow-sdk';

// --- 공통 파서 -------------------------------------------------------------
// 5종 모두 RSS 2.0 <item> 구조지만 pubDate 형식이 셋으로 갈린다.
//   재정경제부   20260903161101              (14자리, 타임존 표기 없음 -> KST)
//   연합인포맥스 2026-09-04 13:06:12         (공백 구분, 타임존 표기 없음 -> KST)
//   연합뉴스/한은/블룸버그  RFC822           (+0900 또는 GMT)
// 앞의 둘을 Date()에 그냥 넘기면 Invalid Date가 되거나 컨테이너 타임존만큼 밀린다.
const PARSE_BODY = `
function decodeOnce(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&');
}
// 연합인포맥스는 &amp;quot; 처럼 이중 인코딩한다. 2회까지만 푼다 -
// 무제한으로 풀면 본문이 의도적으로 쓴 &amp; 가 깨진다.
function decodeEntities(s) {
  var once = decodeOnce(s);
  return /&(lt|gt|quot|amp|apos|#39|nbsp);/.test(once) ? decodeOnce(once) : once;
}
function getText(block, tag) {
  var open = '<' + tag + '>';
  var oi = block.indexOf(open);
  if (oi < 0) return '';
  var start = oi + open.length;
  var end = block.indexOf('</' + tag + '>', start);
  if (end < 0) return '';
  var raw = block.substring(start, end).trim();
  if (raw.indexOf('<![CDATA[') === 0) {
    var ce = raw.lastIndexOf(']]>');
    raw = ce >= 0 ? raw.substring(9, ce) : raw.substring(9);
  }
  return raw.trim();
}
function toIso(raw) {
  if (!raw) return '';
  var s = raw.trim();
  var m14 = s.match(/^(\\d{4})(\\d{2})(\\d{2})(\\d{2})(\\d{2})(\\d{2})$/);
  if (m14) {
    return new Date(m14[1] + '-' + m14[2] + '-' + m14[3] + 'T' + m14[4] + ':' + m14[5] + ':' + m14[6] + '+09:00').toISOString();
  }
  var mSpace = s.match(/^(\\d{4}-\\d{2}-\\d{2})[ T](\\d{2}:\\d{2}:\\d{2})$/);
  if (mSpace) {
    return new Date(mSpace[1] + 'T' + mSpace[2] + '+09:00').toISOString();
  }
  var d = new Date(s);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}
if (items[0] && items[0].json && items[0].json.error) {
  return [{ json: { _fetchError: true, source: SOURCE, message: String(items[0].json.error) } }];
}
var data = items[0] && items[0].json ? items[0].json.data : null;
if (!data) {
  return [{ json: { _fetchError: true, source: SOURCE, message: 'empty response' } }];
}
var out = [];
var blocks = data.split('</item>');
for (var i = 0; i < blocks.length && out.length < MAX; i++) {
  var si = blocks[i].lastIndexOf('<item>');
  if (si < 0) continue;
  var b = blocks[i].substring(si);
  var title = decodeEntities(getText(b, 'title'));
  var url = getText(b, 'link');
  if (!title || !url) continue;
  var desc = decodeEntities(getText(b, 'description')).replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim();
  out.push({ json: {
    source: SOURCE,
    title: title,
    url: url,
    published_at: toIso(getText(b, 'pubDate')),
    snippet: desc.substring(0, 300)
  } });
}
if (out.length === 0) {
  return [{ json: { _sourceEmpty: true, source: SOURCE, message: 'parsed item count: 0' } }];
}
return out;
`;

const FEEDS = [
  { key: 'MOFE', label: 'MOFE 일일경제지표', url: 'https://mofe.go.kr/com/detailRssTagService.do?bbsId=MOSFBBS_000000000045' },
  { key: 'BOK', label: 'BOK 보도자료', url: 'https://www.bok.or.kr/portal/bbs/B0000552/news.rss?menuNo=200690' },
  { key: 'EINFOMAX', label: '연합인포맥스', url: 'https://news.einfomax.co.kr/rss/allArticle.xml' },
  { key: 'YNA_MARKET', label: '연합뉴스 market', url: 'https://www.yna.co.kr/rss/market.xml' },
  { key: 'BLOOMBERG', label: 'Bloomberg markets', url: 'https://feeds.bloomberg.com/markets/news.rss' },
];

const whenCalled = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.1,
  config: {
    name: 'When Called by Another Workflow',
    position: [0, 400],
    parameters: { inputSource: 'passthrough' },
  },
  output: [{}],
});

const fetchNodes = FEEDS.map((feed, i) =>
  node({
    type: 'n8n-nodes-base.httpRequest',
    version: 4.2,
    config: {
      name: 'Fetch ' + feed.label,
      onError: 'continueRegularOutput',
      parameters: {
        url: feed.url,
        options: { response: { response: { responseFormat: 'text' } }, timeout: 15000 },
      },
      position: [224, i * 200],
    },
    output: [{ data: '<raw feed text>' }],
  })
);

const parseNodes = FEEDS.map((feed, i) =>
  node({
    type: 'n8n-nodes-base.code',
    version: 2,
    config: {
      name: 'Parse ' + feed.label,
      parameters: {
        mode: 'runOnceForAllItems',
        jsCode: 'const SOURCE = ' + JSON.stringify(feed.key) + '; const MAX = 25;' + PARSE_BODY,
      },
      position: [448, i * 200],
    },
    output: [{ source: 'X', title: 'T', url: 'https://example.com', published_at: '', snippet: '' }],
  })
);

const mergeFeeds = merge({
  version: 3,
  config: {
    name: 'Merge Feeds',
    parameters: { numberInputs: FEEDS.length },
    position: [672, 400],
  },
});

// 소스별 쿼터를 두고 라운드로빈으로 뽑는다. 전역 우선순위 정렬만 쓰면 발행량이 많은
// 매체가 상한을 다 먹고 뒤 순위 소스(Bloomberg)가 통째로 잘린다 - 실측으로 확인됨.
//
// 키워드 필터도 여기서 건다. 연합인포맥스·연합뉴스 market은 경제 전문이지만 종목·기업·정치
// 기사가 함께 실려서, 거르지 않으면 "오늘 체크할 뉴스 Top 2"에 면세점 철수 같은 게 올라온다.
// 재정경제부·한국은행은 1차 출처라 키워드와 무관하게 통과시킨다.
const filterDedupe = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Filter & Dedupe',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `
const PRIORITY = { MOFE: 0, BOK: 1, EINFOMAX: 2, YNA_MARKET: 3, BLOOMBERG: 4 };
const ALWAYS_PASS = new Set(['MOFE', 'BOK']);
const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_TOTAL = 30;
const MAX_PER_SOURCE = 8;
const KEYWORDS = [
  '환율', '달러-원', '엔-원', '원/달러', '위안', '외환', '환시', '역외', '숏커버',
  '금리', '기준금리', '금통위', '국고', '국채', '채권', '크레디트', '통화정책', '완화', '긴축',
  '연준', 'fed', 'fomc', '월러', '파월', '워시', '한국은행', '일본은행', 'boj', 'ecb', '중앙은행',
  '물가', '인플레', 'cpi', '소비자물가', '경상수지', '무역수지', '수출', '성장률', 'gdp', '고용', '실업',
  '코스피', '코스닥', '증시', '주가', '지수', '외국인', '기관', '수급', '반도체',
  '나스닥', 's&p', '다우', '뉴욕증시', '국제유가', '유가', '원자재',
  'exchange rate', 'currency', 'won', 'yen', 'dollar', 'rate hike', 'rate cut', 'rates',
  'inflation', 'treasury', 'bond', 'yield', 'stocks', 'equities', 'index', 'markets',
  'nasdaq', 'kospi', 'central bank', 'tariff', 'oil', 'commodities', 'economy', 'growth',
];
function isRelevant(row) {
  // [표] 로 시작하는 기사는 시세표라 서술형 섹션에 쓸 수 없다. 수치는 섹션 1이 담당한다.
  if (/^\\[표/.test(row.title)) return false;
  if (ALWAYS_PASS.has(row.source)) return true;
  var hay = (row.title + ' ' + (row.snippet || '')).toLowerCase();
  for (var i = 0; i < KEYWORDS.length; i++) {
    if (hay.indexOf(KEYWORDS[i]) >= 0) return true;
  }
  return false;
}
function tokens(t) {
  var norm = t.toLowerCase().replace(/[^\\p{L}\\p{N}]+/gu, ' ').trim();
  return new Set(norm.split(' ').filter(function (w) { return w.length > 1; }));
}
function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  var inter = 0;
  a.forEach(function (w) { if (b.has(w)) inter++; });
  return inter / (a.size + b.size - inter);
}
var fetchErrors = [];
var emptySources = [];
var dropped = 0;
var buckets = new Map();
var now = Date.now();
for (var k = 0; k < items.length; k++) {
  var j = items[k].json;
  if (j._fetchError === true) { fetchErrors.push({ source: j.source, message: j.message }); continue; }
  if (j._sourceEmpty === true) { emptySources.push({ source: j.source, message: j.message }); continue; }
  if (!j.published_at) continue;
  var t = Date.parse(j.published_at);
  if (isNaN(t) || now - t > WINDOW_MS || t > now + 60000) continue;
  if (!isRelevant(j)) { dropped++; continue; }
  if (!buckets.has(j.source)) buckets.set(j.source, []);
  buckets.get(j.source).push(j);
}
buckets.forEach(function (list) {
  list.sort(function (a, b) { return Date.parse(b.published_at) - Date.parse(a.published_at); });
});
var sources = Array.from(buckets.keys()).sort(function (a, b) {
  return (PRIORITY[a] === undefined ? 9 : PRIORITY[a]) - (PRIORITY[b] === undefined ? 9 : PRIORITY[b]);
});
var cursor = {}, taken = {}, kept = [], keptTokens = [];
var seenUrl = new Set();
sources.forEach(function (s) { cursor[s] = 0; taken[s] = 0; });
var progressed = true;
while (kept.length < MAX_TOTAL && progressed) {
  progressed = false;
  for (var si = 0; si < sources.length; si++) {
    var s = sources[si];
    if (kept.length >= MAX_TOTAL) break;
    if (taken[s] >= MAX_PER_SOURCE) continue;
    var list = buckets.get(s);
    var i = cursor[s];
    while (i < list.length) {
      var r = list[i]; i++;
      if (seenUrl.has(r.url)) continue;
      var tk = tokens(r.title);
      var dup = keptTokens.some(function (kt) { return jaccard(tk, kt) >= 0.7; });
      if (dup) continue;
      seenUrl.add(r.url);
      keptTokens.push(tk);
      kept.push(r);
      taken[s] = taken[s] + 1;
      progressed = true;
      break;
    }
    cursor[s] = i;
  }
}
kept.sort(function (a, b) { return Date.parse(b.published_at) - Date.parse(a.published_at); });
return [{ json: { rss_items: kept, _count: kept.length, _droppedByKeyword: dropped, _fetchErrors: fetchErrors, _emptySources: emptySources } }];
`,
    },
    position: [896, 400],
  },
  output: [{ rss_items: [], _count: 0, _droppedByKeyword: 0, _fetchErrors: [], _emptySources: [] }],
});

let chain = workflow('SUB_FETCH_MARKET_SIGNALS_ID', 'Sub-Fetch-Market-Signals');
FEEDS.forEach((_, i) => {
  chain = chain.add(whenCalled).to(fetchNodes[i].to(parseNodes[i].to(mergeFeeds.input(i))));
});

export default chain.add(mergeFeeds).to(filterDedupe);
