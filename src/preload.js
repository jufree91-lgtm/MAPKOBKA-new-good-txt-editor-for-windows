const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openDialog: () => ipcRenderer.invoke('dialog:open'),
  save: (filePath, content) => ipcRenderer.invoke('file:save', { filePath, content }),
  saveAs: (content, currentPath) => ipcRenderer.invoke('file:saveAs', { content, currentPath }),
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  newWindow: () => ipcRenderer.send('window:new'),
  onFileOpened: (cb) => ipcRenderer.on('file-opened', (_e, data) => cb(data)),
  onWindowState: (cb) => ipcRenderer.on('window-state', (_e, maximized) => cb(maximized)),
});
