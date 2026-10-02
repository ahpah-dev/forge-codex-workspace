const { app, BrowserWindow, WebContentsView, desktopCapturer, dialog, ipcMain, screen, shell } = require('electron');
const { fork, spawn } = require('node:child_process');
const path = require('node:path');
const { existsSync } = require('node:fs');

const appId = 'com.forge.codexworkspace';
app.setAppUserModelId(appId);
if (process.env.FORGE_USER_DATA_DIR) app.setPath('userData', path.resolve(process.env.FORGE_USER_DATA_DIR));

let serverProcess;
let mainWindow;
let browserView;
let browserNeedsRecovery = false;
const browserPopups = new Map();
let activeBrowserPopup = null;
let forgeResourceRoot;
let computerHost;
let computerHostRequestId = 0;
const computerHostPending = new Map();
const desktopScreenshotSizes = new Map();
let browserAttached = false;
let browserVisible = false;
let browserState = { url: '', title: '', loading: false, canGoBack: false, canGoForward: false, error: '' };
const browserLayoutWaiters = new Set();
let browserCommandQueue = Promise.resolve();
let browserPointer = { x: 20, y: 20 };
let browserActivityTimer;
let desktopCommandQueue = Promise.resolve();
let stopping = false;
let readyTimer;

ipcMain.handle('forge:choose-folder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a project folder',
    buttonLabel: 'Open folder',
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0] || null;
});

ipcMain.handle('forge:connect-anthropic', async () => {
  const configured = process.env.CLAUDE_CLI;
  const localInstall = path.join(app.getPath('home'), '.local', 'bin', 'claude.exe');
  const executable = configured && existsSync(configured) ? configured : existsSync(localInstall) ? localInstall : 'claude';
  if (executable === 'claude') {
    try { await shell.openExternal('https://code.claude.com/docs/en/setup'); } catch {}
    return { ok: false, error: 'Install Claude Code from Anthropic, then reopen Forge to connect your Claude subscription.' };
  }
  return new Promise((resolve) => {
    const child = spawn(executable, ['auth', 'login'], {
      detached: true,
      windowsHide: false,
      stdio: 'ignore',
    });
    child.once('error', async () => {
      try { await shell.openExternal('https://code.claude.com/docs/en/setup'); } catch {}
      resolve({ ok: false, error: 'Claude Code could not start. Install or update it from Anthropic, then try again.' });
    });
    child.once('spawn', () => {
      child.unref();
      resolve({ ok: true });
    });
  });
});

ipcMain.handle('forge:browser-command', async (_event, { action, params } = {}) => runBrowserCommand(action, params || {}));
ipcMain.handle('forge:browser-transition-frame', async (event) => {
  if (event.sender !== mainWindow?.webContents || !browserView || browserView.webContents.isDestroyed() || !browserVisible) return null;
  if (!browserView.webContents.getURL() || browserView.webContents.getURL() === 'about:blank') return null;
  const bounds = browserView.getBounds();
  if (!bounds.width || !bounds.height) return null;
  try {
    const image = await browserView.webContents.capturePage();
    if (image.isEmpty()) return null;
    return { image: image.toDataURL(), width: bounds.width, height: bounds.height };
  } catch { return null; }
});
ipcMain.handle('forge:browser-open-external', async () => {
  const url = browserView?.webContents.getURL() || '';
  if (!isBrowserUrl(url)) throw new Error('There is no web page to open yet.');
  await shell.openExternal(url);
  return { ok: true };
});
ipcMain.on('forge:browser-layout', (event, layout) => {
  if (event.sender !== mainWindow?.webContents || !browserView || !layout || typeof layout !== 'object') return;
  const active = layout.active === true;
  const left = Math.max(0, Math.round(Number(layout.x) || 0));
  const top = Math.max(0, Math.round(Number(layout.y) || 0));
  const width = Math.max(0, Math.round(Number(layout.width) || 0));
  const height = Math.max(0, Math.round(Number(layout.height) || 0));
  if (active && width > 0 && height > 0) {
    if (!browserAttached) {
      mainWindow.contentView.addChildView(browserView);
      browserAttached = true;
    }
    browserView.setBounds({ x: left, y: top, width, height });
    browserView.setVisible(true);
    browserVisible = true;
    for (const resolve of browserLayoutWaiters) resolve();
    browserLayoutWaiters.clear();
  } else {
    browserView.setVisible(false);
    browserVisible = false;
  }
});

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(startForge);
}

