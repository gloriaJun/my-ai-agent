import { workflow, node, trigger, switchCase, expr } from '@n8n/workflow-sdk';

// ── Node definitions ────────────────────────────────────────────────────────

const webhookNode = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Webhook',
    parameters: { httpMethod: 'POST', path: 'my-ai-agent', responseMode: 'responseNode', options: {} },
    position: [0, 384]
  },
  output: [{ query: {}, body: {} }]
});

const modeFilter = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'ModeFilter',
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode: 'const { type, mode, action } = $json.query;const data = $json.body;const routeMap = { "booking": { "school": 0 }, "news": { "detail": 1 }, "youtube": { "summary": 2, "channel": 4 }, "shopping": { "monitor": 3 } };if (!type || !routeMap[type]) { throw new Error("유효하지 않은 type입니다: " + type); }if (!mode || routeMap[type][mode] === undefined) { throw new Error("유효하지 않은 mode입니다: type=" + type + ", mode=" + mode); }return { outputIndex: routeMap[type][mode], payload: { action, data } };'
    },
    onError: 'continueErrorOutput',
    position: [224, 384]
  },
  output: [{ outputIndex: 0, payload: {} }]
});

const callReactStart = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'CallReactStart',
    parameters: {
      workflowId: { __rl: true, value: '1S2oZuGP1oVNpL5S', mode: 'id' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          channel_id: expr("={{ $('Webhook').first().json.body.channel_id }}"),
          message_ts: expr("={{ $('Webhook').first().json.body.message_ts }}"),
          phase: 'start'
        },
        schema: [
          { id: 'channel_id', displayName: 'channel_id', type: 'string', required: false, defaultMatch: false, canBeUsedToMatch: true, display: true },
          { id: 'message_ts', displayName: 'message_ts', type: 'string', required: false, defaultMatch: false, canBeUsedToMatch: true, display: true },
          { id: 'phase', displayName: 'phase', type: 'string', required: false, defaultMatch: false, canBeUsedToMatch: true, display: true }
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true
      },
      options: { waitForSubWorkflow: false }
    },
    onError: 'continueRegularOutput',
    position: [448, 384]
  },
  output: [{}]
});

const routeMap = switchCase({
  version: 3.2,
  config: {
    name: 'RouteMap',
    parameters: { mode: 'expression', numberOutputs: 5, output: expr('={{ $json.outputIndex }}') },
    onError: 'continueErrorOutput',
    position: [672, 336]
  }
});

const callSubBooking = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: "Call 'Sub-Booking-School'",
    parameters: {
      workflowId: { __rl: true, value: 'QLMIyUrcTz7qt8JF', mode: 'id' },
      workflowInputs: { mappingMode: 'defineBelow', value: {}, matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: true },
      options: { waitForSubWorkflow: true }
    },
    onError: 'continueErrorOutput',
    position: [896, 0]
  },
  output: [{}]
});

const callSubNews = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: "Call 'Sub-News-Detail'",
    parameters: {
      workflowId: { __rl: true, value: 'gTdZIsWomHdCCcSE', mode: 'id' },
      workflowInputs: { mappingMode: 'defineBelow', value: {}, matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: true },
      options: { waitForSubWorkflow: true }
    },
    onError: 'continueErrorOutput',
    position: [896, 192]
  },
  output: [{}]
});

const callSubYoutubeSummary = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: "Call 'Sub-YouTube-Summary'",
    parameters: {
      workflowId: { __rl: true, value: 'lu0n2WwF6p9HDLw2', mode: 'id' },
      workflowInputs: { mappingMode: 'defineBelow', value: {}, matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: true },
      options: { waitForSubWorkflow: true }
    },
    onError: 'continueErrorOutput',
    position: [896, 384]
  },
  output: [{}]
});

const callSubShopping = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: "Call 'Sub-Shopping-Monitor'",
    parameters: {
      workflowId: { __rl: true, value: 'TR3KSEeFVtCskYon', mode: 'id' },
      workflowInputs: { mappingMode: 'defineBelow', value: {}, matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: true },
      options: { waitForSubWorkflow: true }
    },
    onError: 'continueErrorOutput',
    position: [896, 576]
  },
  output: [{}]
});

const callSubYoutubeChannel = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: "Call 'Sub-YouTube-Channel'",
    parameters: {
      workflowId: { __rl: true, value: 'rtfZH556AbXU6mVZ', mode: 'id' },
      workflowInputs: { mappingMode: 'defineBelow', value: {}, matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: true },
      options: { waitForSubWorkflow: true }
    },
    onError: 'continueErrorOutput',
    position: [896, 768]
  },
  output: [{}]
});

const successResponse = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'SuccessResponse',
    parameters: { respondWith: 'allIncomingItems', options: { responseCode: 200, enableStreaming: true } },
    position: [1120, 384]
  },
  output: [{}]
});

