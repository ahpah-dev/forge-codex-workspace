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
import { createFreeRouter, FREE_PROVIDER_ID, FREE_KEY_IDS, isCodexLimitError, exhaustedCodexLimit } from './free-router.mjs';
import { bridgeResponses, createChatProviderRouter, providerApiFormat } from './responses-bridge.mjs';
import { browserCodexConfig } from './browser-config.mjs';

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
const bridgeToken = randomBytes(32).toString('hex');
const ignoredFolders = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage', '.turbo', '.venv', 'venv', '__pycache__']);
const defaultSettings = { activeWorkspace: '', recentWorkspaces: [], providers: [], askExternalApprovals: true, freeRouting: { enabled: false, codexFallback: false } };

let settings = await loadSettings();
let activeWorkspace = await normalizeSavedWorkspace(settings.activeWorkspace);
let port = Number.parseInt(process.env.FORGE_PORT || '4173', 10);
let initialAppState = null;
let threadOpenRevision = 0;
const turnRequests = new Map();
const turnErrors = new Map();
const fallbackJobs = new Map();

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
      apiFormat: ['auto', 'chat', 'responses'].includes(provider.apiFormat) ? provider.apiFormat : 'auto',
      models: Array.isArray(provider.models) ? provider.models.filter((model) => model && /^[\w./:@+-]{1,180}$/.test(model.id || '')).slice(0, 100).map((model) => ({ id: model.id, name: String(model.name || model.id).slice(0, 180) })) : [],
    })) : [];
    return { ...defaultSettings, ...saved, askExternalApprovals: saved.askExternalApprovals !== false, freeRouting: { enabled: saved.freeRouting?.enabled === true, codexFallback: saved.freeRouting?.codexFallback === true }, recentWorkspaces: Array.isArray(saved.recentWorkspaces) ? saved.recentWorkspaces : [], providers };
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
  if (['openai', 'anthropic', 'ollama', 'lmstudio', FREE_PROVIDER_ID, ...Object.values(FREE_KEY_IDS)].includes(id)) throw new Error('That ID is reserved by a built-in model provider. Choose another provider name.');
  return id;
}

function publicProviders(encryptedKeys = {}) {
  const providers = settings.providers.map((provider) => ({
    ...provider,
    authConfigured: typeof encryptedKeys[provider.id] === 'string' && Boolean(encryptedKeys[provider.id]),
  }));
  if (settings.freeRouting.enabled) providers.push({ id: FREE_PROVIDER_ID, name: 'Free Auto Route', authConfigured: Boolean(encryptedKeys[FREE_KEY_IDS.openrouter] && encryptedKeys[FREE_KEY_IDS.nvidia]), models: [{ id: 'auto-free', name: 'OpenRouter Free Auto Route' }] });
  return providers;
}

