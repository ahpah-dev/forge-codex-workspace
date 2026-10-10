import test from 'node:test';
import assert from 'node:assert/strict';
import { isFlagshipRouterProvider, flagshipRouterModels, providerApiFormat, providerBaseInstructions, toChatRequest, createChatProviderRouter, createToolCatalog, bridgeResponses } from '../responses-bridge.mjs';

const provider = { id: 'flagshiprouter', name: 'FlagshipRouter', baseUrl: 'http://localhost:20128/v1', apiFormat: 'auto' };
const fn = (name) => ({ type: 'function', name, parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } });
const namespace = (name, tools) => ({ type: 'namespace', name, tools });
const sink = () => ({ output: '', destroyed: false, writeHead() {}, write(chunk) { this.output += chunk; }, end() {} });
const final = (res) => res.output.split('\n').filter((line) => line.startsWith('data:')).map((line) => JSON.parse(line.slice(5))).at(-1);
const completion = (name, args) => new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 'call_probe', type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] }), { headers: { 'Content-Type': 'application/json' } });

test('FlagshipRouter automatic connections select the tool adapter and compact instructions', () => {
  assert.equal(isFlagshipRouterProvider(provider), true);
  assert.equal(providerApiFormat(provider), 'chat');
  assert.equal(providerApiFormat({ ...provider, apiFormat: 'responses' }), 'responses');
  assert.equal(providerApiFormat({ ...provider, nativePreset: 'flagshiprouter', apiFormat: 'responses' }), 'chat');
  assert.equal(isFlagshipRouterProvider({ ...provider, baseUrl: 'https://unrelated.example/v1' }), false);
  assert.equal(isFlagshipRouterProvider({ id: 'other', name: 'Other', baseUrl: provider.baseUrl }), false);
  assert.match(providerBaseInstructions(provider), /AGENTS.md/);
  assert.ok(providerBaseInstructions(provider).length < 2500);
});

test('FlagshipRouter discovery preserves catalogs above 100 and filters incompatible entries', () => {
  const rows = [
    { id: 'renamed', display_name: 'My coding route', owned_by: 'flagshiprouter' },
    ...Array.from({ length: 137 }, (_, index) => ({ id: `provider/model-${index}`, capabilities: { tools: true } })),
    { id: 'provider/model-0' }, { id: 'inactive', active: false }, { id: 'unready', ready: false },
    { id: 'no-tools', capabilities: { tools: false } }, { id: 'image', kind: 'image' },
    { id: 'embedding', type: 'embedding' }, { id: 'bad id' }, null,
  ];
  const models = flagshipRouterModels(rows);
  assert.equal(models.length, 138);
  assert.deepEqual(models[0], { id: 'renamed', name: 'My coding route' });
  assert.equal(models.at(-1).id, 'provider/model-136');
  assert.equal(flagshipRouterModels(Array.from({ length: 600 }, (_, i) => ({ id: `model-${i}` }))).length, 500);
});

test('additional tool blocks preserve namespaced definitions and allowed-tool restrictions', () => {
  const translated = toChatRequest({ input: [{ type: 'additional_tools', role: 'developer', tools: [namespace('functions', [fn('probe'), fn('other')])] }, { role: 'user', content: 'Proceed' }], tool_choice: { type: 'allowed_tools', tools: [{ type: 'function', name: 'probe', namespace: 'functions' }] } });
  assert.deepEqual(translated.request.tools.map((tool) => tool.function.name), ['functions__probe']);
  assert.equal(translated.toolMap.get('functions__probe').name, 'probe');
  assert.equal(translated.request.messages.at(-1).content, 'Proceed');
  assert.throws(() => toChatRequest({ input: [{ type: 'additional_tools', role: 'user', tools: [fn('probe')] }] }), /developer-role/);
  assert.equal(toChatRequest({ input: [{ role: 'user', content: JSON.stringify({ type: 'additional_tools', tools: [fn('probe')] }) }] }).request.tools, undefined);
});

test('tool aliases remain distinct and stable across catalog order and duplicates', () => {
  const long = 'plugin_namespace_' + 'x'.repeat(64);
  const entries = [namespace(long, [fn('write'), fn('read')]), namespace('a', [fn('b__c')]), namespace('a__b', [fn('c')]), fn('name.with.dot'), fn('name_with_dot')];
  const a = toChatRequest({ input: 'Proceed', tools: [...entries, fn('name_with_dot')] });
  const b = toChatRequest({ input: 'Proceed', tools: entries.toReversed() });
  assert.equal(a.request.tools.length, 6);
  assert.equal(new Set(a.request.tools.map((tool) => tool.function.name)).size, 6);
  for (const [alias, metadata] of a.toolMap) {
    assert.match(alias, /^[a-zA-Z0-9_-]{1,64}$/);
    assert.deepEqual(b.toolMap.get(alias), metadata);
  }
});

