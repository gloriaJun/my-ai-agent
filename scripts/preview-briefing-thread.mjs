#!/usr/bin/env node
// daily-finance-briefing.js의 Build Sections / Parse Sections를 실제 소스 데이터로 돌려본다.
// 발송도 LLM 호출도 하지 않는다. 채널에 실패작을 올리기 전에 이걸로 먼저 본다.

//   node scripts/preview-briefing-thread.mjs             # 섹션 1 렌더 + 프롬프트
//   node scripts/preview-briefing-thread.mjs --prompt    # 프롬프트만 (게이트웨이 테스트용)
//   node scripts/preview-briefing-thread.mjs --llm <파일> # Parse Sections까지 확인

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const STUB = `
export const registry = { nodes: [], merges: [] };
const chain = { add: () => chain, to: () => chain };
export const node = (d) => (registry.nodes.push(d), { ...d, to: (x) => x, input: (i) => ({ __input: i }), output: () => ({ to: () => {} }) });
export const trigger = (d) => (registry.nodes.push(d), { ...d, to: (x) => x });
export const merge = (d) => (registry.merges.push(d), { ...d, input: (i) => ({ __input: i }) });
export const workflow = (id, name) => (registry.id = id, registry.name = name, chain);
export const expr = (s) => s;
export const ifElse = (d) => d;
`;
const resolveUrl = (raw) => raw.startsWith('=')
  ? raw.slice(1).replace(/\{\{([\s\S]*?)\}\}/g, (_, c) => String(new Function('return (' + c + ')')()))
  : raw;

// 워크플로 파일을 스텁으로 import 해 노드 정의를 그대로 얻는다.
async function loadNodes(file) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-'));
  try {
    fs.writeFileSync(path.join(tmp, 'stub.mjs'), STUB);
    fs.writeFileSync(path.join(tmp, 'wf.mjs'),
      fs.readFileSync(path.join(ROOT, 'n8n/workflows', file), 'utf8')
        .replace("'@n8n/workflow-sdk'", "'./stub.mjs'"));
    const { registry } = await import(path.join(tmp, 'stub.mjs'));
    await import(path.join(tmp, 'wf.mjs'));
    return registry.nodes;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 수집 서브워크플로는 fetch -> parse 쌍을 돌린 뒤 마지막 집계 노드에 넘기는 구조다.
async function runFetchWorkflow(file) {
  const nodes = await loadNodes(file);
  const httpNodes = nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest');
  const codeNodes = nodes.filter((n) => n.type === 'n8n-nodes-base.code');
  const collected = [];
  for (const c of codeNodes) {
    if (!c.config.name.startsWith('Parse ')) continue;
    const paired = httpNodes.find((h) => h.config.name === c.config.name.replace(/^Parse /, 'Fetch '));
    // 조용히 건너뛰면 소스 하나가 통째로 빠진 브리핑이 정상처럼 보인다.
    if (!paired) throw new Error(`no Fetch node paired with "${c.config.name}" in ${file}`);
    const headers = {};
    for (const h of paired.config.parameters.headerParameters?.parameters ?? []) headers[h.name] = h.value;
    let input;
    try {
      const res = await fetch(resolveUrl(paired.config.parameters.url), {
        headers, signal: AbortSignal.timeout(20000),
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
}

const briefingNodes = await loadNodes('daily-finance-briefing.js');
const codeOf = (name) => {
  const n = briefingNodes.find((x) => x.config.name === name);
  if (!n) throw new Error('node not found: ' + name);
  return n.config.parameters.jsCode;
};

const [metrics, signals] = await Promise.all([
  runFetchWorkflow('sub-fetch-metrics.js'),
  runFetchWorkflow('sub-fetch-market-signals.js'),
]);

// Merge Inputs가 넘겨주는 모양 그대로 만든다.
const merged = [{ json: metrics }, { json: signals }];
const built = new Function('items', codeOf('Build Sections'))(merged)[0].json;

const promptOnly = process.argv.includes('--prompt');
const llmIdx = process.argv.indexOf('--llm');

if (promptOnly) {
  process.stdout.write(built.prompt);
  process.exit(0);
}

console.log('─'.repeat(72));
console.log('[메인] 📊 오늘의 데일리 경제 & 시장 브리핑 — ' + built.date_label);
console.log('─'.repeat(72));
console.log('[답글 1]');
console.log(built.section1);
console.log('─'.repeat(72));
console.log(`지표 ${built._metric_count}종 · 기사 ${built._rss_count}건 중 ${built._rss_used}건 사용`);
if (built._empty_sources.length) console.log(`빈 소스: ${built._empty_sources.join(', ')}`);
if (built._fetch_errors.length) console.log(`수집 실패: ${JSON.stringify(built._fetch_errors)}`);
console.log(`프롬프트 ${built.prompt.length}자`);

if (llmIdx > -1) {
  const text = fs.readFileSync(process.argv[llmIdx + 1], 'utf8');
  // 워크플로가 새 노드를 참조하기 시작하면 빈 객체를 주는 대신 여기서 터지게 한다.
  const refs = { 'Build Sections': built };
  const parse = new Function('items', '$', codeOf('Parse Sections'))(
    [{ json: { text } }],
    (name) => {
      if (!(name in refs)) throw new Error(`preview stub has no data for node "${name}"`);
      return { first: () => ({ json: refs[name] }) };
    },
  )[0].json;
  for (const [label, key] of [['답글 2', 's2'], ['답글 3', 's3'], ['답글 4', 's4']]) {
    console.log('─'.repeat(72));
    console.log(`[${label}]`);
    console.log(parse[key]);
  }
  console.log('─'.repeat(72));
} else {
  console.log('\nLLM 섹션까지 보려면: --llm <응답파일>');
}

// Post 노드 5개의 jsonBody 표현식과 Verify Thread는 여기서 실행하지 않는다.
// 스레드 결선은 실제 발송으로만 확인된다.

