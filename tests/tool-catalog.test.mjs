import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeResponses, createChatProviderRouter, createToolCatalog, toChatRequest, providerBaseInstructions } from '../responses-bridge.mjs';

const dummyTools = () => Array.from({ length: 250 }, (_, index) => ({ type: 'function', name: `plugin_${index}`, description: 'An unrelated plugin action.', parameters: { type: 'object', properties: {} } }));
const input = () => ({ input: 'Complete the requested action.', tools: [...dummyTools(), { type: 'namespace', name: 'functions', tools: [{ type: 'function', name: 'exec_command' }, { type: 'custom', name: 'apply_patch' }] }, { type: 'namespace', name: 'calendar', tools: [{ type: 'function', name: 'create_event', description: 'Create a calendar event.', parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } }] }] });
const sink = () => ({ output: '', destroyed: false, writeHead() {}, write(chunk) { this.output += chunk; }, end() {} });
const events = (res) => res.output.split('\n').filter((line) => line.startsWith('data:')).map((line) => JSON.parse(line.slice(5)));
const response = (calls, reason = 'tool_calls') => new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: calls.map(([name, args], index) => ({ id: `call_${index}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })) }, finish_reason: reason }] }), { headers: { 'Content-Type': 'application/json' } });

test('Groq compact base instructions are provider specific and leave project/developer messages intact',()=>{
  const groq={baseUrl:'https://api.groq.com/openai/v1'};
  assert.ok(providerBaseInstructions(groq).length<2500);
  assert.match(providerBaseInstructions(groq),/AGENTS.md/);
  assert.equal(providerBaseInstructions({baseUrl:'https://example.com/v1'}),undefined);
  const translated=toChatRequest({instructions:providerBaseInstructions(groq),input:[{role:'developer',content:'Project rule: never delete files'},{role:'user',content:'Save my exact text'}]});
  assert.ok(translated.request.messages.some(message=>message.content==='Project rule: never delete files'));
  assert.ok(translated.request.messages.some(message=>message.content==='Save my exact text'));
});

test('Groq permits Harmony name normalization while retaining local validation and named choices',async()=>{
  const bodies=[];const groq={id:'groq',name:'Groq',baseUrl:'https://api.groq.com/openai/v1'};
  const router=createChatProviderRouter({provider:groq,model:'openai/gpt-oss-120b',key:'fixture',fetchImpl:async(_url,options)=>{bodies.push(JSON.parse(options.body));return response([['functions__exec_command<|channel|>commentary',{cmd:'echo ok'}]]);}});
  const res=sink();await bridgeResponses({input:input(),res,router});
  assert.equal(bodies[0].disable_tool_validation,true);assert.equal(bodies[0].parallel_tool_calls,false);
  assert.equal(events(res).at(-1).type,'response.completed');assert.equal(events(res).at(-1).response.output[0].name,'exec_command');
  const named=toChatRequest({...input(),tool_choice:{type:'function',name:'exec_command',namespace:'functions'}}).request;
  await router.openCompletion(named);assert.equal(bodies[1].disable_tool_validation,undefined);
});

test('Groq repairs one rejected inference before output, without executing invalid calls',async()=>{
  for (const streamed of [false,true]) {
    let calls=0;const bodies=[];
    const router=createChatProviderRouter({provider:{name:'Groq',baseUrl:'https://api.groq.com/openai/v1'},model:'openai/gpt-oss-120b',key:'fixture',fetchImpl:async(_url,options)=>{
      calls++;bodies.push(JSON.parse(options.body));
      if(calls===1){const error={code:'tool_use_failed',message:'Failed to parse tool call arguments as JSON'};return streamed?new Response(`data: ${JSON.stringify({error})}\n\ndata: [DONE]\n\n`,{headers:{'Content-Type':'text/event-stream'}}):new Response(JSON.stringify({error}),{status:400});}
      return response([['functions__exec_command',{cmd:'echo repaired'}]]);
    }});
    const res=sink();await bridgeResponses({input:input(),res,router});
    assert.equal(calls,2);assert.match(bodies[1].messages.at(-1).content,/No failed call was executed/);
    assert.equal(events(res).at(-1).type,'response.completed');
    assert.equal(events(res).filter(event=>event.type==='response.output_item.done').length,1);
  }
  let calls=0;
  const router=createChatProviderRouter({provider:{name:'Groq',baseUrl:'https://api.groq.com/openai/v1'},model:'openai/gpt-oss-120b',key:'fixture',fetchImpl:async()=>{calls++;return new Response(JSON.stringify({error:{code:'tool_use_failed',message:'Invalid arguments'}}),{status:400});}});
  await assert.rejects(router.openCompletion({messages:[]}),/HTTP 400/);assert.equal(calls,2);
});

test('large catalogs stay within 128 and retain core, custom, relevant and recent tools', () => {
  const source = input();
  const catalog = createToolCatalog(toChatRequest(source).request);
  assert.equal(catalog.request.tools.length, 128);
  assert.ok(catalog.request.tools.some((tool) => tool.function.name === 'functions__exec_command'));
  assert.ok(catalog.request.tools.some((tool) => tool.function.name === 'functions__apply_patch'));
  assert.ok(!catalog.request.tools.some((tool) => tool.function.name === 'calendar__create_event'));
  const result = catalog.search({ query: 'calendar create event' });
  assert.equal(result.tools[0].name, 'calendar__create_event');
  assert.ok(catalog.prepare(catalog.request.messages).tools.some((tool) => tool.function.name === 'calendar__create_event'));
  assert.throws(() => catalog.search({ query: '', limit: 1 }));
  assert.throws(() => catalog.search({ query: 'calendar', limit: 500 }));
  source.input = 'Create a calendar event';
  assert.ok(createToolCatalog(toChatRequest(source).request).request.tools.some((tool) => tool.function.name === 'calendar__create_event'));
  source.input = [{ role: 'user', content: 'Continue' }, { type: 'function_call', call_id: 'prior', name: 'plugin_249', arguments: '{}' }, { type: 'function_call_output', call_id: 'prior', output: 'Done' }];
  assert.ok(createToolCatalog(toChatRequest(source).request).request.tools.some((tool) => tool.function.name === 'plugin_249'));
});

test('small, named, disabled and restricted tool choices preserve their permissions', () => {
  for (const tool_choice of ['none', { type: 'function', name: 'exec_command', namespace: 'functions' }, { type: 'allowed_tools', mode: 'required', tools: [{ type: 'function', name: 'plugin_249' }] }]) {
    const translated = toChatRequest({ ...input(), tool_choice });
    const catalog = createToolCatalog(translated.request);
    assert.equal(catalog.discoveryName, null);
    assert.equal(catalog.request.tools?.length || 0, tool_choice === 'none' ? 0 : 1);
  }
  const source = input();
  source.tool_choice = { type: 'allowed_tools', tools: dummyTools().slice(0, 200) };
  const catalog = createToolCatalog(toChatRequest(source).request);
  assert.deepEqual(catalog.search({ query: 'calendar' }).tools, []);
  assert.equal(catalog.request.tools.length, 128);
});

for (const provider of [{ id: 'groq-free', name: 'Groq Free', baseUrl: 'https://api.groq.com/openai/v1' }, { id: 'kilo-free-router', name: 'Kilo Free', baseUrl: 'https://api.kilo.ai/api/gateway', nativePreset: 'kilo-free' }]) {
  test(`${provider.name} discovers late plugin functions while every request stays within 128 tools`, async () => {
    const bodies = [];
    const router = createChatProviderRouter({ provider, model: provider.nativePreset ? 'kilo-auto/free' : 'openai/gpt-oss-20b', key: 'fixture', fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body); bodies.push(body);
      assert.ok(body.tools.length <= 128);
      if (bodies.length === 1) return response([['forge_search_tools', { query: 'calendar create event' }], ['functions__exec_command', { cmd: 'must not execute' }]]);
      assert.ok(body.tools.some((tool) => tool.function.name === 'calendar__create_event'));
      assert.match(body.messages.at(-1).content, /not executed/);
      return response([['calendar__create_event', { title: 'Demo' }]]);
    } });
    const res = sink();
    await bridgeResponses({ input: input(), res, router });
    const final = events(res).at(-1);
    assert.equal(final.type, 'response.completed');
    assert.equal(final.response.output.length, 1);
    assert.equal(final.response.output[0].namespace, 'calendar');
    assert.equal(final.response.output[0].name, 'create_event');
    assert.deepEqual(JSON.parse(final.response.output[0].arguments), { title: 'Demo' });
    assert.equal(bodies.length, 2);
  });
}

test('unadvertised functions and incomplete discovery never become executable calls', async () => {
  for (const completion of [response([['calendar__create_event', { title: 'Unavailable' }]]), response([['forge_search_tools', { query: 'calendar' }]], 'length')]) {
    const res = sink(); let requests = 0;
    await bridgeResponses({ input: input(), res, router: { openCompletion: async () => { requests++; return { response: requests === 1 ? completion : response([['calendar__create_event', {}]]), route: { name: 'Fixture' } }; } } });
    assert.equal(events(res).at(-1).type, 'response.failed');
    assert.ok(!events(res).some((event) => event.type === 'response.output_item.done'));
  }
});

test('discovery loops are bounded and output-limit recovery retains the capped catalog', async () => {
  const res = sink(); let requests = 0;
  await bridgeResponses({ input: input(), res, router: { openCompletion: async (request) => {
    requests++; assert.equal(request.tools.length, 128);
    return { response: response([['forge_search_tools', { query: 'calendar' }]]), route: { name: 'Fixture' } };
  } } });
  assert.equal(requests, 5);
  assert.match(events(res).at(-1).response.error.message, /repeatedly/);
  const truncated = sink(); let recoveries = 0;
  await bridgeResponses({ input: input(), res: truncated, router: { openCompletion: async (request) => {
    recoveries++; assert.equal(request.tools.length, 128);
    return { response: response([['functions__apply_patch', { input: 'patch' }]], recoveries < 3 ? 'length' : 'tool_calls'), route: { name: 'Fixture' } };
  } } });
  assert.equal(recoveries, 3);
  assert.equal(events(truncated).at(-1).type, 'response.completed');
  assert.equal(events(truncated).at(-1).response.output[0].type, 'custom_tool_call');
});

test('Groq schema budgeting preserves complete schemas and makes oversized tools discoverable', () => {
  const source = input();
  source.tools.push({ type: 'function', name: 'large_plugin', description: 'A large specialist capability.', parameters: { type: 'object', properties: { data: { type: 'string', description: 'x'.repeat(12000) } } } });
  const translated = toChatRequest(source);
  const catalog = createToolCatalog(translated.request, { limit: 32, maxSchemaChars: 8000 });
  assert.ok(catalog.request.tools.length <= 32);
  assert.ok(JSON.stringify(catalog.request.tools).length < 8100);
  assert.ok(!catalog.request.tools.some((tool) => tool.function.name === 'large_plugin'));
  catalog.search({ query: 'large_plugin', limit: 1 });
  const prepared = catalog.prepare(catalog.request.messages);
  assert.deepEqual(prepared.tools.find((tool) => tool.function.name === 'large_plugin'), translated.request.tools.find((tool) => tool.function.name === 'large_plugin'));
  assert.ok(prepared.tools.length <= 32);
});

test('Groq oversized-request recovery adjusts only the output reserve once', async () => {
  const bodies = [];
  const router = createChatProviderRouter({ provider: { id: 'groq-free', name: 'Groq Free', baseUrl: 'https://api.groq.com/openai/v1' }, model: 'openai/gpt-oss-20b', key: 'fixture', fetchImpl: async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return bodies.length === 1 ? new Response(JSON.stringify({ error: { message: 'tokens per minute (TPM): Limit 8000, Requested 8500' } }), { status: 413, headers: { 'Content-Type': 'application/json' } }) : response([],'stop');
  } });
  const original = toChatRequest({ input: 'Keep all of my instructions', tools: [{ type: 'function', name: 'read_file' }] }).request;
  await router.openCompletion(original);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].max_tokens, 1420);
  assert.deepEqual(bodies[1].messages, original.messages);
  assert.deepEqual(bodies[1].tools, original.tools);
  await router.openCompletion(original);
  assert.equal(bodies[2].max_tokens, 1420);
});

test('Groq respects short cooldowns and does not wait on daily limits or long cooldowns', async () => {
  for (const [message, seconds, expectedWaits, expectedMs] of [['tokens per minute (TPM): Please try again in 2.5s.', '2.5', 1, 2600], ['tokens per minute: Please try again in 712.5ms.', '', 1, 813], ['tokens per minute: Please try again in 120s.', '120', 0], ['tokens per day exhausted', '2', 0]]) {
    let requests = 0; const waits = [];
    const router = createChatProviderRouter({ provider: { id: 'groq-free', name: 'Groq Free', baseUrl: 'https://api.groq.com/openai/v1' }, model: 'openai/gpt-oss-20b', key: 'fixture', waitImpl: async (milliseconds) => waits.push(milliseconds), fetchImpl: async () => {
      requests++;
      return requests === 1 ? new Response(JSON.stringify({ error: { message } }), { status: 429, headers: { 'Content-Type': 'application/json', 'retry-after': seconds } }) : response([], 'stop');
    } });
    if (expectedWaits) await router.openCompletion({ messages: [] });
    else await assert.rejects(router.openCompletion({ messages: [] }), /rate limit|token limit/);
    assert.equal(waits.length, expectedWaits);
    assert.equal(requests, expectedWaits + 1);
    if (expectedWaits) assert.equal(waits[0], expectedMs);
  }
});

test('Groq handles a cooldown after output-budget recovery without an unbounded retry', async () => {
  const bodies = [], waits = [];
  const router = createChatProviderRouter({ provider: { id: 'groq-free', name: 'Groq Free', baseUrl: 'https://api.groq.com/openai/v1' }, model: 'openai/gpt-oss-20b', key: 'fixture', waitImpl: async (ms) => waits.push(ms), fetchImpl: async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    if (bodies.length === 1) return new Response(JSON.stringify({ error: { message: 'tokens per minute (TPM): Limit 8000, Requested 8500' } }), { status: 413 });
    if (bodies.length === 2) return new Response(JSON.stringify({ error: { message: 'tokens per minute: Please try again in 712.5ms.' } }), { status: 429 });
    return response([], 'stop');
  } });
  await router.openCompletion({ messages: [{ role: 'user', content: 'Proceed' }] }, undefined, { reasoningEffort: 'low' });
  assert.deepEqual(waits, [813]); assert.equal(bodies.length, 3);
  assert.equal(bodies[2].max_tokens, 1420);
  assert.equal(bodies[2].reasoning_effort, 'low');
});
