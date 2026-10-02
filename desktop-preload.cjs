const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ForgeDesktop', {
  chooseFolder: () => ipcRenderer.invoke('forge:choose-folder'),
  connectAnthropic: () => ipcRenderer.invoke('forge:connect-anthropic'),
  computerUse: true,
  browserCommand: (action, params) => ipcRenderer.invoke('forge:browser-command', { action, params }),
  captureBrowserTransition: () => ipcRenderer.invoke('forge:browser-transition-frame'),
  openBrowserExternal: () => ipcRenderer.invoke('forge:browser-open-external'),
  setBrowserLayout: (layout) => ipcRenderer.send('forge:browser-layout', layout),
  onBrowserOpen: (callback) => ipcRenderer.on('forge:browser-open', () => callback()),
  onBrowserState: (callback) => ipcRenderer.on('forge:browser-state', (_event, state) => callback(state)),
});
