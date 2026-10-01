// Opt-in desktop integration check. Uses a temporary Forge profile and a local test page.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const tempRoot = await realpath(tmpdir());
const profile = await mkdtemp(path.join(tempRoot, 'forge-browser-smoke-'));
const fixture = createServer((_req, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end('<!doctype html><title>Browser check</title><style>body{padding:24px;font:16px system-ui}#drag{width:160px;height:70px;background:#cc785c;margin-top:20px} .space{height:2200px}</style><label>Project name <input aria-label="Project name"></label><button id="go">Run action</button><p id="result">Waiting</p><div id="drag">Drag area</div><div class="space"></div><script>window.moves=0;document.querySelector("#go").onclick=e=>{document.querySelector("#result").textContent=e.isTrusted?"Native click received":"Untrusted click"};document.querySelector("#drag").onmousemove=e=>{if(e.buttons)window.moves++}</script>');
});
await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
const fixtureUrl = `http://127.0.0.1:${fixture.address().port}/`;
let desktop;
try {
  const env = { ...process.env, FORGE_USER_DATA_DIR: profile, FORGE_PORT: '4383' };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await electron.launch({ args: [root], env, timeout: 45000 });
  const page = await desktop.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.ForgeDesktop?.computerUse && document.getElementById('browser-toggle')), null, { timeout: 45000 });
  const command = (action, params = {}) => page.evaluate(({ action, params }) => window.ForgeDesktop.browserCommand(action, params), { action, params });
  const readPage = (script) => desktop.evaluate(async ({ webContents }, { fixtureUrl, script }) => {
    const target = webContents.getAllWebContents().find((entry) => entry.getURL() === fixtureUrl);
    if (!target) throw new Error('The embedded browser page is missing.');
    return target.executeJavaScript(script);
  }, { fixtureUrl, script });
  const navigation = await command('navigate', { url: fixtureUrl });
  assert.equal(navigation.title, 'Browser check');
  await command('type', { selector: 'Project name', text: 'Forge project' });
  assert.equal(await readPage('document.querySelector("input").value'), 'Forge project');
  await readPage('window.enterPressed=false;document.querySelector("input").onkeydown=e=>{if(e.key==="Enter")window.enterPressed=true};true');
  await command('press-key', { key: 'Enter' });
  assert.equal(await readPage('window.enterPressed'), true);
  await command('click', { selector: 'Run action' });
  assert.equal(await readPage('document.querySelector("#result").textContent'), 'Native click received');
  const drag = await readPage('JSON.stringify(document.querySelector("#drag").getBoundingClientRect().toJSON())');
  const area = JSON.parse(drag);
  await command('drag', { fromX: Math.round(area.x + 20), fromY: Math.round(area.y + 20), toX: Math.round(area.x + 100), toY: Math.round(area.y + 30) });
  assert.ok(await readPage('window.moves') > 3, 'Native drag should emit intermediate pointer movement');
  await command('scroll', { deltaY: 640 });
  assert.ok(await readPage('window.scrollY') > 100, 'Smooth wheel input should scroll the native page');
  const shot = await command('screenshot');
  const png = Buffer.from(shot.imageBase64, 'base64');
  const bounds = await page.locator('#browser-page-slot').boundingBox();
  assert.ok(Math.abs(png.readUInt32BE(16) - Math.round(bounds.width)) <= 1);
  if (await page.locator('#browser-resize').isVisible()) {
    const original = await page.locator('#browser-workspace').boundingBox();
    const handle = await page.locator('#browser-resize').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 40);
    await page.mouse.down(); await page.mouse.move(handle.x - 50, handle.y + 40, { steps: 6 }); await page.mouse.up();
    const resized = await page.locator('#browser-workspace').boundingBox();
    assert.ok(resized.width > original.width + 20, 'Dragging the panel edge should resize the browser');
  }
  await mkdir(path.join(root, '.schema-temp'), { recursive: true });
  const model = await page.locator('#model-picker').boundingBox();
  const effort = await page.locator('#effort-control').boundingBox();
  assert.ok(model.x + model.width <= effort.x + 1, 'Model and reasoning controls must not overlap in the browser split layout');
  await page.screenshot({ path: path.join(root, '.schema-temp', 'desktop-browser.png') });
  await page.locator('#browser-return').click();
  await command('snapshot');
  assert.equal(await page.locator('#browser-workspace').isVisible(), false, 'Tool calls should respect the user closing the browser panel');
  await page.locator('#browser-toggle').click();
  await page.locator('#browser-expand').click();
  assert.equal(await page.locator('.workspace-surface').isVisible(), false);
  await page.locator('#browser-expand').click();
  await page.locator('#browser-return').click();
  await page.locator('#plugins-toggle').click();
  await page.waitForFunction(() => document.querySelector('[data-plugin-action="setup"]'), null, { timeout: 45000 });
  const vercel = page.locator('[data-plugin-action="setup"][data-plugin-id="vercel@openai-curated-remote"]');
  if (await vercel.count()) {
    await vercel.click();
    await page.waitForFunction(() => document.querySelector('.plugin-connection-row small.is-ready'), null, { timeout: 60000 });
    assert.match(await page.locator('.plugin-setup-panel').innerText(), /Vercel[\s\S]*Connected.*Ready/);
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.plugin-setup-panel')).opacity) > 0.99);
    await page.screenshot({ path: path.join(root, '.schema-temp', 'plugin-setup.png') });
  }
  await page.evaluate(() => {
    const card = renderPluginRequest({ id: 'smoke', method: 'mcpServer/elicitation/request', params: { mode: 'form', serverName: 'demo', message: 'Choose a region', requestedSchema: { type: 'object', properties: { region: { type: 'string', enum: ['eu', 'us'] } }, required: ['region'] } } });
    document.getElementById('approval-slot').append(card);
  });
  assert.equal(await page.locator('#plugin-request-smoke select').count(), 1);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('Desktop browser and plugin checks passed: native click, typing, wheel scrolling, screenshot coordinates, close/expand behavior, Vercel connection status, and plugin form rendering.');
} finally {
  await desktop?.close();
  await new Promise((resolve) => fixture.close(resolve));
  const resolved = await realpath(profile);
  if (!resolved.startsWith(tempRoot + path.sep + 'forge-browser-smoke-')) throw new Error('Refusing to remove an unexpected test profile path.');
  await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
}
