'use strict';

const $ = (id) => document.getElementById(id);

/* ---------- elements ---------- */
const editor = $('editor');
const tabbar = $('tabbar');
const posEl = $('pos');
const countsEl = $('counts');
const saveFlashEl = $('save-flash');
const zoomResetBtn = $('zoom-reset');
const themeSelect = $('theme-select');
const opacitySlider = $('opacity');
const fontFamily = $('font-family');
const fontSizeInput = $('font-size');
const wrapToggle = $('wrap-toggle');
const findPanel = $('find-panel');
const findInput = $('find-input');
const findCount = $('find-count');
const findCaseBtn = $('find-case');
const replaceRow = $('replace-row');
const replaceInput = $('replace-input');
const gotoOverlay = $('goto-overlay');
const gotoInput = $('goto-input');
const recentPop = $('recent-pop');
const notesListEl = $('notes-list');
const notesSearch = $('notes-search');

/* ---------- state ---------- */
let tabs = [];          // {id, path, html, savedText}
let activeId = null;
let notes = [];         // {id, html, title, preview, updated, pinned}
let activeNoteId = null;
let mode = 'files';     // 'files' | 'notes'
let owner = null;       // what the editor currently shows: {kind:'tab'|'note', id}
let zoom = 1;
let recent = [];

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* hidden rendered div: innerText needs layout to produce correct newlines */
const scratch = document.createElement('div');
scratch.id = 'scratch';
document.body.appendChild(scratch);
function htmlToText(html) {
  scratch.innerHTML = html;
  const t = scratch.innerText.replace(/\n$/, '');
  scratch.innerHTML = '';
  return t;
}

const getText = () => editor.innerText.replace(/\n$/, '');

/* ---------- settings ---------- */
const settings = {
  load() {
    try { return JSON.parse(localStorage.getItem('blocnot-settings')) || {}; }
    catch (_) { return {}; }
  },
  save(patch) {
    localStorage.setItem('blocnot-settings', JSON.stringify({ ...this.load(), ...patch }));
  },
};

/* ---------- editor ownership ---------- */
function syncEditor() {
  if (!owner) return;
  if (owner.kind === 'tab') {
    const t = tabs.find((x) => x.id === owner.id);
    if (t) t.html = editor.innerHTML;
  } else {
    const n = notes.find((x) => x.id === owner.id);
    if (n && n.html !== editor.innerHTML) {
      n.html = editor.innerHTML;
      n.updated = Date.now();
      noteMeta(n);
    }
  }
}

/* ---------- tabs ---------- */
function currentTab() { return tabs.find((t) => t.id === activeId) || null; }

function tabName(t) { return t.path ? t.path.split(/[\\/]/).pop() : 'Без названия'; }

function isTabDirty(t) {
  const text = (owner && owner.kind === 'tab' && owner.id === t.id) ? getText() : htmlToText(t.html);
  return t.savedText == null ? text.length > 0 : text !== t.savedText;
}

function createTab({ path = null, content = null, html = null, savedText, activate = true } = {}) {
  const tab = {
    id: uid(),
    path,
    html: html != null ? html : (content != null ? escHtml(content) : ''),
    savedText: savedText !== undefined ? savedText : (content != null ? content : null),
  };
  tabs.push(tab);
  if (activate) activateTab(tab.id); else renderTabs();
  return tab;
}

function activateTab(id) {
  syncEditor();
  activeId = id;
  owner = { kind: 'tab', id };
  const tab = currentTab();
  editor.innerHTML = tab ? tab.html : '';
  renderTabs();
  refreshStats();
  editor.focus();
  scheduleSession();
}

function closeTab(id) {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  const t = tabs[i];
  if (isTabDirty(t) && !confirm(`«${tabName(t)}» — есть несохранённые изменения. Закрыть вкладку?`)) return;
  tabs.splice(i, 1);
  if (id === activeId) {
    owner = null;
    activeId = null;
    if (tabs.length) activateTab(tabs[Math.max(0, i - 1)].id);
    else createTab({});
  } else {
    renderTabs();
  }
  scheduleSession();
}

