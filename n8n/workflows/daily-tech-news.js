import { workflow, node, trigger, merge, ifElse, expr } from '@n8n/workflow-sdk';

const dailyTrigger = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.1,
  config: {
    name: 'Daily 09:00',
    parameters: {"rule":{"interval":[{"triggerAtHour":9}]}},
    position: [0,992]
  },
  output: [{}]
});

const fetchGeekNews = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: "Fetch GeekNews",
    parameters: {"url":"https://feeds.feedburner.com/geeknews-feed","options":{"response":{"response":{"responseFormat":"text"}},"timeout":15000}},
    position: [224,0]
  },
  output: [{ data: '<raw feed text>' }]
});

const parseGeekNews = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: "Parse GeekNews",
    parameters: { jsCode: "const SOURCE=\"GeekNews\";const MAX=15;if(items[0]&&items[0].json.error){return[{json:{_fetchError:true,source:SOURCE,message:String(items[0].json.error)}}];}const data=items[0]&&items[0].json.data;if(!data){return[{json:{_fetchError:true,source:SOURCE,message:\"empty response\"}}];}function getText(b,tag){const cdata=\"<\"+tag+\"><![CDATA[\";const ci=b.indexOf(cdata);if(ci>=0){const cs=ci+cdata.length;const ce=b.indexOf(\"]]></\"+tag+\">\",cs);if(ce>=0)return b.substring(cs,ce).trim();}const oi=b.indexOf(\"<\"+tag+\">\");if(oi>=0){const os=oi+tag.length+2;const oe=b.indexOf(\"</\"+tag+\">\",os);if(oe>=0)return b.substring(os,oe).trim();}return \"\";}function parseAtom(xml,src,max){const result=[];const blocks=xml.split(\"</entry>\").slice(0,-1);for(let i=0;i<blocks.length&&result.length<max;i++){const s=blocks[i].lastIndexOf(\"<entry\");if(s<0)continue;const b=blocks[i].substring(s);let url=\"\";const hi=b.indexOf('href=\"');if(hi>=0){const hs=hi+6;const he=b.indexOf('\"',hs);if(he>=0)url=b.substring(hs,he);}if(!url)url=getText(b,\"id\");const title=getText(b,\"title\");if(!title||!url)continue;const snip=(getText(b,\"summary\")||getText(b,\"content\")||\"\").substring(0,300);result.push({json:{title:title,url:url,source:src,date:getText(b,\"updated\")||getText(b,\"published\"),snippet:snip}});}return result;}const parsed=parseAtom(data,SOURCE,MAX);if(parsed.length===0){return[{json:{_fetchError:true,source:SOURCE,message:\"parsed item count: 0\"}}];}return parsed;" },
    position: [448,0]
  },
  output: [{ source: 'X', title: 'T', url: 'https://example.com', snippet: '', date: '2026-07-21T00:00:00.000Z' }]
});

const fetchHackerNews = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: "Fetch HackerNews",
    parameters: {"url":"https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=50","options":{"response":{"response":{"responseFormat":"text"}},"timeout":15000}},
    position: [224,192]
  },
  output: [{ data: '<raw feed text>' }]
});

const parseHackerNews = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: "Parse HackerNews",
    parameters: { jsCode: "const SOURCE=\"HackerNews\";if(items[0]&&items[0].json.error){return[{json:{_fetchError:true,source:SOURCE,message:String(items[0].json.error)}}];}const data=items[0]&&items[0].json.data;if(!data){return[{json:{_fetchError:true,source:SOURCE,message:\"empty response\"}}];}let parsed;try{parsed=JSON.parse(data);}catch(e){return[{json:{_fetchError:true,source:SOURCE,message:\"JSON parse: \"+e.message}}];}const hits=(parsed.hits||[]).filter(function(h){return(h.points||0)>=10;}).slice(0,15);if(hits.length===0){return[{json:{_fetchError:true,source:SOURCE,message:\"points>=10 기사 없음\"}}];}return hits.map(function(h){return{json:{title:h.title||\"\",url:h.url||(\"https://news.ycombinator.com/item?id=\"+h.objectID),source:SOURCE,date:h.created_at||\"\",snippet:(h.story_text||\"\").substring(0,300),points:h.points||0}};});" },
    position: [448,192]
  },
  output: [{ source: 'X', title: 'T', url: 'https://example.com', snippet: '', date: '2026-07-21T00:00:00.000Z' }]
});

const fetchDevtoJs = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: "Fetch dev.to/javascript",
    parameters: {"url":"https://dev.to/feed/tag/javascript","options":{"response":{"response":{"responseFormat":"text"}},"timeout":15000}},
    position: [224,384]
  },
  output: [{ data: '<raw feed text>' }]
});

