const { spawnSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const root = path.dirname(__dirname);
const folder = path.join(root, 'build', 'browser');
const catalog = JSON.parse(readFileSync(path.join(root, 'node_modules', 'playwright-core', 'browsers.json'), 'utf8'));
const revision = catalog.browsers.find(browser => browser.name === 'chromium-headless-shell').revision;
const executable = path.join(folder, `chromium_headless_shell-${revision}`, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
if (!existsSync(executable)) {
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules', 'playwright', 'cli.js'), 'install', 'chromium', '--only-shell'], {
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: folder }, stdio: 'inherit', windowsHide: true,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status || (existsSync(executable) ? 0 : 1);
} else console.log('Forge browser runtime is ready.');
