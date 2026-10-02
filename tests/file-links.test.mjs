import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import '../public/file-paths.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workspace = 'C:\\Users\\David\\Downloads\\New folder (15)';
const zip = workspace + '\\downloads\\lunar-cli.zip';

test('Windows markdown paths do not duplicate drive letters', () => {
  for (const input of [zip, '/C:/Users/David/Downloads/New folder (15)/downloads/lunar-cli.zip', 'file:///C:/Users/David/Downloads/New%20folder%20(15)/downloads/lunar-cli.zip']) {
    const normalized = ForgeFilePaths.normalize(input);
    assert.equal(path.win32.resolve(workspace, normalized), zip);
    assert.equal(ForgeFilePaths.relativeToWorkspace(workspace, input), 'downloads/lunar-cli.zip');
  }
  assert.equal(ForgeFilePaths.normalize('/C:/src/app.mjs:42:3'), 'C:/src/app.mjs');
  assert.equal(ForgeFilePaths.normalize('/C:/'), 'C:/');
  assert.equal(ForgeFilePaths.relativeToWorkspace('C:\\', '/C:/downloads/file.zip'), 'downloads/file.zip');
});

test('file references preserve UNC paths and reject workspace escapes', () => {
  assert.equal(ForgeFilePaths.normalize('file://server/share/folder/a.zip'), '//server/share/folder/a.zip');
  assert.equal(ForgeFilePaths.relativeToWorkspace('\\\\server\\share\\folder', '\\\\SERVER\\share\\folder\\a.zip'), 'a.zip');
  for (const target of ['../lunar-cli.zip', '%2e%2e/lunar-cli.zip', '/C:/Windows/file.zip', 'C:/Users/David/Downloads/New folder (150)/file.zip', 'downloads/../../../file.zip', 'downloads/file.zip:stream']) {
    assert.throws(() => ForgeFilePaths.relativeToWorkspace(workspace, target));
  }
  assert.throws(() => ForgeFilePaths.normalize('javascript:alert(1)'));
  assert.throws(() => ForgeFilePaths.normalize('file:///C:/bad%00.zip'));
  assert.equal(ForgeFilePaths.opensNatively('downloads/lunar-cli.zip'), true);
  assert.equal(ForgeFilePaths.opensNatively('src/app.mjs'), false);
  assert.equal(ForgeFilePaths.opensNatively('setup.exe'), false);
});

test('archive clicks open through the workspace API while source links preview', { timeout: 30000 }, async () => {
  const browsers = await readdir(path.join(root, 'build/browser'));
  const headless = browsers.find((name) => name.startsWith('chromium_headless_shell-'));
  const executablePath = path.join(root, 'build/browser', headless, 'chrome-headless-shell-win64/chrome-headless-shell.exe');
  const source = await readFile(path.join(root, 'public/app.js'), 'utf8');
  const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const page = await browser.newPage();
    await page.setContent('<main id="conversation-scroll"></main>');
    await page.addScriptTag({ path: path.join(root, 'public/file-paths.js') });
    await page.addScriptTag({ content: `
      const $ = (selector) => document.querySelector(selector);
      const state = { workspace: { path: ${JSON.stringify(workspace)} } };
      const sent = [], previews = [], errors = [];
      const token = 'test-session';
      const escapeHTML = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
      const showToast = (message) => errors.push(message);
      const api = async (route, options) => { sent.push({ route, ...options }); return globalThis.downloadInstead ? { download: true, filename: 'lunar-cli.zip' } : { opened: true }; };
      const openFile = async (file) => previews.push(file);
      ${section('async function openLinkedFile(', 'async function openFile(')}
      ${section('function markdownInline(', 'function renderMarkdown(')}
      ${section("$('#conversation-scroll').addEventListener('click'", "$('#file-tree').addEventListener('click'")}
      $('#conversation-scroll').innerHTML = markdownInline('[Open ZIP](</C:/Users/David/Downloads/New folder (15)/downloads/lunar-cli.zip>)') + markdownInline('[Source](</C:/Users/David/Downloads/New folder (15)/lunar.mjs:42>)') + markdownInline('[File URI](<file:///C:/Users/David/Downloads/New%20folder%20(15)/downloads/lunar-cli.zip>)');
    ` });
    await page.getByRole('link', { name: 'Open ZIP', exact: true }).click();
    await page.getByRole('link', { name: 'Source', exact: true }).click();
    await page.getByRole('link', { name: 'File URI', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => sent), [
      { route: '/api/file/open', method: 'POST', body: { path: 'downloads/lunar-cli.zip' } },
      { route: '/api/file/open', method: 'POST', body: { path: 'downloads/lunar-cli.zip' } },
    ]);
    assert.deepEqual(await page.evaluate(() => previews), ['lunar.mjs']);
    assert.deepEqual(await page.evaluate(() => errors), []);
    await page.evaluate(() => {
      globalThis.downloadInstead = true;
      globalThis.fetch = async (url, options) => {
        globalThis.downloadRequest = { url, headers: options.headers };
        return new Response('PK browser download fixture');
      };
    });
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Open ZIP', exact: true }).click()]);
    assert.equal(download.suggestedFilename(), 'lunar-cli.zip');
    const stream = await download.createReadStream();
    const parts = [];
    for await (const part of stream) parts.push(part);
    assert.equal(Buffer.concat(parts).toString(), 'PK browser download fixture');
    assert.deepEqual(await page.evaluate(() => globalThis.downloadRequest), { url: '/api/file/download?path=downloads%2Flunar-cli.zip', headers: { 'X-Forge-Session': 'test-session' } });
  } finally { await browser.close(); }
});

test('desktop file-open requests call the Windows shell instead of browser automation', async () => {
  const source = await readFile(path.join(root, 'desktop.cjs'), 'utf8');
  const section = source.slice(source.indexOf('function runComputerUseCommand('), source.indexOf('function runBrowserCommand('));
  const opened = [];
  const command = new Function('shell', section + '; return runComputerUseCommand;')({ openPath: async (file) => { opened.push(file); return ''; } });
  assert.deepEqual(await command('open-file', { path: zip }), { opened: true });
  assert.deepEqual(opened, [zip]);
  const failing = new Function('shell', section + '; return runComputerUseCommand;')({ openPath: async () => 'No application is associated with this file.' });
  await assert.rejects(failing('open-file', { path: zip }), /Windows could not open this file/);
});