async function startForge() {
  const resourceRoot = app.isPackaged ? path.join(process.resourcesPath, 'forge') : __dirname;
  forgeResourceRoot = resourceRoot;
  const dataRoot = path.join(app.getPath('userData'), 'data');
  const codexExecutable = app.isPackaged
    ? path.join(process.resourcesPath, 'codex', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe')
    : path.join(__dirname, 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
  const localClaudeExecutable = path.join(app.getPath('home'), '.local', 'bin', 'claude.exe');
  const claudeExecutable = process.env.CLAUDE_CLI && existsSync(process.env.CLAUDE_CLI)
    ? process.env.CLAUDE_CLI
    : existsSync(localClaudeExecutable) ? localClaudeExecutable : 'claude';

  serverProcess = fork(path.join(resourceRoot, 'server.mjs'), [], {
    cwd: resourceRoot,
    execPath: process.execPath,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      FORGE_DATA_DIR: dataRoot,
      FORGE_NO_BROWSER: '1',
      FORGE_IN_APP_BROWSER: '1',
      FORGE_APP_VERSION: app.getVersion(),
      CODEX_CLI: codexExecutable,
      CLAUDE_CLI: claudeExecutable,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });

  let output = '';
  let started = false;
  readyTimer = setTimeout(() => showStartupError('Forge took too long to start. Close the app and try again.'), 45000);
  serverProcess.stdout.setEncoding('utf8');
  serverProcess.stderr.setEncoding('utf8');
  serverProcess.on('message', (message) => {
    if (message?.type !== 'forge:computer-use' || !message.id) return;
    runComputerUseCommand(message.action, message.params || {}).then(
      (result) => serverProcess?.send({ type: 'forge:computer-use-result', id: message.id, result }),
      (error) => serverProcess?.send({ type: 'forge:computer-use-result', id: message.id, error: error.message || 'The computer-use action failed.' }),
    );
  });
  serverProcess.stdout.on('data', (chunk) => {
    output += chunk;
    const match = output.match(/Forge is ready at (http:\/\/127\.0\.0\.1:\d+)/);
    if (!started && match) {
      started = true;
      clearTimeout(readyTimer);
      createMainWindow(match[1]);
    }
    if (output.length > 6000) output = output.slice(-3000);
  });
  serverProcess.stderr.on('data', (chunk) => { output = `${output}${chunk}`.slice(-6000); });
  serverProcess.on('error', (error) => showStartupError(error.message));
  serverProcess.on('exit', (code) => {
    clearTimeout(readyTimer);
    if (!stopping && code !== 0) showStartupError(`Forge closed unexpectedly (exit code ${code ?? 'unknown'}).\n\n${output.slice(-2000)}`);
    if (stopping) app.quit();
  });
}

function createMainWindow(url) {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'forge', 'icon.ico')
    : path.join(__dirname, 'build', 'icon.ico');
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 640,
    show: false,
    backgroundColor: '#fafaf8',
    title: 'Forge',
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'desktop-preload.cjs'),
    },
  });
  if (process.platform === 'win32' && app.isPackaged) {
    mainWindow.setAppDetails({
      appId,
      appIconPath: iconPath,
      appIconIndex: 0,
      relaunchCommand: `"${process.execPath}"`,
      relaunchDisplayName: 'Forge',
    });
  }
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https:\/\//i.test(target)) void shell.openExternal(target);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(url)) {
      event.preventDefault();
      if (/^https:\/\//i.test(target)) void shell.openExternal(target);
    }
  });
  mainWindow.loadURL(url);
  mainWindow.on('closed', () => {
    mainWindow = null;
    browserView?.webContents.close();
    browserView = null;
    browserAttached = false;
    browserVisible = false;
    for (const popup of browserPopups.values()) if (!popup.isDestroyed()) popup.destroy();
    browserPopups.clear(); activeBrowserPopup = null;
    if (!stopping) stopForge();
  });
}

function createBrowserView() {
  browserNeedsRecovery = false;
  browserView = new WebContentsView({
    webPreferences: {
      partition: 'persist:forge-in-app-browser',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: false,
    },
  });
  browserView.setVisible(false);
  browserView.setBackgroundColor('#fafaf8');
  browserView.setBorderRadius(7);
  configureBrowserPopups(browserView.webContents);
  browserView.webContents.on('will-navigate', (event, url) => {
    if (!isBrowserUrl(url)) event.preventDefault();
  });
  const update = (patch = {}) => {
    browserState = { ...browserState, ...patch, url: browserView?.webContents.getURL() || browserState.url, title: browserView?.webContents.getTitle() || browserState.title, loading: browserView?.webContents.isLoading() || false, canGoBack: browserView?.webContents.navigationHistory.canGoBack() || false, canGoForward: browserView?.webContents.navigationHistory.canGoForward() || false };
    mainWindow?.webContents.send('forge:browser-state', browserState);
  };
  for (const event of ['did-start-loading']) browserView.webContents.on(event, () => update({ loading: true, error: '' }));
  for (const event of ['did-navigate', 'did-navigate-in-page', 'did-finish-load', 'page-title-updated', 'did-stop-loading']) browserView.webContents.on(event, () => update({ loading: false }));
  browserView.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) update({ loading: false, error: description || 'The page could not be loaded.' });
  });
  browserView.webContents.on('render-process-gone', () => { browserNeedsRecovery = true; update({ loading: false, error: 'The browser page stopped. Open or reload it to recover.' }); });
}

function configureBrowserPopups(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (url !== 'about:blank' && !isBrowserUrl(url)) return { action: 'deny' };
    return { action: 'allow', overrideBrowserWindowOptions: {
      width: 1000, height: 760, parent: mainWindow, autoHideMenuBar: true,
      webPreferences: { partition: 'persist:forge-in-app-browser', contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
    } };
  });
  contents.on('did-create-window', (popup) => {
    const id = String(popup.webContents.id);
    browserPopups.set(id, popup);
    activeBrowserPopup = id;
    configureBrowserPopups(popup.webContents);
    popup.webContents.on('will-navigate', (event, url) => { if (!isBrowserUrl(url)) event.preventDefault(); });
    popup.webContents.on('will-redirect', (event, url) => { if (!isBrowserUrl(url)) event.preventDefault(); });
    popup.on('focus', () => { activeBrowserPopup = id; });
    popup.on('closed', () => {
      browserPopups.delete(id);
      if (activeBrowserPopup === id) activeBrowserPopup = null;
    });
  });
}

function browserWebContents() {
  const popup = browserPopups.get(activeBrowserPopup);
  if (popup && !popup.isDestroyed() && !popup.webContents.isDestroyed()) return popup.webContents;
  activeBrowserPopup = null;
  return browserView.webContents;
}

function browserViewportBounds() {
  const popup = browserPopups.get(activeBrowserPopup);
  return popup && !popup.isDestroyed() ? popup.getContentBounds() : browserView.getBounds();
}

function isBrowserUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password;
  } catch { return false; }
}

function normalizeBrowserUrl(value) {
  const input = String(value || '').trim();
  if (!input || input.length > 2048 || /[\u0000-\u001f]/.test(input)) throw new Error('Enter a web address or search phrase.');
  let candidate = input;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    if (/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(candidate)) candidate = `http://${candidate}`;
    else if (/^[^\s.]+\.[^\s]+(?:\/|$)/.test(candidate)) candidate = `https://${candidate}`;
    else candidate = `https://duckduckgo.com/?q=${encodeURIComponent(candidate)}`;
  }
  if (!isBrowserUrl(candidate)) throw new Error('The in-app browser only opens HTTP and HTTPS pages.');
  return new URL(candidate).toString();
}

