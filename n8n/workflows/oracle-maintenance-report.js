import { workflow, trigger, node } from '@n8n/workflow-sdk';

const poll = trigger({
  type: 'n8n-nodes-base.scheduleTrigger', version: 1.2,
  config: {
    name: 'Check Every Five Minutes', position: [0, 0],
    parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] } },
  },
});

const readCode = `const fs=require("fs");
try { const s=JSON.parse(fs.readFileSync("/status/latest.json","utf8")); console.log(JSON.stringify(s)); }
catch(e) { if(e.code!=="ENOENT") throw e; console.log(JSON.stringify({state:"idle"})); }`;

const collect = node({
  type: 'n8n-nodes-base.executeCommand', version: 1,
  config: {
    name: 'Read Maintenance Status', position: [224, 0],
    parameters: {
      executeOnce: true,
      command: "docker run --rm --pull=never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --user 1000:1000 --memory 128m --cpus 0.5 --pids-limit 32 --mount type=bind,source=/var/lib/oracle-maintenance/status,target=/status,readonly --entrypoint node n8n-custom -e '" + readCode + "'",
    },
  },
});

const build = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: {
    name: 'Build Maintenance Report', position: [448, 0],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const status=JSON.parse(items[0].json.stdout);
const saved=$getWorkflowStaticData('global');
if (!['success','partial','failed'].includes(status.state) || !status.run_id || saved.lastReportedRun===status.run_id) return [];
const backup=status.backup||{}; const cleanup=status.cleanup||{}; const disk=status.disk||{};
const services=Array.isArray(status.services)?status.services:[];
const bad=services.filter(s=>!s.running || (s.health && !['healthy','none'].includes(s.health)));
const gib=n=>typeof n==='number'?(n/1073741824).toFixed(1)+' GiB':'미확인';
const labels={success:'완료',partial:'백업 완료 · 정리 또는 후속 점검 확인 필요',failed:'실패'};
const text=[
  'Oracle 주간 백업: '+labels[status.state],
  '• 백업: '+String(backup.state||'미확인')+' / '+(typeof backup.bytes==='number'?(backup.bytes/1048576).toFixed(1)+' MiB':'용량 미확인'),
  '• 업로드 검증: '+(backup.verified?'통과':'미완료'),
  '• 월간 정리: '+String(cleanup.state||'미확인'),
  '• 디스크: '+String(disk.used_percent??'?')+'% 사용 / 여유 '+gib(disk.free_bytes),
  '• 서비스: '+(services.length===0?'미확인':bad.length?bad.map(s=>s.name).join(', ')+' 확인 필요':services.length+'개 정상'),
  status.error?'• 확인: '+String(status.error):'',
  cleanup.error?'• 정리: '+String(cleanup.error):'',
  backup.error?'• 백업: '+String(backup.error):'',
].filter(Boolean).join('\\n');
return [{json:{run_id:status.run_id,text}}];`,
    },
  },
});

const send = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.4,
  config: {
    name: 'Send Maintenance Report', position: [672, 0],
    parameters: {
      method: 'POST', url: 'https://slack.com/api/chat.postMessage',
      sendHeaders: true, specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.SLACK_BOT_TOKEN }}' }] },
      sendBody: true, contentType: 'json', specifyBody: 'json',
      jsonBody: '={{ { channel: "C0B0XQP5CF2", text: $json.text } }}',
      options: { timeout: 15000 },
    },
  },
});

const confirm = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: {
    name: 'Confirm Report Delivery', position: [896, 0],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `if(items[0].json.ok!==true) throw new Error('Maintenance report delivery failed');
const saved=$getWorkflowStaticData('global');
saved.lastReportedRun=$('Build Maintenance Report').first().json.run_id;
return items;`,
    },
  },
});

export default workflow('OclBackupReport1', 'Oracle Backup Report', {
  timezone: 'Asia/Seoul', executionOrder: 'v1', errorWorkflow: 'ThAqXteh1LGZZoXt',
}).add(poll).to(collect).to(build).to(send).to(confirm);
