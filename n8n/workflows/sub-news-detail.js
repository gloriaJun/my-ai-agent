import { workflow, node, trigger, ifElse, switchCase, expr } from '@n8n/workflow-sdk';

// ── Error pipeline ─────────────────────────────────────────────────────────────

const subNormalizeError = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'SubNormalizeError',
    parameters: {
      jsCode: "const rawErr = $json.error ?? '';\nconst isString = typeof rawErr === 'string';\nconst cleanMsg = (s) => (s ?? '').replace(/\\s*\\[line \\d+\\]$/, '').trim();\nlet message;\nif (!isString) {\n  const axiosMsg = rawErr.message ?? '';\n  const match = axiosMsg.match(/^\\d+ - \"(.+)\"$/);\n  if (match) {\n    try { const inner = JSON.parse(match[1]); message = inner.message || cleanMsg(axiosMsg); }\n    catch { message = cleanMsg(axiosMsg); }\n  } else { message = cleanMsg(axiosMsg) || '처리 중 오류가 발생했습니다'; }\n} else { message = cleanMsg(rawErr) || '처리 중 오류가 발생했습니다'; }\nconst code = (!isString && Number(rawErr.httpCode ?? rawErr.status)) || 500;\nreturn { errorPayload: JSON.stringify({ error: { code, message, source: 'Sub-News-Detail' } }) };",
    },
    position: [2400, 736],
  },
  output: [{ errorPayload: '{"error":{"code":500,"message":"error","source":"Sub-News-Detail"}}' }],
});

const stopAndError = node({
  type: 'n8n-nodes-base.stopAndError',
  version: 1,
  config: {
    name: 'Stop and Error',
    parameters: {
      errorType: 'errorMessage',
      errorMessage: expr('{{ $json.errorPayload }}'),
    },
    position: [2624, 736],
  },
  output: [],
});

// ── Trigger & routing ──────────────────────────────────────────────────────────

const workflowTrigger = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.1,
  config: {
    name: 'When Executed by Another Workflow',
    parameters: { inputSource: 'passthrough' },
    position: [0, 288],
    onError: 'continueErrorOutput',
  },
  output: [{ payload: { action: 'article-summary', data: { url: 'https://example.com' } } }],
});

const dataNode = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Data',
    parameters: {
      jsCode: "const { action, data } = $json.payload;\nconst validActions = ['article-summary', 'comment-summary', 'search-summary'];\nif (!validActions.includes(action)) {\n  throw new Error('지원하지 않는 action: ' + action);\n}\nreturn { action, url: data?.url || '', query: data?.query || '', actionIndex: validActions.indexOf(action) };",
    },
    position: [224, 288],
    onError: 'continueErrorOutput',
  },
  output: [{ action: 'article-summary', url: 'https://example.com', query: '', actionIndex: 0 }],
});

const actionSwitch = switchCase({
  version: 3.4,
  config: {
    name: 'ActionSwitch',
    parameters: {
      mode: 'expression',
      numberOutputs: 3,
      output: expr('{{ $json.actionIndex }}'),
    },
    position: [448, 288],
  },
});

// ── Case 0: article-summary ────────────────────────────────────────────────────

const getArticleHtml = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Get Article HTML',
    parameters: {
      method: 'GET',
      url: expr("{{ $('Data').item.json.url }}"),
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [{ name: 'User-Agent', value: 'Mozilla/5.0 (compatible; n8n-bot/1.0)' }],
      },
      options: {
        response: {
          response: {
            fullResponse: true,
            neverError: true,
            responseFormat: 'text',
          },
        },
        timeout: 20000,
        redirect: { redirect: { followRedirects: true } },
      },
    },
    position: [672, 96],
    onError: 'continueErrorOutput',
  },
  output: [{ statusCode: 200, headers: {}, body: '<html>...</html>' }],
});

