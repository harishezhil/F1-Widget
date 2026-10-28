const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('f1', {
  get: (url) => ipcRenderer.invoke('get', url),
});