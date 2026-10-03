import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomBytes } from 'node:crypto';

export const OMNIROUTE_VERSION = '3.8.51';
export const OMNIROUTE_BASE_URL = 'http://127.0.0.1:20128/v1';
export function isLocalOmniRoute(provider) {
  if (provider?.nativePreset !== 'omniroute') return false;
  try { const url = new URL(provider.baseUrl); return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && !url.username && !url.password; }
  catch { return false; }
}

export function createOmniRouteManager({ appRoot, dataRoot, fetchImpl = fetch, spawnImpl = spawn }) {
  const installRoot = path.join(dataRoot, 'omniroute', 'runtime');
  const profile = path.join(dataRoot, 'omniroute', 'profile');
  const entry = path.join(installRoot, 'node_modules', 'omniroute', 'dist', 'server.js');
  const npmCli = path.join(appRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const installMarker = path.join(installRoot, `.forge-installed-${OMNIROUTE_VERSION}`);
  const installed = () => existsSync(entry) && existsSync(installMarker);
  let server = null, installer = null, operation = null, starting = null, stopped = false;
  let phase = 'idle', error = '';
  let serverReady = false;
  const serviceToken = randomBytes(32).toString('hex');
  const env = () => ({ ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production', DATA_DIR: profile, HOSTNAME: '127.0.0.1', HOST: '127.0.0.1', PORT: '20128', OMNIROUTE_INTERNAL_SERVICE_TOKEN: serviceToken, OMNIROUTE_NO_UPDATE_NOTIFIER: '1', OMNIROUTE_CLI_SKIP_REPO_ENV: '1', OMNIROUTE_AUTO_FREE_FALLBACK_TO_FULL_POOL: 'false' });
  async function status() {
    let running = false, requiresKey = false;
    try {
      const response = await fetchImpl(`${OMNIROUTE_BASE_URL}/models`, { method: server ? 'HEAD' : 'GET', signal: AbortSignal.timeout(2000) });
      // Do not adopt an unrelated service that happens to use this port.
      running = Boolean(response.headers.get('x-omniroute-version')) || Boolean(server && serverReady && response.ok);
      if (!running && response.ok) { const body = await response.json(); running = body.object === 'list' && body.data?.some((model) => model.id === 'auto/coding' || model.id === 'auto'); }
      else await response.body?.cancel();
      requiresKey = running && [401, 403].includes(response.status);
    } catch { /* Not started yet. */ }
    return { phase: running ? 'running' : phase, running, installed: installed(), managed: Boolean(server), requiresKey, version: OMNIROUTE_VERSION, baseUrl: OMNIROUTE_BASE_URL, dashboardUrl: 'http://127.0.0.1:20128/dashboard', error };
  }
  function start() {
    if (!starting) starting = startProcess().finally(() => { starting = null; });
    return starting;
  }
  async function startProcess() {
    if (stopped) throw new Error('Forge is closing.');
    if ((await status()).running) return status();
    if (!installed()) throw new Error('Install OmniRoute from the provider panel first.');
    if (server) return status();
    await mkdir(profile, { recursive: true });
    phase = 'starting'; error = '';
    serverReady = false;
    // Use OmniRoute's production launcher: it stamps the real socket locality
    // for authenticated internal management and installs its abort guards.
    const productionEntry = path.join(path.dirname(entry), 'server-ws.mjs');
    const child = server = spawnImpl(process.execPath, [existsSync(productionEntry) ? productionEntry : entry], { cwd: path.dirname(entry), env: env(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let startupTail = '';
    const capture = (bytes) => {
      startupTail = (startupTail + bytes.toString().replace(/\x1b\[[0-9;]*m/g, '')).slice(-2000);
      // Require our child's readiness event before trusting a successful HEAD;
      // an unrelated application may already own the requested port.
      if (/Ready in\s+\d/i.test(startupTail)) serverReady = true;
    };
    server.stdout.on('data', capture); server.stderr.on('data', capture);
    child.once('error', () => { if (server !== child) return; server = null; phase = 'failed'; error = 'The local OmniRoute process could not start.'; });
    child.once('exit', () => { if (server !== child) return; server = null; if (!stopped && phase !== 'failed') { phase = 'failed'; error = /EADDRINUSE/.test(startupTail) ? 'Port 20128 is already in use by another application.' : 'OmniRoute stopped. Try Start again; reinstall if the runtime is incomplete.'; } });
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline && server && !stopped) {
      if ((await status()).running) { phase = 'running'; return status(); }
      await delay(1000);
    }
    phase = 'failed'; error ||= 'OmniRoute did not become ready within 90 seconds.';
    server?.kill(); server = null;
    throw new Error(error);
  }
  function installAndStart() {
    if (operation) return;
    error = '';
    phase = installed() ? 'starting' : 'installing';
    operation = (async () => {
      if (!installed()) {
        if (!existsSync(npmCli)) throw new Error('The bundled installer is missing. Install the latest Forge desktop build.');
        phase = 'installing'; await mkdir(installRoot, { recursive: true });
        const code = await new Promise((resolve, reject) => {
          installer = spawnImpl(process.execPath, [npmCli, 'install', '--prefix', installRoot, '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock', '--registry=https://registry.npmjs.org', `omniroute@${OMNIROUTE_VERSION}`], { cwd: installRoot, env: { ...env(), NODE_ENV: '', OMNIROUTE_SKIP_POSTINSTALL: '1', CI: '1' }, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
          const timer = setTimeout(() => { installer?.kill(); reject(new Error('OmniRoute installation timed out. Try again when your connection is stable.')); }, 600000);
          installer.once('error', () => { clearTimeout(timer); reject(new Error('The local package installer could not start.')); });
          installer.once('exit', (code) => { clearTimeout(timer); installer = null; resolve(code); });
        });
        if (code !== 0 || !existsSync(entry)) throw new Error('OmniRoute installation failed. Check your internet connection and available disk space, then retry.');
        const pkg = JSON.parse(await readFile(path.join(installRoot, 'node_modules', 'omniroute', 'package.json'), 'utf8'));
        if (pkg.version !== OMNIROUTE_VERSION) throw new Error('OmniRoute runtime version does not match the supported release.');
        // A partially downloaded package can already have its server entry.
        // Mark installation complete only after npm and version checks succeed,
        // so another click retries an interrupted installation.
        await writeFile(installMarker, OMNIROUTE_VERSION + '\n', 'utf8');
      }
      await start();
    })().catch((failure) => { phase = 'failed'; error = failure.message; }).finally(() => { operation = null; });
  }
  async function stop() { stopped = true; installer?.kill(); server?.kill(); installer = null; server = null; }
  async function management(route, method = 'GET', body) {
    if (!server || !serverReady) throw new Error('Forge can configure only the OmniRoute process it started.');
    const response = await fetchImpl(`http://127.0.0.1:20128/api/${route}`, { method,
      headers: { 'x-omniroute-internal-service-token': serviceToken, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(`OmniRoute configuration failed at ${route.split('/')[0]} (HTTP ${response.status}).`), { status: response.status, details: result.error });
    return result;
  }
  return { status, start, installAndStart, stop, management };
}