const parseDevtoJs = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: "Parse dev.to/javascript",
    parameters: { jsCode: "const SOURCE=\"dev.to/javascript\";const MAX=5;if(items[0]&&items[0].json.error){return[{json:{_fetchError:true,source:SOURCE,message:String(items[0].json.error)}}];}const data=items[0]&&items[0].json.data;if(!data){return[{json:{_fetchError:true,source:SOURCE,message:\"empty response\"}}];}function getText(b,tag){const cdata=\"<\"+tag+\"><![CDATA[\";const ci=b.indexOf(cdata);if(ci>=0){const cs=ci+cdata.length;const ce=b.indexOf(\"]]></\"+tag+\">\",cs);if(ce>=0)return b.substring(cs,ce).trim();}const oi=b.indexOf(\"<\"+tag+\">\");if(oi>=0){const os=oi+tag.length+2;const oe=b.indexOf(\"</\"+tag+\">\",os);if(oe>=0)return b.substring(os,oe).trim();}return \"\";}function parseRss(xml,src,max){const result=[];const blocks=xml.split(\"</item>\").slice(0,-1);for(let i=0;i<blocks.length&&result.length<max;i++){const s=blocks[i].lastIndexOf(\"<item\");if(s<0)continue;const b=blocks[i].substring(s);const title=getText(b,\"title\");const url=getText(b,\"link\");if(!title||!url)continue;result.push({json:{title:title,url:url,source:src,date:getText(b,\"pubDate\"),snippet:getText(b,\"description\").substring(0,300)}});}return result;}const parsed=parseRss(data,SOURCE,MAX);if(parsed.length===0){return[{json:{_fetchError:true,source:SOURCE,message:\"parsed item count: 0\"}}];}return parsed;" },
    position: [448,384]
  },
  output: [{ source: 'X', title: 'T', url: 'https://example.com', snippet: '', date: '2026-07-21T00:00:00.000Z' }]
});

const fetchDevtoTs = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: "Fetch dev.to/typescript",
    parameters: {"url":"https://dev.to/feed/tag/typescript","options":{"response":{"response":{"responseFormat":"text"}},"timeout":15000}},
    position: [224,576]
  },
  output: [{ data: '<raw feed text>' }]
});

const parseDevtoTs = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: "Parse dev.to/typescript",
    parameters: { jsCode: "const SOURCE=\"dev.to/typescript\";const MAX=5;if(items[0]&&items[0].json.error){return[{json:{_fetchError:true,source:SOURCE,message:String(items[0].json.error)}}];}const data=items[0]&&items[0].json.data;if(!data){return[{json:{_fetchError:true,source:SOURCE,message:\"empty response\"}}];}function getText(b,tag){const cdata=\"<\"+tag+\"><![CDATA[\";const ci=b.indexOf(cdata);if(ci>=0){const cs=ci+cdata.length;const ce=b.indexOf(\"]]></\"+tag+\">\",cs);if(ce>=0)return b.substring(cs,ce).trim();}const oi=b.indexOf(\"<\"+tag+\">\");if(oi>=0){const os=oi+tag.length+2;const oe=b.indexOf(\"</\"+tag+\">\",os);if(oe>=0)return b.substring(os,oe).trim();}return \"\";}function parseRss(xml,src,max){const result=[];const blocks=xml.split(\"</item>\").slice(0,-1);for(let i=0;i<blocks.length&&result.length<max;i++){const s=blocks[i].lastIndexOf(\"<item\");if(s<0)continue;const b=blocks[i].substring(s);const title=getText(b,\"title\");const url=getText(b,\"link\");if(!title||!url)continue;result.push({json:{title:title,url:url,source:src,date:getText(b,\"pubDate\"),snippet:getText(b,\"description\").substring(0,300)}});}return result;}const parsed=parseRss(data,SOURCE,MAX);if(parsed.length===0){return[{json:{_fetchError:true,source:SOURCE,message:\"parsed item count: 0\"}}];}return parsed;" },
    position: [448,576]
  },
  output: [{ source: 'X', title: 'T', url: 'https://example.com', snippet: '', date: '2026-07-21T00:00:00.000Z' }]
});

const fetchDevtoReact = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: "Fetch dev.to/react",
    parameters: {"url":"https://dev.to/feed/tag/react","options":{"response":{"response":{"responseFormat":"text"}},"timeout":15000}},
    position: [224,768]
  },
  output: [{ data: '<raw feed text>' }]
});

