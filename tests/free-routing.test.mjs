import test from 'node:test';
import assert from 'node:assert/strict';
import { createFreeRouter, isFreeModel, isCodexLimitError, exhaustedCodexLimit } from '../free-router.mjs';
import { toChatRequest, bridgeResponses, createChatProviderRouter } from '../responses-bridge.mjs';

const free = (id = 'vendor/coder:free', extra = {}) => ({ id, name: id, pricing: { prompt: '0', completion: '0', request: '0' }, supported_parameters: ['tools'], context_length: 128000, ...extra });
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const stream = (chunks) => new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
const successful = () => stream([{ choices: [{ delta: { content: 'Ready.' }, finish_reason: null }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]);
const request = { messages: [{ role: 'user', content: 'Build a feature' }] };

test('free filter rejects paid output, request fees, unknown pricing and non-tool models', () => {
  assert.equal(isFreeModel(free()), true);
  for (const model of [free('paid', { pricing: { prompt: '0', completion: '0.001' } }), free('fee', { pricing: { prompt: '0', completion: '0', request: '0.1' } }), free('unknown', { pricing: {} }), free('no-tools', { supported_parameters: [] }), free('expired', { expiration_date: '2020-01-01' })]) assert.equal(isFreeModel(model), false);
});

test('catalog uses live coding ranking and constrains all OpenRouter requests to zero price', async () => {
  const calls = [];
  const router = createFreeRouter({ getKey: async () => 'fixture-key', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/models')) return json({ data: [free('best:free'), free('newest:free'), free('paid', { pricing: { prompt: '1', completion: '1' } })] });
    return successful();
  } });
  const result = await router.openCompletion(request);
  assert.equal(result.route.model, 'best:free');
  assert.match(calls[0].url, /sort=coding-high-to-low/);
  const body = JSON.parse(calls[1].options.body);
  assert.deepEqual(body.provider.max_price, { prompt: 0, completion: 0 });
  assert.equal(body.provider.require_parameters, true);
});

test('free account limit falls through to NIM once and cools down OpenRouter', async () => {
  let openrouterCalls = 0;
  const router = createFreeRouter({ getKey: async () => 'fixture-key', fetchImpl: async (url) => {
    if (url.includes('openrouter') && url.includes('/models')) return json({ data: [free('one:free'), free('two:free')] });
    if (url.includes('nvidia') && url.includes('/models')) return json({ data: [{ id: 'openai/gpt-oss-120b' }] });
    if (url.includes('openrouter')) { openrouterCalls++; return json({ error: { message: 'Free daily quota reached' } }, 429, { 'retry-after': '300' }); }
    return successful();
  } });
  assert.equal((await router.openCompletion(request)).route.provider, 'nvidia');
  assert.equal((await router.openCompletion(request)).route.provider, 'nvidia');
  assert.equal(openrouterCalls, 1);
});

test('invalid provider key stops with actionable error rather than hiding it', async () => {
  let requests = 0;
  const router = createFreeRouter({ getKey: async () => 'fixture-key', fetchImpl: async () => { requests++; return json({}, 401); } });
  await assert.rejects(router.openCompletion(request), /Check your key/);
  assert.equal(requests, 1);
});

test('a full NIM allowance stops the cascade with no unbounded retry', async () => {
  const router = createFreeRouter({ getKey: async () => 'fixture-key', fetchImpl: async (url) => {
    if (url.includes('/models')) return json({ data: url.includes('openrouter') ? [free()] : [{ id: 'openai/gpt-oss-120b' }] });
    return json({}, 429);
  } });
  await assert.rejects(router.openCompletion(request), /NVIDIA NIM.*rate limit/);
});

test('quota classification rejects authentication and generic network failures', () => {
  assert.equal(isCodexLimitError({ codexErrorInfo: 'UsageLimitExceeded' }), true);
  assert.equal(isCodexLimitError({ codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 429 } } }), true);
  assert.equal(isCodexLimitError({ message: 'Unauthorized' }), false);
  assert.equal(isCodexLimitError({ message: 'Connection failed' }), false);
  assert.equal(exhaustedCodexLimit({ codex: { primary: { usedPercent: 100, resetsAt: Date.now() / 1000 + 60 } } }), true);
  assert.equal(exhaustedCodexLimit({ primary: { usedPercent: 100, resetsAt: Date.now() / 1000 - 60 } }), false);
});