const processArticleHtml = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Process Article HTML',
    parameters: {
      jsCode: "if ($json.statusCode >= 400) throw new Error('HTTP ' + $json.statusCode + ': ' + $('Data').item.json.url);\nconst html = $json.body || '';\nconst text = html.replace(/<script[\\s\\S]*?<\\/script>/gi, '').replace(/<style[\\s\\S]*?<\\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim().substring(0, 15000);\nconst prompt = '다음 웹페이지 내용을 한국어로 요약해주세요. 아래 세 항목을 각각 반드시 한 줄 이상으로 작성하세요:\\n1. 핵심 내용: 이 기사가 다루는 주제와 주장\\n2. 주요 기술 포인트: 언급된 기술·방법론의 핵심\\n3. 실무 의의: 개발자 관점에서 왜 중요하고 어떻게 활용할 수 있는지\\n\\n본문:\\n' + text;\nreturn [{ json: { prompt, url: $('Data').item.json.url } }];",
    },
    position: [896, 96],
    onError: 'continueErrorOutput',
  },
  output: [{ prompt: '요약 프롬프트', url: 'https://example.com' }],
});

const callLlmArticle = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Call Sub-LLM-Call (Article)',
    parameters: {
      workflowId: { __rl: true, value: 'EfSRIKhn13Bsybm0', mode: 'id', cachedResultName: 'Sub-LLM-Call' },
      options: { waitForSubWorkflow: true },
    },
    position: [1120, 96],
    onError: 'continueErrorOutput',
  },
  output: [{ text: '요약 결과 텍스트' }],
});

const formatArticle = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Format Article',
    parameters: {
      jsCode: "const text = $json.text;\nconst url = $('Process Article HTML').item.json.url;\nreturn [{ json: { status: 'ok', summary: text, url } }];",
    },
    position: [1344, 96],
    onError: 'continueErrorOutput',
  },
  output: [{ status: 'ok', summary: '요약 텍스트', url: 'https://example.com' }],
});

// ── Case 1: comment-summary ────────────────────────────────────────────────────

const searchHnByUrl = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Search HN by URL',
    parameters: {
      method: 'GET',
      url: 'https://hn.algolia.com/api/v1/search',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          { name: 'query', value: expr("{{ $('Data').item.json.url }}") },
          { name: 'restrictSearchableAttributes', value: 'url' },
          { name: 'tags', value: 'story' },
          { name: 'hitsPerPage', value: '1' },
        ],
      },
      options: {
        response: { response: { responseFormat: 'json' } },
      },
    },
    position: [672, 384],
    onError: 'continueErrorOutput',
  },
  output: [{ hits: [{ objectID: '12345' }] }],
});

const resolveHnId = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Resolve HN ID',
    parameters: {
      jsCode: "const url = $('Data').item.json.url;\nconst hnItemMatch = url.match(/news\\.ycombinator\\.com\\/item\\?id=(\\d+)/);\nconst hnId = hnItemMatch ? hnItemMatch[1] : ($json.hits?.[0]?.objectID || null);\nreturn [{ json: { hnId, url } }];",
    },
    position: [896, 384],
    onError: 'continueErrorOutput',
  },
  output: [{ hnId: '12345', url: 'https://example.com' }],
});

const hasHnIdCheck = ifElse({
  version: 2.3,
  config: {
    name: 'Has HN ID?',
    parameters: {
      conditions: {
        combinator: 'and',
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 1 },
        conditions: [
          {
            id: 'check-hn-id',
            leftValue: expr('{{ $json.hnId }}'),
            operator: { type: 'string', operation: 'notEmpty' },
            rightValue: '',
          },
        ],
      },
      looseTypeValidation: true,
    },
    position: [1120, 384],
  },
});

const returnNoComments = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Return No Comments',
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode: "return { status: 'ok', summary: '이 기사에 대한 Hacker News 댓글을 찾을 수 없습니다.', url: $json.url };",
    },
    position: [1344, 576],
  },
  output: [{ status: 'ok', summary: '댓글 없음', url: 'https://example.com' }],
});

const fetchHnItems = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Fetch HN Items',
    parameters: {
      method: 'GET',
      url: expr("https://hn.algolia.com/api/v1/items/{{ $json.hnId }}"),
      options: {
        response: { response: { responseFormat: 'json' } },
      },
    },
    position: [1344, 288],
    onError: 'continueErrorOutput',
  },
  output: [{ id: '12345', children: [] }],
});