const parseDevtoReact = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: "Parse dev.to/react",
    parameters: { jsCode: "const SOURCE=\"dev.to/react\";const MAX=5;if(items[0]&&items[0].json.error){return[{json:{_fetchError:true,source:SOURCE,message:String(items[0].json.error)}}];}const data=items[0]&&items[0].json.data;if(!data){return[{json:{_fetchError:true,source:SOURCE,message:\"empty response\"}}];}function getText(b,tag){const cdata=\"<\"+tag+\"><![CDATA[\";const ci=b.indexOf(cdata);if(ci>=0){const cs=ci+cdata.length;const ce=b.indexOf(\"]]></\"+tag+\">\",cs);if(ce>=0)return b.substring(cs,ce).trim();}const oi=b.indexOf(\"<\"+tag+\">\");if(oi>=0){const os=oi+tag.length+2;const oe=b.indexOf(\"</\"+tag+\">\",os);if(oe>=0)return b.substring(os,oe).trim();}return \"\";}function parseRss(xml,src,max){const result=[];const blocks=xml.split(\"</item>\").slice(0,-1);for(let i=0;i<blocks.length&&result.length<max;i++){const s=blocks[i].lastIndexOf(\"<item\");if(s<0)continue;const b=blocks[i].substring(s);const title=getText(b,\"title\");const url=getText(b,\"link\");if(!title||!url)continue;result.push({json:{title:title,url:url,source:src,date:getText(b,\"pubDate\"),snippet:getText(b,\"description\").substring(0,300)}});}return result;}const parsed=parseRss(data,SOURCE,MAX);if(parsed.length===0){return[{json:{_fetchError:true,source:SOURCE,message:\"parsed item count: 0\"}}];}return parsed;" },
    position: [448,768]
  },
  output: [{ source: 'X', title: 'T', url: 'https://example.com', snippet: '', date: '2026-07-21T00:00:00.000Z' }]
});

const fetchDevtoAi = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: "Fetch dev.to/ai",
    parameters: {"url":"https://dev.to/feed/tag/ai","options":{"response":{"response":{"responseFormat":"text"}},"timeout":15000}},
    position: [224,960]
  },
  output: [{ data: '<raw feed text>' }]
});

const parseDevtoAi = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: "Parse dev.to/ai",
    parameters: { jsCode: "const SOURCE=\"dev.to/ai\";const MAX=5;if(items[0]&&items[0].json.error){return[{json:{_fetchError:true,source:SOURCE,message:String(items[0].json.error)}}];}const data=items[0]&&items[0].json.data;if(!data){return[{json:{_fetchError:true,source:SOURCE,message:\"empty response\"}}];}function getText(b,tag){const cdata=\"<\"+tag+\"><![CDATA[\";const ci=b.indexOf(cdata);if(ci>=0){const cs=ci+cdata.length;const ce=b.indexOf(\"]]></\"+tag+\">\",cs);if(ce>=0)return b.substring(cs,ce).trim();}const oi=b.indexOf(\"<\"+tag+\">\");if(oi>=0){const os=oi+tag.length+2;const oe=b.indexOf(\"</\"+tag+\">\",os);if(oe>=0)return b.substring(os,oe).trim();}return \"\";}function parseRss(xml,src,max){const result=[];const blocks=xml.split(\"</item>\").slice(0,-1);for(let i=0;i<blocks.length&&result.length<max;i++){const s=blocks[i].lastIndexOf(\"<item\");if(s<0)continue;const b=blocks[i].substring(s);const title=getText(b,\"title\");const url=getText(b,\"link\");if(!title||!url)continue;result.push({json:{title:title,url:url,source:src,date:getText(b,\"pubDate\"),snippet:getText(b,\"description\").substring(0,300)}});}return result;}const parsed=parseRss(data,SOURCE,MAX);if(parsed.length===0){return[{json:{_fetchError:true,source:SOURCE,message:\"parsed item count: 0\"}}];}return parsed;" },
    position: [448,960]
  },
  output: [{ source: 'X', title: 'T', url: 'https://example.com', snippet: '', date: '2026-07-21T00:00:00.000Z' }]
});

const fetchWebDev = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: "Fetch web.dev",
    parameters: {"url":"https://web.dev/feed.xml","options":{"response":{"response":{"responseFormat":"text"}},"timeout":15000}},
    position: [224,1152]
  },
  output: [{ data: '<raw feed text>' }]
});

