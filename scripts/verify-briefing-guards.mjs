#!/usr/bin/env node
// daily-finance-briefing.js의 가드가 실제로 막는지 합성 입력으로 확인한다. 네트워크를 쓰지 않는다.
// 이 가드들은 정상 경로에서는 절대 발화하지 않아, 일부러 깨진 입력을 넣어야만 검증된다.

//   node scripts/verify-briefing-guards.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const STUB = `
export const registry = { nodes: [] };
const chain = { add: () => chain, to: () => chain };
export const node = (d) => (registry.nodes.push(d), { ...d, to: (x) => x, input: () => ({}), output: () => ({ to: () => {} }) });
export const trigger = (d) => (registry.nodes.push(d), { ...d, to: (x) => x });
export const workflow = () => chain;
`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'guards-'));
fs.writeFileSync(path.join(tmp, 'stub.mjs'), STUB);
fs.writeFileSync(path.join(tmp, 'wf.mjs'),
  fs.readFileSync(path.join(ROOT, 'n8n/workflows/daily-finance-briefing.js'), 'utf8')
    .replace("'@n8n/workflow-sdk'", "'./stub.mjs'"));
const { registry } = await import(path.join(tmp, 'stub.mjs'));
await import(path.join(tmp, 'wf.mjs'));
fs.rmSync(tmp, { recursive: true, force: true });

const codeOf = (name) => {
  const n = registry.nodes.find((x) => x.config.name === name);
  if (!n) throw new Error('node not found: ' + name);
  return n.config.parameters.jsCode;
};
const run = (name, items, $) => new Function('items', '$', codeOf(name))(items, $);

const CODES = ['FX_USDKRW', 'FX_JPY100KRW', 'RATE_KR_BASE', 'RATE_US_TARGET_UPPER',
  'RATE_US_TARGET_LOWER', 'RATE_JP_POLICY', 'IDX_KOSPI', 'IDX_SP500', 'IDX_NASDAQ'];
const metric = (code, value) => ({
  metric_code: code, label: code, flag: '🇰🇷', as_of: '2026-09-08', value,
  prev_as_of: '2026-09-07', delta: 0, delta_pct: 0, decimals: 2,
  unit: code.startsWith('RATE') ? 'percent' : 'KRW', source: 'TEST', status: 'ok',
});
const allMetrics = { metrics: CODES.map((c) => metric(c, 100)), _count: 9, _missing: [], _fetchErrors: [] };
const article = (i) => ({
  source: 'TEST', title: `제목 <a> & b ${i}`, url: `https://example.com/${i}`,
  published_at: '2026-09-08T00:00:00Z',
});
const signals = (n) => ({ rss_items: Array.from({ length: n }, (_, i) => article(i + 1)), _count: n });
const section = (n) => 'x'.repeat(n);

let fail = 0;
const throws = (label, fn) => {
  try { fn(); console.log(`FAIL  ${label} (throw 하지 않음)`); fail++; }
  catch (e) { console.log(`PASS  ${label}  <- ${String(e.message).slice(0, 70)}`); }
};
const passes = (label, fn) => {
  try { fn(); console.log(`PASS  ${label}`); }
  catch (e) { console.log(`FAIL  ${label} -> ${String(e.message).slice(0, 110)}`); fail++; }
};

const build = (metrics, sig) => run('Build Sections', [{ json: metrics }, { json: sig }]);

throws('기사 0건이면 멈춘다', () => build(allMetrics, { rss_items: [], _count: 0, _emptySources: ['A'], _fetchErrors: [] }));
throws('기사가 최소치 미만이면 멈춘다', () => build(allMetrics, signals(2)));
throws('지표가 하나라도 빠지면 멈춘다', () => build({ metrics: [metric('FX_USDKRW', 1)], _count: 1 }, signals(5)));
passes('지표 9종 + 기사 3건이면 통과', () => build(allMetrics, signals(3)));

const built = build(allMetrics, signals(3))[0].json;
passes('기사 제목의 < > & 가 이스케이프된다', () => {
  if (!built.prompt.includes('제목 &lt;a&gt; &amp; b 1')) throw new Error('escape 누락');
});
passes('섹션 1이 지표 9종을 모두 담는다', () => {
  for (const label of ['원/달러', '원/100엔', '[증시]', '[기준금리]']) {
    if (!built.section1.includes(label)) throw new Error('섹션 1에 없음: ' + label);
  }
});

const refs = () => ({ first: () => ({ json: built }) });
const parse = (text) => run('Parse Sections', [{ json: { text } }], refs);
throws('LLM이 문자열 아닌 값을 주면 멈춘다', () => parse(JSON.stringify({ section2: section(30), section3: section(30), section4: [{ x: 1 }] })));
throws('LLM 섹션이 너무 짧으면 멈춘다', () => parse(JSON.stringify({ section2: section(30), section3: section(30), section4: '짧음' })));
throws('JSON이 아니면 멈춘다', () => parse('죄송합니다. 자료가 부족합니다.'));
throws('키가 빠지면 멈춘다', () => parse(JSON.stringify({ section2: section(30), section3: section(30) })));
passes('정상 JSON은 통과', () => parse(JSON.stringify({ section2: section(30), section3: section(30), section4: section(30) })));
passes('코드 펜스로 감싸도 통과', () => parse('```json\n' + JSON.stringify({ section2: section(30), section3: section(30), section4: section(30) }) + '\n```'));

const gate = (json) => run('Check Main Post', [{ json }]);
throws('메인이 ok:false면 답글 전에 멈춘다', () => gate({ ok: false, error: 'not_in_channel' }));
throws('메인에 ts가 없으면 멈춘다', () => gate({ ok: true }));
passes('정상 메인은 통과', () => gate({ ok: true, ts: '1788844348.540959' }));

console.log(fail === 0 ? '\n모두 통과' : `\n${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