function renderTabs() {
  tabbar.innerHTML = '';
  for (const t of tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (t.id === activeId ? ' active' : '');
    el.title = t.path || 'Без названия';

    const title = document.createElement('span');
    title.className = 't-title';
    title.textContent = tabName(t);

    const dot = document.createElement('span');
    dot.className = 't-dot';
    dot.hidden = !isTabDirty(t);

    const x = document.createElement('button');
    x.className = 't-close';
    x.title = 'Закрыть (Ctrl+W)';
    x.textContent = '✕';
    x.onmousedown = (e) => e.preventDefault();
    x.onclick = (e) => { e.stopPropagation(); closeTab(t.id); };

    el.append(title, dot, x);
    el.onclick = () => activateTab(t.id);
    el.onauxclick = (e) => { if (e.button === 1) closeTab(t.id); };
    tabbar.appendChild(el);
  }
  const act = currentTab();
  document.title = (act ? tabName(act) : 'Blocnot') + ' — Blocnot';
}

/* ---------- file ops ---------- */
function openFiles(files) {
  let opened = false;
  for (const f of files || []) {
    if (!f) continue;
    const existing = tabs.find((t) => t.path === f.path);
    if (existing) {
      existing.html = escHtml(f.content);
      existing.savedText = f.content;
      activateTab(existing.id);
    } else {
      // reuse a pristine empty tab
      const act = currentTab();
      if (act && !act.path && !isTabDirty(act) && tabs.length === 1) {
        act.path = f.path;
        act.html = escHtml(f.content);
        act.savedText = f.content;
        activateTab(act.id);
      } else {
        createTab({ path: f.path, content: f.content });
      }
    }
    addRecent(f.path);
    opened = true;
  }
  if (opened && mode !== 'files') setMode('files');
}

async function openDialog() {
  openFiles(await window.api.openDialog());
}

async function saveFile() {
  if (mode === 'notes') return exportActiveNote();
  const tab = currentTab();
  if (!tab) return false;
  const text = getText();
  const target = await window.api.save(tab.path, text);
  if (!target) return false;
  tab.path = target;
  tab.savedText = text;
  addRecent(target);
  renderTabs();
  flashSaved('✓ Сохранено');
  scheduleSession();
  return true;
}

async function saveFileAs() {
  if (mode === 'notes') return exportActiveNote();
  const tab = currentTab();
  if (!tab) return false;
  const text = getText();
  const target = await window.api.saveAs(text, tab.path);
  if (!target) return false;
  tab.path = target;
  tab.savedText = text;
  addRecent(target);
  renderTabs();
  flashSaved('✓ Сохранено');
  scheduleSession();
  return true;
}

function newTab() {
  if (mode === 'notes') { newNote(); return; }
  createTab({});
}

/* ---------- recent files ---------- */
function addRecent(p) {
  if (!p) return;
  recent = [p, ...recent.filter((x) => x !== p)].slice(0, 12);
  settings.save({ recent });
}

function toggleRecentPop() {
  if (!recentPop.hidden) { recentPop.hidden = true; return; }
  recentPop.innerHTML = '';
  if (!recent.length) {
    const empty = document.createElement('div');
    empty.className = 'rp-empty';
    empty.textContent = 'Нет недавних файлов';
    recentPop.appendChild(empty);
  }
  for (const p of recent) {
    const item = document.createElement('button');
    item.className = 'rp-item';
    const name = document.createElement('span');
    name.className = 'rp-name';
    name.textContent = p.split(/[\\/]/).pop();
    const full = document.createElement('span');
    full.className = 'rp-path';
    full.textContent = p;
    item.append(name, full);
    item.onclick = async () => {
      recentPop.hidden = true;
      const content = await window.api.readFile(p);
      if (content == null) {
        recent = recent.filter((x) => x !== p);
        settings.save({ recent });
        alert('Файл не найден:\n' + p);
        return;
      }
      openFiles([{ path: p, content }]);
    };
    recentPop.appendChild(item);
  }
  const r = $('btn-recent').getBoundingClientRect();
  recentPop.style.left = Math.round(r.left) + 'px';
  recentPop.style.top = Math.round(r.bottom + 6) + 'px';
  recentPop.hidden = false;
}

