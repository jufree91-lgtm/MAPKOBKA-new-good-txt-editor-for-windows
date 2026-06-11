const editor = document.getElementById('editor');
const fileNameEl = document.getElementById('file-name');
const dirtyDot = document.getElementById('dirty-dot');
const posEl = document.getElementById('pos');
const countsEl = document.getElementById('counts');
const zoomResetBtn = document.getElementById('zoom-reset');

let currentPath = null;
let savedContent = '';
let zoom = 1;

/* ---------- settings ---------- */
const settings = {
  load() {
    try { return JSON.parse(localStorage.getItem('blocnot-settings')) || {}; }
    catch (_) { return {}; }
  },
  save(patch) {
    const s = { ...this.load(), ...patch };
    localStorage.setItem('blocnot-settings', JSON.stringify(s));
  },
};

/* ---------- helpers ---------- */
const getText = () => editor.innerText.replace(/\n$/, '');
const isDirty = () => getText() !== savedContent;

function refreshTitle() {
  const name = currentPath ? currentPath.split(/[\\/]/).pop() : 'Без названия';
  fileNameEl.textContent = currentPath ? `${name} — ${currentPath}` : name;
  dirtyDot.hidden = !isDirty();
  document.title = (isDirty() ? '● ' : '') + name + ' — Blocnot';
}

function refreshStats() {
  const text = getText();
  const words = (text.match(/[^\s]+/g) || []).length;
  countsEl.textContent = `${words} слов · ${text.length} символов`;

  const sel = window.getSelection();
  if (sel.rangeCount && editor.contains(sel.anchorNode)) {
    const range = sel.getRangeAt(0).cloneRange();
    range.selectNodeContents(editor);
    range.setEnd(sel.anchorNode, sel.anchorOffset);
    const before = range.toString();
    const lines = before.split('\n');
    posEl.textContent = `Стр ${lines.length}, Стлб ${lines[lines.length - 1].length + 1}`;
  }
}

function setContent(text) {
  editor.textContent = text;
  savedContent = getText();
  refreshTitle();
  refreshStats();
}

/* ---------- file ops ---------- */
async function openFile() {
  const result = await window.api.openDialog();
  if (!result) return;
  currentPath = result.path;
  setContent(result.content);
}

async function saveFile() {
  const target = await window.api.save(currentPath, getText());
  if (!target) return false;
  currentPath = target;
  savedContent = getText();
  refreshTitle();
  return true;
}

async function saveFileAs() {
  const target = await window.api.saveAs(getText(), currentPath);
  if (!target) return false;
  currentPath = target;
  savedContent = getText();
  refreshTitle();
  return true;
}

function newFile() {
  if (isDirty() && !confirm('Есть несохранённые изменения. Создать новый файл?')) return;
  currentPath = null;
  setContent('');
  editor.focus();
}

// used by main process on window close
window.__isDirty = isDirty;
window.__saveForClose = saveFile;

window.api.onFileOpened(({ path, content }) => {
  currentPath = path;
  setContent(content);
});

/* ---------- window controls ---------- */
document.getElementById('btn-min').onclick = () => window.api.minimize();
document.getElementById('btn-max').onclick = () => window.api.maximize();
document.getElementById('btn-close').onclick = () => window.api.close();
window.api.onWindowState((maximized) => document.body.classList.toggle('maximized', maximized));

/* ---------- toolbar ---------- */
document.getElementById('btn-new').onclick = newFile;
document.getElementById('btn-open').onclick = openFile;
document.getElementById('btn-save').onclick = saveFile;

document.execCommand('styleWithCSS', false, true);
const fmt = (cmd, val) => { editor.focus(); document.execCommand(cmd, false, val); };

document.getElementById('fmt-bold').onclick = () => fmt('bold');
document.getElementById('fmt-italic').onclick = () => fmt('italic');
document.getElementById('fmt-underline').onclick = () => fmt('underline');
document.getElementById('fmt-strike').onclick = () => fmt('strikeThrough');
document.getElementById('fmt-clear').onclick = () => fmt('removeFormat');

