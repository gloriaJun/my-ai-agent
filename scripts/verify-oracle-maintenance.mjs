#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-workflow-'));

const stub = `export const registry = { nodes: [], workflows: [] };
const chain = { add() { return this; }, to() { return this; } };
export const workflow = (id, name, settings) => { registry.workflows.push({id,name,settings}); return chain; };
export const node = (d) => { registry.nodes.push(d); return d; };
export const trigger = node;
export const expr = (v) => v;
`;

try {
  fs.writeFileSync(path.join(temporary, 'stub.mjs'), stub);

  for (const name of ['oracle-maintenance', 'oracle-maintenance-report']) {
    const source = fs.readFileSync(path.join(root, 'n8n/workflows', name + '.js'), 'utf8');
    fs.writeFileSync(path.join(temporary, name + '.mjs'), source.replace("'@n8n/workflow-sdk'", "'./stub.mjs'"));
    await import(path.join(temporary, name + '.mjs'));
  }

  const { registry } = await import(path.join(temporary, 'stub.mjs'));
  const find = (name) => registry.nodes.find((n) => n.config.name === name);
  assert.equal(registry.workflows.length, 2);

  for (const w of registry.workflows) assert.equal(w.settings.timezone, 'Asia/Seoul');
  assert.equal(find('Weekly Maintenance').config.parameters.rule.interval[0].expression, '0 4 * * 0');
  const submit = find('Request Host Backup').config.parameters.command;
  assert.match(submit, /source=\/var\/lib\/oracle-maintenance\/requests/);
  assert.match(submit, /--network none/);
  assert.match(submit, /linkSync/);
  const collect = find('Read Maintenance Status').config.parameters.command;
  assert.match(collect, /source=\/var\/lib\/oracle-maintenance\/status/);
  assert.match(collect, /readonly/);
  const state = {};
  const evaluate = new Function('items', '$getWorkflowStaticData', find('Build Maintenance Report').config.parameters.jsCode);
  const run = (status) => evaluate([{ json: { stdout: JSON.stringify(status) } }], () => state);
  assert.deepEqual(run({ state: 'idle' }), []);
  assert.deepEqual(run({ state: 'running', run_id: 'running', started_at: new Date().toISOString() }), []);

  for (const status of ['success', 'partial', 'failed']) {
    const result = run({ state: status, run_id: status, backup: { state: 'success', bytes: 1024 }, services: [] });
    assert.equal(result.length, 1);
    assert.equal(result[0].json.run_id, status);
    assert.ok(result[0].json.text.includes('Oracle'));
    assert.ok(result[0].json.text.includes('\n'), 'Report lines must use newline characters');
    assert.equal(state.lastReportedRun, undefined, 'Report must not be acknowledged before Slack succeeds');
  }

  const acknowledge = new Function('items', '$getWorkflowStaticData', '$', find('Confirm Report Delivery').config.parameters.jsCode);
  const previous = () => ({ first: () => ({ json: { run_id: 'success' } }) });
  assert.throws(() => acknowledge([{ json: { ok: false } }], () => state, previous));
  assert.equal(state.lastReportedRun, undefined);
  acknowledge([{ json: { ok: true } }], () => state, previous);
  assert.equal(state.lastReportedRun, 'success');
  assert.deepEqual(run({ state: 'success', run_id: 'success' }), []);
  assert.throws(() => evaluate([{ json: { stdout: 'invalid-json' } }], () => state));
  console.log('PASS: weekly schedule, request/status isolation, terminal reports and delivery acknowledgement');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
