import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bridgeResponses, createChatProviderRouter, providerBaseInstructions } from '../responses-bridge.mjs';
import { decryptProviderKey, readEncryptedProviderKeys } from '../provider-secrets.mjs';
import { createOmniRouteRouting, omniRouteFallbacks } from '../omniroute-routing.mjs';
import { createOmniRouteManager, OMNIROUTE_BASE_URL } from '../omniroute-manager.mjs';

for (const {providerId,task} of [{providerId:'groq-free',task:'files'},{providerId:'groq-free',task:'chat'},{providerId:'kilo-free-router',task:'files'},{providerId:'omniroute-local',task:'files'}]) test(task==='chat' ? `${providerId} GPT-OSS 20B answers a normal native Codex request` : `${providerId} creates and edits real files with over 250 available tools`, { skip: process.env.FORGE_TOOL_LIVE !== '1', timeout: 360000 }, async () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const data = process.env.FORGE_TOOL_DATA || path.join(process.env.APPDATA, 'forge-codex-workspace', 'data');
  const settings = JSON.parse(await readFile(path.join(data, 'settings.json'), 'utf8'));
  const omni=providerId==='omniroute-local';
  const provider = settings.providers.find((p) => p.id === providerId) || (omni?{id:providerId,name:'OmniRoute Local',nativePreset:'omniroute',baseUrl:OMNIROUTE_BASE_URL}:null);
  assert.ok(provider, 'Configure this provider in Forge first');
  const keys = await readEncryptedProviderKeys(path.join(data, 'provider-secrets.json'));
  const key = keys[provider.id] ? await decryptProviderKey(keys[provider.id]) : '';
  const model = omni ? 'auto/coding:free' : providerId === 'groq-free' ? task==='chat' ? 'openai/gpt-oss-20b' : process.env.FORGE_GROQ_CHECK_MODEL || 'openai/gpt-oss-120b' : 'kilo-auto/free';
  const localGateway=omni?createOmniRouteManager({appRoot:root,dataRoot:path.join(root,'data/omniroute-check')}):null;
  let inferenceRequests=0;const toolCounts=[];
  const fetchImpl = async (url, options) => {
    const body=JSON.parse(options.body);inferenceRequests++;toolCounts.push(body.tools?.length || 0);
    if(inferenceRequests===1) {assert.ok(JSON.stringify(body.messages).includes('FORGE_PROJECT_RULE_PROBE'));assert.ok(JSON.stringify(body.messages).includes(task==='chat'?'FORGE_CHAT_PROBE':'Actually save both files'));}
    if(inferenceRequests===1) console.log(JSON.stringify({provider:providerId,outputBudget:body.max_tokens,messageChars:JSON.stringify(body.messages).length,toolChars:JSON.stringify(body.tools).length}));
    assert.ok((body.tools?.length || 0)<=128);
    const response = await fetch(url,options);
    if (!response.ok) {
      const detail = await response.clone().json().catch(() => ({}));
      const requestKey=options.headers.Authorization?.replace(/^Bearer /,'');
      const message=String(detail.error?.message || detail.message || '');
      console.log(JSON.stringify({ provider: providerId, status: response.status, message: requestKey?message.split(requestKey).join('[redacted]'):message }));
    }
    return response;
  };
  const routing=omni?createOmniRouteRouting({fetchImpl,getFallbacks:async()=>omniRouteFallbacks(settings.providers,id=>Boolean(keys[id]),id=>decryptProviderKey(keys[id]),fetchImpl),onRoute:route=>console.log(JSON.stringify({provider:providerId,selectedProvider:route.providerName,selectedModel:route.model,fallback:route.fallback}))}):null;
  const makeRouter=()=>omni?routing.forProvider({provider,model,key,ensureGateway:()=>localGateway.start()}):createChatProviderRouter({provider,model,key,fetchImpl});
  const area = path.join(root, 'data', 'provider-tool-checks');
  await mkdir(area, { recursive: true });
  const workspace = await mkdtemp(path.join(area, 'run-'));
  const profile = path.join(workspace, 'profile');
  await mkdir(profile);
  await writeFile(path.join(workspace, 'existing.txt'), 'before\n');
  await writeFile(path.join(workspace, 'AGENTS.md'), 'FORGE_PROJECT_RULE_PROBE: Read existing files before changing them.\n');
  let requests = 0;
  const server = createServer(async (req, res) => {
    try {
      let body = ''; for await (const bytes of req) body += bytes;
      requests++;
      const input=JSON.parse(body);
      input.tools=[...Array.from({length:260},(_,index)=>({type:'function',name:'fixture_status_'+index,description:'An unrelated status lookup.',parameters:{type:'object',properties:{}}})),...(input.tools || [])];
      await bridgeResponses({ input, res, router: makeRouter(), signal: AbortSignal.timeout(180000) });
    } catch (error) {
      console.log(JSON.stringify({ provider: providerId, bridgeError: String(error.message).split(key).join('[redacted]') }));
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
    await rpc('initialize', { clientInfo: { name: 'forge_provider_tool_check', version: '1.0.41' }, capabilities: { experimentalApi: true } });
    child.stdin.write('{"method":"initialized","params":{}}\n');
    const config = { web_search: 'disabled', model_providers: { provider_check: { name: 'Provider check', base_url: `http://127.0.0.1:${server.address().port}`, wire_api: 'responses', requires_openai_auth: false, supports_websockets: false, request_max_retries: 0, stream_max_retries: 0 } } };
    const started = await rpc('thread/start', { cwd: workspace, model, modelProvider: 'provider_check', sandbox: 'workspace-write', approvalPolicy: 'on-request', config, ...(providerBaseInstructions(provider) ? {baseInstructions:providerBaseInstructions(provider)} : {}) });
    const completed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Provider edit check timed out')), 330000);
      listeners.add((event) => { if (event.method === 'turn/completed' && event.params.threadId === started.thread.id) { clearTimeout(timer); resolve(event.params.turn); } });
    });
    const batching = providerId === 'groq-free' ? 'For this check perform both file changes and their byte verification in one exec_command shell call to minimize API requests. ' : '';
    await rpc('turn/start', { threadId: started.thread.id, effort: 'medium', input: [{ type: 'text', text: task==='chat' ? 'FORGE_CHAT_PROBE: Reply exactly "Forge is ready." Do not call any tools or modify files.' : batching + 'Use your file tools to edit existing.txt: replace the exact JSON string "before\\n" with "after\\n". Create created.txt containing the exact JSON string "Provider saved this\\n". Here \\n means a real trailing LF byte, not the two characters backslash and n. Actually save both files on disk. Verify their bytes, including the final byte 10, and correct any missing trailing newline before completing. Only work in this current directory. Keep the final answer short.' }], sandboxPolicy: { type: 'workspaceWrite', writableRoots: [workspace], networkAccess: false } });
    const result = await completed;
    assert.equal(result.status, 'completed', key?String(result.error?.message || '').split(key).join('[redacted]'):String(result.error?.message || ''));
    if(task==='chat') {
      assert.ok(events.some(event=>event.method==='item/completed' && event.params.item?.type==='agentMessage' && event.params.item.text?.trim()==='Forge is ready.'));
      assert.equal(await readFile(path.join(workspace,'existing.txt'),'utf8'),'before\n');
      await assert.rejects(readFile(path.join(workspace,'created.txt')),error=>error.code==='ENOENT');
      console.log(JSON.stringify({provider:providerId,model,requests,inferenceRequests,toolCounts,verified:['normal native request answered','project rules retained','no files changed']}));
      return;
    }
    assert.equal(await readFile(path.join(workspace, 'existing.txt'), 'utf8'), 'after\n');
    assert.equal(await readFile(path.join(workspace, 'created.txt'), 'utf8'), 'Provider saved this\n');
    assert.ok(events.some((event) => event.method === 'item/completed' && ['fileChange', 'commandExecution'].includes(event.params.item?.type)));
    console.log(JSON.stringify({ provider:providerId, model, requests, inferenceRequests, toolCounts, verified: ['existing.txt edited', 'created.txt created'], workspace }));
  } finally {
    child.kill(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
    await localGateway?.stop();
  }
});

