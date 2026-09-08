import { workflow, trigger, node, expr } from '@n8n/workflow-sdk';

// OpenClaw Health Alert (id: KyxNogJPjoOfmnYD)
// OpenClaw 게이트웨이 이상과 OAuth 만료 임박을 15분마다 점검해 Slack C0B0XQP5CF2로 알린다.
// LLM은 호출하지 않는다.

const every15Min = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.1,
  config: {
    name: 'Every 15 Minutes',
    parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 15 }] } },
    position: [0, 0]
  },
  output: [{}]
});

// n8n 이미지에 docker CLI가 있고 docker.sock 이 마운트돼 openclaw 로 exec 이 된다.
// executeCommand 는 n8n v2.0부터 기본 비활성이라 compose 의 NODES_EXCLUDE 가 전제다.
const collectState = node({
  type: 'n8n-nodes-base.executeCommand',
  version: 1,
  config: {
    name: 'Collect OpenClaw State',
    onError: 'continueRegularOutput',
    parameters: {
      executeOnce: true,
      command: "echo '###HEALTH'; docker exec openclaw openclaw health --json --timeout 10000 2>/dev/null || echo '{\"ok\":false}'; echo '###STATUS'; docker exec openclaw openclaw models status --json 2>/dev/null || echo '{}'"
    },
    position: [224, 0]
  },
  output: [{ exitCode: 0, stdout: '', stderr: '' }]
});

// 중복 발송과 2회 연속 실패 판정은 $getWorkflowStaticData('global')로 한다.
// 스태틱 데이터는 활성 실행에서만 저장되므로 수동 실행으로는 검증할 수 없다.
const evaluateState = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Evaluate State',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: "const j = (items[0] && items[0].json) ? items[0].json : {};\nconst nl = String.fromCharCode(10);\nconst st = $getWorkflowStaticData('global');\nconst now = Date.now();\nconst EXPIRY_MS = 259200000;\nconst REPEAT_MS = 10800000;\nconst STRIKES = 2;\nconst RELOGIN = 'docker exec -it openclaw openclaw models auth login --provider openai --device-code';\nconst alerts = [];\n\nfunction kst(ms) {\n  return new Date(ms).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).substring(0, 16);\n}\nfunction parseJson(text) {\n  try { return JSON.parse(text); } catch (err) { return null; }\n}\nfunction section(out, name, nextName) {\n  const s = out.indexOf('###' + name);\n  if (s < 0) return '';\n  const from = s + name.length + 3;\n  const e = nextName ? out.indexOf('###' + nextName, from) : -1;\n  return out.substring(from, e < 0 ? out.length : e).trim();\n}\n\nif (typeof j.stdout !== 'string') {\n  const why = j.error ? String(j.error) : 'stdout 없음';\n  if (!st.cmdFailAt || now - st.cmdFailAt > REPEAT_MS) {\n    st.cmdFailAt = now;\n    alerts.push('❗ OpenClaw 점검 명령 실패' + nl + '• ' + why.substring(0, 300) + nl + '• n8n 컨테이너에서 docker exec openclaw 가 되는지 확인');\n  }\n  return alerts.length ? [{ json: { text: alerts.join(nl + nl) } }] : [];\n}\ndelete st.cmdFailAt;\n\nconst health = parseJson(section(j.stdout, 'HEALTH', 'STATUS'));\nconst status = parseJson(section(j.stdout, 'STATUS', null));\n\nconst faults = [];\nif (!health || health.ok !== true) {\n  faults.push('health.ok 아님 (게이트웨이 무응답 또는 기동 실패)');\n} else {\n  const perrs = (health.plugins && Array.isArray(health.plugins.errors)) ? health.plugins.errors : [];\n  if (perrs.length) faults.push('플러그인 로드 실패 ' + perrs.length + '건: ' + JSON.stringify(perrs).substring(0, 200));\n  const slack = (health.channels && health.channels.slack) ? health.channels.slack : null;\n  if (slack && slack.enabled === true && slack.connected !== true) {\n    faults.push('Slack 채널 미연결 (lifecycle=' + String(slack.lifecycle) + ', lastError=' + String(slack.lastError) + ')');\n  }\n}\n\nif (faults.length) {\n  st.healthStreak = (st.healthStreak || 0) + 1;\n  const due = !st.healthAlertAt || now - st.healthAlertAt > REPEAT_MS;\n  if (st.healthStreak >= STRIKES && due) {\n    st.healthAlertAt = now;\n    alerts.push('❗ OpenClaw 게이트웨이 이상 (' + st.healthStreak + '회 연속)' + nl + '• ' + faults.join(nl + '• ') + nl + '• 확인: bash scripts/ctl.sh log openclaw');\n  }\n} else {\n  if (st.healthAlertAt) {\n    alerts.push('✅ OpenClaw 게이트웨이 정상 복구' + nl + '• 플러그인 로드·Slack 연결 모두 정상');\n  }\n  delete st.healthStreak;\n  delete st.healthAlertAt;\n}\n\nconst profiles = (status && status.auth && status.auth.oauth && Array.isArray(status.auth.oauth.profiles)) ? status.auth.oauth.profiles : [];\nlet worst = null;\nfor (const p of profiles) {\n  if (p.type !== 'oauth' || typeof p.remainingMs !== 'number') continue;\n  if (!worst || p.remainingMs < worst.remainingMs) worst = p;\n}\nif (worst && worst.remainingMs < EXPIRY_MS) {\n  const day = kst(now).substring(0, 10);\n  if (st.expiryDay !== day) {\n    st.expiryDay = day;\n    const days = Math.round(worst.remainingMs / 86400000 * 10) / 10;\n    const expired = worst.remainingMs <= 0;\n    alerts.push((expired ? '⛔ OpenClaw OAuth 토큰 만료' : '⏰ OpenClaw OAuth 토큰 만료 임박') + nl + '• 프로필: ' + (worst.label || worst.profileId) + nl + '• 만료: ' + kst(worst.expiresAt) + ' (' + (expired ? '이미 지남' : days + '일 남음') + ')' + nl + '• 재로그인: ' + RELOGIN + nl + '• 승인 URL은 로컬 브라우저에서 ChatGPT 계정으로 처리');\n  }\n} else {\n  delete st.expiryDay;\n}\n\nreturn alerts.length ? [{ json: { text: alerts.join(nl + nl) } }] : [];"
    },
    position: [448, 0]
  },
  output: [{ text: '' }]
});

const sendAlert = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Send Health Alert',
    parameters: {
      method: 'POST',
      url: 'https://slack.com/api/chat.postMessage',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [
          { name: 'Authorization', value: expr('=Bearer {{ $env.SLACK_BOT_TOKEN }}') }
        ]
      },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('={{ JSON.stringify({ channel: "C0B0XQP5CF2", text: $json.text }) }}'),
      options: { timeout: 15000 }
    },
    position: [672, 0]
  },
  output: [{}]
});

export default workflow('KyxNogJPjoOfmnYD', 'OpenClaw Health Alert')
  .add(every15Min)
  .to(collectState)
  .to(evaluateState)
  .to(sendAlert);