const parseWebDev = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: "Parse web.dev",
    parameters: { jsCode: "const SOURCE=\"web.dev\";const MAX=5;if(items[0]&&items[0].json.error){return[{json:{_fetchError:true,source:SOURCE,message:String(items[0].json.error)}}];}const data=items[0]&&items[0].json.data;if(!data){return[{json:{_fetchError:true,source:SOURCE,message:\"empty response\"}}];}function getText(b,tag){const cdata=\"<\"+tag+\"><![CDATA[\";const ci=b.indexOf(cdata);if(ci>=0){const cs=ci+cdata.length;const ce=b.indexOf(\"]]></\"+tag+\">\",cs);if(ce>=0)return b.substring(cs,ce).trim();}const oi=b.indexOf(\"<\"+tag+\">\");if(oi>=0){const os=oi+tag.length+2;const oe=b.indexOf(\"</\"+tag+\">\",os);if(oe>=0)return b.substring(os,oe).trim();}return \"\";}function parseRss(xml,src,max){const result=[];const blocks=xml.split(\"</item>\").slice(0,-1);for(let i=0;i<blocks.length&&result.length<max;i++){const s=blocks[i].lastIndexOf(\"<item\");if(s<0)continue;const b=blocks[i].substring(s);const title=getText(b,\"title\");const url=getText(b,\"link\");if(!title||!url)continue;result.push({json:{title:title,url:url,source:src,date:getText(b,\"pubDate\"),snippet:getText(b,\"description\").substring(0,300)}});}return result;}const parsed=parseRss(data,SOURCE,MAX);if(parsed.length===0){return[{json:{_fetchError:true,source:SOURCE,message:\"parsed item count: 0\"}}];}return parsed;" },
    position: [448,1152]
  },
  output: [{ source: 'X', title: 'T', url: 'https://example.com', snippet: '', date: '2026-07-21T00:00:00.000Z' }]
});

const fetchSmashing = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: "Fetch Smashing Magazine",
    parameters: {"url":"https://www.smashingmagazine.com/feed/","options":{"response":{"response":{"responseFormat":"text"}},"timeout":15000}},
    position: [224,1344]
  },
  output: [{ data: '<raw feed text>' }]
});

const parseSmashing = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: "Parse Smashing Magazine",
    parameters: { jsCode: "const SOURCE=\"SmashingMagazine\";const MAX=5;if(items[0]&&items[0].json.error){return[{json:{_fetchError:true,source:SOURCE,message:String(items[0].json.error)}}];}const data=items[0]&&items[0].json.data;if(!data){return[{json:{_fetchError:true,source:SOURCE,message:\"empty response\"}}];}function getText(b,tag){const cdata=\"<\"+tag+\"><![CDATA[\";const ci=b.indexOf(cdata);if(ci>=0){const cs=ci+cdata.length;const ce=b.indexOf(\"]]></\"+tag+\">\",cs);if(ce>=0)return b.substring(cs,ce).trim();}const oi=b.indexOf(\"<\"+tag+\">\");if(oi>=0){const os=oi+tag.length+2;const oe=b.indexOf(\"</\"+tag+\">\",os);if(oe>=0)return b.substring(os,oe).trim();}return \"\";}function parseRss(xml,src,max){const result=[];const blocks=xml.split(\"</item>\").slice(0,-1);for(let i=0;i<blocks.length&&result.length<max;i++){const s=blocks[i].lastIndexOf(\"<item\");if(s<0)continue;const b=blocks[i].substring(s);const title=getText(b,\"title\");const url=getText(b,\"link\");if(!title||!url)continue;result.push({json:{title:title,url:url,source:src,date:getText(b,\"pubDate\"),snippet:getText(b,\"description\").substring(0,300)}});}return result;}const parsed=parseRss(data,SOURCE,MAX);if(parsed.length===0){return[{json:{_fetchError:true,source:SOURCE,message:\"parsed item count: 0\"}}];}return parsed;" },
    position: [448,1344]
  },
  output: [{ source: 'X', title: 'T', url: 'https://example.com', snippet: '', date: '2026-07-21T00:00:00.000Z' }]
});

const fetchLobsters = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: "Fetch Lobsters",
    parameters: {"url":"https://lobste.rs/rss","options":{"response":{"response":{"responseFormat":"text"}},"timeout":15000}},
    position: [224,1536]
  },
  output: [{ data: '<raw feed text>' }]
});