function providerThreadConfig(provider) {
  if (provider.id === FREE_PROVIDER_ID) return {
    web_search: 'disabled',
    model_providers: { [FREE_PROVIDER_ID]: {
      name: 'Free Auto Route', base_url: `http://${host}:${port}/internal/free-route`,
      wire_api: 'responses', requires_openai_auth: false, supports_websockets: false,
      http_headers: { Authorization: `Bearer ${bridgeToken}` }, request_max_retries: 0, stream_max_retries: 0,
    } },
  };
  if (providerApiFormat(provider) === 'chat') return {
    web_search: 'disabled',
    model_providers: { [provider.id]: {
      name: provider.name, base_url: `http://${host}:${port}/internal/providers/${provider.id}`,
      wire_api: 'responses', requires_openai_auth: false, supports_websockets: false,
      http_headers: { Authorization: `Bearer ${bridgeToken}` }, request_max_retries: 0, stream_max_retries: 0,
    } },
  };
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

function runtimeThreadConfig(provider, cwd = activeWorkspace) {
  return { ...browserCodexConfig(appRoot, dataRoot, cwd), ...(provider ? providerThreadConfig(provider) : {}) };
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
  if (!activeWorkspace) return { branch: null, changedFiles: 0, added: 0, removed: 0, entries: [] };
  const workspace = activeWorkspace;
  try {
    const [statusResult, numstatResult] = await Promise.all([
      execFileAsync('git', ['status', '--short', '--branch', '--untracked-files=all'], { cwd: workspace, timeout: 7000, windowsHide: true, maxBuffer: 1024 * 1024 }),
      execFileAsync('git', ['diff', '--numstat', 'HEAD', '--'], { cwd: workspace, timeout: 7000, windowsHide: true, maxBuffer: 1024 * 1024 }).catch(() => ({ stdout: '' })),
    ]);
    const { stdout } = statusResult;
    const lines = stdout.split(/\r?\n/).filter(Boolean);
    const branchLine = lines.shift() || '';
    const lineStats = new Map();
    for (const row of String(numstatResult.stdout || '').split(/\r?\n/).filter(Boolean)) {
      const match = row.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!match) continue;
      const filePath = match[3].replaceAll('\\', '/').toLocaleLowerCase();
      lineStats.set(filePath, { added: Number(match[1]) || 0, removed: Number(match[2]) || 0 });
    }
    const changed = lines.map((line) => ({ status: line.slice(0, 2).trim() || '·', path: line.slice(3) })).slice(0, 100);
    for (const entry of changed) {
      const filePath = entry.path.replaceAll('\\', '/').toLocaleLowerCase();
      const stats = lineStats.get(filePath) || { added: 0, removed: 0 };
      if (entry.status === '??') {
        try {
          const file = await readFile(path.resolve(workspace, entry.path));
          if (file.length <= 2 * 1024 * 1024 && !file.includes(0)) {
            const text = file.toString('utf8');
            stats.added = text ? text.split(/\r?\n/).length - (text.endsWith('\n') || text.endsWith('\r') ? 1 : 0) : 0;
          }
        } catch { /* A file may disappear while the workspace summary is being read. */ }
      }
      entry.added = stats.added;
      entry.removed = stats.removed;
    }
    const added = changed.reduce((sum, entry) => sum + entry.added, 0);
    const removed = changed.reduce((sum, entry) => sum + entry.removed, 0);
    return { branch: branchLine.startsWith('## ') ? branchLine.slice(3).split('...')[0] : null, changedFiles: changed.length, added, removed, entries: changed };
  } catch {
    return { branch: null, changedFiles: 0, added: 0, removed: 0, entries: [] };
  }
}