document.addEventListener('mousedown', (e) => {
  if (!recentPop.hidden && !recentPop.contains(e.target) && e.target.closest('#btn-recent') == null) {
    recentPop.hidden = true;
  }
});

/* ---------- session ---------- */
function buildSession() {
  syncEditor();
  return {
    tabs: tabs.map((t) => ({ path: t.path, html: t.html })),
    activeIndex: tabs.findIndex((t) => t.id === activeId),
    mode,
    activeNoteId,
  };
}
const scheduleSession = debounce(() => window.api.saveStore('session', buildSession()), 600);

async function restoreFromSession(s) {
  for (const t of s.tabs || []) {
    let savedText = null;
    if (t.path) savedText = await window.api.readFile(t.path);
    tabs.push({ id: uid(), path: t.path || null, html: t.html || '', savedText });
  }
  if (tabs.length) {
    const i = Math.min(Math.max(s.activeIndex || 0, 0), tabs.length - 1);
    activateTab(tabs[i].id);
  }
  if (s.activeNoteId) activeNoteId = s.activeNoteId;
  if (s.mode === 'notes') setMode('notes');
}

/* flushed by main process right before the window closes */
window.__flushState = () => ({ session: buildSession(), notes: { notes } });

/* ---------- notes (macOS Notes style) ---------- */
function noteMeta(n) {
  const text = htmlToText(n.html);
  const lines = text.split('\n').filter((l) => l.trim());
  n.title = (lines[0] || 'Новая заметка').slice(0, 60);
  n.preview = (lines[1] || '').slice(0, 80);
}

const persistNotes = debounce(() => window.api.saveStore('notes', { notes }), 400);

function sortedNotes() {
  const f = notesSearch.value.trim().toLowerCase();
  let list = notes;
  if (f) list = notes.filter((n) => (n.title + ' ' + htmlToText(n.html)).toLowerCase().includes(f));
  return [...list].sort((a, b) => (b.pinned - a.pinned) || (b.updated - a.updated));
}

function relDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
  if (new Date(now - 864e5).toDateString() === d.toDateString()) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function renderNotesList() {
  notesListEl.innerHTML = '';
  for (const n of sortedNotes()) {
    const li = document.createElement('li');
    li.className = 'note-item' + (n.id === activeNoteId ? ' active' : '') + (n.pinned ? ' pinned' : '');

    const top = document.createElement('div');
    top.className = 'ni-top';
    const title = document.createElement('span');
    title.className = 'ni-title';
    title.textContent = n.title || 'Новая заметка';
    const pin = document.createElement('button');
    pin.className = 'ni-pin';
    pin.title = n.pinned ? 'Открепить' : 'Закрепить';
    pin.innerHTML = '<svg width="11" height="11" viewBox="0 0 14 14"><path d="M5 1.5h4l-.5 4 2.5 2.5v1H8v3.5L7 13.5 6 12.5V9H3v-1L5.5 5.5z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>';
    pin.onclick = (e) => { e.stopPropagation(); n.pinned = !n.pinned; persistNotes(); renderNotesList(); };
    top.append(title, pin);

    const bottom = document.createElement('div');
    bottom.className = 'ni-bottom';
    const date = document.createElement('span');
    date.className = 'ni-date';
    date.textContent = relDate(n.updated);
    const prev = document.createElement('span');
    prev.className = 'ni-prev';
    prev.textContent = n.preview || 'Нет текста';
    bottom.append(date, prev);

    const del = document.createElement('button');
    del.className = 'ni-del';
    del.title = 'Удалить заметку';
    del.innerHTML = '<svg width="11" height="11" viewBox="0 0 14 14"><path d="M2.5 3.5h9M5 3.5V2h4v1.5M4 3.5l.5 9h5l.5-9" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>';
    del.onclick = (e) => { e.stopPropagation(); deleteNote(n.id); };

    li.append(top, bottom, del);
    li.onclick = () => { if (n.id !== activeNoteId) activateNote(n.id); };
    notesListEl.appendChild(li);
  }
}

