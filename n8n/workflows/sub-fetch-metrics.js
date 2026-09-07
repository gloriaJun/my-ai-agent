// Sub-Fetch-Metrics
// 경제 브리핑 섹션 1용 지표를 2일치씩 모아 전일 대비까지 계산해 반환한다.
// 반환: { metrics: [{ metric_code, label, as_of, value, delta, decimals, unit, source, status }],
//         _count, _missing: [], _fetchErrors: [] }
// delta는 절대값, delta_pct는 직전 관측 대비 변동률(%). 금리는 퍼센트 변동이 무의미해
// 렌더 단계에서 unit === 'percent' 이면 bp(= delta * 100)로 표기한다.
//
// PoC 단계라 인증키가 필요한 소스를 쓰지 않는다. 전부 키리스로 구성했다.
// 대가: 환율이 매매기준율이 아니라 글로벌 시장가다(0.6% 내외 차이). 브리핑에는 소스명을
// 병기해 오해를 막고, 필요해지면 아래 METRICS의 해당 항목만 ECOS로 바꾼다.
//
// 새 워크플로라 아직 n8n ID가 없다. MCP 세션에서 create_workflow_from_code로 만든 뒤
// 아래 workflow(...) 첫 인자를 실제 ID로 교체한다.
import { workflow, node, trigger, merge } from '@n8n/workflow-sdk';

const FRED_LOOKBACK_DAYS = 10;

// kind 별 수집 방식
//   yahoo : query2.finance.yahoo.com chart API. close 배열에 null이 실제로 섞인다
//   fred  : fredgraph.csv 키리스 경로. 결측은 "." 문자열
//   bis   : SDMX CSV. 본문에 콤마가 든 인용 필드가 있어 정규식으로 뽑는다
//   fixed : 외부 호출 없이 고정값. 정책금리는 연 8회만 바뀌므로 이 편이 정확하다
const METRICS = [
  { code: 'FX_USDKRW', label: '원/달러 환율', unit: 'KRW', decimals: 1, flag: '🇺🇸',
    kind: 'yahoo', symbol: 'KRW=X', source: 'YAHOO_FX' },
  { code: 'FX_JPY100KRW', label: '원/100엔 환율', unit: 'KRW', decimals: 2, flag: '🇯🇵',
    kind: 'yahoo', symbol: 'JPYKRW=X', multiplier: 100, source: 'YAHOO_FX' },
  { code: 'RATE_KR_BASE', label: '한국 기준금리', unit: 'percent', decimals: 2, flag: '🇰🇷',
    kind: 'fixed', value: 3.0, since: '2026-08-27', source: 'FIXED_BOK' },
  { code: 'RATE_US_TARGET_UPPER', label: '미국 기준금리 상단', unit: 'percent', decimals: 2, flag: '🇺🇸',
    kind: 'fred', series: 'DFEDTARU', source: 'FRED' },
  { code: 'RATE_US_TARGET_LOWER', label: '미국 기준금리 하단', unit: 'percent', decimals: 2, flag: '🇺🇸',
    kind: 'fred', series: 'DFEDTARL', source: 'FRED' },
  { code: 'RATE_JP_POLICY', label: '일본 기준금리', unit: 'percent', decimals: 2, flag: '🇯🇵',
    kind: 'bis', ref: 'D.JP', source: 'BIS' },
  { code: 'IDX_KOSPI', label: 'KOSPI', unit: 'point', decimals: 2, flag: '🇰🇷',
    kind: 'yahoo', symbol: '^KS11', source: 'YAHOO_IDX' },
  { code: 'IDX_SP500', label: 'S&P500', unit: 'point', decimals: 2, flag: '🇺🇸',
    kind: 'yahoo', symbol: '^GSPC', source: 'YAHOO_IDX' },
  { code: 'IDX_NASDAQ', label: 'NASDAQ', unit: 'point', decimals: 2, flag: '🇺🇸',
    kind: 'yahoo', symbol: '^IXIC', source: 'YAHOO_IDX' },
];

function urlFor(m) {
  if (m.kind === 'yahoo') {
    return 'https://query2.finance.yahoo.com/v8/finance/chart/' +
      encodeURIComponent(m.symbol) + '?range=7d&interval=1d';
  }
  if (m.kind === 'fred') {
    // cosd는 워크플로 실행 시점 기준으로 채운다. 표현식으로 넣어 과거 전체를 받지 않는다.
    return '=https://fred.stlouisfed.org/graph/fredgraph.csv?id=' + m.series +
      '&cosd={{ new Date(Date.now() - ' + FRED_LOOKBACK_DAYS + ' * 86400000).toISOString().slice(0, 10) }}';
  }
  if (m.kind === 'bis') {
    return 'https://stats.bis.org/api/v1/data/WS_CBPOL/' + m.ref +
      '/all?format=csv&lastNObservations=3';
  }
  return null;
}