async function readWorkspaceChange(relativePath) {
  const workspace = activeWorkspace;
  const input = String(relativePath || '');
  if (!workspace || !input || input.length > 2048 || path.isAbsolute(input)) throw new Error('Select a changed file in the open workspace.');
  const candidate = path.resolve(workspace, input);
  if (!pathIsInside(workspace, candidate) || candidate === workspace) throw new Error('Select a file inside the open workspace.');
  const filePath = path.relative(workspace, candidate);
  if (!filePath) throw new Error('Select a changed file, rather than the workspace folder.');
  const options = { cwd: workspace, timeout: 7000, windowsHide: true, maxBuffer: 1024 * 1024 };
  const diffFlags = ['--no-ext-diff', '--no-textconv', '--no-color', '--relative'];
  let diff;
  try {
    ({ stdout: diff } = await execFileAsync('git', ['--literal-pathspecs', 'diff', ...diffFlags, 'HEAD', '--', filePath], options));
  } catch {
    const staged = await execFileAsync('git', ['--literal-pathspecs', 'diff', ...diffFlags, '--cached', '--', filePath], options);
    const unstaged = await execFileAsync('git', ['--literal-pathspecs', 'diff', ...diffFlags, '--', filePath], options);
    diff = staged.stdout + unstaged.stdout;
  }
  if (!diff) {
    const status = await execFileAsync('git', ['--literal-pathspecs', 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', filePath], options);
    if (status.stdout.startsWith('?? ')) {
      const canonical = await realpath(candidate);
      if (!pathIsInside(workspace, canonical)) throw new Error('This file points outside the open workspace.');
      const info = await stat(canonical);
      if (!info.isFile() || info.size > 512 * 1024) throw new Error('This file is too large for an inline diff. Open it in your editor.');
      const contents = await readFile(canonical);
      if (contents.includes(0)) return { path: input, diff: '', binary: true };
      const text = contents.toString('utf8');
      const lines = text ? text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n') : [];
      diff = `--- /dev/null\n+++ b/${filePath.replaceAll('\\', '/')}\n@@ -0,0 +1,${lines.length} @@\n` + lines.map((line) => '+' + line).join('\n');
    }
  }
  return { path: input, diff: diff || '', binary: /Binary files .* differ|GIT binary patch/.test(diff || '') };
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
        this.serverRequests.set(String(message.id), { method: message.method, params: message.params || {} });
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
  if (event.type === 'notification' && /^(item\/(started|delta|completed|fileChange\/patchUpdated)|turn\/(started|completed|failed|interrupted))$/.test(event.method || '')) {
    invalidateThreadHistory(event.params?.threadId);
  }
  if (event.type === 'notification' && event.method === 'error' && event.params?.threadId) turnErrors.set(event.params.threadId, event.params.error);
  if (event.type === 'notification' && event.method === 'turn/completed') {
    const threadId = event.params?.threadId;
    const request = turnRequests.get(threadId);
    const error = event.params?.turn?.error || turnErrors.get(threadId);
    if (request && request.providerId === 'openai' && settings.freeRouting.codexFallback && settings.freeRouting.enabled
      && event.params?.turn?.status === 'failed' && isCodexLimitError(error) && !fallbackJobs.has(threadId)) {
      turnRequests.delete(threadId);
      turnErrors.delete(threadId);
      publish({ type: 'notification', method: 'routing/fallback/starting', params: { threadId, reason: 'Codex usage limit reached. Continuing with Free Auto Route.' } });
      const controller = new AbortController();
      const job = { controller, newThreadId: null, newTurnId: null };
      fallbackJobs.set(threadId, job);
      void continueWithFreeRoute(request, threadId, controller.signal).catch((failure) => {
        publish({ type: 'notification', method: 'routing/fallback/failed', params: { threadId, message: failure.message } });
      }).finally(() => fallbackJobs.delete(threadId));
      return;
    }
    turnRequests.delete(threadId);
    turnErrors.delete(threadId);
  }
  publish(event);
});

const freeRouter = createFreeRouter({
  async getKey(provider) {
    const keys = await readEncryptedProviderKeys(providerKeysPath);
    return keys[FREE_KEY_IDS[provider]] ? decryptProviderKey(keys[FREE_KEY_IDS[provider]]) : '';
  },
  onRoute(route) { publish({ type: 'notification', method: 'routing/model/selected', params: { route } }); },
});

function freeRoutingStatus(keys) {
  return { ...settings.freeRouting, openrouterConfigured: Boolean(keys[FREE_KEY_IDS.openrouter]), nvidiaConfigured: Boolean(keys[FREE_KEY_IDS.nvidia]), ...freeRouter.status() };
}

async function startCodexTask(input, cwd, { announceContinuation, signal } = {}) {
  const providerId = String(input.providerId || 'openai');
  const provider = providerId === FREE_PROVIDER_ID ? { id: FREE_PROVIDER_ID, name: 'Free Auto Route', models: [{ id: 'auto-free' }] }
    : providerId === 'openai' ? null : settings.providers.find((item) => item.id === providerId);
  if (providerId !== 'openai' && !provider) throw new Error('That provider is no longer configured. Refresh the model list.');
  const model = providerId === FREE_PROVIDER_ID ? 'auto-free' : provider ? String(input.providerModel || '') : String(input.model || '');
  if (provider && !provider.models.some((item) => item.id === model)) throw new Error('Choose a model listed under this provider.');
  const encryptedKeys = await readEncryptedProviderKeys(providerKeysPath);
  if (providerId === FREE_PROVIDER_ID) {
    if (!settings.freeRouting.enabled || !encryptedKeys[FREE_KEY_IDS.openrouter] || !encryptedKeys[FREE_KEY_IDS.nvidia]) throw new Error('Enable Free Auto Route and save both API keys in Settings first.');
  } else if (provider && !encryptedKeys[providerId]) throw new Error(`Add an API key for ${provider.name} in provider settings.`);
  if (!provider && !(await getAccount()).connected) throw new Error('Sign in to ChatGPT before starting a Codex task.');
  let threadId = String(input.threadId || '');
  if (threadId) {
    const history = await getThreadHistory(threadId);
    if ((history.thread.modelProvider || 'openai') !== providerId) throw new Error('Start a new session to switch providers.');
  }
  const readOnly = Boolean(input.readOnly || input.planningMode);
  const officialCodex = providerId === 'openai';
  const unrestricted = !readOnly && (officialCodex || !settings.askExternalApprovals);
  const sandbox = readOnly ? 'read-only' : unrestricted ? 'danger-full-access' : 'workspace-write';
  const approvalPolicy = officialCodex || !settings.askExternalApprovals || readOnly ? 'never' : 'on-request';
  if (signal?.aborted) throw new Error('The continuation was stopped.');
  if (!threadId) {
    const startParams = { cwd, model, sandbox, approvalPolicy, personality: 'pragmatic', config: runtimeThreadConfig(provider, cwd) };
    if (provider) startParams.modelProvider = provider.id;
    threadId = (await codex.rpc('thread/start', startParams)).thread.id;
    invalidateThreadHistory(threadId);
    resumedThreads.add(threadId);
  } else await resumeThread(threadId);
  if (signal?.aborted) throw new Error('The continuation was stopped.');
  if (input.continuationContext) {
    await codex.rpc('thread/inject_items', { threadId, items: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: input.continuationContext }] }] });
    settings.continuations ||= {};
    settings.continuations[threadId] = { fromThreadId: input.continuedFrom || announceContinuation, createdAt: Date.now() };
    await saveSettings();
  }
  if (announceContinuation) {
    const job = fallbackJobs.get(announceContinuation);
    if (job) job.newThreadId = threadId;
    publish({ type: 'notification', method: 'routing/fallback/started', params: { threadId: announceContinuation, newThreadId: threadId, providerId } });
  }
  const effort = String(input.effort || 'medium');
  turnRequests.set(threadId, { ...input, providerId, cwd, threadId });
  turnErrors.delete(threadId);
  const turn = await codex.rpc('turn/start', {
    threadId, cwd, input: [
      ...(input.text ? [{ type: 'text', text: input.text }] : []),
      ...(input.images || []).map((image) => ({ type: 'image', url: image.dataUrl, detail: 'auto' })),
    ], model: model || undefined, effort,
    collaborationMode: { mode: input.planningMode ? 'plan' : 'default', settings: { model, reasoning_effort: effort, developer_instructions: null } },
    approvalPolicy,
    sandboxPolicy: readOnly ? { type: 'readOnly', networkAccess: false } : unrestricted ? { type: 'dangerFullAccess' } : { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: false },
  });
  const turnId = turn.turn?.id || null;
  if (announceContinuation) {
    const job = fallbackJobs.get(announceContinuation);
    if (job) job.newTurnId = turnId;
    if (signal?.aborted && turnId) await codex.rpc('turn/interrupt', { threadId, turnId });
  }
  return { threadId, turnId, providerId, ...(announceContinuation ? { continuedFrom: announceContinuation } : {}) };
}