function newNote() {
  const n = { id: uid(), html: '', title: 'Новая заметка', preview: '', updated: Date.now(), pinned: false };
  notes.unshift(n);
  notesSearch.value = '';
  activateNote(n.id);
  persistNotes();
}

function activateNote(id) {
  syncEditor();
  activeNoteId = id;
  owner = { kind: 'note', id };
  const n = notes.find((x) => x.id === id);
  editor.innerHTML = n ? n.html : '';
  renderNotesList();
  refreshStats();
  editor.focus();
  scheduleSession();
}

function deleteNote(id) {
  const n = notes.find((x) => x.id === id);
  if (!n) return;
  if (!confirm(`Удалить заметку «${n.title}»?`)) return;
  notes = notes.filter((x) => x.id !== id);
  if (id === activeNoteId) {
    owner = null;
    activeNoteId = null;
    const rest = sortedNotes();
    if (rest.length) activateNote(rest[0].id);
    else { editor.innerHTML = ''; renderNotesList(); }
  } else {
    renderNotesList();
  }
  persistNotes();
  scheduleSession();
}

async function exportActiveNote() {
  const n = notes.find((x) => x.id === activeNoteId);
  if (!n) return false;
  syncEditor();
  const target = await window.api.saveAs(htmlToText(n.html), (n.title || 'Заметка') + '.txt');
  if (target) flashSaved('✓ Экспортировано');
  return !!target;
}

notesSearch.addEventListener('input', renderNotesList);
$('btn-new-note').onclick = newNote;

/* ---------- mode ---------- */
function setMode(m) {
  if (m === mode) return;
  syncEditor();
  owner = null;
  mode = m;
  document.body.classList.toggle('notes-mode', m === 'notes');
  $('seg-files').classList.toggle('active', m === 'files');
  $('seg-notes').classList.toggle('active', m === 'notes');
  editor.dataset.ph = m === 'notes' ? 'Начни печатать…' : '';

  if (m === 'notes') {
    if (!notes.length) { newNote(); }
    else {
      const id = activeNoteId && notes.some((n) => n.id === activeNoteId)
        ? activeNoteId
        : sortedNotes()[0].id;
      activateNote(id);
    }
  } else {
    if (!tabs.length) createTab({});
    else activateTab(activeId && tabs.some((t) => t.id === activeId) ? activeId : tabs[0].id);
  }
  refreshStats();
  scheduleSession();
}

$('seg-files').onclick = () => setMode('files');
$('seg-notes').onclick = () => setMode('notes');

/* ---------- statusbar ---------- */
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

let flashTimer = null;
function flashSaved(msg) {
  saveFlashEl.textContent = msg;
  saveFlashEl.classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => saveFlashEl.classList.remove('show'), 1400);
}

/* ---------- find & replace ---------- */
const caseOn = () => findCaseBtn.classList.contains('active');

function openFind(withReplace) {
  const sel = window.getSelection().toString();
  if (sel && !sel.includes('\n')) findInput.value = sel;
  findPanel.hidden = false;
  replaceRow.hidden = !withReplace;
  findInput.focus();
  findInput.select();
  updateFindCount();
}

function closeFind() {
  findPanel.hidden = true;
  editor.focus();
}

function updateFindCount() {
  const q = findInput.value;
  if (!q) { findCount.textContent = ''; return; }
  const hay = caseOn() ? getText() : getText().toLowerCase();
  const needle = caseOn() ? q : q.toLowerCase();
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  findCount.textContent = n ? String(n) : '0';
  findCount.classList.toggle('zero', n === 0);
}