const parseLobsters = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: "Parse Lobsters",
    parameters: { jsCode: "const SOURCE=\"Lobsters\";const MAX=15;if(items[0]&&items[0].json.error){return[{json:{_fetchError:true,source:SOURCE,message:String(items[0].json.error)}}];}const data=items[0]&&items[0].json.data;if(!data){return[{json:{_fetchError:true,source:SOURCE,message:\"empty response\"}}];}function getText(b,tag){const cdata=\"<\"+tag+\"><![CDATA[\";const ci=b.indexOf(cdata);if(ci>=0){const cs=ci+cdata.length;const ce=b.indexOf(\"]]></\"+tag+\">\",cs);if(ce>=0)return b.substring(cs,ce).trim();}const oi=b.indexOf(\"<\"+tag+\">\");if(oi>=0){const os=oi+tag.length+2;const oe=b.indexOf(\"</\"+tag+\">\",os);if(oe>=0)return b.substring(os,oe).trim();}return \"\";}function parseRss(xml,src,max){const result=[];const blocks=xml.split(\"</item>\").slice(0,-1);for(let i=0;i<blocks.length&&result.length<max;i++){const s=blocks[i].lastIndexOf(\"<item\");if(s<0)continue;const b=blocks[i].substring(s);const title=getText(b,\"title\");const url=getText(b,\"link\");if(!title||!url)continue;result.push({json:{title:title,url:url,source:src,date:getText(b,\"pubDate\"),snippet:getText(b,\"description\").substring(0,300)}});}return result;}const parsed=parseRss(data,SOURCE,MAX);if(parsed.length===0){return[{json:{_fetchError:true,source:SOURCE,message:\"parsed item count: 0\"}}];}return parsed;" },
    position: [448,1536]
  },
  output: [{ source: 'X', title: 'T', url: 'https://example.com', snippet: '', date: '2026-07-21T00:00:00.000Z' }]
});

const fetchCssTricks = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: "Fetch CSS-Tricks",
    parameters: {"url":"https://css-tricks.com/feed/","options":{"response":{"response":{"responseFormat":"text"}},"timeout":15000}},
    position: [224,1728]
  },
  output: [{ data: '<raw feed text>' }]
});

const parseCssTricks = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: "Parse CSS-Tricks",
    parameters: { jsCode: "const SOURCE=\"CSS-Tricks\";const MAX=5;if(items[0]&&items[0].json.error){return[{json:{_fetchError:true,source:SOURCE,message:String(items[0].json.error)}}];}const data=items[0]&&items[0].json.data;if(!data){return[{json:{_fetchError:true,source:SOURCE,message:\"empty response\"}}];}function getText(b,tag){const cdata=\"<\"+tag+\"><![CDATA[\";const ci=b.indexOf(cdata);if(ci>=0){const cs=ci+cdata.length;const ce=b.indexOf(\"]]></\"+tag+\">\",cs);if(ce>=0)return b.substring(cs,ce).trim();}const oi=b.indexOf(\"<\"+tag+\">\");if(oi>=0){const os=oi+tag.length+2;const oe=b.indexOf(\"</\"+tag+\">\",os);if(oe>=0)return b.substring(os,oe).trim();}return \"\";}function parseRss(xml,src,max){const result=[];const blocks=xml.split(\"</item>\").slice(0,-1);for(let i=0;i<blocks.length&&result.length<max;i++){const s=blocks[i].lastIndexOf(\"<item\");if(s<0)continue;const b=blocks[i].substring(s);const title=getText(b,\"title\");const url=getText(b,\"link\");if(!title||!url)continue;result.push({json:{title:title,url:url,source:src,date:getText(b,\"pubDate\"),snippet:getText(b,\"description\").substring(0,300)}});}return result;}const parsed=parseRss(data,SOURCE,MAX);if(parsed.length===0){return[{json:{_fetchError:true,source:SOURCE,message:\"parsed item count: 0\"}}];}return parsed;" },
    position: [448,1728]
  },
  output: [{ source: 'X', title: 'T', url: 'https://example.com', snippet: '', date: '2026-07-21T00:00:00.000Z' }]
});

const fetchByteByteGo = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: "Fetch ByteByteGo",
    parameters: {"url":"https://blog.bytebytego.com/feed","options":{"response":{"response":{"responseFormat":"text"}},"timeout":15000}},
    position: [448,1920]
  },
  output: [{ data: '<raw feed text>' }]
});

