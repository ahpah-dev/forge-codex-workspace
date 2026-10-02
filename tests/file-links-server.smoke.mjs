// Isolated round trip: real chat click -> workspace API -> desktop IPC boundary.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { readdir } from 'node:fs/promises';

const root = path.resolve(import.meta.dirname, '..');
const profile = await mkdtemp(path.join(await realpath(tmpdir()), 'forge-file-links-'));
const workspace = path.join(profile, 'New folder (15)');
const archive = path.join(workspace, 'downloads', 'lunar-cli.zip');
const bytes = Buffer.from('PK archive fixture');
await mkdir(path.dirname(archive), { recursive: true });
await mkdir(path.join(profile, 'data'), { recursive: true });
await writeFile(archive, bytes);
await writeFile(path.join(workspace, 'lunar.mjs'), 'console.log("preview works");');
await writeFile(path.join(workspace, 'setup.exe'), 'executable fixture');
await writeFile(path.join(profile, 'data/settings.json'), JSON.stringify({ activeWorkspace: workspace }));
let server, browser;
const opened = [];
try {
  server = fork(path.join(root, 'server.mjs'), [], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, FORGE_DATA_DIR: path.join(profile, 'data'), FORGE_NO_BROWSER: '1', FORGE_PORT: '0', CODEX_HOME: path.join(profile, 'codex'), CODEX_CLI: path.join(profile, 'unavailable-codex'), CLAUDE_CLI: path.join(profile, 'unavailable-claude') },
  });
  server.on('message', (message) => {
    if (message.type !== 'forge:computer-use') return;
    assert.equal(message.action, 'open-file');
    opened.push(message.params.path);
    server.send({ type: 'forge:computer-use-result', id: message.id, result: { opened: true } });
  });
  const url = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Isolated server did not start.')), 20000);
    server.stdout.on('data', (chunk) => { output += chunk; const match = output.match(/Forge is ready at (http:\/\/127\.0\.0\.1:\d+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    server.once('exit', (code) => { clearTimeout(timer); reject(new Error('Server exited: ' + code)); });
  });
  const browsers = await readdir(path.join(root, 'build/browser'));
  const headless = browsers.find((name) => name.startsWith('chromium_headless_shell-'));
  browser = await chromium.launch({ headless: true, executablePath: path.join(root, 'build/browser', headless, 'chrome-headless-shell-win64/chrome-headless-shell.exe') });
  const page = await browser.newPage();
  await page.route('https://**/*', (route) => route.abort());
  await page.goto(url);
  await page.waitForFunction(() => Boolean(globalThis.ForgeFilePaths && typeof openLinkedFile === 'function'), null, { timeout: 20000 });
  const target = '/' + archive.replaceAll('\\', '/');
  await page.evaluate(({ target, workspace }) => {
    state.workspace = { path: workspace, name: 'New folder (15)' };
    state.threadId = 'file-link-fixture';
    state.messages = [{ id: 'fixture', role: 'assistant', text: 'File link fixture' }];
    renderSurface();
    $('#conversation-scroll').innerHTML = renderMarkdown(`[Open ZIP](<${target}>) [Source](</${workspace.replaceAll('\\', '/')}/lunar.mjs:1>)`);
  }, { target, workspace });
  const [response] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/file/open')),
    page.getByRole('link', { name: 'Open ZIP', exact: true }).click(),
  ]);
  assert.equal(response.status(), 200);
  assert.deepEqual(await response.json(), { opened: true });
  assert.deepEqual(opened, [archive]);
  const direct = await page.evaluate(async (target) => api('/api/file/open', { method: 'POST', body: { path: target } }), target);
  assert.equal(direct.opened, true, 'server must also normalize a leading slash before a Windows drive');
  const downloaded = await page.evaluate(async () => {
    const response = await fetch('/api/file/download?path=downloads%2Flunar-cli.zip', { headers: { 'X-Forge-Session': token } });
    return { status: response.status, disposition: response.headers.get('content-disposition'), bytes: Array.from(new Uint8Array(await response.arrayBuffer())) };
  });
  assert.equal(downloaded.status, 200);
  assert.match(downloaded.disposition, /lunar-cli.zip/);
  assert.deepEqual(downloaded.bytes, Array.from(bytes));
  await page.getByRole('link', { name: 'Source', exact: true }).click();
  await page.locator('#file-preview pre').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#file-preview pre').textContent(), 'console.log("preview works");');
  const blocked = await page.evaluate(async (outside) => {
    const errors = [];
    for (const file of [outside, 'setup.exe']) {
      try { await api('/api/file/open', { method: 'POST', body: { path: file } }); }
      catch (error) { errors.push(error.message); }
    }
    return errors;
  }, path.join(profile, 'outside.zip'));
  assert.match(blocked[0], /outside open workspace/);
  assert.match(blocked[1], /Forge preview/);
  assert.equal(opened.length, 2);
  console.log('PASS: actual ZIP clicks reach desktop IPC, /C:/ normalization works on both sides, downloads preserve bytes, code previews are visible, and outside paths/executables stay blocked.');
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) { server.kill(); await new Promise((resolve) => { server.once('exit', resolve); setTimeout(resolve, 3000).unref(); }); }
  // This absolute, known temporary profile is the only cleanup target.
  if (!path.isAbsolute(profile) || !path.basename(profile).startsWith('forge-file-links-') || path.dirname(profile).toLowerCase() !== (await realpath(tmpdir())).toLowerCase()) throw new Error('Unexpected cleanup target.');
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
