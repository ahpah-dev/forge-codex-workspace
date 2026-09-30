import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bridgeResponses } from '../responses-bridge.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(root, 'node_modules/@openai/codex/bin/codex.js');
const sse = (chunks) => new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n');

test('real Codex runtime executes adapted file tools and accepts native planning mode', { timeout: 45000 }, async () => {
  const area = path.join(root, 'data', 'bridge-checks');
  await mkdir(area, { recursive: true });
  const workspace = await mkdtemp(path.join(area, 'run-'));
  const profile = path.join(workspace, 'profile');
  await mkdir(profile);
  let upstreamCalls = 0;
  let observedTools = [];
  let phase = 'code';
  const router = { async openCompletion(request) {
    upstreamCalls++;
    observedTools = request.tools?.map((tool) => tool.function.name) || [];
    let chunks;
    if (!request.messages.some((message) => message.role === 'tool')) {
      const name = observedTools.find((tool) => /exec_command$/.test(tool));
      assert.ok(name, `Expected exec_command in ${observedTools.join(', ')}`);
      const cmd = phase === 'plan' ? "Set-Content -LiteralPath 'plan-must-not-write.txt' -Value 'forbidden'" : "Set-Content -LiteralPath 'marker.txt' -Value 'bridge works'";
      chunks = [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_fixture', function: { name, arguments: JSON.stringify({ cmd, workdir: workspace, max_output_tokens: 1000 }) } }] }, finish_reason: 'tool_calls' }] }];
    } else {
      chunks = [{ choices: [{ delta: { content: phase === 'plan' ? '<proposed_plan>\nInspect the project, then implement the requested change.\n</proposed_plan>' : 'The marker file was created.' }, finish_reason: 'stop' }] }];
    }
    return { response: sse(chunks), route: { provider: 'fixture', name: 'Local fixture' } };
  } };
  const server = createServer(async (req, res) => {
    try {
      let text = ''; for await (const bytes of req) text += bytes;
      await bridgeResponses({ input: JSON.parse(text), res, router });
    } catch (error) { console.error('Fixture bridge:', error.message); if (!res.headersSent) res.writeHead(500); res.end(JSON.stringify({ error: { message: error.message } })); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const child = spawn(process.execPath, [cli, 'app-server', '--listen', 'stdio://'], { env: { ...process.env, CODEX_HOME: profile }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '', diagnostic = '';
  let nextId = 1;
  const pending = new Map();
  const events = [];
  const listeners = new Set();
  child.stderr.on('data', (bytes) => { diagnostic = (diagnostic + bytes).slice(-3000); });
  child.stdout.on('data', (bytes) => {
    buffer += bytes;
    let boundary;
    while ((boundary = buffer.indexOf('\n')) >= 0) {
      const text = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 1);
      if (!text.trim()) continue;
      const message = JSON.parse(text);
      if (message.method && message.id != null) {
        child.stdin.write(JSON.stringify({ id: message.id, result: { decision: phase === 'plan' ? 'decline' : 'accept' } }) + '\n');
      } else if (message.id != null) {
        const request = pending.get(message.id); pending.delete(message.id);
        message.error ? request?.reject(new Error(message.error.message)) : request?.resolve(message.result);
      } else {
        events.push(message); for (const listener of listeners) listener(message);
      }
    }
  });
  function rpc(method, params) {
    return new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n'); });
  }
  function complete(threadId) {
    return new Promise((resolve, reject) => {
      const existing = events.find((event) => event.method === 'turn/completed' && event.params.threadId === threadId);
      if (existing) return resolve(existing);
      const timer = setTimeout(() => { listeners.delete(listener); reject(new Error(`Codex fixture timeout: ${diagnostic}\n${JSON.stringify(events.slice(-4))}`)); }, 30000);
      const listener = (event) => { if (event.method === 'turn/completed' && event.params.threadId === threadId) { clearTimeout(timer); listeners.delete(listener); resolve(event); } };
      listeners.add(listener);
    });
  }
  try {
    await rpc('initialize', { clientInfo: { name: 'forge_bridge_check', version: '1.0.0' }, capabilities: { experimentalApi: true } });
    child.stdin.write('{"method":"initialized","params":{}}\n');
    const config = { web_search: 'disabled', model_providers: { forge_fixture: { name: 'Local fixture', base_url: baseUrl, wire_api: 'responses', requires_openai_auth: false, supports_websockets: false, request_max_retries: 0, stream_max_retries: 0 } } };
    const coding = await rpc('thread/start', { cwd: workspace, model: 'auto-free', modelProvider: 'forge_fixture', sandbox: 'workspace-write', approvalPolicy: 'on-request', config });
    await rpc('thread/inject_items', { threadId: coding.thread.id, items: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Carry forward completed work and inspect files before editing.' }] }] });
    await rpc('turn/start', { threadId: coding.thread.id, input: [{ type: 'text', text: 'Create marker.txt.' }], sandboxPolicy: { type: 'workspaceWrite', writableRoots: [workspace], networkAccess: false }, collaborationMode: { mode: 'default', settings: { model: 'auto-free', reasoning_effort: 'medium', developer_instructions: null } } });
    const codeResult = await complete(coding.thread.id);
    assert.equal(codeResult.params.turn.status, 'completed', JSON.stringify(codeResult.params.turn.error));
    assert.equal((await readFile(path.join(workspace, 'marker.txt'), 'utf8')).trim(), 'bridge works');
    phase = 'plan';
    const planning = await rpc('thread/start', { cwd: workspace, model: 'auto-free', modelProvider: 'forge_fixture', sandbox: 'read-only', approvalPolicy: 'on-request', config });
    await rpc('turn/start', { threadId: planning.thread.id, input: [{ type: 'text', text: 'Plan a change.' }], sandboxPolicy: { type: 'readOnly', networkAccess: false }, collaborationMode: { mode: 'plan', settings: { model: 'auto-free', reasoning_effort: 'medium', developer_instructions: null } } });
    const planResult = await complete(planning.thread.id);
    assert.equal(planResult.params.turn.status, 'completed', JSON.stringify(planResult.params.turn.error));
    await assert.rejects(readFile(path.join(workspace, 'plan-must-not-write.txt')), { code: 'ENOENT' });
    assert.ok(upstreamCalls >= 3);
    assert.ok(events.some((event) => event.method === 'item/completed' && event.params.item?.type === 'commandExecution'));
  } finally {
    child.kill();
    await new Promise((resolve) => server.close(resolve));
  }
});