test('adapter retains namespace functions, tool outputs and exact free-form tool input', () => {
  const input = { instructions: 'Read only', tools: [{ type: 'namespace', name: 'functions', tools: [{ type: 'function', name: 'read_file', parameters: { type: 'object', properties: { path: { type: 'string' } } } }, { type: 'custom', name: 'apply_patch' }] }], input: [
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Inspect this' }] },
    { type: 'function_call', call_id: 'c1', namespace: 'functions', name: 'read_file', arguments: '{"path":"a"}' },
    { type: 'function_call_output', call_id: 'c1', output: 'source' },
    { type: 'custom_tool_call', call_id: 'c2', name: 'apply_patch', input: '*** exact patch ***' },
    { type: 'custom_tool_call_output', call_id: 'c2', output: 'saved' },
  ] };
  const { request: translated, toolMap } = toChatRequest(input);
  assert.equal(translated.messages[0].role, 'system');
  assert.equal(translated.messages.find((message) => message.role === 'assistant').tool_calls[0].function.name, 'functions__read_file');
  assert.equal(translated.messages.find((message) => message.role === 'tool').tool_call_id, 'c1');
  const patchCall = translated.messages.filter((message) => message.role === 'assistant').find((message) => message.tool_calls?.[0]?.function.name === 'functions__apply_patch');
  assert.equal(JSON.parse(patchCall.tool_calls[0].function.arguments).input, '*** exact patch ***');
  assert.equal(toolMap.get('functions__apply_patch').custom, true);
});

test('adapter preserves strict schemas, named tool choice and parallel-call settings', () => {
  const { request } = toChatRequest({
    tools: [{ type: 'function', name: 'read_file', strict: true, parameters: { type: 'object', properties: {}, additionalProperties: false } }],
    tool_choice: { type: 'function', name: 'read_file' },
    parallel_tool_calls: true,
    input: 'Inspect the file',
  });
  assert.equal(request.tools[0].function.strict, true);
  assert.deepEqual(request.tool_choice, { type: 'function', function: { name: 'read_file' } });
  assert.equal(request.parallel_tool_calls, true);
  assert.match(request.messages.find((message) => message.role === 'system').content, /structured function-calling interface/i);
});

test('custom Chat Completions providers receive Codex tools and parallel-call settings', async () => {
  let sent;
  const router = createChatProviderRouter({
    provider: { id: 'custom-api', name: 'Custom API', baseUrl: 'https://example.test/v1' },
    model: 'coding-model', key: 'fixture-key',
    fetchImpl: async (url, options) => { sent = { url, body: JSON.parse(options.body) }; return successful(); },
  });
  await router.openCompletion({ messages: [{ role: 'user', content: 'Edit a file' }], tools: [{ type: 'function', function: { name: 'write_file', parameters: { type: 'object' } } }], parallel_tool_calls: true });
  assert.equal(sent.url, 'https://example.test/v1/chat/completions');
  assert.equal(sent.body.tools[0].function.name, 'write_file');
  assert.equal(sent.body.parallel_tool_calls, true);
  assert.equal(sent.body.stream, true);
});

test('adapter limits allowed-tools requests to the requested function set', () => {
  const { request, allowedToolNames } = toChatRequest({
    tools: [{ type: 'function', name: 'read_file' }, { type: 'function', name: 'write_file' }],
    tool_choice: { type: 'allowed_tools', mode: 'required', tools: [{ type: 'function', name: 'read_file' }] },
    input: 'Inspect the file',
  });
  assert.equal(request.tools.length, 1);
  assert.equal(request.tools[0].function.name, 'read_file');
  assert.equal(request.tool_choice, 'required');
  assert.deepEqual([...allowedToolNames], ['read_file']);
});

test('unsupported history is rejected rather than silently dropped', () => {
  assert.throws(() => toChatRequest({ input: [{ type: 'compaction', encrypted_content: 'opaque' }] }), /Cannot safely translate/);
});

test('NIM Harmony channel suffix maps only to an advertised tool', async () => {
  const res = sink();
  await bridgeResponses({ input: { model: 'gpt-oss', input: 'Inspect', tools: [{ type: 'function', name: 'exec_command' }] }, res,
    router: { openCompletion: async () => ({ route: { name: 'NIM GPT-OSS' }, response: stream([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'exec_command<|channel|>commentary', arguments: '{"cmd":"pwd"}' } }] }, finish_reason: 'tool_calls' }] }]) }) } });
  assert.equal(events(res).at(-1).response.output[0].name, 'exec_command');
});