function setCaretAtStart() {
  const r = document.createRange();
  r.setStart(editor, 0);
  r.collapse(true);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

function doFind(backwards) {
  const q = findInput.value;
  if (!q) return;
  const found = window.find(q, caseOn(), !!backwards, true, false, false, false);
  if (!found) {
    findInput.classList.add('miss');
    setTimeout(() => findInput.classList.remove('miss'), 350);
  }
}

function doReplace() {
  const q = findInput.value;
  if (!q) return;
  const sel = window.getSelection().toString();
  const eq = caseOn() ? sel === q : sel.toLowerCase() === q.toLowerCase();
  if (eq && sel) document.execCommand('insertText', false, replaceInput.value);
  window.find(q, caseOn(), false, true, false, false, false);
  updateFindCount();
}

function doReplaceAll() {
  const q = findInput.value;
  if (!q) return;
  editor.focus();
  setCaretAtStart();
  let n = 0;
  // wrap=false so replacements containing the query can't loop forever
  while (window.find(q, caseOn(), false, false, false, false, false)) {
    document.execCommand('insertText', false, replaceInput.value);
    if (++n > 5000) break;
  }
  updateFindCount();
  flashSaved(n + ' замен');
}

$('btn-find').onclick = () => openFind(false);
$('find-close').onclick = closeFind;
$('find-prev').onclick = () => doFind(true);
$('find-next').onclick = () => doFind(false);
$('btn-replace').onclick = doReplace;
$('btn-replace-all').onclick = doReplaceAll;
findCaseBtn.onclick = () => { findCaseBtn.classList.toggle('active'); updateFindCount(); };
findInput.addEventListener('input', updateFindCount);
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); doFind(e.shiftKey); }
  if (e.key === 'Escape') closeFind();
});
replaceInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); doReplace(); }
  if (e.key === 'Escape') closeFind();
});
/* keep editor selection when pressing panel buttons */
for (const b of findPanel.querySelectorAll('button')) {
  b.addEventListener('mousedown', (e) => e.preventDefault());
}

/* ---------- go to line ---------- */
function openGoto() {
  gotoOverlay.hidden = false;
  gotoInput.value = '';
  gotoInput.focus();
}

function closeGoto() {
  gotoOverlay.hidden = true;
  editor.focus();
}

function placeCaretAtLine(n) {
  editor.focus();
  if (n <= 1) { setCaretAtStart(); return; }
  const isBlock = (el) => el.nodeType === 1 && (el.tagName === 'DIV' || el.tagName === 'P');
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node, line = 1, contentBefore = false;

  const place = (nd, off) => {
    const r = document.createRange();
    r.setStart(nd, off);
    r.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    const el = nd.nodeType === 1 ? nd : nd.parentElement;
    el?.scrollIntoView({ block: 'center' });
  };

  while ((node = walker.nextNode())) {
    if (node.nodeType === 1) {
      if (isBlock(node)) {
        if (contentBefore) {
          line++;
          if (line === n) { place(node, 0); return; }
        }
        contentBefore = true;
      }
    } else {
      contentBefore = true;
      let idx = -1, off = 0;
      while ((idx = node.data.indexOf('\n', off)) !== -1) {
        line++;
        off = idx + 1;
        if (line === n) { place(node, off); return; }
      }
    }
  }
  // past the last line — caret to end
  const r = document.createRange();
  r.selectNodeContents(editor);
  r.collapse(false);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

$('goto-ok').onclick = () => { const n = parseInt(gotoInput.value, 10); closeGoto(); if (n >= 1) placeCaretAtLine(n); };
$('goto-cancel').onclick = closeGoto;
gotoInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('goto-ok').click();
  if (e.key === 'Escape') closeGoto();
});
gotoOverlay.addEventListener('mousedown', (e) => { if (e.target === gotoOverlay) closeGoto(); });
posEl.onclick = openGoto;

/* ---------- formatting ---------- */
document.execCommand('styleWithCSS', false, true);
const fmt = (cmd, val) => { editor.focus(); document.execCommand(cmd, false, val); };

$('fmt-bold').onclick = () => fmt('bold');
$('fmt-italic').onclick = () => fmt('italic');
$('fmt-underline').onclick = () => fmt('underline');
$('fmt-strike').onclick = () => fmt('strikeThrough');
$('fmt-clear').onclick = () => fmt('removeFormat');

