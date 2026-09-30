const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ForgeDesktop', {
  chooseFolder: () => ipcRenderer.invoke('forge:choose-folder'),
  connectAnthropic: () => ipcRenderer.invoke('forge:connect-anthropic'),
});
