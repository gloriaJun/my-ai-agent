#!/usr/bin/env node
// sub-fetch-metrics 워크플로의 파서·delta 계산을 실제 소스로 검증한다.
// n8n이나 MCP 없이 돌아가고 의존성도 없다 (Node 18+ 내장 fetch만 사용).
//
//   node scripts/verify-metrics.mjs          # 검증만, exit 0/1
//   node scripts/verify-metrics.mjs --show   # 지표 표도 출력
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const WORKFLOW = path.join(ROOT, 'n8n/workflows/sub-fetch-metrics.js');
const SHOW = process.argv.includes('--show');

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

// n8n 표현식 URL(=https://...{{ ... }})을 로컬에서 평가한다.
function resolveUrl(raw) {
  if (!raw.startsWith('=')) return raw;
  return raw.slice(1).replace(/\{\{([\s\S]*?)\}\}/g, (_, code) => String(new Function('return (' + code + ')')()));
}

function prevDay(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-metrics-'));
try {
  fs.writeFileSync(path.join(tmp, 'stub.mjs'), STUB);
  fs.writeFileSync(path.join(tmp, 'wf.mjs'),
    fs.readFileSync(WORKFLOW, 'utf8').replace("'@n8n/workflow-sdk'", "'./stub.mjs'"));

  const { registry } = await import(path.join(tmp, 'stub.mjs'));
  await import(path.join(tmp, 'wf.mjs'));

  const failures = [];
  const check = (ok, label) => {
    console.log((ok ? 'PASS  ' : 'FAIL  ') + label);
    if (!ok) failures.push(label);
  };

  const fetchNodes = registry.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest');
  const codeNodes = registry.nodes.filter((n) => n.type === 'n8n-nodes-base.code');
  const parseNodes = codeNodes.filter((n) => n.config.name.startsWith('Parse '));
  check(registry.merges[0]?.config?.parameters?.numberInputs === fetchNodes.length + 1,
    'merge 입력 수 = 수집 노드 + 고정값 노드');

  const parsed = [];
  for (const p of parseNodes) {
    const code = p.config.name.replace('Parse ', '');
    const f = fetchNodes.find((n) => n.config.name === 'Fetch ' + code);
    let input;
    try {
      const res = await fetch(resolveUrl(f.config.parameters.url), {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(20000),
      });
      input = [{ json: { data: await res.text() } }];
    } catch (e) {
      input = [{ json: { error: String(e.message) } }];
    }
    let out;
    try {
      out = new Function('items', p.config.parameters.jsCode)(input);
    } catch (e) {
      check(false, code + ' 파서 실행: ' + e.message);
      continue;
    }
    const j = out[0].json;
    check(j.status === 'ok' && j.observations.length >= 2,
      code.padEnd(22) + 'obs=' + String(j.observations.length).padStart(2) +
      (j.status === 'ok' ? '  last=' + JSON.stringify(j.observations.slice(-1)[0]) : '  ' + j.message));
    parsed.push(...out);
  }

  const fixedNode = codeNodes.find((n) => n.config.name === 'Emit Fixed Metrics');
  const fixedOut = new Function('items', fixedNode.config.parameters.jsCode)([]);
  check(fixedOut.length > 0 && fixedOut[0].json.observations.length === 2, '고정값 지표 방출');
  parsed.push(...fixedOut);

  // 수집 실패 경로
  const errOut = new Function('items', parseNodes[0].config.parameters.jsCode)([{ json: { error: 'ETIMEDOUT' } }]);
  check(errOut[0].json.status === 'error', '수집 실패 -> status=error');

  const normNode = codeNodes.find((n) => n.config.name === 'Normalize & Delta');
  const j = new Function('items', normNode.config.parameters.jsCode)(parsed)[0].json;

  check(j._count >= 8, '지표 8개 이상 산출 (실제 ' + j._count + '개)');
  check(j._missing.length === 0, '결측 없음' + (j._missing.length ? ' -> ' + j._missing.join(', ') : ''));
  const withDelta = j.metrics.filter((m) => m.delta !== null).length;
  check(withDelta >= 5, '전일 대비 5종 이상 (실제 ' + withDelta + '종)');
  check(j.metrics.every((m) => typeof m.value === 'number' && !isNaN(m.value)), '모든 value가 숫자');

  if (SHOW) {
    console.log('\n--- metrics ---');
    for (const m of j.metrics) {
      const v = m.value.toFixed(m.decimals);
      const d = m.delta === null ? '-' : m.delta === 0 ? '보합' :
        (m.delta > 0 ? '▲' : '▼') + Math.abs(m.delta).toFixed(m.decimals);
      // prev_as_of가 as_of의 바로 전날이 아니면 비교 기준일을 밝힌다 (소스에 결측일이 있다).
      const basis = m.prev_as_of && m.prev_as_of !== prevDay(m.as_of) ? ' (vs ' + m.prev_as_of + ')' : '';
      console.log('  ' + m.label.padEnd(20) + v.padStart(11) + '  ' + d.padStart(9) +
        '   ' + m.as_of + basis + '  ' + m.source);
    }
  }

  console.log('\n' + (failures.length === 0 ? '모두 통과' : failures.length + '건 실패'));
  process.exit(failures.length === 0 ? 0 : 1);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