function browserSnapshot() {
  const contents = browserWebContents();
  return {
    url: contents.getURL(), title: contents.getTitle(), loading: contents.isLoading(),
    canGoBack: contents.navigationHistory.canGoBack(), canGoForward: contents.navigationHistory.canGoForward(),
    pageId: String(contents.id), error: activeBrowserPopup ? '' : browserState.error || '',
  };
}

async function showBrowserPane() {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Forge is closing. Reopen the in-app browser after it starts.');
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  if (browserVisible) return;
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { browserLayoutWaiters.delete(onReady); reject(new Error('The in-app browser could not open.')); }, 6000);
    const onReady = () => { clearTimeout(timeout); resolve(); };
    browserLayoutWaiters.add(onReady);
  });
  mainWindow.webContents.send('forge:browser-open');
  await ready;
}

const browserPause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function settleBrowserPage() {
  await browserPause(100);
  const contents = browserWebContents();
  if (contents.isLoading()) {
    let finish;
    let timeout;
    await new Promise((resolve) => {
      finish = resolve;
      contents.once('did-stop-loading', finish);
      timeout = setTimeout(resolve, 2500);
    });
    clearTimeout(timeout);
    contents.removeListener('did-stop-loading', finish);
  }
  await browserPause(60);
}

async function navigateBrowserPage(contents, url) {
  let onReady, onFail, timeout;
  const ready = new Promise((resolve, reject) => {
    onReady = resolve;
    onFail = (_event, code, description, _url, mainFrame) => {
      if (mainFrame && code !== -3) reject(new Error(`Could not open ${url}: ${description}`));
    };
    contents.once('dom-ready', onReady);
    contents.on('did-fail-load', onFail);
    timeout = setTimeout(() => reject(new Error(`The browser did not reach a usable page at ${url} within 30 seconds. Check the connection or try another URL.`)), 30000);
  });
  try {
    // DOM readiness keeps pages with long-lived requests usable without returning
    // an empty previous document just because a timer expired.
    await Promise.race([contents.loadURL(url), ready]);
    await settleBrowserPage();
    if (browserState.error && contents === browserView.webContents) throw new Error(browserState.error);
    browserNeedsRecovery = false;
  } catch (error) {
    contents.stop();
    throw error;
  } finally {
    clearTimeout(timeout);
    contents.removeListener('dom-ready', onReady);
    contents.removeListener('did-fail-load', onFail);
  }
}

async function markBrowserPointer(x, y, pressed = false) {
  browserPointer = { x, y };
  await browserWebContents().executeJavaScript(`(() => {
    let pointer = document.getElementById('__forge_agent_pointer');
    if (!pointer) {
      pointer = document.createElement('div'); pointer.id = '__forge_agent_pointer'; pointer.setAttribute('aria-hidden', 'true');
      pointer.style.cssText = 'position:fixed;z-index:2147483647;width:20px;height:20px;border:2px solid #cc785c;border-radius:50%;pointer-events:none;box-shadow:0 0 0 5px #cc785c22;transform:translate(-50%,-50%);transition:left .16s ease-out,top .16s ease-out,opacity .3s ease,scale .16s ease;';
      document.documentElement.append(pointer);
    }
    pointer.style.left = ${x} + 'px'; pointer.style.top = ${y} + 'px'; pointer.style.opacity = '1'; pointer.style.scale = ${pressed ? 0.8 : 1} + '';
    clearTimeout(window.__forgePointerFade); window.__forgePointerFade = setTimeout(() => { pointer.style.opacity = '0'; }, 900);
  })()`).catch(() => {});
}

function rejectComputerHostRequests(error) {
  for (const [id, pending] of computerHostPending) {
    computerHostPending.delete(id);
    clearTimeout(pending.timeout);
    pending.reject(error);
  }
}

function startComputerHost() {
  if (computerHost && computerHost.exitCode === null) return computerHost;
  if (process.platform !== 'win32') throw new Error('Native desktop controls are currently available in the Windows Forge app.');
  const script = path.join(forgeResourceRoot || __dirname, 'computer-use-host.ps1');
  const windowsPowerShell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0');
  const host = spawn(process.env.FORGE_POWERSHELL_EXE || path.join(windowsPowerShell, 'powershell.exe'), [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
  ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env,
    PSModulePath: [path.join(windowsPowerShell, 'Modules'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'WindowsPowerShell', 'Modules')].join(path.delimiter),
  } });
  computerHost = host;
  let hostBuffer = '';
  host.stdout.setEncoding('utf8');
  host.stdout.on('data', (chunk) => {
    if (computerHost !== host) return;
    hostBuffer += chunk;
    if (hostBuffer.length > 2 * 1024 * 1024) {
      host.kill();
      rejectComputerHostRequests(new Error('The native desktop helper returned too much data.'));
      return;
    }
    let newline;
    while ((newline = hostBuffer.indexOf('\n')) >= 0) {
      const line = hostBuffer.slice(0, newline).trim();
      hostBuffer = hostBuffer.slice(newline + 1);
      if (!line) continue;
      let response;
      try { response = JSON.parse(line); } catch { continue; }
      const pending = computerHostPending.get(String(response.id));
      if (!pending) continue;
      computerHostPending.delete(String(response.id));
      clearTimeout(pending.timeout);
      if (response.error) pending.reject(new Error(String(response.error)));
      else pending.resolve(response.result || {});
    }
  });
  let stderrTail = '';
  host.stderr.on('data', (chunk) => { stderrTail = (stderrTail + chunk.toString()).slice(-1500); });
  host.on('error', (error) => {
    if (computerHost !== host) return;
    computerHost = null;
    rejectComputerHostRequests(new Error(`Could not start the Windows desktop controller: ${error.message}`));
  });
  host.on('exit', (code) => {
    if (computerHost !== host) return;
    computerHost = null;
    if (computerHostPending.size) rejectComputerHostRequests(new Error(`The Windows desktop controller stopped${code === null ? '' : ` (exit ${code})`}.${stderrTail ? ` ${stderrTail.trim()}` : ''}`));
  });
  host.stdin.on('error', (error) => {
    if (computerHost !== host) return;
    computerHost = null;
    rejectComputerHostRequests(new Error(`The Windows desktop controller disconnected: ${error.message}`));
    host.kill();
  });
  return host;
}

