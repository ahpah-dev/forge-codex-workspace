import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, mkdir, access } from 'node:fs/promises';

const root = path.dirname(fileURLToPath(import.meta.url));
function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? path.resolve(process.argv[index + 1]) : fallback;
}
const workspace = option('--workspace', process.cwd());
const output = option('--output-dir', path.join(root, 'data', 'browser-artifacts'));
const roots = [path.join(root, 'browser'), path.join(root, 'build', 'browser')];
let executable;
for (const directory of roots) {
  const entries = await readdir(directory).catch(() => []);
  for (const name of entries.filter((name) => /^chromium_headless_shell-\d+$/.test(name))) {
    const candidate = path.join(directory, name, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
    try { await access(candidate); executable = candidate; break; } catch { /* Try the next installed runtime. */ }
  }
  if (executable) break;
}
if (!executable) throw new Error('Forge browser runtime is missing. Reinstall Forge, or run npm run browser:install for a source checkout.');
await mkdir(output, { recursive: true });
process.chdir(workspace);
const cli = path.join(root, 'node_modules', '@playwright', 'mcp', 'cli.js');
process.argv = [process.execPath, cli, '--headless', '--isolated', '--executable-path', executable,
  '--caps', 'vision', '--no-webmcp', '--output-dir', output, '--viewport-size', '1440x900', '--console-level', 'info'];
await import(new URL('./node_modules/@playwright/mcp/cli.js', import.meta.url).href);