const parseByteByteGo = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: "Parse ByteByteGo",
    parameters: { jsCode: "const SOURCE=\"ByteByteGo\";const MAX=5;if(items[0]&&items[0].json.error){return[{json:{_fetchError:true,source:SOURCE,message:String(items[0].json.error)}}];}const data=items[0]&&items[0].json.data;if(!data){return[{json:{_fetchError:true,source:SOURCE,message:\"empty response\"}}];}function getText(b,tag){const cdata=\"<\"+tag+\"><![CDATA[\";const ci=b.indexOf(cdata);if(ci>=0){const cs=ci+cdata.length;const ce=b.indexOf(\"]]></\"+tag+\">\",cs);if(ce>=0)return b.substring(cs,ce).trim();}const oi=b.indexOf(\"<\"+tag+\">\");if(oi>=0){const os=oi+tag.length+2;const oe=b.indexOf(\"</\"+tag+\">\",os);if(oe>=0)return b.substring(os,oe).trim();}return \"\";}function parseRss(xml,src,max){const result=[];const blocks=xml.split(\"</item>\").slice(0,-1);for(let i=0;i<blocks.length&&result.length<max;i++){const s=blocks[i].lastIndexOf(\"<item\");if(s<0)continue;const b=blocks[i].substring(s);const title=getText(b,\"title\");const url=getText(b,\"link\");if(!title||!url)continue;result.push({json:{title:title,url:url,source:src,date:getText(b,\"pubDate\"),snippet:getText(b,\"description\").substring(0,300)}});}return result;}const parsed=parseRss(data,SOURCE,MAX);if(parsed.length===0){return[{json:{_fetchError:true,source:SOURCE,message:\"parsed item count: 0\"}}];}return parsed;" },
    position: [672,1920]
  },
  output: [{ source: 'X', title: 'T', url: 'https://example.com', snippet: '', date: '2026-07-21T00:00:00.000Z' }]
});

const fetchNextjs = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: "Fetch Next.js Blog",
    parameters: {"url":"https://nextjs.org/feed.xml","options":{"response":{"response":{"responseFormat":"text"}},"timeout":15000}},
    position: [448,2112]
  },
  output: [{ data: '<raw feed text>' }]
});

const parseNextjs = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: "Parse Next.js Blog",
    parameters: { jsCode: "const SOURCE=\"Next.js Blog\";const MAX=5;if(items[0]&&items[0].json.error){return[{json:{_fetchError:true,source:SOURCE,message:String(items[0].json.error)}}];}const data=items[0]&&items[0].json.data;if(!data){return[{json:{_fetchError:true,source:SOURCE,message:\"empty response\"}}];}function getText(b,tag){const cdata=\"<\"+tag+\"><![CDATA[\";const ci=b.indexOf(cdata);if(ci>=0){const cs=ci+cdata.length;const ce=b.indexOf(\"]]></\"+tag+\">\",cs);if(ce>=0)return b.substring(cs,ce).trim();}const oi=b.indexOf(\"<\"+tag+\">\");if(oi>=0){const os=oi+tag.length+2;const oe=b.indexOf(\"</\"+tag+\">\",os);if(oe>=0)return b.substring(os,oe).trim();}return \"\";}function parseRss(xml,src,max){const result=[];const blocks=xml.split(\"</item>\").slice(0,-1);for(let i=0;i<blocks.length&&result.length<max;i++){const s=blocks[i].lastIndexOf(\"<item\");if(s<0)continue;const b=blocks[i].substring(s);const title=getText(b,\"title\");const url=getText(b,\"link\");if(!title||!url)continue;result.push({json:{title:title,url:url,source:src,date:getText(b,\"pubDate\"),snippet:getText(b,\"description\").substring(0,300)}});}return result;}const parsed=parseRss(data,SOURCE,MAX);if(parsed.length===0){return[{json:{_fetchError:true,source:SOURCE,message:\"parsed item count: 0\"}}];}return parsed;" },
    position: [672,2112]
  },
  output: [{ source: 'X', title: 'T', url: 'https://example.com', snippet: '', date: '2026-07-21T00:00:00.000Z' }]
});

const mergeSourcesA = merge({
  version: 3,
  config: {
    name: 'Merge Sources A',
    parameters: {"numberInputs":10},
    position: [672,736]
  }
});

const mergeAllNews = merge({
  version: 3,
  config: {
    name: 'Merge All News',
    parameters: {"numberInputs":3},
    position: [896,1904]
  }
});

