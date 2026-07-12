// Workflow ID: EfSRIKhn13Bsybm0 (Sub-LLM-Call)
// Provider-agnostic LLM sub-workflow. Returns { text }.
// Calls the OpenClaw gateway (OpenAI-compatible /v1/chat/completions).
// Agent route via body model ($env.LLM_AGENT || "openclaw/default");
// backend model via x-openclaw-model header ($json.model || $env.LLM_MODEL).
// Retry 3 tries, 10-min wait.
import { workflow, node, trigger } from '@n8n/workflow-sdk';

const whenCalled = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.1,
  config: {
    name: 'When Called by Another Workflow',
    position: [0, 0],
    parameters: {
      inputSource: 'passthrough',
    },
  },
  output: [{}],
});

const callLlmApi = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Call LLM API',
    position: [224, 0],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 600000,
    parameters: {
      method: 'POST',
      url: 'http://openclaw:18789/v1/chat/completions',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [
          { name: 'Authorization', value: '=Bearer {{ $env.OPENCLAW_GATEWAY_TOKEN }}' },
          { name: 'x-openclaw-model', value: '={{ $json.model || $env.LLM_MODEL }}' },
        ],
      },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody:
        '={{ { "model": $env.LLM_AGENT || "openclaw/default", "messages": [{ "role": "user", "content": $json.prompt }], "temperature": $json.temperature || 0.3, "max_tokens": $json.maxTokens || 16000 } }}',
      options: {
        timeout: 60000,
      },
    },
  },
  output: [{}],
});

const extractText = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Extract Text',
    position: [448, 0],
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode: 'const text = $json.choices?.[0]?.message?.content;\nif (!text) throw new Error("no text from LLM: " + JSON.stringify($json).substring(0, 200));\nreturn { text };',
    },
  },
  output: [{ text: '' }],
});

export default workflow('EfSRIKhn13Bsybm0', 'Sub-LLM-Call')
  .add(whenCalled)
  .to(callLlmApi)
  .to(extractText);