const buildCommentPrompt = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Comment Prompt',
    parameters: {
      jsCode: "const url = $('Resolve HN ID').item.json.url;\nconst extractComments = (children, depth) => {\n  if (!children || depth > 3) return [];\n  return children.flatMap(c => {\n    const text = (c.text || '').replace(/<[^>]+>/g, ' ').trim();\n    return text ? [text, ...extractComments(c.children, depth + 1)] : extractComments(c.children, depth + 1);\n  });\n};\nconst allComments = extractComments($json.children || [], 0);\nif (!allComments.length) {\n  return [{ json: { status: 'ok', summary: '아직 댓글이 없거나 불러올 수 없습니다.', url } }];\n}\nconst commentsText = allComments.slice(0, 50).join('\\n---\\n');\nconst prompt = '다음은 Hacker News 댓글들입니다. 아래 세 항목을 각각 반드시 한 줄 이상으로 작성하세요:\\n1. 전반적 분위기: 커뮤니티 반응이 긍정·부정·혼재 중 어떤지\\n2. 주요 의견: 가장 많이 언급되거나 공감받은 관점\\n3. 논쟁 포인트: 의견이 갈리는 부분이나 특이한 시각\\n\\n댓글:\\n' + commentsText;\nreturn [{ json: { prompt, url } }];",
    },
    position: [1568, 288],
    onError: 'continueErrorOutput',
  },
  output: [{ prompt: '댓글 요약 프롬프트', url: 'https://example.com' }],
});

const checkHasPromptComment = ifElse({
  version: 2.3,
  config: {
    name: 'Check Has Prompt',
    parameters: {
      conditions: {
        combinator: 'and',
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 1 },
        conditions: [
          {
            id: 'check-prompt',
            leftValue: expr('{{ $json.prompt }}'),
            operator: { type: 'string', operation: 'notEmpty' },
            rightValue: '',
          },
        ],
      },
      looseTypeValidation: true,
    },
    position: [1792, 288],
  },
});

const callLlmComment = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Call Sub-LLM-Call (Comment)',
    parameters: {
      workflowId: { __rl: true, value: 'EfSRIKhn13Bsybm0', mode: 'id', cachedResultName: 'Sub-LLM-Call' },
      options: { waitForSubWorkflow: true },
    },
    position: [2016, 192],
    onError: 'continueErrorOutput',
  },
  output: [{ text: 'LLM 결과' }],
});

const formatCommentLlm = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Format Comment LLM',
    parameters: {
      jsCode: "const text = $json.text;\nconst url = $('Build Comment Prompt').item.json.url;\nreturn [{ json: { status: 'ok', summary: text, url } }];",
    },
    position: [2240, 192],
    onError: 'continueErrorOutput',
  },
  output: [{ status: 'ok', summary: 'LLM 요약', url: 'https://example.com' }],
});

const passCommentResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Pass Comment Result',
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode: "return { status: $json.status, summary: $json.summary, url: $json.url };",
    },
    position: [2016, 384],
  },
  output: [{ status: 'ok', summary: '결과', url: 'https://example.com' }],
});

// ── Case 2: search-summary ─────────────────────────────────────────────────────

const braveNewsSearch = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Brave News Search',
    parameters: {
      method: 'GET',
      url: 'https://api.search.brave.com/res/v1/news/search',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          { name: 'q', value: expr("{{ $('Data').item.json.query }}") },
          { name: 'count', value: '5' },
        ],
      },
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [
          { name: 'X-Subscription-Token', value: expr('{{ $env.BRAVE_API_KEY }}') },
          { name: 'Accept', value: 'application/json' },
        ],
      },
      options: {
        response: { response: { responseFormat: 'json' } },
      },
    },
    position: [672, 768],
    onError: 'continueErrorOutput',
  },
  output: [{ results: [] }],
});