function sink() {
  return { output: '', destroyed: false, writeHead() {}, write(chunk) { this.output += chunk; }, end() {} };
}
function events(res) { return res.output.split('\n').filter((line) => line.startsWith('data:')).map((line) => JSON.parse(line.slice(5))); }

test('patch calls emit complete custom input events with their namespace intact', async () => {
  const res = sink();
  const patch = '*** Begin Patch\n*** Add File: marker.txt\n+saved\n*** End Patch';
  await bridgeResponses({ input: { model: 'nim', input: 'Save a file', tools: [{ type: 'namespace', name: 'functions', tools: [{ type: 'custom', name: 'apply_patch' }] }] }, res,
    router: { openCompletion: async () => ({ route: { name: 'NIM fixture' }, response: stream([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'patch1', function: { name: 'functions__apply_patch', arguments: JSON.stringify({ input: patch }) } }] }, finish_reason: 'tool_calls' }] }]) }) } });
  const received = events(res);
  assert.equal(received.find((event) => event.type === 'response.custom_tool_call_input.delta').delta, patch);
  assert.equal(received.find((event) => event.type === 'response.custom_tool_call_input.done').input, patch);
  assert.equal(received.at(-1).response.output[0].namespace, 'functions');
});

test('an invalid tool batch exposes no executable calls', async () => {
  const res = sink();
  await bridgeResponses({ input: { model: 'nim', input: 'Edit', tools: [{ type: 'function', name: 'edit' }] }, res,
    router: { openCompletion: async () => ({ route: { name: 'NIM fixture' }, response: stream([{ choices: [{ delta: { tool_calls: [
      { index: 0, id: 'valid', function: { name: 'edit', arguments: '{}' } },
      { index: 1, id: 'invalid', function: { name: 'edit', arguments: '{' } },
    ] }, finish_reason: 'tool_calls' }] }]) }) } });
  assert.equal(events(res).at(-1).type, 'response.failed');
  assert.equal(events(res).filter((event) => event.type === 'response.output_item.done').length, 0);
});

test('bridge streams text and emits a completed Responses envelope', async () => {
  const res = sink();
  await bridgeResponses({ input: { model: 'auto-free', input: 'Hello' }, res, router: { openCompletion: async () => ({ response: successful(), route: { name: 'Test' } }) } });
  const received = events(res);
  assert.equal(received.find((event) => event.type === 'response.output_text.delta').delta, 'Ready.');
  assert.equal(received.at(-1).response.status, 'completed');
  assert.equal(received.at(-1).response.output[0].content[0].text, 'Ready.');
});

test('bridge assembles split tool argument deltas into a valid call', async () => {
  const res = sink();
  const response = stream([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_file', arguments: '{"path":' } }] } }] }, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"a"}' } }] }, finish_reason: 'tool_calls' }] }]);
  await bridgeResponses({ input: { model: 'auto-free', input: 'Inspect', tools: [{ type: 'function', name: 'read_file' }] }, res, router: { openCompletion: async () => ({ response, route: { name: 'Test' } }) } });
  const call = events(res).at(-1).response.output[0];
  assert.equal(call.name, 'read_file');
  assert.deepEqual(JSON.parse(call.arguments), { path: 'a' });
});

test('bridge adapts non-streaming function calls into Codex tool events', async () => {
  const res = sink();
  await bridgeResponses({ input: { model: 'custom', input: 'Inspect', tools: [{ type: 'function', name: 'read_file' }] }, res,
    router: { openCompletion: async () => ({ response: json({ choices: [{ message: { tool_calls: [{ id: 'call_json', type: 'function', function: { name: 'read_file', arguments: '{"path":"a"}' } }] }, finish_reason: 'tool_calls' }] }), route: { name: 'Custom provider' } }) } });
  const call = events(res).at(-1).response.output[0];
  assert.equal(call.call_id, 'call_json');
  assert.equal(call.name, 'read_file');
  assert.deepEqual(JSON.parse(call.arguments), { path: 'a' });
});

test('bridge adapts legacy streamed function_call responses', async () => {
  const res = sink();
  const response = stream([
    { choices: [{ delta: { function_call: { name: 'read_file' } } }] },
    { choices: [{ delta: { function_call: { arguments: '{"path":"a"}' } }, finish_reason: 'function_call' }] },
  ]);
  await bridgeResponses({ input: { model: 'custom', input: 'Inspect', tools: [{ type: 'function', name: 'read_file' }] }, res,
    router: { openCompletion: async () => ({ response, route: { name: 'Custom provider' } }) } });
  const call = events(res).at(-1).response.output[0];
  assert.match(call.call_id, /^call_/);
  assert.equal(call.name, 'read_file');
  assert.deepEqual(JSON.parse(call.arguments), { path: 'a' });
});

