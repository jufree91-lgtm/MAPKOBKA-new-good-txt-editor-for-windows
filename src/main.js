const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const windows = new Set();
const storePath = (name) => path.join(app.getPath('userData'), name + '.json');

function readFileSafe(p) {
  try { return { path: p, content: fs.readFileSync(p, 'utf-8') }; } catch (_) { return null; }
}

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

function createWindow(filePath, restoreSession) {
  const win = new BrowserWindow({
    width: 1040,
    height: 680,
    minWidth: 500,
    minHeight: 340,
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
    win.webContents.send('init', {
      restoreSession,
      file: filePath ? readFileSafe(filePath) : null,
    });
  });

  // Win11-style: no save prompt — session (incl. unsaved tabs) is flushed to disk
  let closing = false;
  win.on('close', async (e) => {
    if (closing) return;
    e.preventDefault();
    closing = true;
    try {
      const state = await win.webContents.executeJavaScript(
        'window.__flushState ? window.__flushState() : null'
      );
      if (state) {
        if (state.session) fs.writeFileSync(storePath('session'), JSON.stringify(state.session));
        if (state.notes) fs.writeFileSync(storePath('notes'), JSON.stringify(state.notes));
      }
    } catch (_) {}
    win.close();
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
    const [win] = windows;
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      if (file) {
        const data = readFileSafe(file);
        if (data) win.webContents.send('file-opened', data);
      }
    } else {
      createWindow(file, false);
    }
  });

  app.whenReady().then(() => {
    createWindow(getFileFromArgv(process.argv), true);
  });
}

app.on('window-all-closed', () => app.quit());

/* ---------- IPC ---------- */

const TEXT_FILTERS = [
  { name: 'Текстовые файлы', extensions: ['txt', 'log', 'md', 'ini', 'cfg', 'csv', 'json', 'xml'] },
  { name: 'Все файлы', extensions: ['*'] },
];

ipcMain.handle('dialog:open', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    filters: TEXT_FILTERS,
    properties: ['openFile', 'multiSelections'],
  });
  if (canceled) return [];
  return filePaths.map(readFileSafe).filter(Boolean);
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

ipcMain.handle('file:read', (_e, p) => {
  try { return fs.readFileSync(p, 'utf-8'); } catch (_) { return null; }
});

ipcMain.handle('store:load', (_e, name) => {
  try { return JSON.parse(fs.readFileSync(storePath(name), 'utf-8')); } catch (_) { return null; }
});

ipcMain.handle('store:save', (_e, { name, data }) => {
  try { fs.writeFileSync(storePath(name), JSON.stringify(data)); return true; } catch (_) { return false; }
});

ipcMain.on('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
ipcMain.on('window:maximize', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.on('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());
ipcMain.on('window:new', () => createWindow(null, false));