function sendComputerHost(action, params = {}) {
  const host = startComputerHost();
  const id = String(++computerHostRequestId);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (computerHost === host) computerHost = null;
      rejectComputerHostRequests(new Error('The Windows desktop controller timed out and was reset. Inspect the desktop again before continuing; do not repeat input blindly.'));
      host.kill();
    }, 20000);
    computerHostPending.set(id, { resolve, reject, timeout });
    try { host.stdin.write(`${JSON.stringify({ id, action, ...params })}\n`); }
    catch (error) {
      computerHostPending.delete(id);
      clearTimeout(timeout);
      reject(error);
    }
  });
}

function getDesktopDisplay(displayId) {
  const displays = screen.getAllDisplays();
  const display = displayId === undefined || displayId === null || displayId === ''
    ? screen.getPrimaryDisplay()
    : displays.find((candidate, index) => String(candidate.id) === String(displayId) || String(index) === String(displayId));
  if (!display) throw new Error('That display is no longer connected. Take a fresh computer screenshot and try again.');
  return display;
}

async function captureDesktopDisplay(displayId) {
  const display = getDesktopDisplay(displayId);
  const scale = Number(display.scaleFactor) || 1;
  const thumbnailSize = {
    width: Math.max(1, Math.min(1920, Math.round(display.bounds.width * scale))),
    height: Math.max(1, Math.min(1200, Math.round(display.bounds.height * scale))),
  };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
  const source = sources.find((item) => item.display_id === String(display.id));
  if (!source || source.thumbnail.isEmpty()) throw new Error('Forge could not capture that display. Check Windows screen-capture permissions and try again.');
  const size = source.thumbnail.getSize();
  desktopScreenshotSizes.set(String(display.id), { width: size.width, height: size.height });
  return {
    display,
    imageBase64: source.thumbnail.toPNG().toString('base64'),
    imageWidth: size.width,
    imageHeight: size.height,
  };
}

async function desktopPoint(xValue, yValue, displayId) {
  const display = getDesktopDisplay(displayId);
  const key = String(display.id);
  let size = desktopScreenshotSizes.get(key);
  if (!size) {
    const capture = await captureDesktopDisplay(key);
    size = { width: capture.imageWidth, height: capture.imageHeight };
  }
  const x = Number(xValue), y = Number(yValue);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= size.width || y >= size.height) {
    throw new Error(`Use coordinates inside the latest computer screenshot (0–${size.width - 1}, 0–${size.height - 1}).`);
  }
  const nativePoint = screen.dipToScreenPoint({
    x: Math.round(display.bounds.x + x * display.bounds.width / size.width),
    y: Math.round(display.bounds.y + y * display.bounds.height / size.height),
  });
  return {
    display,
    x: nativePoint.x, y: nativePoint.y,
  };
}

const desktopVirtualKeys = {
  BACKSPACE: 0x08, TAB: 0x09, ENTER: 0x0d, SHIFT: 0x10, CTRL: 0x11, CONTROL: 0x11, ALT: 0x12,
  PAUSE: 0x13, CAPSLOCK: 0x14, ESC: 0x1b, ESCAPE: 0x1b, SPACE: 0x20, PAGEUP: 0x21, PAGEDOWN: 0x22,
  END: 0x23, HOME: 0x24, LEFT: 0x25, ARROWLEFT: 0x25, UP: 0x26, ARROWUP: 0x26,
  RIGHT: 0x27, ARROWRIGHT: 0x27, DOWN: 0x28, ARROWDOWN: 0x28, PRINTSCREEN: 0x2c,
  INSERT: 0x2d, DELETE: 0x2e, WIN: 0x5b, META: 0x5b, CMD: 0x5b,
  NUMPAD0: 0x60, NUMPAD1: 0x61, NUMPAD2: 0x62, NUMPAD3: 0x63, NUMPAD4: 0x64,
  NUMPAD5: 0x65, NUMPAD6: 0x66, NUMPAD7: 0x67, NUMPAD8: 0x68, NUMPAD9: 0x69,
  MULTIPLY: 0x6a, ADD: 0x6b, SUBTRACT: 0x6d, DECIMAL: 0x6e, DIVIDE: 0x6f,
  NUMLOCK: 0x90, SCROLLLOCK: 0x91, OEM_PLUS: 0xbb, OEM_COMMA: 0xbc, OEM_MINUS: 0xbd,
  OEM_PERIOD: 0xbe, OEM_SLASH: 0xbf, OEM_TILDE: 0xc0, OEM_LBRACKET: 0xdb, OEM_BACKSLASH: 0xdc,
  OEM_RBRACKET: 0xdd, OEM_QUOTE: 0xde,
};

function parseDesktopKeyChord(value) {
  const names = String(value || '').toUpperCase().split('+').map((part) => part.trim()).filter(Boolean);
  if (!names.length || names.length > 6) throw new Error('Enter a key or shortcut such as Enter, Ctrl+S, or Alt+Tab.');
  return names.map((name) => {
    if (desktopVirtualKeys[name]) return desktopVirtualKeys[name];
    if (/^[A-Z0-9]$/.test(name)) return name.charCodeAt(0);
    const functionKey = name.match(/^F([1-9]|1[0-9]|2[0-4])$/);
    if (functionKey) return 0x70 + Number(functionKey[1]) - 1;
    throw new Error(`Unsupported desktop key: ${name}.`);
  });
}

