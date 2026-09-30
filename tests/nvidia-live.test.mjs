import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bridgeResponses, createChatProviderRouter } from '../responses-bridge.mjs';
import { decryptProviderKey, readEncryptedProviderKeys } from '../provider-secrets.mjs';

test('NVIDIA model creates and edits real files through the Codex runtime', { skip: process.env.FORGE_NVIDIA_LIVE !== '1', timeout: 240000 }, async () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const data = process.env.FORGE_NVIDIA_DATA || path.join(process.env.APPDATA, 'forge-codex-workspace', 'data');
  const settings = JSON.parse(await readFile(path.join(data, 'settings.json'), 'utf8'));
  const provider = settings.providers.find((p) => new URL(p.baseUrl).hostname === 'integrate.api.nvidia.com');
  assert.ok(provider, 'Configure NVIDIA in Forge first');
  const keys = await readEncryptedProviderKeys(path.join(data, 'provider-secrets.json'));
  const key = await decryptProviderKey(keys[provider.id]);
  const model = process.env.FORGE_NVIDIA_MODEL || 'openai/gpt-oss-20b';
  const router = createChatProviderRouter({ provider, model, key });
  const area = path.join(root, 'data', 'nvidia-checks');
  await mkdir(area, { recursive: true });
  const workspace = await mkdtemp(path.join(area, 'run-'));
  const profile = path.join(workspace, 'profile');
  await mkdir(profile);
  await writeFile(path.join(workspace, 'existing.txt'), 'before\n');
  let requests = 0;
  const server = createServer(async (req, res) => {
    try {
      let body = ''; for await (const bytes of req) body += bytes;
      requests++;
      await bridgeResponses({ input: JSON.parse(body), res, router, signal: AbortSignal.timeout(180000) });
    } catch (error) {
      if (!res.headersSent) res.writeHead(500);
      res.end(JSON.stringify({ error: { message: error.message } }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const child = spawn(process.execPath, [path.join(root, 'node_modules/@openai/codex/bin/codex.js'), 'app-server', '--listen', 'stdio://'], {
    env: { ...process.env, CODEX_HOME: profile }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = '', nextId = 1;
  const pending = new Map(), events = [], listeners = new Set();
  child.stderr.on('data', () => {});
  child.stdout.on('data', (bytes) => {
    buffer += bytes;
    let boundary;
    while ((boundary = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.method && message.id != null) {
        // Only this disposable workspace receives approvals during this check.
        child.stdin.write(JSON.stringify({ id: message.id, result: { decision: 'accept' } }) + '\n');
      } else if (message.id != null) {
        const request = pending.get(message.id); pending.delete(message.id);
        message.error ? request?.reject(new Error(message.error.message)) : request?.resolve(message.result);
      } else { events.push(message); for (const listener of listeners) listener(message); }
    }
  });
  function rpc(method, params) {
    return new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n'); });
  }
  try {
    await rpc('initialize', { clientInfo: { name: 'forge_nvidia_check', version: '1.0.15' }, capabilities: { experimentalApi: true } });
    child.stdin.write('{"method":"initialized","params":{}}\n');
    const config = { web_search: 'disabled', model_providers: { nim_check: { name: 'NVIDIA check', base_url: `http://127.0.0.1:${server.address().port}`, wire_api: 'responses', requires_openai_auth: false, supports_websockets: false, request_max_retries: 0, stream_max_retries: 0 } } };
    const started = await rpc('thread/start', { cwd: workspace, model, modelProvider: 'nim_check', sandbox: 'workspace-write', approvalPolicy: 'on-request', config });
    const completed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('NVIDIA edit check timed out')), 210000);
      listeners.add((event) => { if (event.method === 'turn/completed' && event.params.threadId === started.thread.id) { clearTimeout(timer); resolve(event.params.turn); } });
    });
    await rpc('turn/start', { threadId: started.thread.id, input: [{ type: 'text', text: 'Use your file tools to edit existing.txt to contain exactly after followed by a newline, and create created.txt containing exactly NVIDIA saved this followed by a newline. Use the provided forge_write_file and forge_edit_file tools if available. Actually save both files on disk, then verify their contents. Only work in this current directory. Keep the final answer short.' }], sandboxPolicy: { type: 'workspaceWrite', writableRoots: [workspace], networkAccess: false } });
    const result = await completed;
    assert.equal(result.status, 'completed', JSON.stringify(result.error));
    assert.equal(await readFile(path.join(workspace, 'existing.txt'), 'utf8'), 'after\n');
    assert.equal(await readFile(path.join(workspace, 'created.txt'), 'utf8'), 'NVIDIA saved this\n');
    assert.ok(events.some((event) => event.method === 'item/completed' && ['fileChange', 'commandExecution'].includes(event.params.item?.type)));
    console.log(JSON.stringify({ model, requests, verified: ['existing.txt edited', 'created.txt created'], workspace }));
  } finally {
    child.kill(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  }
});
