const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ForgeDesktop', {
  chooseFolder: () => ipcRenderer.invoke('forge:choose-folder'),
  titleBarOverlay: process.platform === 'win32',
  setTitleBarTheme: (color, symbolColor) => ipcRenderer.invoke('forge:set-titlebar-theme', { color, symbolColor }),
  connectAnthropic: () => ipcRenderer.invoke('forge:connect-anthropic'),
  computerUse: true,
  browserCommand: (action, params) => ipcRenderer.invoke('forge:browser-command', { action, params }),
  captureBrowserTransition: () => ipcRenderer.invoke('forge:browser-transition-frame'),
  openBrowserExternal: () => ipcRenderer.invoke('forge:browser-open-external'),
  openExternalUrl: (url) => ipcRenderer.invoke('forge:open-external-url', url),
  setBrowserLayout: (layout) => ipcRenderer.send('forge:browser-layout', layout),
  onBrowserOpen: (callback) => ipcRenderer.on('forge:browser-open', () => callback()),
  onBrowserState: (callback) => ipcRenderer.on('forge:browser-state', (_event, state) => callback(state)),
});
