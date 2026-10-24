import { workflow, trigger, node } from '@n8n/workflow-sdk';

const workflowError = trigger({
  "type": "n8n-nodes-base.errorTrigger",
  "version": 1,
  "config": {
    "name": "Workflow Error",
    "parameters": {},
    "position": [
      240,
      300
    ]
  }
});

const filterBookingRejections = node({
  "type": "n8n-nodes-base.code",
  "version": 2,
  "config": {
    "name": "Filter Expected Booking Rejections",
    "parameters": {
      "mode": "runOnceForAllItems",
      "jsCode": "function isBookingRejection(value, depth = 0) {\n  if (depth > 8 || value == null) return false;\n  if (typeof value === 'string') {\n    try {\n      return isBookingRejection(JSON.parse(value), depth + 1);\n    } catch {\n      const httpError = value.match(/^\\s*(\\d{3})\\s*-\\s*([\\s\\S]+)$/);\n      return httpError?.[1] === '400'\n        && isBookingRejection(httpError[2], depth + 1);\n    }\n  }\n  if (typeof value !== 'object' || Array.isArray(value)) return false;\n  for (const field of ['code', 'httpCode', 'statusCode']) {\n    if (value[field] != null && Number(value[field]) !== 400) return false;\n  }\n  if (value.status === 'error' && value.error_code === 'E011') return true;\n  return isBookingRejection(value.error, depth + 1)\n    || isBookingRejection(value.message, depth + 1);\n}\n\nreturn items.filter(({ json }) => !(\n  json.workflow?.id === 'QLMIyUrcTz7qt8JF'\n  && isBookingRejection(json.execution?.error)\n));"
    },
    "position": [
      240,
      0
    ]
  }
});

const sendSlackAlert = node({
  "type": "n8n-nodes-base.httpRequest",
  "version": 4.4,
  "config": {
    "name": "Send Slack Alert",
    "parameters": {
      "method": "POST",
      "url": "https://slack.com/api/chat.postMessage",
      "sendHeaders": true,
      "specifyHeaders": "keypair",
      "headerParameters": {
        "parameters": [
          {
            "name": "Authorization",
            "value": "=Bearer {{ $env.SLACK_BOT_TOKEN }}"
          }
        ]
      },
      "sendBody": true,
      "contentType": "json",
      "specifyBody": "json",
      "jsonBody": {
        "channel": "C0B0XQP5CF2",
        "text": "={{ \"🚨 *워크플로우 오류 알림*\\n\\n📋 워크플로우: \" + $json.workflow.name + \"\\n❌ 오류: \" + $json.execution.error.message + \"\\n🔧 마지막 노드: \" + $json.execution.lastNodeExecuted + \"\\n🔗 실행 링크: \" + $json.execution.url }}"
      }
    },
    "position": [
      460,
      300
    ]
  }
});

export default workflow('ThAqXteh1LGZZoXt', 'Error Alert')
  .add(workflowError)
  .to(filterBookingRejections)
  .to(sendSlackAlert);