const textColor = document.getElementById('text-color');
const markColor = document.getElementById('mark-color');
document.getElementById('fmt-color').onclick = (e) => {
  if (e.target === textColor) return;
  fmt('foreColor', textColor.value);
};
textColor.oninput = () => {
  document.getElementById('color-bar').style.background = textColor.value;
  fmt('foreColor', textColor.value);
};
document.getElementById('fmt-mark').onclick = (e) => {
  if (e.target === markColor) return;
  fmt('hiliteColor', markColor.value);
};
markColor.oninput = () => {
  document.getElementById('mark-bar').style.background = markColor.value;
  fmt('hiliteColor', markColor.value);
};

/* ---------- theme / opacity ---------- */
const themeSelect = document.getElementById('theme-select');
themeSelect.onchange = () => {
  document.body.dataset.theme = themeSelect.value;
  settings.save({ theme: themeSelect.value });
};

const opacitySlider = document.getElementById('opacity');
opacitySlider.oninput = () => {
  document.documentElement.style.setProperty('--bg-alpha', opacitySlider.value / 100);
  settings.save({ opacity: +opacitySlider.value });
};

/* ---------- font ---------- */
const fontFamily = document.getElementById('font-family');
const fontSize = document.getElementById('font-size');

fontFamily.onchange = () => {
  document.documentElement.style.setProperty('--editor-font', fontFamily.value);
  settings.save({ font: fontFamily.value });
};

function applyFontSize(px) {
  px = Math.min(72, Math.max(8, px));
  fontSize.value = px;
  document.documentElement.style.setProperty('--editor-size', px + 'px');
  settings.save({ size: px });
}
fontSize.onchange = () => applyFontSize(+fontSize.value || 15);
document.getElementById('size-up').onclick = () => applyFontSize(+fontSize.value + 1);
document.getElementById('size-down').onclick = () => applyFontSize(+fontSize.value - 1);

/* ---------- zoom ---------- */
function applyZoom(z) {
  zoom = Math.min(5, Math.max(0.3, z));
  document.documentElement.style.setProperty('--zoom', zoom);
  zoomResetBtn.textContent = Math.round(zoom * 100) + '%';
}
zoomResetBtn.onclick = () => applyZoom(1);

editor.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  applyZoom(zoom + (e.deltaY < 0 ? 0.1 : -0.1));
}, { passive: false });

/* ---------- wrap ---------- */
const wrapToggle = document.getElementById('wrap-toggle');
wrapToggle.onclick = () => {
  const nowrap = document.body.classList.toggle('nowrap');
  wrapToggle.classList.toggle('active', !nowrap);
  settings.save({ nowrap });
};

/* ---------- shortcuts ---------- */
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (e.ctrlKey && !e.shiftKey && k === 's') { e.preventDefault(); saveFile(); }
  else if (e.ctrlKey && e.shiftKey && k === 's') { e.preventDefault(); saveFileAs(); }
  else if (e.ctrlKey && k === 'o') { e.preventDefault(); openFile(); }
  else if (e.ctrlKey && !e.shiftKey && k === 'n') { e.preventDefault(); newFile(); }
  else if (e.ctrlKey && e.shiftKey && k === 'n') { e.preventDefault(); window.api.newWindow(); }
  else if (e.ctrlKey && (e.key === '=' || e.key === '+')) { e.preventDefault(); applyZoom(zoom + 0.1); }
  else if (e.ctrlKey && e.key === '-') { e.preventDefault(); applyZoom(zoom - 0.1); }
  else if (e.ctrlKey && e.key === '0') { e.preventDefault(); applyZoom(1); }
});

/* paste as plain text */
editor.addEventListener('paste', (e) => {
  e.preventDefault();
  const text = e.clipboardData.getData('text/plain');
  document.execCommand('insertText', false, text);
});

/* tab inserts spaces instead of leaving the editor */
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    document.execCommand('insertText', false, '    ');
  }
});

editor.addEventListener('input', () => { refreshTitle(); refreshStats(); });
document.addEventListener('selectionchange', refreshStats);

/* ---------- init ---------- */
(function init() {
  const s = settings.load();
  if (s.theme) { document.body.dataset.theme = s.theme; themeSelect.value = s.theme; }
  if (s.opacity) { opacitySlider.value = s.opacity; document.documentElement.style.setProperty('--bg-alpha', s.opacity / 100); }
  if (s.font) { fontFamily.value = s.font; document.documentElement.style.setProperty('--editor-font', s.font); }
  if (s.size) applyFontSize(s.size);
  if (s.nowrap) { document.body.classList.add('nowrap'); wrapToggle.classList.remove('active'); }
  refreshTitle();
  refreshStats();
  editor.focus();
})();
