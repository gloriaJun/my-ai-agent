#!/usr/bin/env node
// sub-fetch-market-signals 워크플로의 파서·필터를 실제 피드로 검증한다.
// n8n이나 MCP 없이 돌아가고 의존성도 없다 (Node 18+ 내장 fetch만 사용).
//
//   node scripts/verify-market-signals.mjs          # 검증만, exit 0/1
//   node scripts/verify-market-signals.mjs --show   # 통과한 기사 목록도 출력
//
// 워크플로 파일에서 code 노드의 jsCode를 그대로 꺼내 실행하므로, 파일을 고치면
// 이 스크립트가 바로 그 변경을 검증한다. 피드가 포맷을 바꾸거나 죽으면 여기서 잡힌다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const WORKFLOW = path.join(ROOT, 'n8n/workflows/sub-fetch-market-signals.js');
const SHOW = process.argv.includes('--show');

const FEEDS = {
  MOFE: 'https://mofe.go.kr/com/detailRssTagService.do?bbsId=MOSFBBS_000000000045',
  BOK: 'https://www.bok.or.kr/portal/bbs/B0000552/news.rss?menuNo=200690',
  EINFOMAX: 'https://news.einfomax.co.kr/rss/allArticle.xml',
  YNA_MARKET: 'https://www.yna.co.kr/rss/market.xml',
  BLOOMBERG: 'https://feeds.bloomberg.com/markets/news.rss',
};

// @n8n/workflow-sdk는 n8n 컨테이너 안에만 있다. 노드 정의만 모으는 스텁으로 대체해
// 워크플로 파일을 그대로 로드한다.
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-signals-'));
try {
  fs.writeFileSync(path.join(tmp, 'stub.mjs'), STUB);
  const src = fs.readFileSync(WORKFLOW, 'utf8').replace("'@n8n/workflow-sdk'", "'./stub.mjs'");
  fs.writeFileSync(path.join(tmp, 'wf.mjs'), src);

  const { registry } = await import(path.join(tmp, 'stub.mjs'));
  await import(path.join(tmp, 'wf.mjs'));

  const codeNodes = registry.nodes.filter((n) => n.type === 'n8n-nodes-base.code');
  const failures = [];
  const check = (ok, label) => {
    console.log((ok ? 'PASS  ' : 'FAIL  ') + label);
    if (!ok) failures.push(label);
  };

  check(registry.merges[0]?.config?.parameters?.numberInputs === Object.keys(FEEDS).length,
    'merge 입력 수 = 피드 수');

  const parsed = [];
  for (const n of codeNodes) {
    const jsCode = n.config.parameters.jsCode;
    const m = jsCode.match(/^const SOURCE = "([A-Z_]+)"/);
    if (!m) continue;
    const source = m[1];
    let input;
    try {
      const res = await fetch(FEEDS[source], { signal: AbortSignal.timeout(20000) });
      input = [{ json: { data: await res.text() } }];
    } catch (e) {
      input = [{ json: { error: String(e.message) } }];
    }
    let out;
    try {
      out = new Function('items', jsCode)(input);
    } catch (e) {
      check(false, source + ' 파서 실행: ' + e.message);
      continue;
    }
    const rows = out.map((r) => r.json);
    const badDate = rows.filter((r) => !r._fetchError && !r._sourceEmpty && !r.published_at).length;
    const badUrl = rows.filter((r) => !r._fetchError && !r._sourceEmpty && !/^https?:\/\//.test(r.url || '')).length;
    check(rows.length > 0 && !rows[0]._fetchError && badDate === 0 && badUrl === 0,
      source.padEnd(11) + 'items=' + String(rows.length).padStart(3) + ' badDate=' + badDate + ' badUrl=' + badUrl);
    parsed.push(...out);
  }

  // 수집 실패가 _fetchError 아이템으로 변환되는지
  const firstParser = codeNodes.find((n) => /^const SOURCE = /.test(n.config.parameters.jsCode));
  const errOut = new Function('items', firstParser.config.parameters.jsCode)([{ json: { error: 'connect ETIMEDOUT' } }]);
  check(errOut[0]?.json?._fetchError === true, '수집 실패 -> _fetchError 아이템 변환');

  const filterNode = codeNodes.find((n) => n.config.name === 'Filter & Dedupe');
  const j = new Function('items', filterNode.config.parameters.jsCode)(parsed)[0].json;
  const bySource = {};
  for (const r of j.rss_items) bySource[r.source] = (bySource[r.source] || 0) + 1;

  check(j._count >= 5, '24시간 필터 후 5건 이상 (실제 ' + j._count + '건)');
  check(Object.keys(bySource).length >= 4, '4개 이상 소스에서 확보 ' + JSON.stringify(bySource));
  check(j.rss_items.every((r) => Date.now() - Date.parse(r.published_at) <= 24 * 3600 * 1000),
    '모든 항목이 24시간 이내');
  check(j.rss_items.every((r) => r.title && r.url && r.published_at), '필수 필드 누락 없음');
  console.log('      키워드로 걸러낸 건수: ' + j._droppedByKeyword);

  if (SHOW) {
    console.log('\n--- rss_items ---');
    for (const r of j.rss_items) {
      const kst = new Date(r.published_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      console.log('[' + kst + '] ' + r.source.padEnd(11) + r.title.slice(0, 56));
    }
  }

  console.log('\n' + (failures.length === 0 ? '모두 통과' : failures.length + '건 실패'));
  process.exit(failures.length === 0 ? 0 : 1);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
