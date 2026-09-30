const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { fork, spawn } = require('node:child_process');
const path = require('node:path');
const { existsSync } = require('node:fs');

const appId = 'com.forge.codexworkspace';
app.setAppUserModelId(appId);

let serverProcess;
let mainWindow;
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
    if (!stopping) stopForge();
  });
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
app.on('window-all-closed', () => { if (process.platform !== 'darwin') stopForge(); });