const processSearchResults = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Process Search Results',
    parameters: {
      jsCode: "const query = $('Data').item.json.query;\nif (!query) throw new Error('검색어가 없습니다');\nconst results = $json.results || [];\nif (!results.length) {\n  return [{ json: { status: 'ok', summary: '\"' + query + '\"에 대한 관련 뉴스를 찾을 수 없습니다.', query } }];\n}\nconst nl = String.fromCharCode(10);\nconst articleList = results.map((r, i) => (i + 1) + '. ' + (r.title || '') + nl + 'URL: ' + (r.url || '') + nl + '요약: ' + (r.description || '')).join(nl + nl);\nconst prompt = '다음 뉴스 검색 결과를 한국어로 종합 요약해주세요.' + nl + '검색어: ' + query + nl + nl + '규칙:' + nl + '- 전체 흐름과 주요 포인트를 종합적으로 정리' + nl + '- 중요한 기사는 제목과 URL을 포함' + nl + '- 최신 동향을 파악할 수 있도록 작성' + nl + nl + '검색 결과:' + nl + articleList;\nreturn [{ json: { prompt, query } }];",
    },
    position: [896, 768],
    onError: 'continueErrorOutput',
  },
  output: [{ prompt: '검색 결과 프롬프트', query: '검색어' }],
});

const checkHasSearchPrompt = ifElse({
  version: 2.3,
  config: {
    name: 'Check Has Search Prompt',
    parameters: {
      conditions: {
        combinator: 'and',
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 1 },
        conditions: [
          {
            id: 'check-search-prompt',
            leftValue: expr('{{ $json.prompt }}'),
            operator: { type: 'string', operation: 'notEmpty' },
            rightValue: '',
          },
        ],
      },
      looseTypeValidation: true,
    },
    position: [1120, 768],
  },
});

const callLlmSearch = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Call Sub-LLM-Call (Search)',
    parameters: {
      workflowId: { __rl: true, value: 'EfSRIKhn13Bsybm0', mode: 'id', cachedResultName: 'Sub-LLM-Call' },
      options: { waitForSubWorkflow: true },
    },
    position: [1344, 672],
    onError: 'continueErrorOutput',
  },
  output: [{ text: 'LLM 결과' }],
});

const formatSearchLlm = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Format Search LLM',
    parameters: {
      jsCode: "const text = $json.text;\nconst query = $('Process Search Results').item.json.query;\nreturn [{ json: { status: 'ok', summary: text, query } }];",
    },
    position: [1568, 672],
    onError: 'continueErrorOutput',
  },
  output: [{ status: 'ok', summary: 'LLM 요약', query: '검색어' }],
});

const passSearchResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Pass Search Result',
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode: "return { status: $json.status, summary: $json.summary };",
    },
    position: [1344, 864],
  },
  output: [{ status: 'ok', summary: '결과 없음' }],
});

// ── Error connections (must be before export default) ──────────────────────────

workflowTrigger.output(1).to(subNormalizeError);
dataNode.output(1).to(subNormalizeError);
getArticleHtml.output(1).to(subNormalizeError);
processArticleHtml.output(1).to(subNormalizeError);
callLlmArticle.output(1).to(subNormalizeError);
formatArticle.output(1).to(subNormalizeError);
searchHnByUrl.output(1).to(subNormalizeError);
resolveHnId.output(1).to(subNormalizeError);
fetchHnItems.output(1).to(subNormalizeError);
buildCommentPrompt.output(1).to(subNormalizeError);
callLlmComment.output(1).to(subNormalizeError);
formatCommentLlm.output(1).to(subNormalizeError);
braveNewsSearch.output(1).to(subNormalizeError);
processSearchResults.output(1).to(subNormalizeError);
callLlmSearch.output(1).to(subNormalizeError);
subNormalizeError.to(stopAndError);

// ── Workflow composition ───────────────────────────────────────────────────────

export default workflow('gTdZIsWomHdCCcSE', 'Sub-News-Detail')
  .add(workflowTrigger)
  .to(dataNode)
  .to(actionSwitch
    .onCase(0,
      getArticleHtml
        .to(processArticleHtml)
        .to(callLlmArticle)
        .to(formatArticle)
    )
    .onCase(1,
      searchHnByUrl
        .to(resolveHnId)
        .to(hasHnIdCheck
          .onTrue(
            fetchHnItems
              .to(buildCommentPrompt)
              .to(checkHasPromptComment
                .onTrue(callLlmComment.to(formatCommentLlm))
                .onFalse(passCommentResult)
              )
          )
          .onFalse(returnNoComments)
        )
    )
    .onCase(2,
      braveNewsSearch
        .to(processSearchResults)
        .to(checkHasSearchPrompt
          .onTrue(callLlmSearch.to(formatSearchLlm))
          .onFalse(passSearchResult)
        )
    )
  );
