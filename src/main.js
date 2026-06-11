const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const windows = new Set();

function getFileFromArgv(argv) {
  // skip executable, app dir (dev mode) and flags
  const args = argv.slice(app.isPackaged ? 1 : 2);
  for (const a of args) {
    if (a.startsWith('-')) continue;
    try {
      if (fs.existsSync(a) && fs.statSync(a).isFile()) return path.resolve(a);
    } catch (_) {}
  }
  return null;
}

function createWindow(filePath) {
  const win = new BrowserWindow({
    width: 980,
    height: 660,
    minWidth: 420,
    minHeight: 300,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  windows.add(win);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.once('ready-to-show', () => win.show());

  win.webContents.on('did-finish-load', () => {
    if (filePath) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        win.webContents.send('file-opened', { path: filePath, content });
      } catch (e) {
        dialog.showErrorBox('Ошибка', 'Не удалось открыть файл:\n' + e.message);
      }
    }
  });

  let confirmedClose = false;
  win.on('close', async (e) => {
    if (confirmedClose) return;
    e.preventDefault();
    let dirty = false;
    try {
      dirty = await win.webContents.executeJavaScript('window.__isDirty ? window.__isDirty() : false');
    } catch (_) {}
    if (!dirty) {
      confirmedClose = true;
      win.close();
      return;
    }
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Сохранить', 'Не сохранять', 'Отмена'],
      defaultId: 0,
      cancelId: 2,
      title: 'Несохранённые изменения',
      message: 'Сохранить изменения перед закрытием?',
    });
    if (response === 0) {
      const saved = await win.webContents.executeJavaScript('window.__saveForClose()');
      if (saved) { confirmedClose = true; win.close(); }
    } else if (response === 1) {
      confirmedClose = true;
      win.close();
    }
  });

  win.on('closed', () => windows.delete(win));
  win.on('maximize', () => win.webContents.send('window-state', true));
  win.on('unmaximize', () => win.webContents.send('window-state', false));
  return win;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const file = getFileFromArgv(argv);
    if (file) {
      createWindow(file);
    } else {
      const [win] = windows;
      if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
      else createWindow(null);
    }
  });

  app.whenReady().then(() => {
    createWindow(getFileFromArgv(process.argv));
  });
}

app.on('window-all-closed', () => app.quit());

/* ---------- IPC ---------- */

ipcMain.handle('dialog:open', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    filters: [
      { name: 'Текстовые файлы', extensions: ['txt', 'log', 'md', 'ini', 'cfg', 'csv', 'json', 'xml'] },
      { name: 'Все файлы', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return null;
  const content = fs.readFileSync(filePaths[0], 'utf-8');
  return { path: filePaths[0], content };
});

ipcMain.handle('file:save', async (e, { filePath, content }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  let target = filePath;
  if (!target) {
    const { canceled, filePath: chosen } = await dialog.showSaveDialog(win, {
      filters: [
        { name: 'Текстовый файл', extensions: ['txt'] },
        { name: 'Все файлы', extensions: ['*'] },
      ],
      defaultPath: 'Без названия.txt',
    });
    if (canceled || !chosen) return null;
    target = chosen;
  }
  fs.writeFileSync(target, content, 'utf-8');
  return target;
});

ipcMain.handle('file:saveAs', async (e, { content, currentPath }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePath: chosen } = await dialog.showSaveDialog(win, {
    filters: [
      { name: 'Текстовый файл', extensions: ['txt'] },
      { name: 'Все файлы', extensions: ['*'] },
    ],
    defaultPath: currentPath || 'Без названия.txt',
  });
  if (canceled || !chosen) return null;
  fs.writeFileSync(chosen, content, 'utf-8');
  return chosen;
});

ipcMain.on('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
ipcMain.on('window:maximize', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.on('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());
ipcMain.on('window:new', () => createWindow(null));