async function continuationText(threadId, input) {
  const history = await getThreadHistory(threadId);
  const context = history.messages.filter((message) => message.text || message.command || message.changes?.length).map((message) => {
    if (message.role === 'activity') return `[Completed activity: ${message.status || 'unknown'}] ${message.command || JSON.stringify(message.changes)}\n${message.output || ''}`;
    return `[${message.role}] ${message.text || ''}`;
  }).join('\n\n').slice(-65000);
  return `Continue this task after the original Codex session reached its usage limit. Inspect the current files before making edits. Completed operations may already have changed the workspace; do not replay them blindly. Preserve the user's requested ${input.planningMode ? 'planning (read only)' : input.readOnly ? 'read only' : 'coding'} mode.\n\nPrevious session context:\n${context}\n\nCurrent user request:\n${input.text}`;
}

async function continueWithFreeRoute(input, threadId, signal) {
  const text = await continuationText(threadId, input);
  return startCodexTask({ ...input, threadId: '', continuationContext: text, continuedFrom: threadId, providerId: FREE_PROVIDER_ID, providerModel: 'auto-free' }, input.cwd, { announceContinuation: threadId, signal });
}

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
    askExternalApprovals: settings.askExternalApprovals !== false,
    freeRouting: freeRoutingStatus(encryptedProviderKeys),
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
  const maxLength = req.url?.startsWith('/internal/') ? 32 * 1024 * 1024 : req.url?.startsWith('/api/messages') ? 14 * 1024 * 1024 : 1024 * 1024;
  for await (const chunk of req) {
    text += chunk;
    if (text.length > maxLength) throw new Error(req.url?.startsWith('/api/messages') ? 'Request body is too large. Keep attached images under 9 MB total.' : 'Request body is too large.');
  }
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new Error('Request body must be valid JSON.'); }
}

