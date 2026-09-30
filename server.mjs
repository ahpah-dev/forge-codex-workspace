import { spawn, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { decryptProviderKey, encryptProviderKey, readEncryptedProviderKeys, writeEncryptedProviderKeys } from './provider-secrets.mjs';
import { createAnthropicProvider } from './anthropic-provider.mjs';

const execFileAsync = promisify(execFile);
const appRoot = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(appRoot, 'public');
const dataRoot = process.env.FORGE_DATA_DIR || path.join(appRoot, 'data');
const settingsPath = path.join(dataRoot, 'settings.json');
const providerKeysPath = path.join(dataRoot, 'provider-secrets.json');
const providerAuthScript = path.join(appRoot, 'provider-auth.mjs');
const bundledCodexCli = path.join(appRoot, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
const codexExecutable = process.env.CODEX_CLI || (existsSync(bundledCodexCli) ? process.execPath : 'codex');
const codexPrefixArgs = process.env.CODEX_CLI || !existsSync(bundledCodexCli) ? [] : [bundledCodexCli];
const codexArgs = (args) => [...codexPrefixArgs, ...args];
const host = '127.0.0.1';
const sessionToken = randomBytes(32).toString('hex');
const ignoredFolders = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage', '.turbo', '.venv', 'venv', '__pycache__']);
const defaultSettings = { activeWorkspace: '', recentWorkspaces: [], providers: [] };

let settings = await loadSettings();
let activeWorkspace = await normalizeSavedWorkspace(settings.activeWorkspace);
let port = Number.parseInt(process.env.FORGE_PORT || '4173', 10);
let initialAppState = null;
let threadOpenRevision = 0;

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
}

async function loadSettings() {
  try {
    const saved = JSON.parse(await readFile(settingsPath, 'utf8'));
    const providers = Array.isArray(saved.providers) ? saved.providers.filter((provider) => provider && /^[a-z0-9][a-z0-9_-]{0,40}$/.test(provider.id || '') && !['openai', 'anthropic'].includes(provider.id)).map((provider) => ({
      id: provider.id,
      name: String(provider.name || provider.id).slice(0, 48),
      baseUrl: String(provider.baseUrl || ''),
      models: Array.isArray(provider.models) ? provider.models.filter((model) => model && /^[\w./:@+-]{1,180}$/.test(model.id || '')).slice(0, 100).map((model) => ({ id: model.id, name: String(model.name || model.id).slice(0, 180) })) : [],
    })) : [];
    return { ...defaultSettings, ...saved, recentWorkspaces: Array.isArray(saved.recentWorkspaces) ? saved.recentWorkspaces : [], providers };
  } catch {
    return { ...defaultSettings };
  }
}

async function saveSettings() {
  await mkdir(dataRoot, { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

function normalizeProviderBaseUrl(value) {
  let parsed;
  try { parsed = new URL(String(value || '').trim()); }
  catch { throw new Error('Enter a valid provider base URL.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname.toLowerCase());
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    throw new Error('Provider URLs must use HTTPS. HTTP is allowed only for a local endpoint.');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Remove credentials, query parameters, and fragments from the base URL.');
  const pathname = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${pathname}`;
}

function normalizeProviderModels(value) {
  const entries = Array.isArray(value) ? value : String(value || '').split(/[\r\n,]+/);
  const models = [];
  const seen = new Set();
  for (const item of entries) {
    const id = String(typeof item === 'string' ? item : item?.id || '').trim();
    if (!id || seen.has(id)) continue;
    if (!/^[\w./:@+-]{1,180}$/.test(id)) throw new Error(`Model ID “${id.slice(0, 45)}” contains unsupported characters.`);
    seen.add(id);
    models.push({ id, name: id });
    if (models.length >= 100) break;
  }
  if (!models.length) throw new Error('Add at least one model ID or use Load models.');
  return models;
}

function providerIdFromName(value) {
  const id = String(value || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  if (!id) throw new Error('Enter a provider name.');
  if (['openai', 'anthropic', 'ollama', 'lmstudio'].includes(id)) throw new Error('That ID is reserved by a built-in model provider. Choose another provider name.');
  return id;
}

function publicProviders(encryptedKeys = {}) {
  return settings.providers.map((provider) => ({
    ...provider,
    authConfigured: typeof encryptedKeys[provider.id] === 'string' && Boolean(encryptedKeys[provider.id]),
  }));
}

function providerThreadConfig(provider) {
  return {
    model_providers: {
      [provider.id]: {
        name: provider.name,
        base_url: provider.baseUrl,
        wire_api: 'responses',
        supports_websockets: false,
        auth: {
          command: process.execPath,
          args: [providerAuthScript, provider.id],
          timeout_ms: 10000,
          refresh_interval_ms: 0,
        },
      },
    },
  };
}

async function normalizeSavedWorkspace(candidate) {
  if (!candidate) return '';
  try {
    const canonical = await realpath(path.resolve(candidate));
    return (await stat(canonical)).isDirectory() ? canonical : '';
  } catch {
    return '';
  }
}

function pathIsInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function setWorkspace(candidate) {
  const input = String(candidate || '').trim().replace(/^['"]|['"]$/g, '');
  if (!input) throw new Error('Enter a folder path to open a workspace.');
  const canonical = await realpath(path.resolve(input));
  const details = await stat(canonical);
  if (!details.isDirectory()) throw new Error('That path is not a folder.');
  if (activeWorkspace && activeWorkspace.toLowerCase() === canonical.toLowerCase()) {
    return { path: canonical, name: path.basename(canonical) || canonical };
  }
  activeWorkspace = canonical;
  const prior = settings.recentWorkspaces.filter((item) => item.path.toLowerCase() !== canonical.toLowerCase());
  settings.recentWorkspaces = [{ path: canonical, name: path.basename(canonical) || canonical }, ...prior].slice(0, 8);
  settings.activeWorkspace = canonical;
  await saveSettings();
  return { path: canonical, name: path.basename(canonical) || canonical };
}

async function resolveWorkspacePath(relativePath = '') {
  if (!activeWorkspace) throw new Error('Open a workspace folder first.');
  const absolute = path.resolve(activeWorkspace, String(relativePath || ''));
  if (!pathIsInside(activeWorkspace, absolute)) throw new Error('That path is outside the open workspace.');
  const canonical = await realpath(absolute);
  if (!pathIsInside(activeWorkspace, canonical)) throw new Error('That path resolves outside the open workspace.');
  return canonical;
}

async function readTree(relativePath = '') {
  const directory = await resolveWorkspacePath(relativePath);
  const details = await stat(directory);
  if (!details.isDirectory()) throw new Error('The selected path is not a folder.');
  const entries = await readdir(directory, { withFileTypes: true });
  const visible = entries
    .filter((entry) => !(entry.isDirectory() && ignoredFolders.has(entry.name)))
    .filter((entry) => entry.name !== '.' && entry.name !== '..')
    .sort((left, right) => Number(right.isDirectory()) - Number(left.isDirectory()) || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
    .slice(0, 250);
  return visible.filter((entry) => entry.isDirectory() || entry.isFile()).map((entry) => {
    const relative = path.relative(activeWorkspace, path.join(directory, entry.name)).split(path.sep).join('/');
    return { name: entry.name, path: relative, kind: entry.isDirectory() ? 'directory' : 'file', extension: path.extname(entry.name).slice(1).toLowerCase() };
  });
}

async function readWorkspaceFile(relativePath) {
  const filePath = await resolveWorkspacePath(relativePath);
  const details = await stat(filePath);
  if (!details.isFile()) throw new Error('Select a file to preview it.');
  if (details.size > 512 * 1024) throw new Error('This file is larger than the 512 KB preview limit.');
  const contents = await readFile(filePath);
  if (contents.includes(0)) return { path: relativePath, isText: false, content: '', size: details.size };
  const text = contents.toString('utf8');
  return { path: relativePath, isText: true, content: text, size: details.size };
}

async function readGitSummary() {
  if (!activeWorkspace) return { branch: null, changedFiles: 0, entries: [] };
  try {
    const { stdout } = await execFileAsync('git', ['status', '--short', '--branch'], { cwd: activeWorkspace, timeout: 7000, windowsHide: true, maxBuffer: 1024 * 1024 });
    const lines = stdout.split(/\r?\n/).filter(Boolean);
    const branchLine = lines.shift() || '';
    const changed = lines.map((line) => ({ status: line.slice(0, 2).trim() || '·', path: line.slice(3) })).slice(0, 100);
    return { branch: branchLine.startsWith('## ') ? branchLine.slice(3).split('...')[0] : null, changedFiles: changed.length, entries: changed };
  } catch {
    return { branch: null, changedFiles: 0, entries: [] };
  }
}

class CodexAppServer {
  constructor() {
    this.child = null;
    this.initialized = false;
    this.starting = null;
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map();
    this.serverRequests = new Map();
    this.stderrTail = '';
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* A disconnected browser cannot interrupt the Codex process. */ }
    }
  }

  async ensureStarted() {
    if (this.initialized && this.child && !this.child.killed) return;
    if (this.starting) return this.starting;
    this.starting = this.start();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async start() {
    const child = spawn(codexExecutable, codexArgs(['app-server', '--listen', 'stdio://']), {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: process.env,
    });
    this.child = child;
    this.initialized = false;
    this.buffer = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.readStdout(chunk));
    child.stderr.on('data', (chunk) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-4000);
      if (/failed to start|fatal|panic/i.test(chunk)) this.emit({ type: 'diagnostic', message: String(chunk).trim().slice(-700) });
    });
    child.on('error', (error) => {
      this.failPending(error);
      this.emit({ type: 'connection', connected: false, message: error.message });
    });
    child.on('close', (code) => {
      if (this.child === child) {
        this.child = null;
        this.initialized = false;
      }
      this.failPending(new Error(`Codex App Server exited${code === null ? '' : ` with code ${code}`}.`));
      this.emit({ type: 'connection', connected: false, message: 'Codex connection closed.' });
    });
    await this.requestRaw('initialize', {
      clientInfo: { name: 'forge_coding_workspace', title: 'Forge', version: '1.0.0' },
      capabilities: { experimentalApi: true },
    });
    this.notify('initialized', {});
    this.initialized = true;
    this.emit({ type: 'connection', connected: true });
  }

  readStdout(chunk) {
    this.buffer += chunk;
    let newline;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        this.emit({ type: 'diagnostic', message: line.slice(0, 500) });
        continue;
      }
      if (Object.hasOwn(message, 'id') && typeof message.method === 'string') {
        this.serverRequests.set(String(message.id), message.method);
        this.emit({ type: 'server-request', id: message.id, method: message.method, params: message.params || {} });
      } else if (Object.hasOwn(message, 'id')) {
        const pending = this.pending.get(String(message.id));
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(String(message.id));
          if (message.error) pending.reject(new Error(message.error.message || 'Codex returned an error.'));
          else pending.resolve(message.result);
        }
      } else if (message.method) {
        this.emit({ type: 'notification', method: message.method, params: message.params || {} });
      }
    }
  }

  failPending(error) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  write(message) {
    if (!this.child || this.child.killed || !this.child.stdin.writable) throw new Error('Codex App Server is not running.');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  requestRaw(method, params = {}, timeoutMs = 30000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new Error(`Codex did not respond to ${method} in time.`));
      }, timeoutMs);
      this.pending.set(String(id), { resolve, reject, timer });
      try {
        this.write({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(String(id));
        reject(error);
      }
    });
  }

  async rpc(method, params = {}, timeoutMs = 30000) {
    await this.ensureStarted();
    return this.requestRaw(method, params, timeoutMs);
  }

  notify(method, params = {}) {
    this.write({ method, params });
  }

  reply(id, result) {
    const key = String(id);
    if (!this.serverRequests.has(key)) throw new Error('That Codex request is no longer waiting for a reply.');
    this.serverRequests.delete(key);
    this.write({ id, result });
  }

  rejectRequest(id, message = 'This request was declined in Forge.') {
    const key = String(id);
    if (!this.serverRequests.has(key)) throw new Error('That Codex request is no longer waiting for a reply.');
    this.serverRequests.delete(key);
    this.write({ id, error: { code: -32000, message } });
  }

  async stop() {
    const child = this.child;
    this.child = null;
    this.initialized = false;
    if (child && !child.killed) {
      try { child.stdin.end(); } catch { /* Process is already stopping. */ }
      const timer = setTimeout(() => { if (!child.killed) child.kill(); }, 1500);
      timer.unref();
    }
  }
}

const codex = new CodexAppServer();
let nextEventId = 1;
const eventHistory = [];
const eventClients = new Set();
const threadHistoryCache = new Map();
const threadHistoryLoads = new Map();
const threadHistoryRevisions = new Map();
const threadResumeLoads = new Map();
const resumedThreads = new Set();
const threadHistoryCacheLimit = 8;

function invalidateThreadHistory(threadId) {
  if (!threadId) return;
  threadHistoryRevisions.set(threadId, (threadHistoryRevisions.get(threadId) || 0) + 1);
  threadHistoryCache.delete(threadId);
}

function publish(event) {
  const wrapped = { id: nextEventId++, event };
  eventHistory.push(wrapped);
  if (eventHistory.length > 150) eventHistory.shift();
  const encoded = `id: ${wrapped.id}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const response of eventClients) {
    try { response.write(encoded); } catch { eventClients.delete(response); }
  }
}

codex.subscribe((event) => {
  if (event.type === 'notification' && /^(item\/(started|delta|completed)|turn\/(started|completed|failed|interrupted))$/.test(event.method || '')) {
    invalidateThreadHistory(event.params?.threadId);
  }
  publish(event);
});

const anthropic = createAnthropicProvider({
  dataRoot,
  publish,
  executable: process.env.CLAUDE_CLI || 'claude',
});

async function getAccount() {
  await codex.ensureStarted();
  const result = await codex.rpc('account/read', {});
  return {
    connected: Boolean(result?.account),
    type: result?.account?.type || null,
    planType: result?.account?.planType || null,
    requiresOpenaiAuth: Boolean(result?.requiresOpenaiAuth),
  };
}

let codexCliVersionPromise;
function getCodexCliVersion() {
  if (!codexCliVersionPromise) {
    codexCliVersionPromise = execFileAsync(codexExecutable, codexArgs(['--version']), { timeout: 5000, windowsHide: true })
      .then(({ stdout }) => {
        const text = String(stdout || '').trim();
        const match = text.match(/(\d+)\.(\d+)\.(\d+)/);
        if (!match) return { version: text || null, supportsGpt6Family: false };
        const [major, minor, patch] = match.slice(1).map(Number);
        const supportsGpt6Family = major > 0 || minor > 156 || (minor === 156 && patch >= 1);
        return { version: match[0], supportsGpt6Family };
      })
      .catch(() => ({ version: null, supportsGpt6Family: false }));
  }
  return codexCliVersionPromise;
}

async function getAppState() {
  const [account, codexCli, encryptedProviderKeys, anthropicStatus] = await Promise.all([
    getAccount(),
    getCodexCliVersion(),
    readEncryptedProviderKeys(providerKeysPath),
    anthropic.getStatus(),
  ]);
  let models = [];
  let limits = null;
  let threads = [];
  if (account.connected) {
    const [modelResult, limitsResult, threadsResult] = await Promise.allSettled([
      codex.rpc('model/list', { includeHidden: false, limit: 50 }),
      codex.rpc('account/rateLimits/read', {}),
      activeWorkspace ? codex.rpc('thread/list', { cwd: activeWorkspace, limit: 40, sortKey: 'updated_at', sortDirection: 'desc' }) : Promise.resolve({ data: [] }),
    ]);
    if (modelResult.status === 'fulfilled') models = (modelResult.value.data || []).map((model) => ({
      id: model.model || model.id,
      name: model.displayName || model.model || model.id,
      isDefault: Boolean(model.isDefault),
      reasoningEfforts: (model.supportedReasoningEfforts || []).map((item) => item.reasoningEffort),
      defaultEffort: model.defaultReasoningEffort || 'medium',
      description: model.description || '',
    }));
    if (limitsResult.status === 'fulfilled') limits = limitsResult.value.rateLimitsByLimitId || limitsResult.value.rateLimits || null;
    if (threadsResult.status === 'fulfilled') threads = threadsResult.value.data || [];
  }
  if (activeWorkspace) threads.push(...await anthropic.listThreads(activeWorkspace));
  const git = await readGitSummary();
  const visibleThreads = [];
  const seenThreadIds = new Set();
  for (const thread of threads) {
    if (!thread.id || seenThreadIds.has(thread.id)) continue;
    seenThreadIds.add(thread.id);
    visibleThreads.push(thread);
  }
  void warmRecentThreadHistories(visibleThreads.slice(0, 4).map((thread) => thread.id));
  return {
    account,
    codexCli,
    models,
    providers: publicProviders(encryptedProviderKeys),
    anthropic: anthropicStatus,
    limits,
    workspace: activeWorkspace ? { path: activeWorkspace, name: path.basename(activeWorkspace) || activeWorkspace } : null,
    recentWorkspaces: settings.recentWorkspaces,
    threads: visibleThreads.map((thread) => ({ id: thread.id, name: thread.name || thread.preview || 'Untitled session', updatedAt: thread.updatedAt, status: thread.status?.type || thread.status || null, modelProvider: thread.modelProvider || 'openai' })),
    git,
  };
}

function requireSession(req) {
  const origin = req.headers.origin;
  if (origin) {
    const hostHeader = req.headers.host;
    try {
      if (new URL(origin).host !== hostHeader) return false;
    } catch {
      return false;
    }
  }
  const supplied = req.headers['x-forge-session'] || (req.url?.startsWith('/api/events') ? new URL(req.url, `http://${host}`).searchParams.get('token') : null);
  return supplied === sessionToken;
}

async function bodyJson(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 1024 * 1024) throw new Error('Request body is too large.');
  }
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new Error('Request body must be valid JSON.'); }
}

async function readThreadHistory(threadId) {
  const result = await codex.rpc('thread/read', { threadId, includeTurns: true });
  const thread = result.thread;
  const messages = [];
  for (const turn of thread?.turns || []) {
    for (const item of turn.items || []) {
      if (item.type === 'userMessage') {
        const content = (item.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('\n');
        if (content) messages.push({ id: item.id, turnId: turn.id, role: 'user', text: content });
      } else if (item.type === 'agentMessage') {
        messages.push({ id: item.id, turnId: turn.id, role: 'assistant', text: item.text || '' });
      } else if (item.type === 'plan') {
        messages.push({ id: item.id, turnId: turn.id, role: 'plan', text: item.text || '' });
      } else if (item.type === 'commandExecution') {
        messages.push({ id: item.id, turnId: turn.id, role: 'activity', activityType: 'command', command: item.command, output: item.aggregatedOutput || '', status: item.status?.type || item.status || '', exitCode: item.exitCode });
      } else if (item.type === 'fileChange') {
        messages.push({ id: item.id, turnId: turn.id, role: 'activity', activityType: 'files', changes: item.changes || [], status: item.status?.type || item.status || '' });
      } else if (item.type === 'collabAgentToolCall' || item.type === 'subAgentActivity') {
        messages.push({ id: item.id, turnId: turn.id, role: 'agent-event', item });
      }
    }
  }
  return { thread: { id: thread.id, name: thread.name || thread.preview || 'Untitled session', cwd: thread.cwd, modelProvider: thread.modelProvider || 'openai' }, messages };
}

async function getThreadHistory(threadId) {
  if (anthropic.owns(threadId)) return anthropic.readThreadHistory(threadId);
  const cached = threadHistoryCache.get(threadId);
  if (cached) {
    threadHistoryCache.delete(threadId);
    threadHistoryCache.set(threadId, cached);
    return cached.result;
  }
  const pending = threadHistoryLoads.get(threadId);
  if (pending) return pending;

  const revision = threadHistoryRevisions.get(threadId) || 0;
  const load = readThreadHistory(threadId).then((result) => {
    if ((threadHistoryRevisions.get(threadId) || 0) === revision) {
      threadHistoryCache.delete(threadId);
      threadHistoryCache.set(threadId, { result, loadedAt: Date.now() });
      while (threadHistoryCache.size > threadHistoryCacheLimit) threadHistoryCache.delete(threadHistoryCache.keys().next().value);
    }
    return result;
  }).finally(() => {
    if (threadHistoryLoads.get(threadId) === load) threadHistoryLoads.delete(threadId);
  });
  threadHistoryLoads.set(threadId, load);
  return load;
}

async function warmRecentThreadHistories(threadIds) {
  for (let index = 0; index < threadIds.length; index += 2) {
    await Promise.allSettled(threadIds.slice(index, index + 2).map((threadId) => getThreadHistory(threadId)));
  }
}

function resumeThread(threadId) {
  if (resumedThreads.has(threadId)) return Promise.resolve(null);
  const pending = threadResumeLoads.get(threadId);
  if (pending) return pending;
  const load = codex.rpc('thread/resume', { threadId }).then((result) => {
    resumedThreads.add(threadId);
    return result;
  }).finally(() => {
    if (threadResumeLoads.get(threadId) === load) threadResumeLoads.delete(threadId);
  });
  threadResumeLoads.set(threadId, load);
  return load;
}

async function openThread(threadId) {
  const revision = ++threadOpenRevision;
  const history = await getThreadHistory(threadId);
  if (!anthropic.owns(threadId)) void resumeThread(threadId).catch(() => {});
  let workspace = activeWorkspace ? { path: activeWorkspace, name: path.basename(activeWorkspace) || activeWorkspace } : null;
  const pathFromThread = history.thread.cwd;
  if (pathFromThread && revision === threadOpenRevision) workspace = await setWorkspace(pathFromThread);
  return { ...history, workspace };
}

async function handleApi(req, res, url) {
  if (!requireSession(req)) return json(res, 403, { error: 'The local app session is invalid. Refresh Forge to reconnect.' });
  const route = url.pathname;
  if (req.method === 'GET' && route === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': connected\n\n');
    const lastEventId = Number.parseInt(req.headers['last-event-id'] || '0', 10);
    for (const item of eventHistory) if (item.id > lastEventId) res.write(`id: ${item.id}\ndata: ${JSON.stringify(item.event)}\n\n`);
    eventClients.add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { clearInterval(ping); } }, 25000);
    req.on('close', () => { clearInterval(ping); eventClients.delete(res); });
    return;
  }
  if (req.method === 'GET' && route === '/api/state') {
    if (initialAppState) {
      const snapshot = initialAppState;
      initialAppState = null;
      return json(res, 200, snapshot);
    }
    try { return json(res, 200, await getAppState()); }
    catch (error) { return json(res, 503, { error: error.message || 'Could not connect to Codex.' }); }
  }
  if (req.method === 'GET' && route === '/api/tree') {
    try { return json(res, 200, { entries: await readTree(url.searchParams.get('dir') || '') }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (req.method === 'GET' && route === '/api/file') {
    try { return json(res, 200, await readWorkspaceFile(url.searchParams.get('path') || '')); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (req.method === 'POST') {
    let input;
    try { input = await bodyJson(req); } catch (error) { return json(res, 400, { error: error.message }); }
    try {
      if (route === '/api/workspaces/open') {
        const workspace = await setWorkspace(input.path);
        return json(res, 200, { workspace });
      }
      if (route === '/api/providers/discover') {
        const baseUrl = normalizeProviderBaseUrl(input.baseUrl);
        let apiKey = String(input.apiKey || '').trim();
        if (!apiKey && input.id) {
          const encryptedKeys = await readEncryptedProviderKeys(providerKeysPath);
          const encrypted = encryptedKeys[String(input.id)];
          if (encrypted) apiKey = await decryptProviderKey(encrypted);
        }
        if (!apiKey) throw new Error('Enter the provider API key before loading models.');
        const response = await fetch(`${baseUrl}/models`, {
          headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error(`The provider model list returned HTTP ${response.status}. Check the endpoint and API key.`);
        const payload = await response.json();
        const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
        const modelIds = [...new Set(rows.map((model) => String(model?.id || model?.name || '').trim()).filter((id) => /^[\w./:@+-]{1,180}$/.test(id)))].slice(0, 100);
        if (!modelIds.length) throw new Error('The provider returned no model IDs. Add model IDs manually.');
        return json(res, 200, { modelIds });
      }
      if (route === '/api/providers/save') {
        const name = String(input.name || '').trim().slice(0, 48);
        if (!name) throw new Error('Enter a provider name.');
        const existingId = String(input.id || '').trim();
        const existing = existingId ? settings.providers.find((provider) => provider.id === existingId) : null;
        if (existingId && !existing) throw new Error('That provider no longer exists. Refresh and try again.');
        let id = existing?.id || providerIdFromName(name);
        if (!existing) {
          const baseId = id;
          let suffix = 2;
          while (settings.providers.some((provider) => provider.id === id)) id = `${baseId.slice(0, 36)}-${suffix++}`;
        }
        const baseUrl = normalizeProviderBaseUrl(input.baseUrl);
        const models = normalizeProviderModels(input.models);
        const apiKey = String(input.apiKey || '').trim();
        if (apiKey.length > 4096) throw new Error('Provider API keys must be 4,096 characters or fewer.');
        const encryptedKeys = await readEncryptedProviderKeys(providerKeysPath);
        if (apiKey) encryptedKeys[id] = await encryptProviderKey(apiKey);
        if (!encryptedKeys[id]) throw new Error('Enter an API key for this provider.');
        const provider = { id, name, baseUrl, models };
        await writeEncryptedProviderKeys(providerKeysPath, encryptedKeys);
        settings.providers = existing
          ? settings.providers.map((item) => item.id === id ? provider : item)
          : [...settings.providers, provider];
        await saveSettings();
        return json(res, 200, { provider: { ...provider, authConfigured: true } });
      }
      if (route === '/api/providers/remove') {
        const id = String(input.id || '');
        if (!settings.providers.some((provider) => provider.id === id)) throw new Error('That provider no longer exists.');
        const encryptedKeys = await readEncryptedProviderKeys(providerKeysPath);
        delete encryptedKeys[id];
        await writeEncryptedProviderKeys(providerKeysPath, encryptedKeys);
        settings.providers = settings.providers.filter((provider) => provider.id !== id);
        await saveSettings();
        return json(res, 200, { providers: publicProviders(encryptedKeys) });
      }
      if (route === '/api/login/start') {
        const result = await codex.rpc('account/login/start', { type: 'chatgpt' });
        return json(res, 200, result);
      }
      if (route === '/api/threads/open') {
        const result = await openThread(String(input.threadId || ''));
        return json(res, 200, result);
      }
      if (route === '/api/threads/delete') {
        if (!activeWorkspace) throw new Error('Open a workspace before deleting a session.');
        const threadId = String(input.threadId || '').trim();
        if (!threadId || threadId.length > 200) throw new Error('Choose a valid session to delete.');
        if (anthropic.owns(threadId)) {
          await anthropic.deleteThread(threadId);
          return json(res, 200, { deleted: true, threadId });
        }
        const listed = await codex.rpc('thread/list', { cwd: activeWorkspace, limit: 40, sortKey: 'updated_at', sortDirection: 'desc' });
        if (!(listed.data || []).some((thread) => thread.id === threadId)) throw new Error('That session is no longer in this workspace. Refresh the session list and try again.');
        await codex.rpc('thread/delete', { threadId });
        invalidateThreadHistory(threadId);
        threadHistoryLoads.delete(threadId);
        threadResumeLoads.delete(threadId);
        resumedThreads.delete(threadId);
        return json(res, 200, { deleted: true, threadId });
      }
      if (route === '/api/messages') {
        if (!activeWorkspace) throw new Error('Open a workspace folder before starting a task.');
        const text = String(input.text || '').trim();
        if (!text) throw new Error('Write a prompt before sending.');
        if (text.length > 100000) throw new Error('Prompts are limited to 100,000 characters.');
        const providerId = String(input.providerId || 'openai');
        if (providerId === 'anthropic') {
          const result = await anthropic.startTurn({
            threadId: String(input.threadId || ''),
            text,
            model: String(input.providerModel || ''),
            cwd: activeWorkspace,
            readOnly: Boolean(input.readOnly),
          });
          return json(res, 200, { ...result, providerId });
        }
        const account = await getAccount();
        if (!account.connected) throw new Error('Sign in to ChatGPT before starting a Codex task.');
        const provider = providerId === 'openai' ? null : settings.providers.find((item) => item.id === providerId);
        if (providerId !== 'openai' && !provider) throw new Error('That provider is no longer configured. Refresh the model list and try again.');
        const model = provider ? String(input.providerModel || '') : String(input.model || '');
        if (provider && !provider.models.some((item) => item.id === model)) throw new Error('Choose a model listed under this provider.');
        if (provider) {
          const encryptedKeys = await readEncryptedProviderKeys(providerKeysPath);
          if (!encryptedKeys[provider.id]) throw new Error(`Add an API key for ${provider.name} in provider settings.`);
        }
        let threadId = String(input.threadId || '');
        if (threadId) {
          const history = await getThreadHistory(threadId);
          const existingProviderId = history.thread.modelProvider || 'openai';
          if (existingProviderId !== providerId) throw new Error('A session keeps the provider it started with. Start a new session to switch providers.');
        }
        if (!threadId) {
          const startParams = {
            cwd: activeWorkspace,
            model,
            sandbox: input.readOnly ? 'read-only' : 'workspace-write',
            approvalPolicy: 'on-request',
            personality: 'pragmatic',
          };
          if (provider) {
            startParams.modelProvider = provider.id;
            startParams.config = providerThreadConfig(provider);
          }
          const started = await codex.rpc('thread/start', startParams);
          threadId = started.thread.id;
          invalidateThreadHistory(threadId);
        }
        if (input.threadId) await resumeThread(threadId).catch(() => null);
        const turn = await codex.rpc('turn/start', {
          threadId,
          cwd: activeWorkspace,
          input: [{ type: 'text', text }],
          model: model || undefined,
          effort: String(input.effort || '') || undefined,
          sandboxPolicy: input.readOnly
            ? { type: 'readOnly', networkAccess: false }
            : { type: 'workspaceWrite', writableRoots: [activeWorkspace], networkAccess: false },
        });
        return json(res, 200, { threadId, turnId: turn.turn?.id || null, providerId });
      }
      if (route === '/api/interrupt') {
        const threadId = String(input.threadId || '');
        if (anthropic.owns(threadId)) await anthropic.interrupt(threadId);
        else await codex.rpc('turn/interrupt', { threadId, turnId: String(input.turnId || '') });
        return json(res, 200, { ok: true });
      }
      if (route === '/api/approval') {
        const id = input.id;
        if (String(id || '').startsWith('anthropic:')) {
          const decision = String(input.decision || 'decline');
          if (!['accept', 'acceptForSession', 'decline', 'cancel'].includes(decision)) throw new Error('Choose a valid approval decision.');
          anthropic.resolveApproval(id, decision);
          return json(res, 200, { ok: true });
        }
        const method = codex.serverRequests.get(String(id));
        if (!method) throw new Error('That request has already completed.');
        if (method === 'commandExecution/requestApproval' || method === 'fileChange/requestApproval') {
          const decision = String(input.decision || 'decline');
          if (!['accept', 'acceptForSession', 'decline', 'cancel'].includes(decision)) throw new Error('Choose a valid approval decision.');
          codex.reply(id, { decision });
        } else if (method === 'tool/requestUserInput') {
          codex.reply(id, { answers: input.answers || {} });
        } else {
          codex.rejectRequest(id);
        }
        return json(res, 200, { ok: true });
      }
      if (route === '/api/shutdown') {
        json(res, 200, { ok: true });
        setTimeout(async () => { await codex.stop(); httpServer.close(() => process.exit(0)); }, 100);
        return;
      }
      return json(res, 404, { error: 'Route not found.' });
    } catch (error) {
      return json(res, 400, { error: error.message || 'The request could not be completed.' });
    }
  }
  return json(res, 404, { error: 'Route not found.' });
}

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const httpServer = createServer(async (req, res) => {
  setSecurityHeaders(res);
  const url = new URL(req.url || '/', `http://${host}:${port}`);
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed.' });
  let assetPath = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  assetPath = path.resolve(publicRoot, assetPath);
  if (!pathIsInside(publicRoot, assetPath)) return json(res, 404, { error: 'File not found.' });
  try {
    let content = await readFile(assetPath);
    if (path.basename(assetPath) === 'index.html') content = Buffer.from(content.toString('utf8').replaceAll('__FORGE_SESSION_TOKEN__', sessionToken));
    res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(assetPath).toLowerCase()] || 'application/octet-stream', 'Content-Length': content.length, 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    return res.end(content);
  } catch {
    return json(res, 404, { error: 'File not found.' });
  }
});

function openBrowser(url) {
  if (process.env.FORGE_NO_BROWSER === '1') return;
  if (process.platform === 'win32') execFile('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true }, () => {});
  else if (process.platform === 'darwin') execFile('open', [url], { windowsHide: true }, () => {});
  else execFile('xdg-open', [url], { windowsHide: true }, () => {});
}

function listenOnAvailablePort(startPort, remaining = 10) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      if (error.code === 'EADDRINUSE' && remaining > 0) {
        port += 1;
        resolve(listenOnAvailablePort(port, remaining - 1));
      } else reject(error);
    };
    httpServer.once('error', onError);
    httpServer.listen(startPort, host, () => {
      httpServer.removeListener('error', onError);
      resolve(httpServer.address().port);
    });
  });
}

const actualPort = await listenOnAvailablePort(port);
const localUrl = `http://${host}:${actualPort}`;
console.log(`Forge is ready at ${localUrl}`);
const accountWarmup = codex.ensureStarted()
  .then(getAppState)
  .then((snapshot) => { initialAppState = snapshot; console.log('Synced the saved Codex account.'); })
  .catch((error) => console.warn(`Codex account connection will retry when Forge opens: ${error.message}`));
await Promise.race([accountWarmup, new Promise((resolve) => setTimeout(resolve, 1500))]);
openBrowser(localUrl);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await codex.stop();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1200).unref();
  });
}