async function executeDesktopComputerAction(action, params = {}) {
  if (action === 'computer-open') {
    const target = String(params.target || '').trim();
    if (isBrowserUrl(target)) await shell.openExternal(target);
    else {
      if (!path.isAbsolute(target)) throw new Error('Use an absolute app/file/folder path, or an HTTP/HTTPS URL.');
      const error = await shell.openPath(target);
      if (error) throw new Error(`Windows could not open ${target}: ${error}`);
    }
    return { message: `Windows accepted the open request for ${target}. Inspect computer_use_state and a fresh screenshot to verify the window opened.` };
  }
  if (action === 'computer-focus') {
    const target = String(params.target || '').trim();
    if (!target || target.length > 512) throw new Error('Choose a window handle or title from computer_use_state.');
    const result = await sendComputerHost('focus', { target });
    return { ...result, message: `Focused ${result.foregroundWindow}. Take a fresh screenshot before interacting.` };
  }
  if (action === 'computer-state') {
    const state = await sendComputerHost('state');
    const displays = screen.getAllDisplays().map((display, index) => ({
      displayId: String(display.id), index, primary: display.id === screen.getPrimaryDisplay().id,
      width: Math.round(display.bounds.width * (Number(display.scaleFactor) || 1)),
      height: Math.round(display.bounds.height * (Number(display.scaleFactor) || 1)),
      scaleFactor: Number(display.scaleFactor) || 1,
    }));
    return { ...state, displays, message: `Foreground window: ${state.foregroundWindow || '(untitled)'}. Cursor: ${state.cursor.x}, ${state.cursor.y}. Displays: ${displays.map((display) => `${display.displayId}${display.primary ? ' (primary)' : ''} ${display.width}×${display.height}`).join('; ')}.\nOpen windows:\n${(state.windows || []).map((window) => `${window.handle}: ${window.title}${window.minimized ? ' (minimized)' : ''}`).join('\n')}` };
  }
  if (action === 'computer-screenshot') {
    const capture = await captureDesktopDisplay(params.displayId);
    return {
      imageBase64: capture.imageBase64,
      mimeType: 'image/png',
      displayId: String(capture.display.id),
      imageWidth: capture.imageWidth,
      imageHeight: capture.imageHeight,
      message: `Display ${capture.display.id} screenshot, ${capture.imageWidth}×${capture.imageHeight}. Use these image-pixel coordinates for the next computer_use_click, computer_use_move, computer_use_drag, and computer_use_scroll call, and pass displayId ${capture.display.id}.`,
    };
  }
  if (action === 'computer-click' || action === 'computer-move') {
    const point = await desktopPoint(params.x, params.y, params.displayId);
    if (action === 'computer-move') {
      await sendComputerHost('move', { x: point.x, y: point.y });
      return { message: `Moved the pointer to screenshot coordinate ${params.x}, ${params.y} on display ${point.display.id}.` };
    }
    const button = ['left', 'right', 'middle'].includes(String(params.button || 'left').toLowerCase()) ? String(params.button || 'left').toLowerCase() : 'left';
    const count = Number(params.count) === 2 ? 2 : 1;
    await sendComputerHost('click', { x: point.x, y: point.y, button, count });
    return { message: `${count === 2 ? 'Double-clicked' : 'Clicked'} with ${button} button at screenshot coordinate ${params.x}, ${params.y} on display ${point.display.id}.` };
  }
  if (action === 'computer-drag') {
    const start = await desktopPoint(params.fromX, params.fromY, params.displayId);
    const end = await desktopPoint(params.toX, params.toY, params.displayId);
    const button = ['left', 'right', 'middle'].includes(String(params.button || 'left').toLowerCase()) ? String(params.button || 'left').toLowerCase() : 'left';
    await sendComputerHost('drag', { fromX: start.x, fromY: start.y, toX: end.x, toY: end.y, button });
    return { message: `Dragged from ${params.fromX}, ${params.fromY} to ${params.toX}, ${params.toY} on display ${start.display.id}.` };
  }
  if (action === 'computer-scroll') {
    const hasPoint = params.x !== undefined || params.y !== undefined;
    let point = { x: -1, y: -1 };
    if (hasPoint) {
      if (params.x === undefined || params.y === undefined) throw new Error('Provide both x and y from the current screenshot when choosing where to scroll.');
      point = await desktopPoint(params.x, params.y, params.displayId);
    }
    const horizontal = Math.max(-12, Math.min(12, Math.round(Number(params.horizontal) || 0)));
    const vertical = Math.max(-12, Math.min(12, Math.round(Number(params.vertical) || 0)));
    await sendComputerHost('scroll', { x: point.x, y: point.y, horizontal, vertical });
    return { message: `Scrolled ${vertical > 0 ? 'down' : vertical < 0 ? 'up' : 'horizontally'} ${Math.abs(vertical || horizontal)} wheel steps on the desktop.` };
  }
  if (action === 'computer-type') {
    const text = String(params.text || '');
    if (!text || text.length > 10000) throw new Error('Type between 1 and 10,000 characters at a time.');
    await sendComputerHost('type', { text });
    return { message: `Typed ${text.length} characters into the focused desktop control.` };
  }
  if (action === 'computer-press-key') {
    const keys = parseDesktopKeyChord(params.key);
    await sendComputerHost('press-keys', { keys });
    return { message: `Pressed ${String(params.key).toUpperCase()} on the desktop.` };
  }
  throw new Error('That computer-use action is not supported by Forge.');
}

