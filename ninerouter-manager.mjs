import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomBytes } from 'node:crypto';

export const NINEROUTER_VERSION = '0.5.99';
// OmniRoute owns 20128; the two gateways can run together.
export const NINEROUTER_BASE_URL = 'http://127.0.0.1:20129/v1';
export const NINEROUTER_PROVIDER_ID = '9router';
export function isLocalNineRouter(provider) {
  if (provider?.nativePreset !== '9router') return false;
  try {
    const url = new URL(provider.baseUrl);
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}
export function defaultNineRouter() {
  return { id: NINEROUTER_PROVIDER_ID, name: '9router', nativePreset: '9router', apiFormat: 'chat', baseUrl: NINEROUTER_BASE_URL, models: [] };
}

export function createNineRouterManager({ appRoot, dataRoot }) {
  const root = path.join(dataRoot, '9router', 'runtime');
  const profile = path.join(dataRoot, '9router', 'profile');
  const entry = path.join(root, 'node_modules', '9router', 'app', 'custom-server.js');
  const marker = path.join(root, `.forge-installed-${NINEROUTER_VERSION}`);
  const npmCli = path.join(appRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const secretFile = path.join(profile, '.forge-auth-secret');
  let authSecret = '';
  const installed = () => existsSync(entry) && existsSync(marker);
  const env = () => ({ ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production', DATA_DIR: profile,
    PORT: '20129', HOSTNAME: '127.0.0.1', HOST: '127.0.0.1', ...(authSecret ? { JWT_SECRET: authSecret, API_KEY_SECRET: authSecret } : {}),
    BASE_URL: 'http://127.0.0.1:20129', NEXT_PUBLIC_BASE_URL: 'http://127.0.0.1:20129',
    NODE_PATH: [path.join(root, 'node_modules'), path.join(path.dirname(entry), 'node_modules')].join(path.delimiter) });
  let server = null, installer = null, operation = null, starting = null, stopped = false, ready = false;
  let phase = 'idle', error = '';
  async function status() {
    let running = false;
    try {
      // /models may consult upstream catalogs; readiness must stay independent of them.
      const response = await fetch('http://127.0.0.1:20129/dashboard', { signal: AbortSignal.timeout(2000) });
      const html = await response.text();
      running = response.ok && (server && ready || /9router/i.test(html));
    } catch { /* Router is not running. */ }
    return { phase: running ? 'running' : phase, running: Boolean(running), installed: installed(), managed: Boolean(server),
      version: NINEROUTER_VERSION, baseUrl: NINEROUTER_BASE_URL, dashboardUrl: 'http://127.0.0.1:20129/dashboard', error };
  }
  async function startProcess() {
    if (stopped) throw new Error('Forge is closing.');
    if ((await status()).running) return status();
    if (!installed()) throw new Error('Open Manage providers → 9router → Install & start, then connect your free providers in its dashboard.');
    await mkdir(profile, { recursive: true });
    try { authSecret = (await readFile(secretFile, 'utf8')).trim(); } catch { /* First start. */ }
    if (!/^[a-f0-9]{64}$/.test(authSecret)) { authSecret = randomBytes(32).toString('hex'); await writeFile(secretFile, authSecret, { mode: 0o600 }); }
    phase = 'starting'; error = ''; ready = false;
    let tail = '';
    const child = server = spawn(process.execPath, ['--dns-result-order=ipv4first', entry], { cwd: path.dirname(entry), env: env(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const capture = (bytes) => { tail = (tail + bytes.toString().replace(/\x1b\[[0-9;]*m/g, '')).slice(-2000); if (/Ready in\s+\d/i.test(tail)) ready = true; };
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    child.once('error', () => { if (server === child) { server = null; phase = 'failed'; error = 'The 9router process could not start.'; } });
    child.once('exit', () => { if (server !== child) return; server = null; ready = false; if (!stopped) { phase = 'failed'; error = /EADDRINUSE/.test(tail) ? 'Port 20129 is in use. Set the address of your existing 9router instance in the provider form.' : '9router stopped. Try Start again, or reinstall its runtime.'; } });
    const deadline = Date.now() + 90000;
    while (server && !stopped && Date.now() < deadline) {
      if ((await status()).running) { phase = 'running'; return status(); }
      await delay(1000);
    }
    error ||= '9router did not become ready within 90 seconds.';
    phase = 'failed'; server?.kill(); server = null;
    throw new Error(error);
  }
  function start() {
    if (!starting) starting = startProcess().finally(() => { starting = null; });
    return starting;
  }
  function installAndStart() {
    if (operation || stopped) return;
    phase = installed() ? 'starting' : 'installing'; error = '';
    operation = (async () => {
      if (!installed()) {
        if (!existsSync(npmCli)) throw new Error('The bundled npm installer is missing. Install the latest Forge desktop build.');
        await mkdir(root, { recursive: true });
        const code = await new Promise((resolve, reject) => {
          // sql.js supplies the portable SQLite fallback, including its WASM asset.
          // Launch the production server directly to avoid CLI tray/update processes.
          const child = installer = spawn(process.execPath, [npmCli, 'install', '--prefix', root, '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock', '--registry=https://registry.npmjs.org', `9router@${NINEROUTER_VERSION}`, 'sql.js@1.14.1'], { cwd: root, env: { ...env(), NODE_ENV: '', CI: '1' }, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
          const timer = setTimeout(() => { child.kill(); reject(new Error('9router installation timed out. Check your connection and retry.')); }, 600000);
          child.once('error', () => { clearTimeout(timer); reject(new Error('The 9router installer could not start.')); });
          child.once('exit', (code) => { clearTimeout(timer); if (installer === child) installer = null; resolve(code); });
        });
        if (stopped) return;
        if (code !== 0 || !existsSync(entry)) throw new Error('9router installation failed. Check your connection and disk space, then retry.');
        const pkg = JSON.parse(await readFile(path.join(root, 'node_modules', '9router', 'package.json'), 'utf8'));
        if (pkg.version !== NINEROUTER_VERSION || !existsSync(path.join(root, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'))) throw new Error('9router runtime is incomplete. Retry installation.');
        await writeFile(marker, NINEROUTER_VERSION + '\n');
      }
      await start();
    })().catch((failure) => { if (!stopped) { phase = 'failed'; error = failure.message; } }).finally(() => { operation = null; });
  }
  async function stop() { stopped = true; installer?.kill(); server?.kill(); installer = null; server = null; }
  return { status, start, installAndStart, stop };
}