const callReactSuccess = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'CallReactSuccess',
    parameters: {
      workflowId: { __rl: true, value: '1S2oZuGP1oVNpL5S', mode: 'id' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          channel_id: expr("={{ $('Webhook').first().json.body.channel_id }}"),
          message_ts: expr("={{ $('Webhook').first().json.body.message_ts }}"),
          phase: 'success'
        },
        schema: [
          { id: 'channel_id', displayName: 'channel_id', type: 'string', required: false, defaultMatch: false, canBeUsedToMatch: true, display: true },
          { id: 'message_ts', displayName: 'message_ts', type: 'string', required: false, defaultMatch: false, canBeUsedToMatch: true, display: true },
          { id: 'phase', displayName: 'phase', type: 'string', required: false, defaultMatch: false, canBeUsedToMatch: true, display: true }
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true
      },
      options: { waitForSubWorkflow: false }
    },
    onError: 'continueRegularOutput',
    position: [1344, 384]
  },
  output: [{}]
});

const normalizeError = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'NormalizeError',
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode: "const rawErr = $json.error ?? '';const isString = typeof rawErr === 'string';const cleanMsg = (s) => (s ?? '').replace(/\\s*\\[line \\d+\\]$/, '').trim();let message, code, source;if ($json.query !== undefined) { const { type, mode } = $json.query; if (!type) message = 'type 파라미터가 필요합니다'; else if (!mode) message = 'mode 파라미터가 필요합니다'; else message = 'support error'; code = 400; source = 'ModeFilter';} else { const rawString = isString ? cleanMsg(rawErr) : cleanMsg(rawErr.message); let parsed = null; try { parsed = JSON.parse(rawString); } catch {} if (parsed?.error) { message = parsed.error.message || '처리 중 오류가 발생했습니다'; code = parsed.error.code || 500; source = parsed.error.source || 'sub-workflow'; } else { message = rawString || '처리 중 오류가 발생했습니다'; code = 500; source = 'sub-workflow'; } }return { success: false, error: { code, message, source } };"
    },
    position: [48, 992]
  },
  output: [{ success: false, error: { code: 500, message: '오류', source: 'sub-workflow' } }]
});

const errorResponse = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'ErrorResponse',
    parameters: {
      respondWith: 'json',
      responseBody: expr('={{ JSON.stringify($json) }}'),
      options: { responseCode: expr('={{ $json.error?.code >= 500 ? 500 : 400 }}'), enableStreaming: true }
    },
    position: [224, 992]
  },
  output: [{}]
});

const callReactFailure = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'CallReactFailure',
    parameters: {
      workflowId: { __rl: true, value: '1S2oZuGP1oVNpL5S', mode: 'id' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          channel_id: expr("={{ $('Webhook').first().json.body.channel_id }}"),
          message_ts: expr("={{ $('Webhook').first().json.body.message_ts }}"),
          phase: 'failure'
        },
        schema: [
          { id: 'channel_id', displayName: 'channel_id', type: 'string', required: false, defaultMatch: false, canBeUsedToMatch: true, display: true },
          { id: 'message_ts', displayName: 'message_ts', type: 'string', required: false, defaultMatch: false, canBeUsedToMatch: true, display: true },
          { id: 'phase', displayName: 'phase', type: 'string', required: false, defaultMatch: false, canBeUsedToMatch: true, display: true }
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true
      },
      options: { waitForSubWorkflow: false }
    },
    onError: 'continueRegularOutput',
    position: [448, 992]
  },
  output: [{}]
});

// ── Error path connections ──────────────────────────────────────────────────
// CRITICAL: Nodes with onError:'continueErrorOutput' must have .output(1).to(normalizeError)
// declared here as side effects BEFORE export default.
// update_workflow replaces the entire workflow — omitting these loses the connections.
modeFilter.output(1).to(normalizeError);
routeMap.output(1).to(normalizeError);
callSubBooking.output(1).to(normalizeError);
callSubNews.output(1).to(normalizeError);
callSubYoutubeSummary.output(1).to(normalizeError);
callSubShopping.output(1).to(normalizeError);
callSubYoutubeChannel.output(1).to(normalizeError);

// ── Success path fan-in ─────────────────────────────────────────────────────
successResponse.to(callReactSuccess);

export default workflow('aKIZYBnzbB0ZpTMC', 'My-AI-Agent')
  .add(webhookNode)
  .to(modeFilter)
  .to(callReactStart)
  .to(routeMap
    .onCase(0, callSubBooking.to(successResponse))
    .onCase(1, callSubNews.to(successResponse))
    .onCase(2, callSubYoutubeSummary.to(successResponse))
    .onCase(3, callSubShopping.to(successResponse))
    .onCase(4, callSubYoutubeChannel.to(successResponse)))
  .add(normalizeError)
  .to(errorResponse)
  .to(callReactFailure);