function runComputerUseCommand(action, params = {}) {
  if (action === 'open-file') {
    return shell.openPath(String(params.path || '')).then((error) => {
      if (error) throw new Error(`Windows could not open this file: ${error}`);
      return { opened: true };
    });
  }
  if (!action.startsWith('computer-')) return runBrowserCommand(action, params);
  const next = desktopCommandQueue.then(() => executeDesktopComputerAction(action, params));
  desktopCommandQueue = next.catch(() => {});
  return next;
}

function runBrowserCommand(action, params = {}) {
  if (action === 'stop' && browserView) {
    browserWebContents().stop();
    return Promise.resolve(browserSnapshot());
  }
  const next = browserCommandQueue.then(async () => {
    const labels = { open: 'Opening browser', tabs: 'Selecting browser page', navigate: 'Opening website', snapshot: 'Reading page', screenshot: 'Capturing page', click: 'Clicking page element', type: 'Typing in page', 'press-key': 'Pressing a key', 'click-at': 'Clicking page', move: 'Moving pointer', drag: 'Dragging', scroll: 'Scrolling page', back: 'Going back', forward: 'Going forward', reload: 'Reloading page', stop: 'Stopping navigation' };
    clearTimeout(browserActivityTimer);
    if (labels[action]) {
      browserState = { ...browserState, activity: labels[action], actionActive: true };
      mainWindow?.webContents.send('forge:browser-state', browserState);
    }
    try { return await executeBrowserCommand(action, params); }
    catch (error) {
      browserState = { ...browserState, error: error.message || 'The browser action failed.' };
      throw error;
    }
    finally {
      browserState = { ...browserState, actionActive: false };
      mainWindow?.webContents.send('forge:browser-state', browserState);
      browserActivityTimer = setTimeout(() => {
        browserState = { ...browserState, activity: '' };
        mainWindow?.webContents.send('forge:browser-state', browserState);
      }, 1800);
    }
  });
  browserCommandQueue = next.catch(() => {});
  return next;
}

