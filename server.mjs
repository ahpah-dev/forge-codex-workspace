import { spawn, execFile } from 'node:child_process';
import { existsSync, createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, realpath, stat, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { decryptProviderKey, encryptProviderKey, readEncryptedProviderKeys, writeEncryptedProviderKeys } from './provider-secrets.mjs';
import { createAnthropicProvider } from './anthropic-provider.mjs';
import { createFreeRouter, FREE_PROVIDER_ID, FREE_KEY_IDS, isCodexLimitError, exhaustedCodexLimit } from './free-router.mjs';
import { bridgeResponses, createChatProviderRouter, providerApiFormat, GROQ_CODING_MODELS, isGroqProvider, KILO_FREE_BASE_URL, KILO_FREE_MODEL } from './responses-bridge.mjs';
import { browserCodexConfig, browserCodexArgs, computerUseInstructions } from './browser-config.mjs';
import './public/question-protocol.js';
import './public/plugin-protocol.js';
import './public/file-paths.js';

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
const codexHome = process.env.CODEX_HOME || path.join(homedir(), '.codex');
const host = '127.0.0.1';
const sessionToken = randomBytes(32).toString('hex');
const bridgeToken = randomBytes(32).toString('hex');
const ignoredFolders = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage', '.turbo', '.venv', 'venv', '__pycache__']);
const defaultSettings = { activeWorkspace: '', recentWorkspaces: [], providers: [], askExternalApprovals: true, freeRouting: { enabled: false, codexFallback: false } };
const computerUseDeveloperInstruction = computerUseInstructions();
let pluginCatalogCache = null;
let pluginCatalogCacheAt = 0;
let pluginCatalogLoading = null;
const pluginSetupCache = new Map();
let installedPluginCache = null;
let installedPluginCacheAt = 0;
let marketplaceCache = null;
let marketplaceCacheAt = 0;

let settings = await loadSettings();
let activeWorkspace = await normalizeSavedWorkspace(settings.activeWorkspace);
let port = Number.parseInt(process.env.FORGE_PORT || '4173', 10);
let initialAppState = null;
let threadOpenRevision = 0;
const turnRequests = new Map();
const turnErrors = new Map();
const fallbackJobs = new Map();
const pendingComputerUse = new Map();
let computerUseQueue = Promise.resolve();

process.on('message', (message) => {
  if (message?.type !== 'forge:computer-use-result' || !message.id) return;
  const pending = pendingComputerUse.get(message.id);
  if (!pending) return;
  pendingComputerUse.delete(message.id);
  clearTimeout(pending.timeout);
  if (message.error) pending.reject(new Error(message.error));
  else pending.resolve(message.result);
});

function requestDesktopComputerUse(action, params) {
  if (typeof process.send !== 'function' || !process.connected) return Promise.reject(new Error('Computer-use controls are available in the Forge Windows desktop app.'));
  const id = randomBytes(12).toString('hex');
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingComputerUse.delete(id);
      reject(new Error('Forge’s computer-use controls did not respond in time.'));
    }, 90000);
    pendingComputerUse.set(id, { resolve, reject, timeout });
    process.send({ type: 'forge:computer-use', id, action, params }, (error) => {
      if (!error) return;
      pendingComputerUse.delete(id);
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function runDesktopComputerUse(action, params, signal) {
  const next = computerUseQueue.then(() => {
    signal?.throwIfAborted();
    return requestDesktopComputerUse(action, params);
  });
  computerUseQueue = next.catch(() => {});
  return next;
}

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
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; font-src 'self' https://cdn.prod.website-files.com; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
}

async function loadSettings() {
  try {
    const saved = JSON.parse(await readFile(settingsPath, 'utf8'));
    const providers = Array.isArray(saved.providers) ? saved.providers.filter((provider) => provider && /^[a-z0-9][a-z0-9_-]{0,40}$/.test(provider.id || '') && !['openai', 'anthropic'].includes(provider.id)).map((provider) => ({
      id: provider.id,
      name: String(provider.name || provider.id).slice(0, 48),
      baseUrl: String(provider.baseUrl || ''),
      apiFormat: ['auto', 'chat', 'responses'].includes(provider.apiFormat) ? provider.apiFormat : 'auto',
      ...(provider.nativePreset === 'kilo-free' ? { nativePreset: 'kilo-free' } : {}),
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

async function codexPluginCommand(args, { timeout = 120000 } = {}) {
  try {
    const { stdout } = await execFileAsync(codexExecutable, codexArgs(['plugin', ...args]), {
      timeout,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      env: process.env,
    });
    return String(stdout || '').trim();
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message || '').trim().slice(-900);
    throw new Error(detail || 'Codex could not complete the plugin operation.');
  }
}

function parsePluginJson(output, label) {
  try { return JSON.parse(output); }
  catch { throw new Error(`Codex returned an unreadable ${label} list. Update Codex, then refresh Plugins.`); }
}

function compactPlugin(plugin) {
  return {
    pluginId: String(plugin.pluginId || ''),
    name: String(plugin.name || plugin.pluginId || ''),
    marketplaceName: String(plugin.marketplaceName || ''),
    version: String(plugin.version || ''),
    installed: plugin.installed === true,
    enabled: plugin.enabled === true,
  };
}

async function getPluginSetup(pluginId, forceRefresh = false) {
  const cached = pluginSetupCache.get(pluginId);
  if (!forceRefresh && cached && Date.now() - cached.at < 60000) return cached.result;
  const plugin = (await getInstalledPlugins()).find((entry) => entry.pluginId === pluginId);
  if (!plugin) throw new Error('This plugin is not installed. Refresh Plugins first.');
  const marketplaces = await getPluginMarketplaces();
  const marketplace = marketplaces.find((entry) => entry.name === plugin.marketplaceName);
  const selector = marketplace && !plugin.marketplaceName.includes('remote')
    ? { marketplacePath: marketplace.root, pluginName: plugin.name }
    : { remoteMarketplaceName: plugin.marketplaceName, pluginName: plugin.name };
  const [{ plugin: detail }, runtime] = await Promise.all([
    codex.rpc('plugin/read', selector, 45000),
    codex.rpc('app/installed', { forceRefresh }, 45000),
  ]);
  const apps = (detail.apps || []).map((app) => {
    const state = (runtime.apps || []).find((entry) => entry.id === app.id);
    return { ...app, available: Boolean(state), enabled: state?.enabled === true, callable: state?.callable === true };
  });
  const servers = [];
  let cursor;
  do {
    const page = await codex.rpc('mcpServerStatus/list', { cursor, limit: 100, detail: 'toolsAndAuthOnly' }, 45000);
    for (const server of page.data || []) {
      if (server.pluginId === pluginId || (detail.mcpServers || []).includes(server.name)) {
        servers.push({ name: server.name, authStatus: server.authStatus, status: server.runtimeStatus, error: server.toolsError, toolCount: Object.keys(server.tools || {}).length });
      }
    }
    cursor = page.nextCursor;
  } while (cursor);
  const result = { pluginId, description: detail.description || '', apps, servers, skills: (detail.skills || []).map((skill) => skill.name) };
  pluginSetupCache.set(pluginId, { result, at: Date.now() });
  return result;
}

async function refreshPluginRuntime() {
  pluginSetupCache.clear();
  await codex.rpc('config/mcpServer/reload', {}, 45000);
  await codex.rpc('app/installed', { forceRefresh: true }, 45000);
  resumedThreads.clear();
}

async function getInstalledPlugins(force = false) {
  if (!force && installedPluginCache && Date.now() - installedPluginCacheAt < 45000) return installedPluginCache;
  const output = await codexPluginCommand(['list', '--json']);
  const payload = parsePluginJson(output, 'installed plugin');
  installedPluginCache = (payload.installed || []).map(compactPlugin).filter((plugin) => plugin.pluginId);
  installedPluginCacheAt = Date.now();
  return installedPluginCache;
}

async function getPluginCatalog(force = false) {
  if (!force && pluginCatalogCache && Date.now() - pluginCatalogCacheAt < 120000) return pluginCatalogCache;
  if (pluginCatalogLoading) return pluginCatalogLoading;
  pluginCatalogLoading = (async () => {
    const output = await codexPluginCommand(['list', '--available', '--json'], { timeout: 180000 });
    const payload = parsePluginJson(output, 'plugin catalog');
    const catalog = (payload.available || []).map(compactPlugin).filter((plugin) => plugin.pluginId);
    pluginCatalogCache = catalog;
    pluginCatalogCacheAt = Date.now();
    return catalog;
  })();
  try { return await pluginCatalogLoading; }
  finally { pluginCatalogLoading = null; }
}

async function getPluginMarketplaces(force = false) {
  if (!force && marketplaceCache && Date.now() - marketplaceCacheAt < 45000) return marketplaceCache;
  const output = await codexPluginCommand(['marketplace', 'list', '--json']);
  const payload = parsePluginJson(output, 'marketplace');
  marketplaceCache = (payload.marketplaces || []).map((marketplace) => ({
    name: String(marketplace.name || ''),
    root: String(marketplace.root || ''),
  })).filter((marketplace) => marketplace.name);
  marketplaceCacheAt = Date.now();
  return marketplaceCache;
}

function invalidatePluginCaches() {
  pluginSetupCache.clear();
  pluginCatalogCache = null;
  installedPluginCache = null;
  marketplaceCache = null;
  pluginCatalogCacheAt = 0;
  installedPluginCacheAt = 0;
  marketplaceCacheAt = 0;
}

function validatePluginSelector(pluginId) {
  const value = String(pluginId || '').trim();
  if (value.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}@[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(value)) {
    throw new Error('Choose a plugin from the Codex plugin list.');
  }
  return value;
}

async function setCodexPluginEnabled(pluginId, enabled) {
  const configPath = path.join(codexHome, 'config.toml');
  let source;
  try { source = await readFile(configPath, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') source = ''; else throw error; }
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source ? source.split(/\r?\n/) : [];
  const header = `[plugins."${pluginId}"]`;
  const start = lines.findIndex((line) => line.trim() === header);
  const isTable = (line) => /^\s*\[[^\]]+\]\s*(?:#.*)?$/.test(line);
  let end = lines.length;
  if (start >= 0) {
    for (let i = start + 1; i < lines.length; i += 1) {
      if (isTable(lines[i])) { end = i; break; }
    }
    const enabledLine = /^\s*enabled\s*=.*$/;
    const existing = lines.findIndex((line, index) => index > start && index < end && enabledLine.test(line));
    if (existing >= 0) lines[existing] = `enabled = ${enabled ? 'true' : 'false'}`;
    else lines.splice(start + 1, 0, `enabled = ${enabled ? 'true' : 'false'}`);
  } else {
    while (lines.length && lines.at(-1) === '') lines.pop();
    lines.push('', header, `enabled = ${enabled ? 'true' : 'false'}`);
  }
  await mkdir(codexHome, { recursive: true });
  const temporaryPath = `${configPath}.forge-${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temporaryPath, `${lines.join(newline).replace(/\n*$/, '')}${newline}`, 'utf8');
    await rename(temporaryPath, configPath);
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
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
  const input = relativePath ? ForgeFilePaths.normalize(relativePath) : '';
  const absolute = path.resolve(activeWorkspace, input);
  if (!pathIsInside(activeWorkspace, absolute)) {
    const requestedPath = absolute.replace(/[\u0000-\u001f\u007f]/g, '�');
    throw new Error(`Path “${requestedPath}” is outside open workspace “${activeWorkspace}”. Open the folder containing that path and try again.`);
  }
  const canonical = await realpath(absolute);
  if (!pathIsInside(activeWorkspace, canonical)) {
    const resolvedPath = canonical.replace(/[\u0000-\u001f\u007f]/g, '�');
    throw new Error(`Path “${resolvedPath}” resolves outside open workspace “${activeWorkspace}”. Open the folder containing that path and try again.`);
  }
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
    resumedThreads.clear();
    const child = spawn(codexExecutable, codexArgs(['app-server', '--listen', 'stdio://', '-c', 'features.default_mode_request_user_input=true', '-c', 'features.apps=true', '-c', 'features.plugins=true', ...browserCodexArgs(appRoot, dataRoot, activeWorkspace)]), {
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
      if (this.child !== child) return;
      this.child = null;
      this.initialized = false;
      resumedThreads.clear();
      this.failPending(error);
      this.emit({ type: 'connection', connected: false, message: error.message });
    });
    child.on('close', (code) => {
      if (this.child !== child) return;
      this.child = null;
      this.initialized = false;
      resumedThreads.clear();
      this.failPending(new Error(`Codex App Server exited${code === null ? '' : ` with code ${code}`}.`));
      this.emit({ type: 'connection', connected: false, message: 'Codex connection closed.' });
    });
    await this.requestRaw('initialize', {
      clientInfo: { name: 'forge_coding_workspace', title: 'Forge', version: process.env.FORGE_APP_VERSION || '1.0.37' },
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
        if (message.method === 'serverRequest/resolved') this.serverRequests.delete(String(message.params?.requestId));
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
  const pluginMentions = [];
  if (Array.isArray(input.pluginMentions) && input.pluginMentions.length) {
    if (input.pluginMentions.length > 10) throw new Error('Mention at most ten Codex plugins in one message.');
    const installed = await getInstalledPlugins();
    const seen = new Set();
    for (const requested of input.pluginMentions) {
      const pluginId = validatePluginSelector(requested?.pluginId);
      if (seen.has(pluginId)) continue;
      const plugin = installed.find((candidate) => candidate.pluginId === pluginId && candidate.enabled);
      if (!plugin) throw new Error('That plugin is not enabled in your Codex account. Refresh the plugin list and try again.');
      if (!String(input.text || '').includes(`@${plugin.name}`)) throw new Error('The message no longer contains the selected plugin mention.');
      pluginMentions.push({ type: 'mention', name: plugin.name, path: `plugin://${plugin.name}@${plugin.marketplaceName}` });
      // App mentions make a plugin's already connected service tools explicit to the model.
      const setup = await getPluginSetup(pluginId).catch(() => ({ apps: [] }));
      for (const app of setup.apps.filter((app) => app.callable)) {
        if (!pluginMentions.some((mention) => mention.path === `app://${app.id}`)) {
          pluginMentions.push({ type: 'mention', name: app.name, path: `app://${app.id}` });
        }
      }
      seen.add(pluginId);
    }
  }
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
      ...pluginMentions,
      ...(input.images || []).map((image) => ({ type: 'image', url: image.dataUrl, detail: 'auto' })),
    ], model: model || undefined, effort,
    collaborationMode: { mode: input.planningMode ? 'plan' : 'default', settings: { model, reasoning_effort: effort, developer_instructions: computerUseDeveloperInstruction } },
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
        messages.push({ id: item.id, turnId: turn.id, role: 'activity', activityType: 'tool', toolName: (item.server === 'forge_browser' ? (String(item.tool || '').startsWith('computer_use_') ? 'Computer' : 'Browser') : item.server) + ' · ' + String(item.tool || '').replace(/^(?:browser_|computer_use_)/, '').replaceAll('_', ' '), input: item.arguments, output: (item.result?.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('\n').slice(0, 24000) || item.error?.message || '', status: item.status?.type || item.status || '' });
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
  if (req.method === 'GET' && route === '/api/plugins') {
    try {
      const refresh = url.searchParams.get('refresh') === '1';
      const view = url.searchParams.get('view') || 'installed';
      if (!['installed', 'discover', 'marketplaces'].includes(view)) throw new Error('Choose a valid Plugins view.');
      if (view === 'marketplaces') return json(res, 200, { view, marketplaces: await getPluginMarketplaces(refresh) });
      const installed = await getInstalledPlugins(refresh);
      if (view === 'installed') return json(res, 200, { view, plugins: installed, total: installed.length });
      const query = String(url.searchParams.get('q') || '').trim().slice(0, 100).toLocaleLowerCase();
      const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') || '0', 10) || 0);
      const limit = Math.min(60, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '36', 10) || 36));
      const installedIds = new Set(installed.map((plugin) => plugin.pluginId));
      const matching = (await getPluginCatalog(refresh))
        .filter((plugin) => !installedIds.has(plugin.pluginId))
        .filter((plugin) => !query || `${plugin.name} ${plugin.pluginId} ${plugin.marketplaceName}`.toLocaleLowerCase().includes(query));
      return json(res, 200, { view, plugins: matching.slice(offset, offset + limit), total: matching.length, offset, limit });
    } catch (error) { return json(res, 503, { error: error.message || 'Could not load Codex plugins.' }); }
  }
  if (req.method === 'GET' && route === '/api/plugins/setup') {
    try { return json(res, 200, await getPluginSetup(validatePluginSelector(url.searchParams.get('pluginId')), url.searchParams.get('refresh') === '1')); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (req.method === 'GET' && route === '/api/tree') {
    try { return json(res, 200, { entries: await readTree(url.searchParams.get('dir') || '') }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (req.method === 'GET' && route === '/api/file') {
    try { return json(res, 200, await readWorkspaceFile(url.searchParams.get('path') || '')); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (req.method === 'GET' && route === '/api/file/download') {
    try {
      const filePath = await resolveWorkspacePath(url.searchParams.get('path') || '');
      const info = await stat(filePath);
      if (!info.isFile()) throw new Error('Choose a file to download.');
      const filename = encodeURIComponent(path.basename(filePath)).replace(/['()]/g, (char) => '%' + char.charCodeAt(0).toString(16));
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': info.size, 'Content-Disposition': `attachment; filename*=UTF-8''${filename}`, 'Cache-Control': 'no-store' });
      const stream = createReadStream(filePath);
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
      return;
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (req.method === 'GET' && route === '/api/changes/file') {
    try { return json(res, 200, await readWorkspaceChange(url.searchParams.get('path') || '')); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (req.method === 'POST') {
    let input;
    try { input = await bodyJson(req); } catch (error) { return json(res, 400, { error: error.message }); }
    try {
      if (route === '/api/file/open') {
        const filePath = await resolveWorkspacePath(input.path);
        if (!(await stat(filePath)).isFile()) throw new Error('Choose a file to open.');
        if (!ForgeFilePaths.opensNatively(filePath)) throw new Error('Open this file in the Forge preview.');
        if (typeof process.send !== 'function' || !process.connected) return json(res, 200, { download: true, filename: path.basename(filePath) });
        const result = await requestDesktopComputerUse('open-file', { path: filePath });
        return json(res, 200, result);
      }
      if (route === '/api/plugins/connect') {
        const setup = await getPluginSetup(validatePluginSelector(input.pluginId));
        const server = setup.servers.find((entry) => entry.name === input.serverName);
        if (!server) throw new Error('Choose a server from this plugin’s setup panel.');
        const result = await codex.rpc('mcpServer/oauth/login', { name: server.name }, 45000);
        return json(res, 200, result);
      }
      if (route === '/api/plugins/app/enable') {
        const setup = await getPluginSetup(validatePluginSelector(input.pluginId));
        const app = setup.apps.find((entry) => entry.id === input.appId);
        if (!app) throw new Error('Choose a connection declared by this plugin.');
        await codex.rpc('config/value/write', { keyPath: `apps.${app.id}.enabled`, value: true, mergeStrategy: 'upsert' });
        await refreshPluginRuntime();
        return json(res, 200, { ok: true });
      }
      if (route === '/api/plugins/install') {
        const pluginId = validatePluginSelector(input.pluginId);
        const available = await getPluginCatalog();
        if (!available.some((plugin) => plugin.pluginId === pluginId)) throw new Error('That plugin is no longer available. Refresh the catalog and try again.');
        await codexPluginCommand(['add', pluginId, '--json'], { timeout: 240000 });
        invalidatePluginCaches();
        await refreshPluginRuntime();
        return json(res, 200, { ok: true, newSessionRequired: true });
      }
      if (route === '/api/plugins/remove') {
        const pluginId = validatePluginSelector(input.pluginId);
        const installed = await getInstalledPlugins();
        if (!installed.some((plugin) => plugin.pluginId === pluginId)) throw new Error('That plugin is no longer installed. Refresh the list and try again.');
        await codexPluginCommand(['remove', pluginId, '--json'], { timeout: 240000 });
        invalidatePluginCaches();
        return json(res, 200, { ok: true, newSessionRequired: true });
      }
      if (route === '/api/plugins/enabled') {
        const pluginId = validatePluginSelector(input.pluginId);
        const installed = await getInstalledPlugins();
        if (!installed.some((plugin) => plugin.pluginId === pluginId)) throw new Error('That plugin is no longer installed. Refresh the list and try again.');
        await setCodexPluginEnabled(pluginId, input.enabled === true);
        invalidatePluginCaches();
        await refreshPluginRuntime();
        return json(res, 200, { ok: true, newSessionRequired: true });
      }
      if (route === '/api/plugins/marketplaces/add') {
        const source = String(input.source || '').trim();
        if (!source || source.length > 3000 || source.startsWith('-') || /[\u0000-\u001f]/.test(source)) throw new Error('Enter a marketplace Git URL, owner/repository, or local folder path.');
        await codexPluginCommand(['marketplace', 'add', source], { timeout: 300000 });
        invalidatePluginCaches();
        return json(res, 200, { ok: true, marketplaces: await getPluginMarketplaces(true) });
      }
      if (route === '/api/plugins/marketplaces/remove') {
        const name = String(input.name || '').trim();
        if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(name) || name.toLowerCase().startsWith('openai-')) throw new Error('Choose a user-added marketplace to remove.');
        if (!(await getPluginMarketplaces()).some((marketplace) => marketplace.name === name)) throw new Error('That marketplace is no longer configured. Refresh the list and try again.');
        await codexPluginCommand(['marketplace', 'remove', name]);
        invalidatePluginCaches();
        return json(res, 200, { ok: true, marketplaces: await getPluginMarketplaces(true) });
      }
      if (route === '/api/plugins/marketplaces/refresh') {
        const name = String(input.name || '').trim();
        if (name && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(name)) throw new Error('Choose a valid marketplace.');
        const marketplaces = await getPluginMarketplaces();
        if (name && !marketplaces.some((marketplace) => marketplace.name === name)) throw new Error('That marketplace is no longer configured. Refresh the list and try again.');
        await codexPluginCommand(['marketplace', 'upgrade', ...(name ? [name] : [])], { timeout: 300000 });
        invalidatePluginCaches();
        return json(res, 200, { ok: true, marketplaces: await getPluginMarketplaces(true) });
      }
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
        const kiloFree = input.nativePreset === 'kilo-free';
        if (kiloFree && baseUrl !== KILO_FREE_BASE_URL) throw new Error('Kilo Free Router requires the official Kilo gateway endpoint.');
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
        const availableIds = [...new Set(rows.filter((model) => model?.active !== false).map((model) => String(model?.id || model?.name || '').trim()).filter((id) => /^[\w./:@+-]{1,180}$/.test(id)))].slice(0, 100);
        const codingOnly = kiloFree || isGroqProvider({ baseUrl });
        const freeAlias = rows.find((model) => model?.id === KILO_FREE_MODEL);
        const freePrice = freeAlias?.pricing && ['prompt', 'completion'].every((field) => freeAlias.pricing[field] != null && String(freeAlias.pricing[field]).trim() !== '' && Number(freeAlias.pricing[field]) === 0);
        const modelIds = kiloFree ? (freePrice && freeAlias.supported_parameters?.includes('tools') ? [KILO_FREE_MODEL] : []) : codingOnly ? GROQ_CODING_MODELS.filter((id) => availableIds.includes(id)) : availableIds;
        if (!modelIds.length) throw new Error(kiloFree ? 'Kilo Auto Free is not currently listed as a zero-price tool-capable route. Try again later; no paid route will be added.' : 'The provider returned no model IDs. Add model IDs manually.');
        return json(res, 200, { modelIds, codingOnly });
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
        const nativePreset = input.nativePreset === 'kilo-free' ? 'kilo-free' : undefined;
        if (nativePreset && (baseUrl !== KILO_FREE_BASE_URL || models.some((model) => model.id !== KILO_FREE_MODEL))) throw new Error('Kilo Free Router is restricted to the official endpoint and kilo-auto/free.');
        const apiKey = String(input.apiKey || '').trim();
        if (apiKey.length > 4096) throw new Error('Provider API keys must be 4,096 characters or fewer.');
        const encryptedKeys = await readEncryptedProviderKeys(providerKeysPath);
        if (apiKey) encryptedKeys[id] = await encryptProviderKey(apiKey);
        if (!encryptedKeys[id]) throw new Error('Enter an API key for this provider.');
        const apiFormat = ['auto', 'chat', 'responses'].includes(input.apiFormat) ? input.apiFormat : 'auto';
        const provider = { id, name, baseUrl, models, apiFormat: nativePreset ? 'chat' : apiFormat, ...(nativePreset ? { nativePreset } : {}) };
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
          if (input.decision === 'answer' || input.decision === 'skip') {
            anthropic.resolveQuestion(id, input.answers, input.decision === 'skip');
            return json(res, 200, { ok: true });
          }
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
        } else if (method === 'mcpServer/elicitation/request') {
          const action = String(input.decision || 'decline');
          if (!['accept', 'decline', 'cancel'].includes(action)) throw new Error('Choose Continue, Decline, or Cancel.');
          if (action === 'accept' && params.mode !== 'url' && !['form', 'openai/form', 'openaiForm'].includes(params.mode)) throw new Error('This verification needs its original client. Open it in Codex.');
          const content = action === 'accept' && params.mode !== 'url' ? ForgePluginForms.validate(params.requestedSchema, input.content) : null;
          codex.reply(id, { action, content, _meta: null });
        } else if (method === 'tool/requestUserInput' || method === 'item/tool/requestUserInput') {
          const answers = input.decision === 'skip' ? {} : ForgeQuestions.validate(params.questions, input.answers);
          codex.reply(id, { answers });
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
  if (url.pathname === '/internal/computer-use') {
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
    if (req.headers.authorization !== `Bearer ${bridgeToken}` || req.headers.origin) return json(res, 403, { error: 'Invalid local computer-use session.' });
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', cancel);
    try {
      const input = await bodyJson(req);
      const action = String(input.action || '');
      if (!['computer-connection', 'computer-state', 'computer-focus', 'computer-open', 'computer-screenshot', 'computer-click', 'computer-move', 'computer-drag', 'computer-scroll', 'computer-type', 'computer-press-key', 'open', 'tabs', 'state', 'navigate', 'back', 'forward', 'reload', 'stop', 'snapshot', 'screenshot', 'click', 'type', 'press-key', 'click-at', 'move', 'drag', 'scroll'].includes(action)) throw new Error('Choose a supported computer-use action.');
      const result = await runDesktopComputerUse(action, input.params && typeof input.params === 'object' ? input.params : {}, controller.signal);
      if (controller.signal.aborted) return;
      return json(res, 200, { result });
    } catch (error) {
      if (controller.signal.aborted) return;
      return json(res, 502, { error: error.message || 'The computer-use action failed.' });
    } finally {
      res.removeListener('close', cancel);
    }
  }
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
if (process.env.FORGE_IN_APP_BROWSER === '1') {
  process.env.FORGE_BROWSER_API_URL = `${localUrl}/internal/computer-use`;
  process.env.FORGE_BROWSER_API_TOKEN = bridgeToken;
}
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