// --- 파서 본문 ------------------------------------------------------------
// 앞에서 const META = {...} 를 주입한다. 반환은 관측치 배열이며 delta는 뒷 노드가 계산한다.
const PARSE_BODY = `
function fail(message) {
  return [{ json: { metric_code: META.code, label: META.label, unit: META.unit,
                    decimals: META.decimals, flag: META.flag, source: META.source,
                    status: 'error', message: message, observations: [] } }];
}
if (items[0] && items[0].json && items[0].json.error) {
  return fail(String(items[0].json.error));
}
var raw = items[0] && items[0].json ? items[0].json.data : null;
if (!raw) return fail('empty response');

var observations = [];
if (META.kind === 'yahoo') {
  var parsed;
  try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch (e) { return fail('JSON parse: ' + e.message); }
  var result = parsed && parsed.chart && parsed.chart.result ? parsed.chart.result[0] : null;
  if (!result) return fail('no chart result');
  var stamps = result.timestamp || [];
  var closes = (result.indicators && result.indicators.quote && result.indicators.quote[0])
    ? result.indicators.quote[0].close : [];
  for (var i = 0; i < stamps.length; i++) {
    // close 배열에 null이 실제로 섞여 들어온다. 그대로 읽으면 값이 깨진다.
    if (closes[i] === null || closes[i] === undefined) continue;
    observations.push({ as_of: new Date(stamps[i] * 1000).toISOString().slice(0, 10), value: closes[i] });
  }
  // 장중이면 일봉 배열보다 meta 쪽이 최신이다.
  var live = result.meta ? result.meta.regularMarketPrice : null;
  var liveTime = result.meta ? result.meta.regularMarketTime : null;
  if (typeof live === 'number' && liveTime) {
    var liveDate = new Date(liveTime * 1000).toISOString().slice(0, 10);
    var last = observations[observations.length - 1];
    if (!last || last.as_of < liveDate) observations.push({ as_of: liveDate, value: live });
    else if (last.as_of === liveDate) last.value = live;
  }
} else if (META.kind === 'fred') {
  var lines = String(raw).split('\\n');
  for (var k = 1; k < lines.length; k++) {
    var cols = lines[k].trim().split(',');
    if (cols.length < 2) continue;
    if (cols[1] === '.' || cols[1] === '') continue;   // FRED의 결측 표기
    var n = Number(cols[1]);
    if (isNaN(n)) continue;
    observations.push({ as_of: cols[0], value: n });
  }
} else if (META.kind === 'bis') {
  // 본문에 콤마가 든 인용 필드가 있어 컬럼 분리 대신 ,날짜,값,상태, 패턴을 뽑는다.
  var re = /,(\\d{4}-\\d{2}-\\d{2}),([0-9.]+),[A-Z],/g;
  var m;
  while ((m = re.exec(String(raw))) !== null) {
    observations.push({ as_of: m[1], value: Number(m[2]) });
  }
} else {
  return fail('unknown kind: ' + META.kind);
}

if (observations.length === 0) return fail('no observation parsed');
observations.sort(function (a, b) { return a.as_of < b.as_of ? -1 : a.as_of > b.as_of ? 1 : 0; });
if (typeof META.multiplier === 'number') {
  observations = observations.map(function (o) { return { as_of: o.as_of, value: o.value * META.multiplier }; });
}
return [{ json: { metric_code: META.code, label: META.label, unit: META.unit,
                  decimals: META.decimals, flag: META.flag, source: META.source,
                  status: 'ok', observations: observations.slice(-5) } }];
`;

const fetched = METRICS.filter((m) => m.kind !== 'fixed');

const whenCalled = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.1,
  config: {
    name: 'When Called by Another Workflow',
    position: [0, 800],
    parameters: { inputSource: 'passthrough' },
  },
  output: [{}],
});

const fetchNodes = fetched.map((m, i) =>
  node({
    type: 'n8n-nodes-base.httpRequest',
    version: 4.2,
    config: {
      name: 'Fetch ' + m.code,
      onError: 'continueRegularOutput',
      parameters: {
        url: urlFor(m),
        options: { response: { response: { responseFormat: 'text' } }, timeout: 15000 },
      },
      position: [224, i * 180],
    },
    output: [{ data: '<raw payload>' }],
  })
);