async function executeBrowserCommand(action, params = {}) {
  if (!browserView || browserView.webContents.isDestroyed()) {
    if (browserView && browserAttached) mainWindow?.contentView.removeChildView(browserView);
    browserAttached = false; browserVisible = false;
    createBrowserView();
  }
  if (action === 'tabs') {
    const id = String(params.pageId || '');
    if (params.operation === 'close') {
      const popup = browserPopups.get(id);
      if (!popup) throw new Error('Only popup pages can be closed. Use a popup pageId from browser_tabs.');
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { popup.removeListener('closed', closed); reject(new Error('The popup did not close. Inspect it for an unsaved-changes prompt.')); }, 3000);
        const closed = () => { clearTimeout(timeout); resolve(); };
        popup.once('closed', closed);
        popup.close();
      });
    } else if (params.operation === 'select') {
      if (id === String(browserView.webContents.id)) { activeBrowserPopup = null; await showBrowserPane(); mainWindow.focus(); }
      else {
        const popup = browserPopups.get(id);
        if (!popup || popup.isDestroyed()) throw new Error('That browser page is no longer open. List pages again.');
        activeBrowserPopup = id;
        if (popup.isMinimized()) popup.restore();
        popup.show(); popup.focus();
      }
    } else if (params.operation && params.operation !== 'list') throw new Error('Choose list, select, or close.');
    const pages = [browserView.webContents, ...[...browserPopups.values()].filter((popup) => !popup.isDestroyed()).map((popup) => popup.webContents)];
    return { ...browserSnapshot(), message: pages.map((page) => `${page.id}${page === browserWebContents() ? ' (active)' : ''}: ${page.getTitle() || '(untitled)'} ${page.getURL() || 'about:blank'}`).join('\n') };
  }
  if (action === 'open') {
    activeBrowserPopup = null;
    await showBrowserPane();
    if (params.url) return executeBrowserCommand('navigate', params);
    if (!browserView.webContents.getURL()) throw new Error('Provide a URL or search phrase to open a browser page.');
    if (browserNeedsRecovery) {
      browserState.error = '';
      await navigateBrowserPage(browserView.webContents, browserView.webContents.getURL());
    }
    return browserSnapshot();
  }
  const webContents = browserWebContents();
  // Reveal once; returning to chat does not get undone by every tool call.
  if (!browserAttached) await showBrowserPane();
  if (action === 'state') return browserSnapshot();
  if (action === 'navigate') {
    const url = normalizeBrowserUrl(params.url);
    browserState.error = '';
    await navigateBrowserPage(webContents, url);
    return browserSnapshot();
  }
  if (browserNeedsRecovery && !activeBrowserPopup) {
    const url = webContents.getURL();
    if (!isBrowserUrl(url)) throw new Error('The browser page stopped. Use browser_open with a URL to recover.');
    browserState.error = '';
    await navigateBrowserPage(webContents, url);
  }
  if (action === 'back' || action === 'forward') {
    const canNavigate = action === 'back' ? webContents.navigationHistory.canGoBack() : webContents.navigationHistory.canGoForward();
    if (!canNavigate) return browserSnapshot();
    await (action === 'back' ? webContents.navigationHistory.goBack() : webContents.navigationHistory.goForward());
    await settleBrowserPage();
    return browserSnapshot();
  }
  if (action === 'reload') {
    const url = webContents.getURL();
    if (!isBrowserUrl(url)) throw new Error('Open a URL before reloading the browser.');
    browserState.error = '';
    await navigateBrowserPage(webContents, url);
    return browserSnapshot();
  }
  if (action === 'stop') { webContents.stop(); return browserSnapshot(); }
  await settleBrowserPage();
  if (!webContents.getURL() || webContents.getURL() === 'about:blank') throw new Error('No browser page is open. Use browser_open or browser_navigate with a URL first.');
  if (action === 'snapshot') {
    const page = await webContents.executeJavaScript(`(() => {
      const visible = (element) => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };
      const controls = [...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"]')].filter(visible).slice(0, 180).map((element, index) => {
        const label = element.getAttribute('aria-label') || element.getAttribute('title') || element.innerText || element.value || element.getAttribute('placeholder') || '';
        const rect = element.getBoundingClientRect();
        return '[' + index + '] ' + element.tagName.toLowerCase() + (element.type ? '[type=' + element.type + ']' : '') + ' ' + JSON.stringify(String(label).trim().replace(/\\s+/g, ' ').slice(0, 150)) + ' at ' + Math.round(rect.x) + ',' + Math.round(rect.y) + ' ' + Math.round(rect.width) + 'x' + Math.round(rect.height) + (element.href ? ' → ' + element.href : '');
      });
      return { title: document.title, url: location.href, text: (document.body?.innerText || '').slice(0, 24000), controls };
    })()`);
    return { ...browserSnapshot(), text: page.text || '', controls: page.controls || [] };
  }
  if (action === 'screenshot') {
    await webContents.executeJavaScript("document.getElementById('__forge_agent_pointer')?.remove()").catch(() => {});
    const image = await webContents.capturePage();
    const { width, height } = browserViewportBounds();
    const alignedImage = image.resize({ width: Math.max(1, width), height: Math.max(1, height) });
    return { ...browserSnapshot(), imageBase64: alignedImage.toPNG().toString('base64'), mimeType: 'image/png' };
  }
  if (action === 'click') {
    const selector = String(params.selector || params.text || '').trim().slice(0, 500);
    if (!selector) throw new Error('Give the browser element a label or CSS selector.');
    const query = JSON.stringify(selector.replace(/^text=/i, ''));
    const result = await webContents.executeJavaScript(`(() => {
      const query = ${query};
      const norm = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const visible = (element) => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };
      let element = null;
      try { element = document.querySelector(query); } catch {}
      if (!element) { const options = [...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[role="link"],[role="checkbox"],[role="menuitem"]')].filter(visible); const exact = options.find((item) => [item.getAttribute('aria-label'), item.getAttribute('title'), item.innerText, item.value, item.getAttribute('placeholder')].some((value) => norm(value) === norm(query))); element = exact || options.find((item) => [item.getAttribute('aria-label'), item.getAttribute('title'), item.innerText, item.value, item.getAttribute('placeholder')].some((value) => norm(value).includes(norm(query)))); }
      if (!element) return { ok: false, error: 'No visible page element matched: ' + query };
      element.scrollIntoView({ block: 'center', inline: 'center' });
      element.focus({ preventScroll: true });
      const label = element.getAttribute('aria-label') || element.innerText || element.value || element.tagName.toLowerCase();
      const rect = element.getBoundingClientRect();
      const x = Math.max(0, Math.min(innerWidth - 1, rect.x + rect.width / 2));
      const y = Math.max(0, Math.min(innerHeight - 1, rect.y + rect.height / 2));
      const hit = document.elementFromPoint(x, y);
      if (!hit || (!element.contains(hit) && !hit.contains(element))) return { ok: false, error: 'The element is covered by another page element. Close the overlay first.' };
      return { ok: true, x, y, label: String(label).trim().slice(0, 160) };
    })()`);
    if (!result.ok) throw new Error(result.error);
    const x = Math.round(result.x), y = Math.round(result.y);
    await markBrowserPointer(x, y, true);
    webContents.sendInputEvent({ type: 'mouseMove', x, y });
    webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    await settleBrowserPage();
    return { ...browserSnapshot(), message: `Clicked ${result.label}.` };
  }
  if (action === 'type') {
    const text = String(params.text || '').slice(0, 20000);
    if (!text) throw new Error('Provide text to type.');
    const selector = String(params.selector || '').trim().slice(0, 500);
    if (selector) {
      const query = JSON.stringify(selector.replace(/^text=/i, ''));
      const focused = await webContents.executeJavaScript(`(() => { let element = null; try { element = document.querySelector(${query}); } catch {} if (!element) { const query = ${query}.toLowerCase(); element = [...document.querySelectorAll('input,textarea,[contenteditable="true"],[role="textbox"]')].find((item) => [item.getAttribute('aria-label'), item.getAttribute('placeholder'), item.getAttribute('name'), item.getAttribute('title')].some((value) => String(value || '').toLowerCase().includes(query))); } if (!element) return false; element.scrollIntoView({ block: 'center' }); element.focus(); if (typeof element.select === 'function') element.select(); return true; })()`);
      if (!focused) throw new Error(`No editable field matched: ${selector}`);
    }
    const editable = await webContents.executeJavaScript(`(() => { const element = document.activeElement; return !!element && (['INPUT','TEXTAREA'].includes(element.tagName) || element.isContentEditable || element.getAttribute('role') === 'textbox'); })()`);
    if (!editable) throw new Error('Click or select an editable field before typing.');
    await webContents.insertText(text);
    await browserPause(80);
    return { ...browserSnapshot(), message: `Typed ${text.length} characters.` };
  }
  if (action === 'press-key') {
    const allowedKeys = new Set(['ENTER', 'TAB', 'ESCAPE', 'BACKSPACE', 'DELETE', 'ARROWUP', 'ARROWDOWN', 'ARROWLEFT', 'ARROWRIGHT', 'HOME', 'END', 'PAGEUP', 'PAGEDOWN', 'SPACE', 'F5']);
    const key = String(params.key || '').trim().toUpperCase();
    if (!allowedKeys.has(key) && !/^(CTRL|CONTROL|ALT|SHIFT|META)(\+(CTRL|CONTROL|ALT|SHIFT|META))*\+[A-Z0-9]$/.test(key)) throw new Error('Use Enter, Tab, Escape, arrows, Backspace, Delete, Space, F5, or a modifier shortcut such as Ctrl+A.');
    const parts = key.split('+');
    const keyCode = parts.at(-1);
    const modifiers = parts.slice(0, -1).map((item) => item === 'CTRL' || item === 'CONTROL' ? 'control' : item.toLowerCase());
    const keyMap = { ENTER: 'ENTER', TAB: 'TAB', ESCAPE: 'ESC', BACKSPACE: 'BACKSPACE', DELETE: 'DELETE', ARROWUP: 'UP', ARROWDOWN: 'DOWN', ARROWLEFT: 'LEFT', ARROWRIGHT: 'RIGHT', HOME: 'HOME', END: 'END', PAGEUP: 'PAGEUP', PAGEDOWN: 'PAGEDOWN', SPACE: ' ', F5: 'F5' };
    const code = keyMap[keyCode] || keyCode;
    webContents.sendInputEvent({ type: 'keyDown', keyCode: code, modifiers });
    if (!modifiers.length && ['ENTER', 'SPACE'].includes(key)) webContents.sendInputEvent({ type: 'char', keyCode: code });
    webContents.sendInputEvent({ type: 'keyUp', keyCode: code, modifiers });
    await settleBrowserPage();
    return { ...browserSnapshot(), message: `Pressed ${key}.` };
  }
  if (action === 'click-at') {
    const x = Math.round(Number(params.x)); const y = Math.round(Number(params.y));
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > browserViewportBounds().width || y > browserViewportBounds().height) throw new Error('Click coordinates must be inside the browser page.');
    await markBrowserPointer(x, y, true);
    webContents.sendInputEvent({ type: 'mouseMove', x, y });
    webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: params.doubleClick ? 2 : 1 });
    webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: params.doubleClick ? 2 : 1 });
    await settleBrowserPage();
    return { ...browserSnapshot(), message: `Clicked at ${x}, ${y}.` };
  }
  if (action === 'move') {
    const x = Math.round(Number(params.x)); const y = Math.round(Number(params.y));
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > browserViewportBounds().width || y > browserViewportBounds().height) throw new Error('Pointer coordinates must be inside the browser page.');
    const start = { ...browserPointer };
    await markBrowserPointer(x, y);
    for (let step = 1; step <= 8; step++) {
      const t = 1 - Math.pow(1 - step / 8, 3);
      webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(start.x + (x - start.x) * t), y: Math.round(start.y + (y - start.y) * t) });
      await browserPause(16);
    }
    return { ...browserSnapshot(), message: `Moved to ${x}, ${y}.` };
  }
  if (action === 'drag') {
    const points = [params.fromX, params.fromY, params.toX, params.toY].map((value) => Math.round(Number(value)));
    if (points.some((value) => !Number.isFinite(value) || value < 0) || points[0] > browserViewportBounds().width || points[2] > browserViewportBounds().width || points[1] > browserViewportBounds().height || points[3] > browserViewportBounds().height) throw new Error('Drag coordinates must stay inside the browser page.');
    const [fromX, fromY, toX, toY] = points;
    await markBrowserPointer(fromX, fromY, true);
    webContents.sendInputEvent({ type: 'mouseMove', x: fromX, y: fromY });
    webContents.sendInputEvent({ type: 'mouseDown', x: fromX, y: fromY, button: 'left', clickCount: 1 });
    for (let step = 1; step <= 12; step++) {
      const t = step / 12;
      webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(fromX + (toX - fromX) * t), y: Math.round(fromY + (toY - fromY) * t), modifiers: ['leftButtonDown'] });
      await browserPause(16);
    }
    webContents.sendInputEvent({ type: 'mouseUp', x: toX, y: toY, button: 'left', clickCount: 1 });
    await markBrowserPointer(toX, toY);
    await settleBrowserPage();
    return { ...browserSnapshot(), message: `Dragged from ${fromX}, ${fromY} to ${toX}, ${toY}.` };
  }
  if (action === 'scroll') {
    const deltaY = Math.max(-3000, Math.min(3000, Math.round(Number(params.deltaY) || 0)));
    const deltaX = Math.max(-1500, Math.min(1500, Math.round(Number(params.deltaX) || 0)));
    const x = Math.max(0, Math.min(browserViewportBounds().width - 1, Math.round(Number(params.x) || 20)));
    const y = Math.max(0, Math.min(browserViewportBounds().height - 1, Math.round(Number(params.y) || 20)));
    let sentX = 0, sentY = 0;
    for (let step = 1; step <= 8; step++) {
      const nextX = Math.round(deltaX * step / 8), nextY = Math.round(deltaY * step / 8);
      webContents.sendInputEvent({ type: 'mouseWheel', x, y, deltaY: sentY - nextY, deltaX: sentX - nextX, canScroll: true });
      sentX = nextX; sentY = nextY;
      await browserPause(16);
    }
    await browserPause(100);
    return { ...browserSnapshot(), message: `Scrolled ${deltaY < 0 ? 'up' : 'down'} ${Math.abs(deltaY)} pixels.` };
  }
  throw new Error('That computer-use action is not supported by Forge.');
}

function showStartupError(message) {
  clearTimeout(readyTimer);
  if (stopping || !app.isReady()) return;
  stopping = true;
  dialog.showMessageBox({
    type: 'error',
    title: 'Forge could not start',
    message: 'Forge could not start its local workspace.',
    detail: message,
    buttons: ['Close'],
    noLink: true,
  }).finally(() => {
    serverProcess?.kill();
    app.quit();
  });
}

function stopForge() {
  if (stopping) return;
  stopping = true;
  clearTimeout(readyTimer);
  if (!serverProcess || serverProcess.exitCode !== null) return app.quit();
  serverProcess.kill('SIGTERM');
  const forceExit = setTimeout(() => { serverProcess?.kill(); app.quit(); }, 2500);
  forceExit.unref();
}

app.on('before-quit', () => {
  if (!stopping && serverProcess && serverProcess.exitCode === null) stopForge();
});
app.on('will-quit', () => {
  computerHost?.kill();
  rejectComputerHostRequests(new Error('Forge closed before the desktop action finished.'));
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') stopForge(); });