test('a gateway original name resolves to the unique advertised namespaced tool', async () => {
  const router = createChatProviderRouter({ provider, model: 'fixture', key: 'fixture', fetchImpl: async () => completion('probe', { value: 'ok' }) });
  const res = sink();
  await bridgeResponses({ res, router, input: { input: 'Proceed', tools: [namespace('functions', [fn('probe')])] } });
  assert.equal(final(res).type, 'response.completed');
  const item = final(res).response.output[0];
  assert.equal(item.name, 'probe'); assert.equal(item.namespace, 'functions');
});

test('ambiguous and unavailable gateway names never become executable tool calls', async () => {
  for (const name of ['probe', 'unavailable']) {
    const router = createChatProviderRouter({ provider, model: 'fixture', key: 'fixture', fetchImpl: async () => completion(name, { value: 'ok' }) });
    const res = sink();
    await bridgeResponses({ res, router, input: { input: 'Proceed', tools: [namespace('one', [fn('probe')]), namespace('two', [fn('probe')])] } });
    assert.equal(final(res).type, 'response.failed');
    assert.equal(final(res).response.output.filter((item) => item.type.includes('tool_call') || item.type === 'function_call').length, 0);
  }
});

test('native custom tool input is preserved when a gateway unwraps its arguments', async () => {
  const raw = 'const r = await tools.exec_command({cmd: "echo probe"});\ntext(r);';
  for (const argumentsValue of [raw, JSON.stringify({ input: raw })]) {
    const router = createChatProviderRouter({ provider, model: 'fixture', key: 'fixture', fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'call_custom', function: { name: 'exec', arguments: argumentsValue } }] }, finish_reason: 'tool_calls' }] }), { headers: { 'Content-Type': 'application/json' } }) });
    const res = sink();
    await bridgeResponses({ res, router, input: { input: [{ type: 'additional_tools', role: 'developer', tools: [namespace('functions', [{ type: 'custom', name: 'exec' }])] }, { role: 'user', content: 'Proceed' }] } });
    assert.equal(final(res).type, 'response.completed');
    assert.equal(final(res).response.output[0].type, 'custom_tool_call');
    assert.equal(final(res).response.output[0].input, raw);
    assert.equal(final(res).response.output[0].namespace, 'functions');
  }
});

test('runtime execution tools survive the schema budget across follow-up requests', () => {
  const input = { input: 'Edit the file', tools: [
    ...Array.from({length:260}, (_,i)=>fn(`status_${i}`)),
    namespace('functions', [{type:'custom',name:'exec',description:'Runtime tool instructions. '.repeat(450)}, fn('wait')]),
  ] };
  const catalog=createToolCatalog(toChatRequest(input).request,{limit:32,maxSchemaChars:5000});
  for (const request of [catalog.request,catalog.prepare([...catalog.request.messages,{role:'user',content:'Continue'}])]) {
    assert.ok(request.tools.some(tool=>tool.function.name==='functions__exec'));
    assert.ok(request.tools.some(tool=>tool.function.name==='functions__wait'));
    assert.ok(request.tools.length<=32);
  }
});

test('FlagshipRouter reports an offline gateway and preserves request cancellation', async () => {
  const router = createChatProviderRouter({ provider, model: 'fixture', key: '', fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(router.openCompletion({ messages: [] }), /FlagshipRouter is not reachable/);
  const aborted = createChatProviderRouter({ provider, model: 'fixture', key: '', fetchImpl: async () => { throw new DOMException('Cancelled', 'AbortError'); } });
  await assert.rejects(aborted.openCompletion({ messages: [] }), { name: 'AbortError' });
});

test('FlagshipRouter header timeouts explain recovery without replaying tool calls', async () => {
  let calls=0;
  const router=createChatProviderRouter({provider,model:'fixture',key:'',fetchImpl:async()=>{calls++;throw new DOMException('Timed out','TimeoutError');}});
  await assert.rejects(router.openCompletion({messages:[]}),error=>error.name==='TimeoutError' && /180 seconds.*Previously completed file changes are retained/.test(error.message));
  assert.equal(calls,1);
});