const filterDedup = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Filter & Deduplicate',
    parameters: { jsCode: "const KEYWORDS=['ai','llm','gpt','claude','gemini','openai','anthropic','deepmind','machine learning','deep learning','neural','diffusion','multimodal','agent','mcp','rag','reasoning','copilot','cursor','react','vue','svelte','angular','next.js','nextjs','nuxt','remix','astro','tanstack','solid','typescript','javascript','bun','deno','node.js','nodejs','rust','python','go','css','tailwind','shadcn','frontend','web components','vite','webpack','turbopack','esbuild','webassembly','wasm','browser','v8','vercel','netlify','cloudflare','프론트','인공지능','리액트','타입스크립트','에이전트','프론트엔드'];const fetchErrors=items.filter(function(i){return i.json._fetchError===true;}).map(function(i){return{source:i.json.source,message:i.json.message};});const normalItems=items.filter(function(i){return i.json._fetchError!==true;});const seen=new Set();const filtered=[];for(const item of normalItems){const title=(item.json.title||'').toLowerCase();const url=item.json.url||'';if(!url||seen.has(url))continue;if(!KEYWORDS.some(function(kw){return title.includes(kw);}))continue;seen.add(url);filtered.push(item);if(filtered.length>=60)break;}if(filtered.length===0){return [{json:{title:'',url:'',source:'',date:'',snippet:'',_fetchErrors:fetchErrors}}];}filtered[0]=Object.assign({},filtered[0],{json:Object.assign({},filtered[0].json,{_fetchErrors:fetchErrors})});return filtered;" },
    position: [1120,1920]
  },
  output: [{ source: 'X', title: 'T', url: 'https://example.com', snippet: '', date: '2026-07-21T00:00:00.000Z' }]
});

const aggregateArticles = node({
  type: 'n8n-nodes-base.aggregate',
  version: 1,
  config: {
    name: 'Aggregate Articles',
    parameters: {"aggregate":"aggregateAllItemData","destinationFieldName":"articles","options":{}},
    position: [1344,1920]
  },
  output: [{ articles: [] }]
});

const buildIngestBatch = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Ingest Batch',
    parameters: { mode: 'runOnceForAllItems', jsCode: "const SLUG_MAP = {\n  \"GeekNews\": \"geeknews\",\n  \"HackerNews\": \"hacker-news\",\n  \"dev.to/javascript\": \"dev-to-javascript\",\n  \"dev.to/react\": \"dev-to-react\",\n  \"web.dev\": \"web-dev\",\n  \"SmashingMagazine\": \"smashing-magazine\",\n  \"Lobsters\": \"lobsters\",\n  \"CSS-Tricks\": \"css-tricks\",\n  \"ByteByteGo\": \"bytebytego\",\n  \"Next.js Blog\": \"nextjs-blog\"\n};\nconst TRACKING = new Set([\"ref\", \"fbclid\", \"gclid\", \"mc_cid\", \"mc_eid\", \"igshid\", \"spm\"]);\nfunction canonicalUrl(raw) {\n  try {\n    const u = new URL(raw);\n    u.protocol = \"https:\";\n    u.hash = \"\";\n    u.hostname = u.hostname.replace(/^www\\./, \"\");\n    for (const k of [...u.searchParams.keys()]) {\n      if (/^utm_/i.test(k) || TRACKING.has(k.toLowerCase())) u.searchParams.delete(k);\n    }\n    let s = u.toString();\n    if (s.endsWith(\"/\") && u.pathname !== \"/\") s = s.slice(0, -1);\n    return s;\n  } catch (e) {\n    return raw;\n  }\n}\nconst src = (items[0] && items[0].json && items[0].json.articles) ? items[0].json.articles : [];\nconst skipped = {};\nconst seen = new Set();\nconst articles = [];\nfor (const a of src) {\n  if (!a || !a.url || !a.title) continue;\n  const slug = SLUG_MAP[a.source];\n  if (!slug) { const key = a.source || \"unknown\"; skipped[key] = (skipped[key] || 0) + 1; continue; }\n  const url = canonicalUrl(a.url);\n  if (seen.has(url)) continue;\n  seen.add(url);\n  const d = a.date ? new Date(a.date) : null;\n  const publishedAt = (d && !isNaN(d.getTime())) ? d.toISOString() : new Date().toISOString();\n  const snippet = (a.snippet == null) ? \"\" : String(a.snippet).trim();\n  const content = snippet.length > 0 ? snippet.slice(0, 200000) : a.title;\n  articles.push({ sourceSlug: slug, url: url, title: a.title, content: content, publishedAt: publishedAt });\n}\nconst kst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);\nconst batchId = \"daily-tech-\" + kst;\nreturn [{ json: { batchId: batchId, articles: articles, _count: articles.length, _skipped: skipped } }];" },
    position: [1568, 1920]
  },
  output: [{ batchId: 'daily-tech-2026-07-21', articles: [], _count: 0, _skipped: {} }]
});

const hasArticles = ifElse({
  version: 2.2,
  config: {
    name: 'Has Articles?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [
          {
            id: '1a2b3c4d-0000-4000-8000-000000000001',
            leftValue: expr('={{ $json._count }}'),
            rightValue: 0,
            operator: { type: 'number', operation: 'gt' }
          }
        ],
        combinator: 'and'
      },
      looseTypeValidation: true,
      options: {}
    },
    position: [1792, 1920]
  }
});

