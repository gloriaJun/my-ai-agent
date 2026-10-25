import { workflow, trigger, node } from '@n8n/workflow-sdk';

const weekly = trigger({
  type: 'n8n-nodes-base.scheduleTrigger', version: 1.2,
  config: {
    name: 'Weekly Maintenance', position: [0, 0],
    parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 4 * * 0' }] } },
  },
});

// A separate helper exits before the host job stops n8n. Hard-link creation publishes complete JSON atomically.
const requestCode = `const fs = require("fs"); const crypto = require("crypto");
const id = crypto.randomUUID(); const temporary = "/requests/" + id + ".tmp";
fs.writeFileSync(temporary, JSON.stringify({request_id:id,requested_at:new Date().toISOString()}), {mode:384,flag:"wx"});
try { fs.linkSync(temporary,"/requests/start.json"); console.log(JSON.stringify({requested:true,request_id:id})); }
catch (e) { if(e.code!=="EEXIST") throw e; console.log(JSON.stringify({requested:false,reason:"pending_request"})); }
finally { fs.unlinkSync(temporary); }`;

const request = node({
  type: 'n8n-nodes-base.executeCommand', version: 1,
  config: {
    name: 'Request Host Backup', position: [224, 0],
    parameters: {
      executeOnce: true,
      command: "docker run --rm --pull=never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --user 1000:1000 --memory 128m --cpus 0.5 --pids-limit 32 --mount type=bind,source=/var/lib/oracle-maintenance/requests,target=/requests --entrypoint node n8n-custom -e '" + requestCode + "'",
    },
  },
});

export default workflow('OclBackupWeekly1', 'Oracle Weekly Backup', {
  timezone: 'Asia/Seoul', executionOrder: 'v1', errorWorkflow: 'ThAqXteh1LGZZoXt',
}).add(weekly).to(request);