function normalizeImageAttachments(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 4) throw new Error('Attach up to four images per message.');
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
  let totalBytes = 0;
  return value.map((image) => {
    const mediaType = String(image?.mediaType || '').toLowerCase();
    if (!allowedTypes.has(mediaType)) throw new Error('Attach PNG, JPEG, WebP, or GIF images.');
    const base64 = String(image?.base64 || '');
    if (!base64 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('An attached image could not be read. Try adding it again.');
    const bytes = Buffer.from(base64, 'base64');
    if (!bytes.length || bytes.toString('base64') !== base64) throw new Error('An attached image is invalid. Try adding it again.');
    if (bytes.length > 5 * 1024 * 1024) throw new Error('Each image must be 5 MB or smaller.');
    totalBytes += bytes.length;
    if (totalBytes > 9 * 1024 * 1024) throw new Error('Images must be 9 MB or smaller in total.');
    const name = path.basename(String(image.name || 'image')).replace(/[\u0000-\u001f]/g, '').slice(0, 160) || 'image';
    return { name, mediaType, base64, dataUrl: `data:${mediaType};base64,${base64}` };
  });
}

async function readThreadHistory(threadId) {
  const result = await codex.rpc('thread/read', { threadId, includeTurns: true });
  const thread = result.thread;
  const messages = [];
  for (const turn of thread?.turns || []) {
    for (const item of turn.items || []) {
      if (item.type === 'userMessage') {
        const content = (item.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('\n');
        const images = (item.content || []).filter((part) => part.type === 'image').map((part, index) => {
          const dataUrl = part.image_url || part.url || (part.data ? `data:${part.media_type || part.mediaType || 'image/png'};base64,${part.data}` : '');
          return typeof dataUrl === 'string' && dataUrl.startsWith('data:image/') ? { name: `image-${index + 1}`, dataUrl } : null;
        }).filter(Boolean);
        if (content || images.length) messages.push({ id: item.id, turnId: turn.id, role: 'user', text: content, images });
      } else if (item.type === 'agentMessage') {
        messages.push({ id: item.id, turnId: turn.id, role: 'assistant', text: item.text || '' });
      } else if (item.type === 'plan') {
        messages.push({ id: item.id, turnId: turn.id, role: 'plan', text: item.text || '' });
      } else if (item.type === 'commandExecution') {
        messages.push({ id: item.id, turnId: turn.id, role: 'activity', activityType: 'command', command: item.command, output: item.aggregatedOutput || '', status: item.status?.type || item.status || '', exitCode: item.exitCode });
      } else if (item.type === 'fileChange') {
        messages.push({ id: item.id, turnId: turn.id, role: 'activity', activityType: 'files', changes: item.changes || [], status: item.status?.type || item.status || '' });
      } else if (item.type === 'mcpToolCall') {
        messages.push({ id: item.id, turnId: turn.id, role: 'activity', activityType: 'tool', toolName: (item.server === 'forge_browser' ? 'Browser' : item.server) + ' · ' + String(item.tool || '').replace(/^browser_/, '').replaceAll('_', ' '), input: item.arguments, output: (item.result?.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('\n').slice(0, 24000) || item.error?.message || '', status: item.status?.type || item.status || '' });
      } else if (item.type === 'collabAgentToolCall' || item.type === 'subAgentActivity') {
        messages.push({ id: item.id, turnId: turn.id, role: 'agent-event', item });
      }
    }
  }
  const continuedFrom = settings.continuations?.[threadId]?.fromThreadId || null;
  if (continuedFrom) messages.unshift({ role: 'routing', text: 'This Free Auto Route session continues a previous Codex session after its usage limit.', continuedFrom });
  return { thread: { id: thread.id, name: thread.name || thread.preview || 'Untitled session', cwd: thread.cwd, modelProvider: thread.modelProvider || 'openai', continuedFrom }, messages };
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
  const load = getThreadHistory(threadId).then((history) => {
    const provider = history.thread.modelProvider === FREE_PROVIDER_ID ? { id: FREE_PROVIDER_ID }
      : settings.providers.find((item) => item.id === history.thread.modelProvider);
    return codex.rpc('thread/resume', { threadId, config: runtimeThreadConfig(provider, history.thread.cwd || activeWorkspace) });
  }).then((result) => {
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
  if (req.method === 'GET' && route === '/api/changes/file') {
    try { return json(res, 200, await readWorkspaceChange(url.searchParams.get('path') || '')); }
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
      if (route === '/api/routing/save') {
        const keys = await readEncryptedProviderKeys(providerKeysPath);
        for (const provider of ['openrouter', 'nvidia']) {
          const key = String(input[`${provider}Key`] || '').trim();
          if (key.length > 4096) throw new Error('API keys must be 4,096 characters or fewer.');
          if (key) keys[FREE_KEY_IDS[provider]] = await encryptProviderKey(key);
        }
        const enabled = input.enabled === true;
        if (enabled && (!keys[FREE_KEY_IDS.openrouter] || !keys[FREE_KEY_IDS.nvidia])) throw new Error('Save both your OpenRouter and NVIDIA NIM API keys to enable Free Auto Route.');
        await writeEncryptedProviderKeys(providerKeysPath, keys);
        settings.freeRouting = { enabled, codexFallback: enabled && input.codexFallback === true };
        await saveSettings();
        freeRouter.reset();
        initialAppState = null;
        return json(res, 200, { freeRouting: freeRoutingStatus(keys), providers: publicProviders(keys) });
      }
      if (route === '/api/permissions/settings') {
        settings.askExternalApprovals = input.askExternalApprovals !== false;
        await saveSettings();
        initialAppState = null;
        return json(res, 200, { askExternalApprovals: settings.askExternalApprovals });
      }
      if (route === '/api/routing/discover') {
        freeRouter.reset();
        const results = await Promise.allSettled([freeRouter.catalog('openrouter', { force: true }), freeRouter.catalog('nvidia', { force: true })]);
        return json(res, 200, { catalogs: results.map((result, index) => ({ provider: index ? 'nvidia' : 'openrouter', ...(result.status === 'fulfilled' ? { count: result.value.length, model: result.value[0].id, name: result.value[0].name || result.value[0].id } : { error: result.reason.message }) })) });
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
        const apiFormat = ['auto', 'chat', 'responses'].includes(input.apiFormat) ? input.apiFormat : 'auto';
        const provider = { id, name, baseUrl, models, apiFormat };
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
      if (route === '/api/threads/fork-before-message') {
        if (!activeWorkspace) throw new Error('Open a workspace before branching a conversation.');
        const threadId = String(input.threadId || '').trim();
        const beforeTurnId = String(input.turnId || '').trim();
        if (!threadId || !beforeTurnId || threadId.length > 200 || beforeTurnId.length > 200) throw new Error('Choose a valid message to branch from.');
        if (anthropic.owns(threadId)) {
          const forkedThreadId = await anthropic.forkBeforeMessage(threadId, beforeTurnId);
          return json(res, 200, { threadId: forkedThreadId, sourceThreadId: threadId });
        }
        const history = await readThreadHistory(threadId);
        if (history.thread.cwd && path.resolve(history.thread.cwd).toLowerCase() !== path.resolve(activeWorkspace).toLowerCase()) throw new Error('Open the workspace where this conversation started before branching it.');
        if (!history.messages.some((message) => message.role === 'user' && message.turnId === beforeTurnId)) throw new Error('That user message is no longer in this conversation. Refresh the session and try again.');
        const providerId = history.thread.modelProvider || 'openai';
        const provider = providerId === FREE_PROVIDER_ID ? { id: FREE_PROVIDER_ID } : settings.providers.find((item) => item.id === providerId);
        const result = await codex.rpc('thread/fork', {
          threadId,
          beforeTurnId,
          cwd: activeWorkspace,
          modelProvider: providerId,
          config: runtimeThreadConfig(provider, activeWorkspace),
        });
        const forkedThreadId = result.thread?.id;
        if (!forkedThreadId) throw new Error('Codex did not return the new conversation branch.');
        invalidateThreadHistory(forkedThreadId);
        threadHistoryLoads.delete(forkedThreadId);
        resumedThreads.delete(forkedThreadId);
        return json(res, 200, { threadId: forkedThreadId, sourceThreadId: threadId });
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
        const images = normalizeImageAttachments(input.images);
        if (!text && !images.length) throw new Error('Write a prompt or attach an image before sending.');
        if (text.length > 100000) throw new Error('Prompts are limited to 100,000 characters.');
        const providerId = String(input.providerId || 'openai');
        if (providerId === 'anthropic') {
          const result = await anthropic.startTurn({
            threadId: String(input.threadId || ''),
            text,
            images,
            model: String(input.providerModel || ''),
            cwd: activeWorkspace,
            readOnly: Boolean(input.readOnly),
            planningMode: Boolean(input.planningMode),
            askBeforeExternalActions: settings.askExternalApprovals,
          });
          return json(res, 200, { ...result, providerId });
        }
        let task = { ...input, text, images, providerId };
        let continuedFrom = null;
        if (providerId === 'openai' && settings.freeRouting.enabled && settings.freeRouting.codexFallback) {
          const limits = await codex.rpc('account/rateLimits/read', {}).catch(() => null);
          if (exhaustedCodexLimit(limits?.rateLimitsByLimitId || limits?.rateLimits)) {
            continuedFrom = String(input.threadId || '') || null;
            const contextualText = continuedFrom ? await continuationText(continuedFrom, task) : text;
            task = { ...task, continuationContext: continuedFrom ? contextualText : '', continuedFrom, providerId: FREE_PROVIDER_ID, providerModel: 'auto-free', threadId: '' };
          }
        }
        try {
          const result = await startCodexTask(task, activeWorkspace);
          return json(res, 200, { ...result, continuedFrom });
        } catch (error) {
          if (task.providerId !== 'openai' || !settings.freeRouting.enabled || !settings.freeRouting.codexFallback || !isCodexLimitError(error)) throw error;
          const contextualText = input.threadId ? await continuationText(input.threadId, task) : text;
          const result = await startCodexTask({ ...task, continuationContext: input.threadId ? contextualText : '', continuedFrom: input.threadId || null, providerId: FREE_PROVIDER_ID, providerModel: 'auto-free', threadId: '' }, activeWorkspace);
          return json(res, 200, { ...result, continuedFrom: input.threadId || null });
        }
      }
      if (route === '/api/interrupt') {
        const threadId = String(input.threadId || '');
        const fallback = fallbackJobs.get(threadId);
        if (fallback) {
          fallback.controller.abort();
          if (fallback.newThreadId && fallback.newTurnId) await codex.rpc('turn/interrupt', { threadId: fallback.newThreadId, turnId: fallback.newTurnId });
          return json(res, 200, { ok: true });
        }
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
        const pending = codex.serverRequests.get(String(id));
        if (!pending) throw new Error('That request has already completed.');
        const method = typeof pending === 'string' ? pending : pending.method;
        const params = typeof pending === 'string' ? {} : pending.params || {};
        if (['commandExecution/requestApproval', 'fileChange/requestApproval', 'item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(method)) {
          const decision = String(input.decision || 'decline');
          if (!['accept', 'acceptForSession', 'decline', 'cancel'].includes(decision)) throw new Error('Choose a valid approval decision.');
          codex.reply(id, { decision });
        } else if (method === 'item/permissions/requestApproval') {
          const decision = String(input.decision || 'decline');
          if (!['accept', 'decline'].includes(decision)) throw new Error('Choose Accept or Decline.');
          codex.reply(id, { permissions: decision === 'accept' ? params.permissions || {} : {}, scope: input.scope === 'session' ? 'session' : 'turn' });
        } else if (method === 'tool/requestUserInput' || method === 'item/tool/requestUserInput') {
          codex.reply(id, { answers: input.answers || {} });
        } else if (method === 'execCommandApproval' || method === 'applyPatchApproval') {
          const decision = String(input.decision || 'decline');
          if (!['accept', 'decline'].includes(decision)) throw new Error('Choose Accept or Decline.');
          codex.reply(id, { decision: decision === 'accept' ? 'approved' : { denied: { rejection: 'Declined in Forge.' } } });
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
  const providerBridge = url.pathname.match(/^\/internal\/providers\/([a-z0-9_-]+)\/responses$/);
  if (url.pathname === '/internal/free-route/responses' || providerBridge) {
    if (req.method !== 'POST') return json(res, 405, { error: { message: 'Method not allowed.' } });
    if (req.headers.authorization !== `Bearer ${bridgeToken}` || req.headers.origin) return json(res, 403, { error: { message: 'Invalid local inference session.' } });
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    try {
      const input = await bodyJson(req);
      let router = freeRouter;
      if (providerBridge) {
        const provider = settings.providers.find((item) => item.id === providerBridge[1]);
        if (!provider || providerApiFormat(provider) !== 'chat') throw new Error('This Chat Completions provider is no longer configured.');
        if (!provider.models.some((item) => item.id === input.model)) throw new Error('Choose a model saved for this provider.');
        const keys = await readEncryptedProviderKeys(providerKeysPath);
        const key = keys[provider.id] ? await decryptProviderKey(keys[provider.id]) : '';
        if (!key) throw new Error(`Add your ${provider.name} API key in Settings.`);
        router = createChatProviderRouter({ provider: { ...provider, baseUrl: normalizeProviderBaseUrl(provider.baseUrl) }, model: input.model, key });
      }
      await bridgeResponses({ input, res, router, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(600000)]) });
    } catch (error) {
      if (!controller.signal.aborted) console.error(JSON.stringify({ scope: 'provider-inference', provider: providerBridge?.[1] || FREE_PROVIDER_ID, errorType: error.name || 'Error' }));
      if (!res.headersSent) return json(res, 502, { error: { code: 'routing_unavailable', message: error.message } });
      res.end();
    }
    return;
  }
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