const textColor = $('text-color');
const markColor = $('mark-color');
$('fmt-color').onclick = (e) => { if (e.target !== textColor) fmt('foreColor', textColor.value); };
textColor.oninput = () => { $('color-bar').style.background = textColor.value; fmt('foreColor', textColor.value); };
$('fmt-mark').onclick = (e) => { if (e.target !== markColor) fmt('hiliteColor', markColor.value); };
markColor.oninput = () => { $('mark-bar').style.background = markColor.value; fmt('hiliteColor', markColor.value); };

/* checklist (macOS Notes style) */
function insertChecklist() {
  editor.focus();
  const tid = 'todo-' + uid();
  document.execCommand('insertHTML', false,
    `<div class="todo" id="${tid}"><input type="checkbox">&nbsp;</div>`);
  const el = document.getElementById(tid);
  if (el) {
    el.removeAttribute('id');
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }
}
$('fmt-todo').onclick = insertChecklist;

editor.addEventListener('click', (e) => {
  if (e.target.matches('input[type="checkbox"]')) {
    // persist the state in the html attribute so it survives save/restore
    if (e.target.checked) e.target.setAttribute('checked', '');
    else e.target.removeAttribute('checked');
    e.target.closest('.todo')?.classList.toggle('done', e.target.checked);
    onEditorInput();
  }
});

/* ---------- date/time ---------- */
function insertDateTime() {
  const d = new Date();
  const s = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    + ' ' + d.toLocaleDateString('ru-RU');
  editor.focus();
  document.execCommand('insertText', false, s);
}
$('btn-datetime').onclick = insertDateTime;

/* ---------- theme / opacity / font / zoom / wrap ---------- */
themeSelect.onchange = () => {
  document.body.dataset.theme = themeSelect.value;
  settings.save({ theme: themeSelect.value });
};

opacitySlider.oninput = () => {
  document.documentElement.style.setProperty('--bg-alpha', opacitySlider.value / 100);
  settings.save({ opacity: +opacitySlider.value });
};

fontFamily.onchange = () => {
  document.documentElement.style.setProperty('--editor-font', fontFamily.value);
  settings.save({ font: fontFamily.value });
};

function applyFontSize(px) {
  px = Math.min(72, Math.max(8, px));
  fontSizeInput.value = px;
  document.documentElement.style.setProperty('--editor-size', px + 'px');
  settings.save({ size: px });
}
fontSizeInput.onchange = () => applyFontSize(+fontSizeInput.value || 15);
$('size-up').onclick = () => applyFontSize(+fontSizeInput.value + 1);
$('size-down').onclick = () => applyFontSize(+fontSizeInput.value - 1);

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

wrapToggle.onclick = () => {
  const nowrap = document.body.classList.toggle('nowrap');
  wrapToggle.classList.toggle('active', !nowrap);
  settings.save({ nowrap });
};

/* ---------- window controls ---------- */
$('btn-min').onclick = () => window.api.minimize();
$('btn-max').onclick = () => window.api.maximize();
$('btn-close').onclick = () => window.api.close();
window.api.onWindowState((maximized) => document.body.classList.toggle('maximized', maximized));

/* ---------- toolbar file buttons ---------- */
$('btn-new').onclick = newTab;
$('btn-newtab').onclick = newTab;
$('btn-open').onclick = openDialog;
$('btn-save').onclick = saveFile;
$('btn-recent').onclick = toggleRecentPop;

/* ---------- editor events ---------- */
function onEditorInput() {
  if (mode === 'notes' && activeNoteId) {
    const n = notes.find((x) => x.id === activeNoteId);
    if (n) {
      n.html = editor.innerHTML;
      n.updated = Date.now();
      noteMeta(n);
      renderNotesList();
      persistNotes();
    }
  } else {
    renderTabs(); // dirty dot
  }
  refreshStats();
  if (!findPanel.hidden) updateFindCount();
  scheduleSession();
}
editor.addEventListener('input', onEditorInput);
document.addEventListener('selectionchange', refreshStats);