test('bridge hides and rejects split text-form tool-call markup', async () => {
  const res = sink();
  const response = stream([
    { choices: [{ delta: { content: '<tool_ca' } }] },
    { choices: [{ delta: { content: 'll>functions.send_user_message_async({"text":"x"})' }, finish_reason: 'stop' }] },
  ]);
  await bridgeResponses({ input: { model: 'custom', input: 'Do the task', tools: [{ type: 'function', name: 'read_file' }] }, res,
    router: { openCompletion: async () => ({ response, route: { name: 'Custom provider' } }) } });
  const serialized = res.output;
  assert.doesNotMatch(serialized, /<tool_call>/i);
  assert.doesNotMatch(serialized, /functions\.send_user_message_async/);
  assert.match(serialized, /Forge did not execute it/);
  assert.equal(events(res).at(-1).type, 'response.failed');
});

test('SSE quota error before any output switches providers safely', async () => {
  const res = sink();
  let attempts = 0, rejected;
  const router = { openCompletion: async () => ({ route: { provider: ++attempts === 1 ? 'openrouter' : 'nvidia', name: 'Test' }, response: attempts === 1 ? stream([{ error: { code: 429, message: 'Quota exceeded' } }]) : successful() }), rejectRoute(route, error) { rejected = { route, error }; } };
  await bridgeResponses({ input: { model: 'auto-free', input: 'Hello' }, res, router });
  assert.equal(rejected.error.code, 429);
  assert.equal(attempts, 2);
  assert.equal(events(res).at(-1).response.status, 'completed');
});

test('partial stream failures never retry tools or report false completion', async () => {
  const res = sink();
  let attempts = 0;
  await bridgeResponses({ input: { model: 'auto-free', input: 'Hello' }, res, router: { openCompletion: async () => { attempts++; return { route: { name: 'Test' }, response: stream([{ choices: [{ delta: { content: 'Partial' } }] }]) }; } } });
  assert.equal(attempts, 1);
  assert.equal(events(res).at(-1).type, 'response.failed');
});

test('NVIDIA keeps structured tools, merges leading instructions and bounds GPT-OSS output', async () => {
  let body;
  const router=createChatProviderRouter({provider:{id:'nvidia-nim',name:'NVIDIA NIM',baseUrl:'https://integrate.api.nvidia.com/v1'},model:'openai/gpt-oss-20b',key:'fixture-key',fetchImpl:async(_url,options)=>{body=JSON.parse(options.body);return successful();}});
  await router.openCompletion({messages:[{role:'system',content:'Instructions'},{role:'system',content:'Use tools'},{role:'user',content:'Save a file'}],tools:[{type:'function',function:{name:'write_file',parameters:{type:'object'}}}],parallel_tool_calls:true});
  assert.equal(body.max_tokens,4096);
  assert.equal(body.parallel_tool_calls,undefined);
  assert.equal(body.tool_choice,'auto');
  assert.deepEqual(body.messages,[{role:'system',content:'Instructions\n\nUse tools'},{role:'user',content:'Save a file'}]);
  assert.equal(body.tools[0].function.name,'write_file');
});

test('NVIDIA output-limit validation retries once and preserves named tool calls', async () => {
  const bodies=[];
  const tool_choice={type:'function',function:{name:'write_file'}};
  const router=createChatProviderRouter({provider:{id:'nvidia-nim',name:'NVIDIA NIM',baseUrl:'https://integrate.api.nvidia.com/v1'},model:'nvidia/nemotron-3-super-120b-a12b',key:'fixture-key',fetchImpl:async(_url,options)=>{
    bodies.push(JSON.parse(options.body));
    return bodies.length===1?json({detail:[{loc:['body','max_tokens'],msg:'Input should be less than or equal to 8192',ctx:{le:8192}}]},422):successful();
  }});
  await router.openCompletion({...request,tools:[{type:'function',function:{name:'write_file'}}],tool_choice});
  assert.deepEqual(bodies.map(body=>body.max_tokens),[16384,8192]);
  assert.deepEqual(bodies[1].tool_choice,tool_choice);
  await router.openCompletion(request,undefined,{maxTokens:32768});
  assert.equal(bodies.at(-1).max_tokens,8192);
});

