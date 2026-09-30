import test from 'node:test';
import assert from 'node:assert/strict';
import { createFreeRouter, isFreeModel, isCodexLimitError, exhaustedCodexLimit } from '../free-router.mjs';
import { toChatRequest, bridgeResponses } from '../responses-bridge.mjs';

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
  await assert.rejects(router.openCompletion(request), /NVIDIA NIM also reached/);
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
  assert.equal(translated.messages[2].tool_calls[0].function.name, 'functions__read_file');
  assert.equal(translated.messages[3].tool_call_id, 'c1');
  assert.equal(JSON.parse(translated.messages[4].tool_calls[0].function.arguments).input, '*** exact patch ***');
  assert.equal(toolMap.get('functions__apply_patch').custom, true);
});

test('unsupported history is rejected rather than silently dropped', () => {
  assert.throws(() => toChatRequest({ input: [{ type: 'compaction', encrypted_content: 'opaque' }] }), /Cannot safely translate/);
});

function sink() {
  return { output: '', destroyed: false, writeHead() {}, write(chunk) { this.output += chunk; }, end() {} };
}
function events(res) { return res.output.split('\n').filter((line) => line.startsWith('data:')).map((line) => JSON.parse(line.slice(5))); }

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
