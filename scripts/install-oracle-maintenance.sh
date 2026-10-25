#!/usr/bin/env bash
set -euo pipefail

MODE="${1:---install-only}"
case "$MODE" in --install-only|--activate) ;; *) echo 'Usage: sudo bash scripts/install-oracle-maintenance.sh [--install-only|--activate]' >&2; exit 2 ;; esac
[[ "$EUID" -eq 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ "$REPO_ROOT" == /home/ubuntu/my-ai-agent ]] || { echo 'Install from /home/ubuntu/my-ai-agent.' >&2; exit 1; }
for executable in docker rclone python3 systemctl tar journalctl; do command -v "$executable" >/dev/null; done

install -d -m 700 /etc/oracle-maintenance
install -d -m 755 /var/lib/oracle-maintenance /var/lib/oracle-maintenance/status
install -d -m 700 -o 1000 -g 1000 /var/lib/oracle-maintenance/requests
if [[ ! -f /etc/oracle-maintenance/config.json ]]; then
  install -m 600 "$REPO_ROOT/config/oracle-maintenance.json" /etc/oracle-maintenance/config.json
fi
for unit in oracle-maintenance.service oracle-maintenance.path oracle-maintenance-recover.service; do
  install -m 644 "$REPO_ROOT/config/$unit" "/etc/systemd/system/$unit"
done
systemd-analyze verify /etc/systemd/system/oracle-maintenance.service /etc/systemd/system/oracle-maintenance.path /etc/systemd/system/oracle-maintenance-recover.service
systemctl daemon-reload

python3 - "$REPO_ROOT" <<'PY'
import json, pathlib, subprocess, sys
root = pathlib.Path(sys.argv[1])
converter = r'''
const fs=require('fs'); const base='/usr/local/lib/node_modules/n8n/node_modules/.pnpm';
const folder=fs.readdirSync(base).find(n=>n.startsWith('@n8n+workflow-sdk@'));
if(!folder)throw new Error('Installed workflow SDK not found');
const sdk=require(base+'/'+folder+'/node_modules/@n8n/workflow-sdk');
const source=fs.readFileSync(0,'utf8').split('\n').filter(line=>!line.startsWith('import ')).join('\n').replace('export default ','return ');
const built=new Function('workflow','trigger','node','expr',source)(sdk.workflow,sdk.trigger,sdk.node,sdk.expr);
const validation=built.validate(); if(!validation.valid)throw new Error(JSON.stringify(validation.errors));
console.log(JSON.stringify(built.toJSON()));
'''
for name in ['oracle-maintenance','oracle-maintenance-report']:
    source = (root/'n8n/workflows'/f'{name}.js').read_text()
    result = subprocess.run(['docker','exec','-i','n8n','node','-e',converter],input=source,text=True,capture_output=True,check=True)
    data = json.loads(result.stdout)
    assert data['settings']['timezone'] == 'Asia/Seoul'
    assert len(data['nodes']) >= 2
    destination = '/tmp/'+name+'.json'
    subprocess.run(['docker','exec','-i','n8n','sh','-c','umask 077; cat > "$1"','sh',destination],input=json.dumps(data),text=True,check=True)
    try:
        subprocess.run(['docker','exec','n8n','n8n','import:workflow','--input='+destination],check=True)
    finally:
        subprocess.run(['docker','exec','n8n','rm','-f',destination],check=True)
PY

if [[ "$MODE" == --activate ]]; then
  python3 - <<'PY'
import json, subprocess
settings = json.load(open('/etc/oracle-maintenance/config.json'))
subprocess.run(['rclone','--config',settings['rclone_config'],'mkdir',settings['remote']],check=True)
PY
  python3 "$REPO_ROOT/scripts/oracle-maintenance.py" --config /etc/oracle-maintenance/config.json preflight
  systemctl enable --now oracle-maintenance-recover.service oracle-maintenance.path
  docker exec n8n n8n publish:workflow --id=OclBackupWeekly1
  docker exec n8n n8n publish:workflow --id=OclBackupReport1
  docker restart n8n >/dev/null
  echo 'Maintenance requests enabled; verify n8n health and both workflow activations.'
else
  echo 'Installed with inactive n8n workflows. Run --activate after Drive authentication and verification.'
fi