const parseNodes = fetched.map((m, i) =>
  node({
    type: 'n8n-nodes-base.code',
    version: 2,
    config: {
      name: 'Parse ' + m.code,
      parameters: {
        mode: 'runOnceForAllItems',
        jsCode: 'const META = ' + JSON.stringify({
          code: m.code, label: m.label, unit: m.unit, decimals: m.decimals,
          flag: m.flag, kind: m.kind, source: m.source, multiplier: m.multiplier,
        }) + ';' + PARSE_BODY,
      },
      position: [448, i * 180],
    },
    output: [{ metric_code: '', observations: [] }],
  })
);

const fixedMetrics = METRICS.filter((m) => m.kind === 'fixed');
const emitFixed = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Emit Fixed Metrics',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode:
        'const FIXED = ' + JSON.stringify(fixedMetrics.map((m) => ({
          metric_code: m.code, label: m.label, unit: m.unit, decimals: m.decimals,
          flag: m.flag, source: m.source, value: m.value, since: m.since,
        }))) + ';\n' +
        // 고정값은 관측일 개념이 없다. 오늘과 어제 같은 값을 넣어 delta가 0으로 나오게 한다.
        // 값이 바뀌면 한국은행 보도자료 RSS(sub-fetch-market-signals)에 결정문이 뜬다.
        'const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);\n' +
        'const prev = new Date(Date.now() + 9 * 3600 * 1000 - 86400000).toISOString().slice(0, 10);\n' +
        'return FIXED.map(function (f) {\n' +
        '  return { json: { metric_code: f.metric_code, label: f.label, unit: f.unit,\n' +
        '    decimals: f.decimals, flag: f.flag, source: f.source, status: "ok", since: f.since,\n' +
        '    observations: [{ as_of: prev, value: f.value }, { as_of: today, value: f.value }] } };\n' +
        '});',
    },
    position: [448, fetched.length * 180],
  },
  output: [{ metric_code: '', observations: [] }],
});

const mergeMetrics = merge({
  version: 3,
  config: {
    name: 'Merge Metrics',
    parameters: { numberInputs: fetched.length + 1 },
    position: [672, 800],
  },
});

const normalizeAndDelta = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize & Delta',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `
const ORDER = ${JSON.stringify(METRICS.map((m) => m.code))};
function round(n, d) { return Number(Math.round(Number(n + 'e' + d)) + 'e-' + d); }
var metrics = [];
var missing = [];
var fetchErrors = [];
for (var i = 0; i < items.length; i++) {
  var j = items[i].json;
  if (!j || !j.metric_code) continue;
  if (j.status !== 'ok' || !j.observations || j.observations.length === 0) {
    missing.push(j.metric_code);
    fetchErrors.push({ metric_code: j.metric_code, message: j.message || 'no observation' });
    continue;
  }
  var obs = j.observations;
  var last = obs[obs.length - 1];
  var prev = obs.length >= 2 ? obs[obs.length - 2] : null;
  // 관측치가 하나뿐이면 전일 대비를 낼 수 없다. 0으로 채우지 않고 null로 남겨
  // 브리핑에서 등락 표시를 생략하게 한다.
  var delta = prev ? round(last.value - prev.value, j.decimals) : null;
  var deltaPct = (prev && prev.value !== 0) ? round(((last.value - prev.value) / prev.value) * 100, 2) : null;
  metrics.push({
    metric_code: j.metric_code,
    label: j.label,
    flag: j.flag,
    as_of: last.as_of,
    value: round(last.value, j.decimals),
    prev_as_of: prev ? prev.as_of : null,
    delta: delta,
    delta_pct: deltaPct,
    decimals: j.decimals,
    unit: j.unit,
    source: j.source,
    status: 'ok'
  });
}
metrics.sort(function (a, b) { return ORDER.indexOf(a.metric_code) - ORDER.indexOf(b.metric_code); });
return [{ json: { metrics: metrics, _count: metrics.length, _missing: missing, _fetchErrors: fetchErrors } }];
`,
    },
    position: [896, 800],
  },
  output: [{ metrics: [], _count: 0, _missing: [], _fetchErrors: [] }],
});

let chain = workflow('SUB_FETCH_METRICS_ID', 'Sub-Fetch-Metrics');
fetched.forEach((_, i) => {
  chain = chain.add(whenCalled).to(fetchNodes[i].to(parseNodes[i].to(mergeMetrics.input(i))));
});
chain = chain.add(whenCalled).to(emitFixed.to(mergeMetrics.input(fetched.length)));

export default chain.add(mergeMetrics).to(normalizeAndDelta);