for (const providerId of ['groq-free', 'kilo-free-router']) test(`${providerId} discovers a function beyond the active catalog`, { skip: process.env.FORGE_TOOL_LIVE !== '1', timeout: 150000 }, async () => {
  const data = process.env.FORGE_TOOL_DATA || path.join(process.env.APPDATA, 'forge-codex-workspace', 'data');
  const settings = JSON.parse(await readFile(path.join(data, 'settings.json'), 'utf8'));
  const provider = settings.providers.find((p) => p.id === providerId);
  const keys = await readEncryptedProviderKeys(path.join(data, 'provider-secrets.json'));
  const key = await decryptProviderKey(keys[provider.id]);
  const counts = []; let sawSearch = false;
  const router = createChatProviderRouter({ provider, model: providerId === 'groq-free' ? 'openai/gpt-oss-20b' : 'kilo-auto/free', key, fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); counts.push(body.tools.length);
    if (counts.length === 1) assert.ok(!body.tools.some((tool) => tool.function.name === 'cedar__sentinel'));
    if (body.messages.some((message) => message.role === 'tool')) sawSearch = true;
    assert.ok(body.tools.length <= 128);
    return fetch(url, options);
  } });
  const res = { output: '', destroyed: false, writeHead() {}, write(chunk) { this.output += chunk; }, end() {} };
  await bridgeResponses({ res, router, signal: AbortSignal.timeout(140000), input: {
    instructions: 'First use forge_search_tools with query cedar sentinel and limit 1. After reading its result, call the discovered cedar sentinel function with value 42. Do not call status lookups or produce an ordinary text answer. This is a function discovery check.',
    input: 'Proceed.', tool_choice: 'required',
    tools: [...Array.from({ length: 260 }, (_, index) => ({ type: 'function', name: 'status_' + index, description: 'Unrelated status lookup.', parameters: { type: 'object', properties: {} } })), { type: 'namespace', name: 'cedar', tools: [{ type: 'function', name: 'sentinel', description: 'Cedar sentinel function.', parameters: { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'], additionalProperties: false } }] }],
  } });
  const final = res.output.split('\n').filter((line) => line.startsWith('data:')).map((line) => JSON.parse(line.slice(5))).at(-1);
  assert.equal(final.type, 'response.completed', String(final.response.error?.message || '').split(key).join('[redacted]'));
  assert.ok(sawSearch);
  const call = final.response.output.find((item) => item.type === 'function_call');
  assert.equal(call.namespace, 'cedar'); assert.equal(call.name, 'sentinel');
  assert.equal(JSON.parse(call.arguments).value, 42);
  console.log(JSON.stringify({ provider: providerId, toolCounts: counts, verified: ['live function discovery', 'original namespace restored'] }));
});