editor.addEventListener('paste', (e) => {
  e.preventDefault();
  const text = e.clipboardData.getData('text/plain');
  document.execCommand('insertText', false, text);
});

editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    document.execCommand('insertText', false, '    ');
  }
});

/* ---------- drag & drop ---------- */
document.body.addEventListener('dragover', (e) => e.preventDefault());
document.body.addEventListener('drop', async (e) => {
  e.preventDefault();
  const paths = [...e.dataTransfer.files]
    .map((f) => { try { return window.api.getPathForFile(f); } catch (_) { return null; } })
    .filter(Boolean);
  const loaded = [];
  for (const p of paths) {
    const content = await window.api.readFile(p);
    if (content != null) loaded.push({ path: p, content });
  }
  if (loaded.length) openFiles(loaded);
});

/* ---------- keyboard shortcuts ---------- */
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  const ctrl = e.ctrlKey;

  if (ctrl && e.code === 'Tab') {
    e.preventDefault();
    if (mode === 'files' && tabs.length > 1) {
      const i = tabs.findIndex((t) => t.id === activeId);
      const next = (i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length;
      activateTab(tabs[next].id);
    }
    return;
  }

  if (ctrl && !e.shiftKey && k === 's') { e.preventDefault(); saveFile(); }
  else if (ctrl && e.shiftKey && k === 's') { e.preventDefault(); saveFileAs(); }
  else if (ctrl && k === 'o') { e.preventDefault(); openDialog(); }
  else if (ctrl && !e.shiftKey && k === 'n') { e.preventDefault(); newTab(); }
  else if (ctrl && e.shiftKey && k === 'n') { e.preventDefault(); window.api.newWindow(); }
  else if (ctrl && k === 'w') { e.preventDefault(); if (mode === 'files' && activeId) closeTab(activeId); }
  else if (ctrl && !e.shiftKey && k === 'f') { e.preventDefault(); openFind(false); }
  else if (ctrl && k === 'h') { e.preventDefault(); openFind(true); }
  else if (ctrl && k === 'g') { e.preventDefault(); openGoto(); }
  else if (ctrl && k === 'p') { e.preventDefault(); window.print(); }
  else if (e.key === 'F5') { e.preventDefault(); insertDateTime(); }
  else if (ctrl && (e.key === '=' || e.key === '+')) { e.preventDefault(); applyZoom(zoom + 0.1); }
  else if (ctrl && e.key === '-') { e.preventDefault(); applyZoom(zoom - 0.1); }
  else if (ctrl && e.key === '0') { e.preventDefault(); applyZoom(1); }
  else if (e.key === 'Escape') {
    if (!findPanel.hidden) closeFind();
    else if (!gotoOverlay.hidden) closeGoto();
    else if (!recentPop.hidden) recentPop.hidden = true;
  }
});

/* ---------- init ---------- */
let initResolve;
const initData = new Promise((r) => { initResolve = r; });
window.api.onInit((d) => initResolve(d));
window.api.onFileOpened((f) => { if (f) openFiles([f]); });

(async function init() {
  const s = settings.load();
  if (s.theme) { document.body.dataset.theme = s.theme; themeSelect.value = s.theme; }
  if (s.opacity) { opacitySlider.value = s.opacity; document.documentElement.style.setProperty('--bg-alpha', s.opacity / 100); }
  if (s.font) { fontFamily.value = s.font; document.documentElement.style.setProperty('--editor-font', s.font); }
  if (s.size) applyFontSize(s.size);
  if (s.nowrap) { document.body.classList.add('nowrap'); wrapToggle.classList.remove('active'); }
  if (Array.isArray(s.recent)) recent = s.recent;

  const notesData = await window.api.loadStore('notes');
  notes = (notesData && notesData.notes) || [];

  const d = await initData;
  if (d.restoreSession) {
    const sess = await window.api.loadStore('session');
    if (sess) await restoreFromSession(sess);
  }
  if (d.file) openFiles([d.file]);
  if (!tabs.length && mode === 'files') createTab({});

  refreshStats();
  editor.focus();
})();
