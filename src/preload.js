const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openDialog: () => ipcRenderer.invoke('dialog:open'),
  save: (filePath, content) => ipcRenderer.invoke('file:save', { filePath, content }),
  saveAs: (content, currentPath) => ipcRenderer.invoke('file:saveAs', { content, currentPath }),
  readFile: (p) => ipcRenderer.invoke('file:read', p),
  loadStore: (name) => ipcRenderer.invoke('store:load', name),
  saveStore: (name, data) => ipcRenderer.invoke('store:save', { name, data }),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  newWindow: () => ipcRenderer.send('window:new'),
  onInit: (cb) => ipcRenderer.on('init', (_e, data) => cb(data)),
  onFileOpened: (cb) => ipcRenderer.on('file-opened', (_e, data) => cb(data)),
  onWindowState: (cb) => ipcRenderer.on('window-state', (_e, maximized) => cb(maximized)),
});
