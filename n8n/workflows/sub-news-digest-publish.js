import { workflow, trigger, node, expr } from '@n8n/workflow-sdk';

// News Digest Publish Notify (id: LbEmsPoC4ATlkly3)
// news-digest가 발행 완료 시 PUBLISH_WEBHOOK_URL로 POST { text } 를 보내면,
// 그 text를 가공 없이 Slack 채널 C0B015JR0BY에 그대로 게시한다.
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
  output: [{ body: { text: '' } }]
});

const postToSlack = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Post to Slack',
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
      jsonBody: expr('={{ JSON.stringify({ channel: "C0B015JR0BY", text: $json.body.text }) }}'),
      options: { timeout: 15000 }
    },
    position: [224, 0]
  },
  output: [{}]
});

export default workflow('LbEmsPoC4ATlkly3', 'News Digest Publish Notify')
  .add(publishWebhook)
  .to(postToSlack);
