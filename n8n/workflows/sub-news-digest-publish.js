import { workflow, trigger, node, expr } from '@n8n/workflow-sdk';

// News Digest Publish Notify (id: LbEmsPoC4ATlkly3)
// news-digest가 발행 완료 시 PUBLISH_WEBHOOK_URL로 POST { text, threads } 를 보내면,
// text를 Slack 채널 C0B015JR0BY에 부모 메시지로 게시하고, threads의 각 원소를 그 부모의
// 스레드에 배열 순서대로 게시한다(카테고리 1개 = threads 원소 1개).
// payload 계약은 my-assistant-hub/apps/news-digest/README.md "발행 알림 webhook 계약" 참고.
// PUBLISH_WEBHOOK_URL (news-digest .env) = http://n8n:5678/webhook/news-digest-publish (internal proxy-net)

const publishWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Publish Webhook',
    parameters: {
      httpMethod: 'POST',
      path: 'news-digest-publish',
      responseMode: 'onReceived',
      options: {}
    },
    position: [0, 0]
  },
  output: [{ body: { text: '', threads: [] } }]
});

const postParent = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Post Parent',
    parameters: {
      method: 'POST',
      url: 'https://slack.com/api/chat.postMessage',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [
          { name: 'Authorization', value: '=Bearer {{ $env.SLACK_BOT_TOKEN }}' }
        ]
      },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        '={{ JSON.stringify({ channel: "C0B015JR0BY", text: $json.body.text, unfurl_links: false, unfurl_media: false }) }}',
      ),
      options: { timeout: 15000 }
    },
    position: [224, 0]
  },
  output: [{ ok: true, ts: '' }]
});

// 부모 게시 응답의 ts를 각 스레드 메시지에 붙여 아이템 배열로 펼친다. HTTP Request 노드가
// 아이템을 배열 순서대로 보내므로 Slack 스레드 순서가 카테고리 순서와 같아진다.
// Slack은 실패해도 HTTP 200에 ok:false로 답하므로 여기서 직접 막지 않으면 thread_ts가
// undefined인 채로 스레드 메시지가 채널 본문에 흩어진다.
// threads가 비면 빈 배열을 돌려 다음 노드를 실행시키지 않는다(부모 메시지만 남는다).
const buildThreadMessages = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Thread Messages',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: "const parent = $('Post Parent').first().json;\nif (!parent || parent.ok !== true || !parent.ts) {\n  throw new Error('parent post failed: ' + JSON.stringify(parent).slice(0, 300));\n}\nconst body = $('Publish Webhook').first().json.body || {};\nconst threads = Array.isArray(body.threads) ? body.threads : [];\nreturn threads\n  .filter((t) => t && typeof t.text === 'string' && t.text.length > 0)\n  .map((t) => ({ json: { text: t.text, thread_ts: parent.ts } }));"
    },
    position: [448, 0]
  },
  output: [{ text: '', thread_ts: '' }]
});

// batching: 스레드 순서를 게시 순서에 맡기므로 한 건씩 보낸다. Slack chat.postMessage는
// 채널당 초당 1건 기준이라 간격도 함께 둔다.
const postThreads = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Post Threads',
    parameters: {
      method: 'POST',
      url: 'https://slack.com/api/chat.postMessage',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [
          { name: 'Authorization', value: '=Bearer {{ $env.SLACK_BOT_TOKEN }}' }
        ]
      },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        '={{ JSON.stringify({ channel: "C0B015JR0BY", thread_ts: $json.thread_ts, text: $json.text, unfurl_links: false, unfurl_media: false }) }}',
      ),
      options: {
        timeout: 15000,
        batching: { batch: { batchSize: 1, batchInterval: 1000 } }
      }
    },
    position: [672, 0]
  },
  output: [{}]
});

export default workflow('LbEmsPoC4ATlkly3', 'News Digest Publish Notify')
  .add(publishWebhook)
  .to(postParent)
  .to(buildThreadMessages)
  .to(postThreads);
