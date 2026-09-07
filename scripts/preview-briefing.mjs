#!/usr/bin/env node
// 실제 소스에서 지표와 뉴스를 가져와 Slack 브리핑 메시지를 그대로 렌더한다.
// 발송은 하지 않는다. LLM이 담당하는 섹션 3은 자리만 표시한다.
//
//   node scripts/preview-briefing.mjs
//
// 포맷을 바꿀 때 이 스크립트로 먼저 눈으로 확인한 뒤 워크플로에 반영한다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const STUB = `
export const registry = { nodes: [], merges: [] };
const chain = { add: () => chain, to: () => chain };
export const node = (d) => (registry.nodes.push(d), { ...d, to: (x) => x, output: () => ({ to: () => {} }) });
export const trigger = (d) => (registry.nodes.push(d), { ...d, to: (x) => x });
export const merge = (d) => (registry.merges.push(d), { ...d, input: (i) => ({ __input: i }) });
export const workflow = (id, name) => (registry.id = id, registry.name = name, chain);
export const expr = (s) => s;
export const ifElse = (d) => d;
`;
const resolveUrl = (raw) => raw.startsWith('=')
  ? raw.slice(1).replace(/\{\{([\s\S]*?)\}\}/g, (_, c) => String(new Function('return (' + c + ')')()))
  : raw;

async function runWorkflow(file) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-'));
  try {
    fs.writeFileSync(path.join(tmp, 'stub.mjs'), STUB);
    fs.writeFileSync(path.join(tmp, 'wf.mjs'),
      fs.readFileSync(path.join(ROOT, 'n8n/workflows', file), 'utf8')
        .replace("'@n8n/workflow-sdk'", "'./stub.mjs'"));
    const { registry } = await import(path.join(tmp, 'stub.mjs'));
    await import(path.join(tmp, 'wf.mjs'));
    const httpNodes = registry.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest');
    const codeNodes = registry.nodes.filter((n) => n.type === 'n8n-nodes-base.code');
    const collected = [];
    for (const c of codeNodes) {
      const paired = httpNodes.find((h) => h.config.name === c.config.name.replace(/^Parse /, 'Fetch '));
      if (!paired) continue;
      let input;
      try {
        const res = await fetch(resolveUrl(paired.config.parameters.url), {
          headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000),
        });
        input = [{ json: { data: await res.text() } }];
      } catch (e) {
        input = [{ json: { error: String(e.message) } }];
      }
      collected.push(...new Function('items', c.config.parameters.jsCode)(input));
    }
    const emitFixed = codeNodes.find((n) => n.config.name === 'Emit Fixed Metrics');
    if (emitFixed) collected.push(...new Function('items', emitFixed.config.parameters.jsCode)([]));
    const finalNode = codeNodes.find((n) => /Normalize & Delta|Filter & Dedupe/.test(n.config.name));
    return new Function('items', finalNode.config.parameters.jsCode)(collected)[0].json;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const num = (v, d) => v.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
const arrow = (d) => (d > 0 ? '▲' : d < 0 ? '▼' : '');
function moveText(m) {
  if (m.delta === null) return '';
  if (m.delta === 0) return ' 보합';
  if (m.unit === 'percent') return ' ' + arrow(m.delta) + Math.round(Math.abs(m.delta) * 100) + 'bp';
  return ' ' + arrow(m.delta) + num(Math.abs(m.delta), m.decimals) +
    (m.delta_pct === null ? '' : ' (' + (m.delta_pct > 0 ? '+' : '') + m.delta_pct.toFixed(2) + '%)');
}
// 주말은 결측이 아니다. 직전 영업일을 기준으로 봐야 월요일에 전 지표가 결측으로 잡히지 않는다.
function prevBusinessDay(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  do { d.setUTCDate(d.getUTCDate() - 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

const [metricsOut, signalsOut] = await Promise.all([
  runWorkflow('sub-fetch-metrics.js'),
  runWorkflow('sub-fetch-market-signals.js'),
]);
const by = Object.fromEntries(metricsOut.metrics.map((m) => [m.metric_code, m]));
const kstToday = new Date(Date.now() + 9 * 3600e3);
const dow = ['일', '월', '화', '수', '목', '금', '토'][kstToday.getUTCDay()];
const dateLabel = kstToday.toISOString().slice(0, 10) + ' (' + dow + ')';

// 직전 영업일을 건너뛴 지표만 기준일을 밝힌다 (공휴일이나 소스 결측).
const gapped = metricsOut.metrics.filter(
  (m) => m.prev_as_of && m.unit !== 'percent' && m.prev_as_of !== prevBusinessDay(m.as_of)
);

// 코드 블록은 고정폭이지만 한글과 국기 이모지는 두 칸을 차지한다. 문자 수로 padEnd 하면
// 콜론이 어긋나므로 표시 폭을 세어 맞춘다.
function width(str) {
  let w = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    w += (cp >= 0x1100 && (cp <= 0x115f || (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1f9ff))) ? 2 : 1;
  }
  return w;
}
const padR = (str, w) => str + ' '.repeat(Math.max(0, w - width(str)));
const padL = (str, w) => ' '.repeat(Math.max(0, w - width(str))) + str;

function moveCell(m) {
  if (m.delta === null) return '';
  if (m.delta === 0) return ' (보합)';
  const abs = arrow(m.delta) + num(Math.abs(m.delta), m.decimals);
  if (m.delta_pct === null) return ' (' + abs + ')';
  return ' (' + abs + ', ' + (m.delta_pct > 0 ? '+' : '') + m.delta_pct.toFixed(2) + '%)';
}

// 그룹 단위로 라벨과 값의 폭을 맞춘다.
function renderGroup(title, rows) {
  const labelW = Math.max(...rows.map((r) => width(r.label)));
  const valueW = Math.max(...rows.map((r) => width(r.value)));
  return ['[' + title + ']'].concat(
    rows.map((r) => '• ' + r.flag + ' ' + padR(r.label, labelW) + ' : ' + padL(r.value, valueW) + r.move)
  );
}

const fxRows = ['FX_USDKRW', 'FX_JPY100KRW'].map((c) => ({
  flag: by[c].flag, label: c === 'FX_USDKRW' ? '원/달러' : '원/100엔',
  value: num(by[c].value, by[c].decimals) + '원', move: moveCell(by[c]),
}));
const idxRows = ['IDX_KOSPI', 'IDX_SP500', 'IDX_NASDAQ'].map((c) => ({
  flag: by[c].flag, label: c === 'IDX_SP500' ? 'S&P 500' : by[c].label,
  value: num(by[c].value, by[c].decimals), move: moveCell(by[c]),
}));

const L = [];
L.push('[메인] 📊 오늘의 데일리 경제 & 시장 브리핑 — ' + dateLabel);
L.push('');
L.push('  [답글 1] 📈 실시간 주요 지표');
L.push('  ```');
for (const line of renderGroup('환율', fxRows)) L.push('  ' + line);
L.push('');
for (const line of renderGroup('증시', idxRows)) L.push('  ' + line);
L.push('');
L.push('  [기준금리]');
L.push('  • ' + by.RATE_KR_BASE.flag + ' 한국 ' + by.RATE_KR_BASE.value.toFixed(2) + '%' +
  ' | ' + by.RATE_US_TARGET_UPPER.flag + ' 미국 ' +
  by.RATE_US_TARGET_LOWER.value.toFixed(2) + '~' + by.RATE_US_TARGET_UPPER.value.toFixed(2) + '%' +
  ' | ' + by.RATE_JP_POLICY.flag + ' 일본 ' + by.RATE_JP_POLICY.value.toFixed(2) + '%');