const postIngest = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'POST Ingest',
    parameters: {
      method: 'POST',
      url: expr('={{ $env.NEWS_DIGEST_URL }}/api/ingest'),
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Authorization', value: expr('=Bearer {{ $env.INGEST_TOKEN }}') }] },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('={{ JSON.stringify({ batchId: $json.batchId, articles: $json.articles }) }}'),
      options: { timeout: 60000 }
    },
    onError: 'continueErrorOutput',
    position: [2016, 1920]
  },
  output: [{}]
});

const postIngestComplete = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'POST Ingest Complete',
    parameters: {
      method: 'POST',
      url: expr('={{ $env.NEWS_DIGEST_URL }}/api/ingest/complete'),
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Authorization', value: expr('=Bearer {{ $env.INGEST_TOKEN }}') }] },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('={{ JSON.stringify({ batchId: $json.batchId }) }}'),
      options: { timeout: 30000 }
    },
    onError: 'continueErrorOutput',
    position: [2240, 1920]
  },
  output: [{}]
});

const buildErrorAlert = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Error Alert',
    parameters: { mode: 'runOnceForEachItem', jsCode: "let msg = 'unknown error';\nconst e = $json.error;\nif (e && typeof e === 'object') { msg = e.message || e.description || JSON.stringify(e); }\nelse if (e) { msg = String(e); }\nelse if ($json.message) { msg = String($json.message); }\nlet batchId = '';\ntry { batchId = $('Build Ingest Batch').first().json.batchId || ''; } catch (err) {}\nconst text = '🚨 Daily Tech News ingest 실패' + (batchId ? ' (' + batchId + ')' : '') + '\\n' + msg;\nreturn { text: text };" },
    position: [2016, 2160]
  },
  output: [{ text: '' }]
});

const sendErrorAlert = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Send Error Alert',
    parameters: {
      method: 'POST',
      url: 'https://slack.com/api/chat.postMessage',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Authorization', value: expr('=Bearer {{ $env.SLACK_BOT_TOKEN }}') }] },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('={{ JSON.stringify({ channel: "C0B0XQP5CF2", text: $json.text }) }}'),
      options: { timeout: 15000 }
    },
    position: [2240, 2160]
  },
  output: [{}]
});

// error path side effects: ingest failures -> alert channel C0B0XQP5CF2
postIngest.output(1).to(buildErrorAlert);
postIngestComplete.output(1).to(buildErrorAlert);

export default workflow('tFyzxMcFUCjpaAzq', 'Daily Tech News Summary')
  .add(dailyTrigger)
  .to(fetchGeekNews.to(parseGeekNews.to(mergeSourcesA.input(0))))
  .add(dailyTrigger)
  .to(fetchHackerNews.to(parseHackerNews.to(mergeSourcesA.input(1))))
  .add(dailyTrigger)
  .to(fetchDevtoJs.to(parseDevtoJs.to(mergeSourcesA.input(2))))
  .add(dailyTrigger)
  .to(fetchDevtoTs.to(parseDevtoTs.to(mergeSourcesA.input(3))))
  .add(dailyTrigger)
  .to(fetchDevtoReact.to(parseDevtoReact.to(mergeSourcesA.input(4))))
  .add(dailyTrigger)
  .to(fetchDevtoAi.to(parseDevtoAi.to(mergeSourcesA.input(5))))
  .add(dailyTrigger)
  .to(fetchWebDev.to(parseWebDev.to(mergeSourcesA.input(6))))
  .add(dailyTrigger)
  .to(fetchSmashing.to(parseSmashing.to(mergeSourcesA.input(7))))
  .add(dailyTrigger)
  .to(fetchLobsters.to(parseLobsters.to(mergeSourcesA.input(8))))
  .add(dailyTrigger)
  .to(fetchCssTricks.to(parseCssTricks.to(mergeSourcesA.input(9))))
  .add(dailyTrigger)
  .to(fetchByteByteGo.to(parseByteByteGo.to(mergeAllNews.input(1))))
  .add(dailyTrigger)
  .to(fetchNextjs.to(parseNextjs.to(mergeAllNews.input(2))))
  .add(mergeSourcesA)
  .to(mergeAllNews.input(0))
  .add(mergeAllNews)
  .to(filterDedup)
  .to(aggregateArticles)
  .to(buildIngestBatch)
  .to(hasArticles
    .onTrue(postIngest.to(postIngestComplete)))
  .add(buildErrorAlert)
  .to(sendErrorAlert);