test('NVIDIA GPT-OSS channel and JSON suffixes resolve only advertised tool names', async () => {
  for (const suffix of ['analysisjson','commentaryjson','json','analysis<|constrain|>json']) {
    const res=sink();
    await bridgeResponses({input:{input:'Inspect',tools:[{type:'function',name:'exec_command'}]},res,router:{openCompletion:async()=>({route:{name:'NVIDIA GPT-OSS'},response:stream([{choices:[{delta:{tool_calls:[{index:0,id:'call_nim',function:{name:'exec_command<|channel|>'+suffix,arguments:'{"cmd":"pwd"}'}}]},finish_reason:'tool_calls'}]}])})}});
    assert.equal(events(res).at(-1).type,'response.completed');
    assert.equal(events(res).at(-1).response.output[0].name,'exec_command');
  }
  const res=sink();
  await bridgeResponses({input:{input:'Inspect',tools:[{type:'function',name:'exec_command'}]},res,router:{openCompletion:async()=>({route:{name:'NVIDIA GPT-OSS'},response:stream([{choices:[{delta:{tool_calls:[{index:0,id:'call_bad',function:{name:'unadvertised<|channel|>analysisjson',arguments:'{}'}}]},finish_reason:'tool_calls'}]}])})}});
  assert.equal(events(res).at(-1).type,'response.failed');
  assert.equal(events(res).filter(event=>event.type==='response.output_item.done').length,0);
});


test('NVIDIA applies model-specific reasoning choices while other providers remain unchanged', async () => {
  for (const [baseUrl,model,effort,expected] of [
    ['https://integrate.api.nvidia.com/v1','openai/gpt-oss-20b','medium','medium'],
    ['https://integrate.api.nvidia.com/v1','nvidia/nemotron-3-super-120b-a12b','medium','low'],
    ['https://integrate.api.nvidia.com/v1','nvidia/nemotron-3-super-120b-a12b','high','high'],
    ['https://example.test/v1','openai/gpt-oss-20b','medium',undefined],
  ]) {
    let body;
    const router=createChatProviderRouter({provider:{id:'provider',name:'Provider',baseUrl},model,key:'fixture-key',fetchImpl:async(_url,options)=>{body=JSON.parse(options.body);return successful();}});
    await router.openCompletion(request,undefined,{reasoningEffort:effort});
    assert.equal(body.reasoning_effort,expected);
  }
});

test('NVIDIA retries a transient HTTP failure before output but never auth or quota failures', async () => {
  let calls=0;
  const router=createChatProviderRouter({provider:{id:'nvidia-nim',name:'NVIDIA NIM',baseUrl:'https://integrate.api.nvidia.com/v1'},model:'openai/gpt-oss-20b',key:'fixture-key',fetchImpl:async()=>++calls===1?json({error:{message:'High demand'}},503):successful()});
  await router.openCompletion(request);
  assert.equal(calls,2);
  for (const status of [401,429]) {
    let rejected=0;
    const blocked=createChatProviderRouter({provider:{id:'nvidia-nim',name:'NVIDIA NIM',baseUrl:'https://integrate.api.nvidia.com/v1'},model:'openai/gpt-oss-20b',key:'fixture-key',fetchImpl:async()=>{rejected++;return json({},status);}});
    await assert.rejects(blocked.openCompletion(request));assert.equal(rejected,1);
  }
});

test('file helper history round-trips the original function instead of an encoded shell command', async () => {
  const input={input:'Save a file',tools:[{type:'function',name:'exec_command',parameters:{type:'object'}}]};
  const res=sink();
  await bridgeResponses({input,res,router:{openCompletion:async()=>({route:{name:'NVIDIA'},response:stream([{choices:[{delta:{tool_calls:[{index:0,id:'file_write',function:{name:'forge_write_file',arguments:JSON.stringify({path:'created.txt',content:'saved\n'})}}]},finish_reason:'tool_calls'}]}])})}});
  const item=events(res).at(-1).response.output[0];
  assert.equal(item.name,'exec_command');
  const {request}=toChatRequest({...input,input:[{role:'user',content:'Save a file'},item,{type:'function_call_output',call_id:item.call_id,output:'Saved: created.txt'}]});
  assert.equal(request.messages.find(message=>message.tool_calls)?.tool_calls[0].function.name,'forge_write_file');
  assert.deepEqual(JSON.parse(request.messages.find(message=>message.tool_calls)?.tool_calls[0].function.arguments),{path:'created.txt',content:'saved\n'});
  assert.equal(request.messages.at(-1).tool_call_id,'file_write');
});