L.push('  ```');
// 기준일 단서는 직전 거래일을 건너뛴 지표가 있을 때만 붙인다. 매일 붙으면 소음이 된다.
if (gapped.length) {
  const md = (iso) => iso.slice(5);
  const byDate = new Map();
  for (const m of gapped) {
    const key = md(m.prev_as_of);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(m.label.replace(/ 환율$/, ''));
  }
  const parts = [...byDate.entries()].map(([d, names]) => names.join('·') + '은 ' + d + ' 종가 기준');
  L.push('  _※ ' + parts.join(', ') + ' (직전 거래일 데이터 없음)_');
}
L.push('  _출처: Yahoo Finance · FRED · BIS · 한국은행_');
L.push('');
L.push('  [답글 2] 🔥 현시점 시장 이슈        <- LLM이 아래 기사로 작성');
for (const r of signalsOut.rss_items.slice(0, 5)) {
  L.push('      · [' + r.source + '] ' + r.title.slice(0, 50));
}
L.push('      (수집 ' + signalsOut._count + '건 중 상위 5건만 표시)');
L.push('');
L.push('  [답글 3] 💡 초보자 눈높이 요약 + 한 줄 비유   <- LLM');
L.push('');
L.push('  [답글 4] 📰 오늘 체크할 뉴스 Top 2            <- LLM이 위 기사에서 선별, 출처 URL 첨부');
console.log(L.join('\n'));
