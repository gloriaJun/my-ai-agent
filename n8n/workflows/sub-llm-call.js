// Workflow ID: EfSRIKhn13Bsybm0 (Sub-LLM-Call)
// Provider-agnostic LLM sub-workflow. Returns { text }.
// Uses Gemini 2.5 Flash with retry (5 tries, 3-min wait).
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
    maxTries: 5,
    waitBetweenTries: 180000,
    parameters: {
      method: 'POST',
      url: '=https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={{ $env.GEMINI_API_KEY }}',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody:
        '={{ { "contents": [{ "parts": [...($json.videoUrl ? [{ "fileData": { "mimeType": "video/*", "fileUri": $json.videoUrl } }] : []), { "text": $json.prompt }] }], "generationConfig": { "temperature": $json.temperature || 0.3, "maxOutputTokens": $json.maxTokens || 16000 } } }}',
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
      jsCode: 'const text = $json.candidates?.[0]?.content?.parts?.[0]?.text;\nif (!text) throw new Error("no text from LLM: " + JSON.stringify($json).substring(0, 200));\nreturn { text };',
    },
  },
  output: [{ text: '' }],
});

export default workflow('EfSRIKhn13Bsybm0', 'Sub-LLM-Call')
  .add(whenCalled)
  .to(callLlmApi)
  .to(extractText);
