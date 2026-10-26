'use strict';
/* ==========================================================================
   RedX Downloader renderer
   Keeps a single snapshot of engine state and patches the DOM in place so
   progress updates never rebuild the list under the pointer.
   ========================================================================== */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const api = window.downloader;
const progressId = new URLSearchParams(location.search).get('progress');
const SVG_NS = 'http://www.w3.org/2000/svg';

const state = { downloads: [], settings: {}, integration: {}, appInfo: null };
let filter = 'all', category = '', searchTerm = '', sort = 'createdAt', ascending = false;
let visible = [];
const selectedIds = new Set();
let selectedId = null, detailId = null, lastDetailSignature = '';
let addMode = 'new', pendingReviewId = null, pendingDuplicate = false;
let toastSeq = 0, settingsSnapshot = null, diagnosticsLoaded = false;
const rowNodes = new Map();
const lastDownloaded = new Map();

const STATUS = {
  queued: ['Queued', 'queued'], scheduled: ['Scheduled', 'scheduled'], probing: ['Connecting', 'queued'],
  downloading: ['Receiving data', 'downloading'], assembling: ['Finishing', 'downloading'],
  paused: ['Paused', 'paused'], complete: ['Complete', 'complete'], error: ['Failed', 'failed'], cancelled: ['Cancelled', 'cancelled']
};
const CATEGORY_ICON = { Video: 'video', Audio: 'audio', Documents: 'file', Programs: 'program', Archives: 'archive', Images: 'image', Other: 'file' };
const CATEGORIES = ['Video', 'Audio', 'Documents', 'Programs', 'Archives', 'Images', 'Other'];

/* The grid shows a file-type badge: the extension decides the glyph and hue,
   and the media category is the fallback when the name has no extension yet. */
const EXT_BADGES = [
  [['exe', 'msi', 'msix', 'appx', 'bat', 'cmd'], 'exeprog', 'program'],
  [['iso', 'img', 'dmg', 'vhd', 'vhdx'], 'isodisc', 'disc'],
  [['pdf'], 'pdfdoc', 'file'],
  [['mkv', 'mp4', 'avi', 'mov', 'webm', 'ts', 'm2ts', 'flv', 'wmv', 'm4v', 'mpg', 'mpeg'], 'videofile', 'film'],
  [['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'zst'], 'archivefile', 'archive'],
  [['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'wma', 'aiff'], 'audiofile', 'audio'],
  [['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'csv', 'md', 'odt', 'ods'], 'docfile', 'file'],
  [['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'tiff', 'heic', 'avif'], 'imagefile', 'image'],
  [['html', 'htm', 'css', 'js', 'json', 'xml', 'mjs', 'cjs'], 'webfile', 'globe']
];
const CATEGORY_BADGE = {
  Video: ['videofile', 'film'], Audio: ['audiofile', 'audio'], Documents: ['docfile', 'file'],
  Programs: ['exeprog', 'app'], Archives: ['archivefile', 'archive'], Images: ['imagefile', 'image'],
  Other: ['webfile', 'file']
};
function badgeFor(filename, category) {
  const match = /\.([a-z0-9]{1,5})$/i.exec(String(filename || '').trim());
  const extension = match ? match[1].toLowerCase() : '';
  for (const [extensions, cls, glyph] of EXT_BADGES) {
    if (extensions.includes(extension)) return { cls, glyph };
  }
  const [fallbackClass, fallbackGlyph] = CATEGORY_BADGE[category] || CATEGORY_BADGE.Other;
  return { cls: fallbackClass, glyph: fallbackGlyph };
}

/* ------------------------------------------------------------------ util */
function icon(name, className) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  if (className) svg.setAttribute('class', className);
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
const number = value => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0);
function bytes(value) {
  const size = number(value);
  if (!size) return '0 B';
  const power = Math.min(4, Math.floor(Math.log(size) / Math.log(1024)));
  return `${(size / 1024 ** power).toFixed(power ? (power > 2 ? 2 : 1) : 0)} ${['B', 'KB', 'MB', 'GB', 'TB'][power]}`;
}
function duration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.ceil(seconds);
  if (total < 60) return `${total} sec`;
  if (total < 3600) {
    const minutes = Math.floor(total / 60), rest = total % 60;
    return rest ? `${minutes} min ${rest} sec` : `${minutes} min`;
  }
  const hours = Math.floor(total / 3600), minutes = Math.round((total % 3600) / 60);
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}
function dateTime(value) {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
}
const statusOf = d => (d?.status === 'complete' ? 'complete' : STATUS[d?.status] ? d.status : 'queued');
function pctLabel(percent) {
  if (percent === null) return '—';
  if (percent >= 99.95) return '100%';
  return `${percent.toFixed(1)}%`;
}
const statusLabel = d => (STATUS[statusOf(d)] || [d?.status || 'Queued'])[0];
function percentOf(d) {
  if (statusOf(d) === 'complete') return 100;
  const total = number(d.total) || number(d.streamProgress?.estimatedBytes);
  if (total) return Math.min(100, number(d.downloaded) / total * 100);
  if (d.streamProgress?.total) return d.streamProgress.completed / d.streamProgress.total * 100;
  return null;
}
function etaOf(d) {
  const total = number(d.total) || number(d.streamProgress?.estimatedBytes);
  const speed = number(d.speedAvg) || number(d.speed);
  if (!total || !speed) return '';
  return duration(Math.max(0, (total - number(d.downloaded)) / speed));
}
function sizeOf(d) {
  if (number(d.total)) return `${d.estimated ? '≈ ' : ''}${bytes(d.total)}`;
  if (d.streamProgress?.estimatedBytes) return `≈ ${bytes(d.streamProgress.estimatedBytes)}`;
  if (d.kind === 'hls') return 'Calculated from segments';
  return 'Unknown';
}
const categoryOf = d => (CATEGORIES.includes(d.category) ? d.category : 'Other');
const messageOf = error => String(error?.message || error || 'The operation failed.').replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');

async function call(method, ...args) {
  if (!api || typeof api[method] !== 'function') throw new Error('The download service is unavailable. Restart RedX Downloader.');
  return api[method](...args);
}

/* ----------------------------------------------------------------- toasts */
function toast(message, { type = 'info', detail = '', actions = [], timeout } = {}) {
  const node = el('div', `toast ${type}`);
  node.dataset.id = String(++toastSeq);
  const text = el('div', 'toast-text');
  text.append(el('div', '', message));
  if (detail) text.append(el('small', '', detail));
  if (actions.length) {
    const row = el('div', 'toast-actions');
    for (const action of actions) {
      const button = el('button', 'btn small', action.label);
      button.type = 'button';
      button.addEventListener('click', () => { close(); action.onClick?.(); });
      row.append(button);
    }
    text.append(row);
  }
  const closeButton = el('button', 'icon-btn');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Dismiss');
  closeButton.append(icon('x'));
  node.append(text, closeButton);
  const close = () => { clearTimeout(node.timer); node.remove(); };
  closeButton.addEventListener('click', close);
  node.timer = setTimeout(close, timeout ?? (type === 'error' ? 12000 : 6500));
  $('#toasts').append(node);
  while ($('#toasts').children.length > 4) $('#toasts').firstElementChild.remove();
  return node;
}

/* ---------------------------------------------------------------- dialogs */
function openDialog(selector) {
  const dialog = $(selector);
  if (dialog && !dialog.open) dialog.showModal();
  // showModal focuses the first control, which paints a focus ring on the close
  // button; move focus off it so the dialog opens cleanly.
  if (document.activeElement?.classList?.contains('icon-btn')) document.activeElement.blur();
  return dialog;
}
function confirmDialog({ title = 'Are you sure?', message = '', ok = 'Continue', cancel = 'Cancel', danger = false } = {}) {
  const dialog = $('#confirm-dialog');
  $('#confirm-title').textContent = title;
  $('#confirm-message').textContent = message;
  $('#confirm-ok').textContent = ok;
  $('#confirm-ok').className = `btn ${danger ? 'danger' : 'primary'}`;
  $('#confirm-cancel').textContent = cancel;
  return new Promise(resolve => {
    const done = value => { cleanup(); dialog.close(); resolve(value); };
    const onClose = () => { cleanup(); resolve(false); };
    const onClick = event => { if (event.target.id === 'confirm-ok') { event.preventDefault(); done(true); } };
    const cleanup = () => { dialog.removeEventListener('close', onClose); dialog.removeEventListener('click', onClick); };
    dialog.addEventListener('close', onClose);
    dialog.addEventListener('click', onClick);
    dialog.showModal();
  });
}

/* ------------------------------------------------------------------ theme */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
}

/* ------------------------------------------------ interface customisation ---
   Column visibility and the toolbar skin are per-machine presentation choices,
   so they live in the renderer profile instead of the shared download state. */
const COLUMN_TRACKS = { size: '108px', progress: '208px', status: '134px', rate: '124px', time: '108px' };
const COLUMN_ORDER = ['size', 'progress', 'status', 'rate', 'time'];
const DEFAULT_COLUMNS = { size: true, progress: true, status: true, rate: true, time: true };
let visibleColumns = { ...DEFAULT_COLUMNS };

function loadInterfacePrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem('redx-columns') || 'null');
    if (saved && typeof saved === 'object') visibleColumns = { ...DEFAULT_COLUMNS, ...saved };
  } catch { /* a corrupted preference must never block startup */ }
  if (!COLUMN_ORDER.some(key => visibleColumns[key])) visibleColumns = { ...DEFAULT_COLUMNS };
  applyColumns();
  applySkin(localStorage.getItem('redx-skin') || 'steel');
}

function applyColumns() {
  const tracks = ['minmax(200px, 1fr)'];
  for (const key of COLUMN_ORDER) if (visibleColumns[key]) tracks.push(COLUMN_TRACKS[key]);
  tracks.push('58px');
  // Only pin the template once the user actually customises it, so the
  // responsive breakpoints keep working for the default layout.
  if (localStorage.getItem('redx-columns')) document.documentElement.style.setProperty('--cols', tracks.join(' '));
  else document.documentElement.style.removeProperty('--cols');
  for (const key of COLUMN_ORDER) document.body.classList.toggle(`no-col-${key}`, !visibleColumns[key]);
  for (const button of $$('[data-column]')) {
    const on = Boolean(visibleColumns[button.dataset.column]);
    button.setAttribute('aria-checked', String(on));
    const mark = button.querySelector('.menu-check');
    if (mark) mark.textContent = on ? '✓' : '';
  }
}

function toggleColumn(key) {
  if (!(key in COLUMN_TRACKS)) return;
  visibleColumns[key] = !visibleColumns[key];
  if (!COLUMN_ORDER.some(name => visibleColumns[name])) visibleColumns[key] = true;
  localStorage.setItem('redx-columns', JSON.stringify(visibleColumns));
  applyColumns();
}

function applySkin(skin) {
  const known = ['steel', 'midnight', 'ice'];
  const next = known.includes(skin) ? skin : 'steel';
  document.body.dataset.skin = next;
  localStorage.setItem('redx-skin', next);
  const select = $('#set-skin');
  if (select) select.value = next;
}

/* ------------------------------------------------------------- data intake */
function acceptSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.downloads)) return;
  state.downloads = snapshot.downloads;
  state.settings = snapshot.settings || state.settings;
  state.integration = snapshot.integration || state.integration;
  applyTheme(state.settings.theme);
  trackSessionBytes();
  const valid = new Set(state.downloads.map(d => d.id));
  for (const id of [...selectedIds]) if (!valid.has(id)) selectedIds.delete(id);
  if (!valid.has(selectedId)) selectedId = null;
  if (detailId && !valid.has(detailId)) closeInspector();
  render();
}
async function refresh() {
  acceptSnapshot(await call('snapshot'));
}
function trackSessionBytes() {
  for (const d of state.downloads) {
    const previous = lastDownloaded.get(d.id);
    if (previous !== undefined && number(d.downloaded) > previous) net.session += number(d.downloaded) - previous;
    lastDownloaded.set(d.id, number(d.downloaded));
  }
  const ids = new Set(state.downloads.map(d => d.id));
  for (const id of lastDownloaded.keys()) if (!ids.has(id)) lastDownloaded.delete(id);
}

/* ------------------------------------------------------------------- list */
function matches(d) {
  const status = statusOf(d);
  if (filter === 'completed' && status !== 'complete') return false;
  if (filter === 'active' && !['queued', 'probing', 'downloading', 'assembling', 'paused', 'scheduled'].includes(status)) return false;
  if (filter === 'scheduled' && status !== 'scheduled') return false;
  if (filter === 'failed' && !['error', 'cancelled'].includes(status)) return false;
  if (category && categoryOf(d) !== category) return false;
  if (!searchTerm) return true;
  return `${d.filename || ''} ${d.url || ''} ${d.description || ''}`.toLowerCase().includes(searchTerm);
}
function sortValue(d) {
  if (sort === 'size') return number(d.total);
  if (sort === 'progress') return percentOf(d) ?? -1;
  if (sort === 'status') return statusLabel(d);
  if (sort === 'createdAt') return new Date(d.createdAt || 0).getTime();
  return String(d.filename || '').toLowerCase();
}
function computeVisible() {
  const list = state.downloads.filter(matches);
  list.sort((a, b) => {
    const left = sortValue(a), right = sortValue(b);
    const result = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right));
    return ascending ? result : -result;
  });
  return list;
}

function buildRow(d) {
  const row = el('div', 'row');
  row.dataset.id = d.id;
  row.tabIndex = 0;
  row.setAttribute('role', 'row');

  const nameCell = el('div', 'name-cell');
  const type = el('span', 'type-icon');
  const nameText = el('div', 'name-text');
  const filename = el('span', 'filename');
  const meta = el('span', 'filemeta');
  nameText.append(filename, meta);
  nameCell.append(type, nameText);

  const size = el('span', 'muted size-cell');
  const progress = el('div', 'progress-cell');
  const bar = el('div', 'bar');
  const fill = el('i');
  bar.append(fill);
  const pct = el('span', 'pct');
  bar.append(fill, pct);
  progress.append(bar);
  const speed = el('span', 'muted speed-cell');
  const time = el('span', 'muted time-cell');
  const statusCell = el('div', 'status-cell');
  const pill = el('span', 'pill');
  statusCell.append(pill);
  const actions = el('div', 'row-actions');
  const quick = el('button', 'icon-btn');
  quick.type = 'button';
  quick.dataset.act = 'quick';
  const more = el('button', 'icon-btn');
  more.type = 'button';
  more.dataset.act = 'more';
  more.append(icon('chevron'));
  more.style.transform = 'rotate(90deg)';
  actions.append(quick, more);

  row.append(nameCell, size, progress, speed, time, statusCell, actions);
  row.addEventListener('click', event => {
    if (event.target.closest('button')) return;
    select(d.id, { additive: event.ctrlKey || event.metaKey });
  });
  row.addEventListener('dblclick', () => openInspector(d.id));
  row.addEventListener('contextmenu', event => { event.preventDefault(); select(d.id); openMenu(d.id, event.clientX, event.clientY); });
  row.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); openInspector(d.id); }
    if (event.key === ' ') { event.preventDefault(); quickAction(d.id); }
  });
  quick.addEventListener('click', () => quickAction(d.id));
  more.addEventListener('click', event => { event.stopPropagation(); const rect = more.getBoundingClientRect(); openMenu(d.id, rect.left - 150, rect.bottom + 6); });

  const refs = { row, type, filename, meta, size, bar, fill, pct, speed, time, pill, quick };
  rowNodes.set(d.id, refs);
  updateRow(refs, d);
  return refs;
}

function updateRow(refs, d) {
  const status = statusOf(d), percent = percentOf(d), cat = categoryOf(d);
  const badge = badgeFor(d.filename, cat);
  refs.row.dataset.status = status;
  refs.row.classList.toggle('selected', selectedIds.has(d.id));
  refs.row.setAttribute('aria-selected', String(selectedIds.has(d.id)));
  refs.type.className = `type-icon ${badge.cls}`;
  refs.type.replaceChildren(icon(badge.glyph));
  refs.type.title = (d.filename || '').split('.').pop()?.toUpperCase() || cat;
  refs.filename.textContent = d.filename || 'Preparing file…';
  const metaParts = [cat === 'Other' ? '' : cat, sizeOf(d)];
  if (d.verification?.state === 'verified') metaParts.push('verified');
  if (d.verification?.state === 'mismatch') metaParts.push('checksum mismatch');
  if (d.needsReview) metaParts.push('needs confirmation');
  refs.meta.textContent = metaParts.filter(Boolean).join(' · ');
  refs.size.textContent = sizeOf(d);
  refs.bar.className = `bar${status === 'complete' ? ' complete' : status === 'error' ? ' failed' : ''}${percent === null && ['downloading', 'probing', 'assembling'].includes(status) ? ' indeterminate' : ''}`;
  refs.fill.style.width = percent === null ? '' : `${percent.toFixed(1)}%`;
  refs.pct.textContent = status === 'complete' ? '100%' : pctLabel(percent);
  refs.speed.textContent = status === 'downloading' || status === 'assembling' ? `${bytes(number(d.speedAvg) || number(d.speed))}/s` : '—';
  refs.time.textContent = status === 'downloading' ? (etaOf(d) || '—') : status === 'scheduled' ? new Date(d.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
  refs.pill.className = `pill ${STATUS[status][1]}`;
  refs.pill.textContent = statusLabel(d);
  refs.pill.title = d.error || statusLabel(d);
  refs.quick.replaceChildren(icon(['downloading', 'queued', 'assembling', 'probing'].includes(status) ? 'pause' : status === 'complete' ? 'folder' : 'play'));
  refs.quick.title = ['downloading', 'queued', 'assembling', 'probing'].includes(status) ? 'Pause' : status === 'complete' ? 'Open folder' : 'Resume';
  refs.row.title = `${d.filename || ''}\n${d.url || ''}${d.error ? `\n${d.error}` : ''}`;
}

function renderList() {
  const list = computeVisible();
  visible = list;
  const container = $('#download-list');
  const ids = new Set(list.map(d => d.id));
  for (const [id, refs] of rowNodes) {
    if (!ids.has(id)) { refs.row.remove(); rowNodes.delete(id); }
  }
  for (const d of list) {
    const refs = rowNodes.get(d.id) || buildRow(d);
    updateRow(refs, d);
    container.append(refs.row); // append keeps order without recreating nodes
  }
  container.setAttribute('aria-busy', 'false');
  $('#list-count').textContent = `${list.length} of ${state.downloads.length}`;
  const empty = list.length === 0;
  $('#empty-state').hidden = !empty;
  $('#table-panel').classList.toggle('is-empty', empty);
  if (empty) {
    const searching = Boolean(searchTerm || category || filter !== 'all');
    $('#empty-title').textContent = searching ? 'Nothing matches this filter' : 'No downloads yet';
    $('#empty-text').textContent = searching
      ? 'Try another search or switch back to All Downloads.'
      : 'Paste a link or press Ctrl + N to start your first download.';
    $('#empty-add').hidden = searching;
  }
}

/* ---------------------------------------------------------------- sidebar */
function renderSidebar() {
  const count = predicate => state.downloads.filter(predicate).length;
  $('#count-all').textContent = String(state.downloads.length);
  $('#count-active').textContent = String(count(d => ['queued', 'probing', 'downloading', 'assembling', 'paused'].includes(statusOf(d))));
  $('#count-completed').textContent = String(count(d => statusOf(d) === 'complete'));
  $('#count-scheduled').textContent = String(count(d => statusOf(d) === 'scheduled'));
  $('#count-failed').textContent = String(count(d => ['error', 'cancelled'].includes(statusOf(d))));
  for (const name of CATEGORIES) $(`#count-${name}`).textContent = String(count(d => categoryOf(d) === name));
  for (const button of $$('.nav-item')) {
    const active = button.dataset.category ? category === button.dataset.category : (!category && filter === button.dataset.filter);
    button.classList.toggle('active', active);
  }
  $('#queue-count').textContent = String(count(d => statusOf(d) === 'queued' || statusOf(d) === 'paused'));
  $('#scheduled-count').textContent = String(count(d => statusOf(d) === 'scheduled'));
}

function renderHeader() {
  const titles = { all: 'All Downloads', active: 'In progress', completed: 'Completed', scheduled: 'Scheduled', failed: 'Failed' };
  $('#view-title').textContent = category ? category : titles[filter] || 'Downloads';
  const totalSize = state.downloads.reduce((sum, d) => sum + number(d.total), 0);
  const completed = state.downloads.filter(d => statusOf(d) === 'complete');
  const done = completed.length;
  const doneSize = completed.reduce((sum, d) => sum + number(d.total), 0);
  $('#view-subtitle').textContent = `${state.downloads.length} ${state.downloads.length === 1 ? 'item' : 'items'} · ${bytes(totalSize)} total · ${done} completed`;
  const speed = aggregateSpeed();
  $('#foot-speed').textContent = `${bytes(speed)}/s`;
  $('#foot-size').textContent = bytes(totalSize);
  const completedCell = $('#completed-count');
  if (completedCell) completedCell.textContent = done ? `${done} (${bytes(doneSize)})` : '0';
  updateGauge(speed);
  const isBusy = state.downloads.some(d => ['downloading', 'queued', 'probing', 'assembling', 'scheduled'].includes(statusOf(d)));
  const isResumable = state.downloads.some(d => ['paused', 'error', 'cancelled', 'queued'].includes(statusOf(d)));
  const hasCompleted = state.downloads.some(d => statusOf(d) === 'complete');
  $('#pause-all').disabled = !isBusy;
  $('#resume-all').disabled = !isResumable;
  $('#remove-completed').disabled = !hasCompleted;
  if ($('#ribbon-stop-all')) $('#ribbon-stop-all').disabled = !isBusy;
  if ($('#ribbon-stop-queue')) $('#ribbon-stop-queue').disabled = !isBusy;
  if ($('#ribbon-start-queue')) $('#ribbon-start-queue').disabled = !isResumable;
  if ($('#ribbon-delete-completed')) $('#ribbon-delete-completed').disabled = !hasCompleted;
  if ($('#ribbon-delete')) $('#ribbon-delete').disabled = selectedIds.size === 0;
  for (const button of $$('[data-sort]')) {
    button.classList.toggle('sorted', sort === button.dataset.sort);
    button.classList.toggle('asc', ascending);
  }
}

function renderIntegration() {
  const info = state.integration || {};
  const connected = info.connectedBrowsers || [];
  $('#integration-dot').className = `dot ${info.connectionError ? 'warn' : connected.length ? 'on' : ''}`;
  $('#integration-label').textContent = info.connectionError ? 'Needs attention' : connected.length ? `${connected.map(b => b.browser).join(', ')} connected` : info.packaged ? 'Extension not detected' : 'Available in packaged builds';
  const target = $('#browser-status');
  if (target) target.textContent = info.connectionError ? `Setup needs attention: ${info.connectionError}` : connected.length ? `${connected.map(b => b.browser).join(', ')} connected. The extension can hand videos to RedX.` : 'No browser extension detected yet. Open Browser setup for the one-time steps.';
  const connState = $('#conn-state'), connDot = $('#conn-dot');
  if (connState) connState.textContent = info.connectionError ? 'Limited' : 'Online';
  if (connDot) connDot.classList.toggle('off', Boolean(info.connectionError));
}

/* -------------------------------------------------------------- inspector */
function openInspector(id) {
  detailId = id;
  lastDetailSignature = '';
  $('#inspector').hidden = false;
  document.body.classList.add('inspector-open');
  renderInspector(true);
}
function closeInspector() {
  detailId = null;
  $('#inspector').hidden = true;
  document.body.classList.remove('inspector-open');
}
function renderInspector(force = false) {
  if (!detailId || $('#inspector').hidden) return;
  const d = state.downloads.find(item => item.id === detailId);
  if (!d) { closeInspector(); return; }
  const signature = [d.status, d.downloaded, d.total, d.speedAvg, d.verification?.state, d.path, d.filename, d.error, d.needsReview].join('|');
  if (!force && signature === lastDetailSignature) return;
  lastDetailSignature = signature;
  const status = statusOf(d), percent = percentOf(d);
  $('#inspector-title').textContent = d.filename || 'Download details';
  const body = $('#inspector-body');
  body.replaceChildren();

  body.append(el('div', 'inspect-sub', d.url || ''));

  const progress = el('div', 'inspect-progress');
  const bar = el('div', `bar${status === 'complete' ? ' complete' : status === 'error' ? ' failed' : ''}`);
  const fill = el('i');
  fill.style.width = `${percent ?? 0}%`;
  bar.append(fill);
  const line = el('div', 'inspect-pct');
  line.append(el('span', '', `${percent === null ? '—' : `${percent.toFixed(1)}%`} of ${sizeOf(d)}`), el('span', '', statusLabel(d)));
  progress.append(bar, line);
  body.append(progress);

  const grid = el('div', 'stat-grid');
  const stats = [
    ['Downloaded', bytes(d.downloaded)],
    ['Speed', ['downloading', 'assembling'].includes(status) ? `${bytes(number(d.speedAvg) || number(d.speed))}/s` : '—'],
    ['Time left', status === 'downloading' ? etaOf(d) || 'Estimating…' : '—'],
    ['Connections', d.connections ? String(d.connections) : '—'],
    ['Resume', d.resumable === true ? 'Supported' : d.resumable === false ? 'Restart required' : 'Checking…'],
    ['Saved to', d.directory || state.settings.defaultDirectory || '—']
  ];
  if (d.scheduledAt && status === 'scheduled') stats.push(['Starts', dateTime(d.scheduledAt)]);
  for (const [label, value] of stats) {
    const stat = el('div', 'stat');
    stat.append(el('small', '', label), el('b', '', value));
    grid.append(stat);
  }
  body.append(grid);

  if (d.error) body.append(el('p', 'inspect-note error', d.error));
  if (d.needsReview) body.append(el('p', 'inspect-note', 'This browser download is waiting for confirmation. Select Resume to set the file name and folder.'));
  if (d.verification?.state === 'verified') body.append(el('p', 'inspect-note ok', 'SHA-256 verified — the file matches the expected checksum.'));
  if (d.verification?.state === 'mismatch') body.append(el('p', 'inspect-note error', `Checksum mismatch. ${d.verification.reason || ''}`));
  if (d.verification?.state === 'unavailable') body.append(el('p', 'inspect-note', 'SHA-256 calculated. No reference checksum was supplied, so integrity cannot be confirmed against an expected value.'));
  if (d.verification?.state === 'error') body.append(el('p', 'inspect-note error', `Verification failed: ${d.verification.reason || 'the file could not be read.'}`));

  if (d.sha256) {
    const hashRow = el('div', 'stat');
    hashRow.append(el('small', '', 'SHA-256'));
    const hash = el('b', 'hash', d.sha256);
    hashRow.append(hash);
    body.append(hashRow);
    const copy = el('button', 'btn small', 'Copy checksum');
    copy.type = 'button';
    copy.addEventListener('click', async () => { await call('copyText', { text: d.sha256 }); toast('SHA-256 copied.', { type: 'success' }); });
    body.append(copy);
  }

  const segments = Array.isArray(d.connectionsProgress) ? d.connectionsProgress : [];
  if (segments.length > 1 && status !== 'complete') {
    const strip = el('div', 'segment-strip');
    segments.forEach((segment, index) => {
      const row = el('div', 'segment-row');
      const barSegment = el('div', 'bar');
      const segFill = el('i');
      const total = segment.total || (segment.end !== null ? segment.end - segment.start + 1 : 0);
      segFill.style.width = total ? `${Math.min(100, (segment.downloaded / total) * 100)}%` : '0%';
      barSegment.append(segFill);
      row.append(el('span', '', `#${index + 1}`), barSegment, el('span', '', bytes(segment.downloaded)));
      strip.append(row);
    });
    body.append(strip);
  }

  const actions = el('div', 'inspect-actions');
  const addAction = (label, handler, variant = '') => {
    const button = el('button', `btn small ${variant}`.trim(), label);
    button.type = 'button';
    button.addEventListener('click', handler);
    actions.append(button);
  };
  if (['downloading', 'queued', 'probing', 'assembling'].includes(status)) addAction('Pause', () => performAction(d.id, 'pause'));
  if (['paused', 'error', 'cancelled'].includes(status)) addAction('Resume', () => performAction(d.id, ['error', 'cancelled'].includes(status) ? 'retry' : 'resume'));
  if (status === 'complete') {
    addAction('Open file', () => performAction(d.id, 'open'));
    addAction('Open folder', () => performAction(d.id, 'reveal'));
    addAction('Verify', () => verifyDownload(d.id));
  }
  if (['queued', 'paused'].includes(status)) {
    addAction('Move up', () => performAction(d.id, 'up'));
    addAction('Move down', () => performAction(d.id, 'down'));
  }
  addAction('Remove', () => removeDownload(d.id), 'danger');
  body.append(actions);
}

/* ------------------------------------------------------------- selection */
function select(id, { additive = false } = {}) {
  if (additive) { if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id); }
  else { selectedIds.clear(); if (id) selectedIds.add(id); }
  selectedId = selectedIds.has(id) ? id : [...selectedIds][0] || null;
  for (const [rowId, refs] of rowNodes) {
    const active = selectedIds.has(rowId);
    refs.row.classList.toggle('selected', active);
    refs.row.setAttribute('aria-selected', String(active));
  }
}

/* -------------------------------------------------------------- row menu */
let openMenuNode = null;
function closeMenu() { openMenuNode?.remove(); openMenuNode = null; }
function openMenu(id, x, y) {
  closeMenu();
  const d = state.downloads.find(item => item.id === id);
  if (!d) return;
  const status = statusOf(d);
  const menu = el('div', 'row-menu');
  menu.style.position = 'fixed';
  const items = [];
  if (status === 'complete') items.push(['Open file', () => performAction(id, 'open')], ['Open folder', () => performAction(id, 'reveal')], ['Verify integrity', () => verifyDownload(id)]);
  if (['downloading', 'queued', 'probing', 'assembling'].includes(status)) items.push(['Pause', () => performAction(id, 'pause')]);
  if (['paused', 'error', 'cancelled'].includes(status)) items.push(['Resume', () => performAction(id, ['error', 'cancelled'].includes(status) ? 'retry' : 'resume')]);
  if (['queued', 'paused'].includes(status)) items.push(['Move up', () => performAction(id, 'up')], ['Move down', () => performAction(id, 'down')]);
  items.push(['Remove from list', () => removeDownload(id)]);
  for (const [label, handler] of items) {
    const button = el('button', 'row-menu-item', label);
    button.type = 'button';
    button.addEventListener('click', () => { closeMenu(); handler(); });
    menu.append(button);
  }
  document.body.append(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(Math.max(8, x), innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(Math.max(8, y), innerHeight - rect.height - 8)}px`;
  openMenuNode = menu;
  setTimeout(() => document.addEventListener('pointerdown', onMenuPointer, { once: true }), 0);
}
function onMenuPointer(event) { if (!openMenuNode?.contains(event.target)) closeMenu(); }

/* ---------------------------------------------------------------- actions */
const pending = new Set();
function quickAction(id) {
  const d = state.downloads.find(item => item.id === id);
  if (!d) return;
  const status = statusOf(d);
  if (['downloading', 'queued', 'probing', 'assembling'].includes(status)) return performAction(id, 'pause');
  if (status === 'complete') return performAction(id, 'reveal');
  return performAction(id, ['error', 'cancelled'].includes(status) ? 'retry' : 'resume');
}
async function performAction(id, action, value) {
  if (pending.has(id)) return;
  pending.add(id);
  try {
    await call('action', { id, action, value });
    await refresh();
  } catch (error) {
    toast(messageOf(error), { type: 'error' });
  } finally { pending.delete(id); }
}
async function verifyDownload(id) {
  try {
    const result = await call('action', { id, action: 'verify' });
    await refresh();
    if (result?.state === 'verified') toast('SHA-256 verified — the file is intact.', { type: 'success' });
    else if (result?.state === 'mismatch') toast('Checksum mismatch. The file does not match the expected value.', { type: 'error' });
    else if (result?.state === 'unavailable') toast('SHA-256 calculated. No reference checksum was supplied.', { type: 'info', detail: result.actual || '' });
    else toast(result?.reason || 'Verification could not be completed.', { type: 'error' });
  } catch (error) { toast(messageOf(error), { type: 'error' }); }
}
async function removeDownload(id) {
  const d = state.downloads.find(item => item.id === id);
  if (!d) return;
  const ok = await confirmDialog({
    title: 'Remove download?',
    message: `“${d.filename || 'This download'}” will be removed from the list.${statusOf(d) === 'complete' ? ' The downloaded file stays on your PC.' : ' Unfinished partial data will be deleted.'}`,
    ok: 'Remove', danger: true
  });
  if (!ok) return;
  await performAction(id, 'remove');
  if (detailId === id) closeInspector();
}
async function bulkAction(action) {
  const candidates = state.downloads.filter(d => action === 'pause'
    ? ['downloading', 'queued', 'probing', 'assembling', 'scheduled'].includes(statusOf(d))
    : ['paused', 'queued', 'error', 'cancelled'].includes(statusOf(d)));
  const results = await Promise.allSettled(candidates.map(d => call('action', { id: d.id, action: action === 'resume' && ['error', 'cancelled'].includes(statusOf(d)) ? 'retry' : action })));
  const failed = results.filter(r => r.status === 'rejected');
  if (failed.length) toast(`${failed.length} item(s) could not be updated: ${messageOf(failed[0].reason)}`, { type: 'error' });
  else if (candidates.length) toast(action === 'pause' ? 'Queue stopped.' : 'Queue started.', { type: 'success' });
  await refresh();
}
function selectedDownloads() { return state.downloads.filter(d => selectedIds.has(d.id)); }

function updateBulkBar() {
  const bar = $('#bulk-bar');
  if (!bar) return;
  const count = selectedIds.size;
  bar.hidden = count === 0;
  if (!count) return;
  $('#bulk-count').textContent = String(count);
  const items = selectedDownloads();
  const active = items.filter(d => ['downloading', 'queued', 'probing', 'assembling'].includes(statusOf(d)));
  const resting = items.filter(d => ['paused', 'error', 'cancelled'].includes(statusOf(d)));
  const finished = items.filter(d => statusOf(d) === 'complete' && d.path);
  $('#bulk-pause').disabled = active.length === 0;
  $('#bulk-resume').disabled = resting.length === 0;
  $('#bulk-retry').disabled = items.filter(d => ['error', 'cancelled'].includes(statusOf(d))).length === 0;
  $('#bulk-delete').disabled = finished.length === 0;
  $('#bulk-delete').title = finished.length ? `Move ${finished.length} file(s) to the Recycle Bin` : 'No finished files selected';
}

async function bulkSelected(kind) {
  const items = selectedDownloads();
  if (!items.length) return;
  if (kind === 'remove') {
    const ok = await confirmDialog({
      title: 'Remove from the list?',
      message: `${items.length} entr${items.length === 1 ? 'y' : 'ies'} will be removed from history. Files already on disk stay where they are.`,
      ok: 'Remove entries', danger: true
    });
    if (!ok) return;
    const results = await Promise.allSettled(items.map(d => call('action', { id: d.id, action: 'remove' })));
    const failed = results.filter(r => r.status === 'rejected').length;
    if (failed) toast(`${failed} entr${failed === 1 ? 'y' : 'ies'} could not be removed.`, { type: 'error' });
    else toast(`${items.length} entr${items.length === 1 ? 'y' : 'ies'} removed from history.`, { type: 'success' });
    select(null);
    await refresh();
    return;
  }
  if (kind === 'delete') {
    const finished = items.filter(d => statusOf(d) === 'complete' && d.path);
    if (!finished.length) { toast('Only finished downloads have files to delete.', { type: 'info' }); return; }
    const ok = await confirmDialog({
      title: 'Delete files from disk?',
      message: `${finished.length} file${finished.length === 1 ? '' : 's'} will be moved to the Recycle Bin and removed from the list. Files are not erased permanently.`,
      ok: 'Move to Recycle Bin', danger: true
    });
    if (!ok) return;
    try {
      const result = await call('deleteFiles', { ids: finished.map(d => d.id) });
      toast(`${result.trashed} file${result.trashed === 1 ? '' : 's'} moved to the Recycle Bin${result.failed ? `, ${result.failed} failed` : ''}.`, { type: result.failed ? 'error' : 'success' });
      select(null);
      await refresh();
    } catch (error) { toast(messageOf(error), { type: 'error' }); }
    return;
  }
  const map = {
    pause: ['downloading', 'queued', 'probing', 'assembling'],
    resume: ['paused'],
    retry: ['error', 'cancelled']
  };
  const eligible = items.filter(d => map[kind].includes(statusOf(d)));
  if (!eligible.length) return;
  const results = await Promise.allSettled(eligible.map(d => call('action', { id: d.id, action: kind === 'retry' ? 'retry' : kind })));
  const failed = results.filter(r => r.status === 'rejected').length;
  toast(`${eligible.length - failed} of ${eligible.length} updated${failed ? `, ${failed} failed` : ''}.`, { type: failed ? 'error' : 'success' });
  await refresh();
}

async function removeCompleted() {
  const completed = state.downloads.filter(d => statusOf(d) === 'complete');
  if (!completed.length) return;
  const ok = await confirmDialog({ title: 'Clear completed downloads?', message: `${completed.length} completed item(s) will be removed from the list. The files stay on your PC.`, ok: 'Clear list', danger: true });
  if (!ok) return;
  const results = await Promise.allSettled(completed.map(d => call('action', { id: d.id, action: 'remove' })));
  const failed = results.filter(r => r.status === 'rejected');
  if (failed.length) toast(`${failed.length} item(s) could not be removed.`, { type: 'error' });
  await refresh();
}

/* --------------------------------------------------------------- network */
const net = { session: 0, history: new Array(60).fill(0), lastTs: 0, silentSince: 0 };

function aggregateSpeed() {
  return state.downloads.reduce((sum, d) => sum + (['downloading', 'assembling'].includes(statusOf(d)) ? number(d.speedAvg) || number(d.speed) : 0), 0);
}

/* LED gauge in the ribbon: MB/s with one decimal, KB/s below a megabyte. */
function updateGauge(speed) {
  const value = $('#gauge-value'), unit = $('#gauge-unit');
  if (!value || !unit) return;
  const rate = Math.max(0, Number(speed) || 0);
  if (rate >= 1048576) {
    value.textContent = (rate / 1048576).toFixed(1);
    value.classList.remove('kb');
    unit.textContent = 'MB/s';
  } else if (rate >= 1024) {
    value.textContent = String(Math.round(rate / 1024));
    value.classList.add('kb');
    unit.textContent = 'KB/s';
  } else {
    value.textContent = '0.0';
    value.classList.remove('kb');
    unit.textContent = 'MB/s';
  }
}
function sampleNetwork() {
  const now = Date.now();
  const speed = aggregateSpeed();
  if (now - net.lastTs >= 900) {
    net.history.push(speed);
    if (net.history.length > 60) net.history.shift();
    net.lastTs = now;
  }
  const active = state.downloads.filter(d => ['downloading', 'probing', 'assembling'].includes(statusOf(d))).length;
  const write = (selector, text) => { const node = $(selector); if (node) node.textContent = text; };
  updateGauge(speed);
  write('#net-now', `${bytes(speed)}/s`);
  const mean = net.history.reduce((a, b) => a + b, 0) / Math.max(1, net.history.length);
  write('#net-avg', `${bytes(mean)}/s`);
  write('#net-total', bytes(net.session));
  write('#net-active', String(active));
  const badge = $('#network-state');
  if (badge) {
    if (!active) { badge.textContent = 'Idle'; badge.className = 'badge'; net.silentSince = 0; }
    else if (speed <= 0) {
      if (!net.silentSince) net.silentSince = now;
      const waiting = now - net.silentSince > 8000;
      badge.textContent = waiting ? 'Waiting on server' : 'Connecting';
      badge.className = `badge${waiting ? ' stalled' : ''}`;
    } else { net.silentSince = 0; badge.textContent = 'Live'; badge.className = 'badge live'; }
  }
  drawGraph();
}
function drawGraph() {
  const canvas = $('#speed-graph');
  if (!canvas || canvas.offsetParent === null || document.hidden) return;
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (!width || !height) return;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  }
  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  const styles = getComputedStyle(document.documentElement);
  const grid = styles.getPropertyValue('--line-soft').trim() || '#202836';
  const peak = Math.max(...net.history, 1);
  const top = peak * 1.25;
  context.strokeStyle = grid; context.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const y = Math.round((height - 12) * i / 2) + 4;
    context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
  }
  const step = width / (net.history.length - 1);
  const points = net.history.map((value, index) => [index * step, height - 6 - (value / top) * (height - 14)]);
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, 'rgba(74,155,255,0.34)');
  gradient.addColorStop(1, 'rgba(74,155,255,0)');
  context.beginPath();
  context.moveTo(0, height);
  for (const [x, y] of points) context.lineTo(x, y);
  context.lineTo(width, height);
  context.closePath();
  context.fillStyle = gradient; context.fill();
  context.beginPath();
  points.forEach(([x, y], index) => (index ? context.lineTo(x, y) : context.moveTo(x, y)));
  context.strokeStyle = '#4a9bff'; context.lineWidth = 2; context.lineJoin = 'round'; context.stroke();
}

/* ---------------------------------------------------------------- render */
function render() {
  renderSidebar();
  renderHeader();
  updateBulkBar();
  if (progressId) { renderProgress(); return; }
  renderList();
  renderIntegration();
  if (detailId) renderInspector();
  const showGraph = state.settings.showSpeedGraph !== false;
  $('#network-panel').classList.toggle('collapsed', !showGraph);
  $('#graph-button').setAttribute('aria-pressed', String(showGraph));
  sampleNetwork();
}

/* ------------------------------------------------------------ add dialog */
function resetAddForm() {
  $('#add-error').hidden = true;
  $('#add-duplicate').hidden = true;
  $('#download-urls').readOnly = false;
  $('#download-urls').value = '';
  $('#download-checksum').value = '';
  $('#download-filename').value = '';
  $('#download-description').value = '';
  $('#download-category').value = '';
  $('#download-priority').value = '5';
  $('#download-quality').value = 'best';
  $('#download-schedule').value = '';
  $('#add-directory').value = state.settings.defaultDirectory || '';
  $('#add-title').textContent = 'New download';
}
function openAdd(text = '', scheduled = '') {
  addMode = pendingReviewId ? 'review' : 'new';
  if (addMode === 'new') resetAddForm();
  if (text) $('#download-urls').value = text;
  if (scheduled) $('#download-schedule').value = scheduled;
  openDialog('#add-dialog');
  ($('#download-urls').readOnly ? $('#download-filename') : $('#download-urls')).focus();
}
function openReview(id) {
  const d = state.downloads.find(item => item.id === id && item.needsReview);
  if (!d) return;
  pendingReviewId = id;
  resetAddForm();
  addMode = 'review';
  $('#add-title').textContent = 'Confirm browser download';
  $('#download-urls').value = d.url || '';
  $('#download-urls').readOnly = true;
  $('#download-filename').value = d.filename || '';
  $('#download-description').value = d.description || '';
  $('#download-category').value = CATEGORIES.includes(d.category) ? d.category : '';
  $('#add-directory').value = d.directory || state.settings.defaultDirectory || '';
  openDialog('#add-dialog');
}
async function dismissReview() {
  if (!pendingReviewId) return;
  const id = pendingReviewId;
  pendingReviewId = null;
  try { await call('action', { id, action: 'remove' }); await refresh(); } catch { /* already gone */ }
}
async function resolveDuplicate({ url, filename, directory }) {
  const found = await call('duplicate', { url, filename, directory });
  if (!found) return true;
  const detail = found.kind === 'complete'
    ? `“${found.filename}” was already downloaded from this link. Nothing will be overwritten; a second copy gets a numbered name.`
    : found.kind === 'active'
      ? `“${found.filename}” is already downloading from this link. Adding it again creates a separate copy.`
      : `A completed download already uses the name “${found.filename}” in this folder.`;
  return confirmDialog({ title: 'Possible duplicate', message: detail, ok: 'Add anyway', cancel: 'Keep existing' });
}

/* -------------------------------------------------------------- settings */
function settingInputs() { return $$('#settings-form [data-setting]'); }
function applySettingsToForm(settings) {
  for (const input of settingInputs()) {
    const key = input.dataset.setting;
    if (input.type === 'checkbox') input.checked = settings[key] === true;
    else input.value = settings[key] ?? '';
  }
  buildFolderGrid(settings);
  applyTheme(settings.theme);
}
function buildFolderGrid(settings) {
  const grid = $('#category-folders');
  if (!grid) return;
  grid.replaceChildren();
  grid.append(el('p', 'panel-note', 'Optional per-category folders. Leave a field empty to use the default folder.'));
  for (const name of CATEGORIES) {
    const row = el('div', 'folder-row');
    const caption = el('label', '', name);
    const input = document.createElement('input');
    input.value = settings.categoryDirectories?.[name] || '';
    input.placeholder = 'Use default folder';
    input.dataset.folder = name;
    const browse = el('button', 'btn small', 'Browse');
    browse.type = 'button';
    browse.addEventListener('click', async () => {
      try { const folder = await call('chooseDirectory'); if (typeof folder === 'string' && folder) input.value = folder; }
      catch (error) { toast(messageOf(error), { type: 'error' }); }
    });
    row.append(caption, input, browse);
    grid.append(row);
  }
}
function openSettings(section = 'appearance') {
  settingsSnapshot = { ...state.settings };
  applySettingsToForm(state.settings);
  $('#settings-state').textContent = '';
  const version = $('#settings-version');
  if (version && state.appInfo?.version) version.textContent = state.appInfo.version;
  showSettingsSection(section);
  openDialog('#settings-dialog');
}
function showSettingsSection(section) {
  for (const button of $$('.settings-nav button')) button.classList.toggle('active', button.dataset.section === section);
  for (const panel of $$('.settings-panel')) panel.hidden = panel.dataset.panel !== section;
  if (section === 'diagnostics' && !diagnosticsLoaded) loadDiagnostics();
}
async function loadDiagnostics() {
  try {
    const info = await call('diagnostics');
    diagnosticsLoaded = true;
    const list = $('#diag-list');
    list.replaceChildren();
    const rows = [
      ['Version', state.appInfo?.version || '1.0.0'],
      ['Package', info.packaged ? 'Installed build' : 'Development'],
      ['Electron', info.electron], ['Chromium', info.chrome], ['Node', info.node],
      ['System', info.platform], ['Downloads', info.downloadsFolder],
      ['Data folder', info.userData], ['Log file', info.logs]
    ];
    for (const [label, value] of rows) list.append(el('dt', '', label), el('dd', '', value));
    $('#log-tail').textContent = info.tail || 'No log entries yet.';
  } catch (error) { toast(messageOf(error), { type: 'error' }); }
}
async function saveSettings() {
  const patch = {};
  for (const input of settingInputs()) {
    const key = input.dataset.setting;
    if (input.type === 'checkbox') patch[key] = input.checked;
    else if (input.type === 'number') patch[key] = Number(input.value);
    else patch[key] = input.value.trim();
  }
  const categoryDirectories = {};
  for (const input of $$('#category-folders [data-folder]')) if (input.value.trim()) categoryDirectories[input.dataset.folder] = input.value.trim();
  patch.categoryDirectories = categoryDirectories;
  $('#settings-save').disabled = true;
  try {
    await call('settings', patch);
    await refresh();
    settingsSnapshot = { ...state.settings };
    $('#settings-state').textContent = 'Saved';
    setTimeout(() => { const node = $('#settings-state'); if (node) node.textContent = ''; }, 2500);
  } catch (error) {
    $('#settings-state').textContent = messageOf(error);
  } finally { $('#settings-save').disabled = false; }
}

/* ------------------------------------------------------------- scheduler */
function renderScheduler() {
  const list = $('#scheduled-list');
  if (!list) return;
  const scheduled = state.downloads.filter(d => statusOf(d) === 'scheduled').sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  list.replaceChildren();
  if (!scheduled.length) { list.append(el('p', 'field-help', 'No scheduled downloads. Add a link with a start time to plan one.')); return; }
  for (const d of scheduled) {
    const row = el('div', 'scheduled-item');
    const name = el('span', '', d.filename || d.url);
    name.title = d.url || '';
    row.append(name, el('time', '', dateTime(d.scheduledAt)));
    list.append(row);
  }
}

/* ----------------------------------------------------------- integration */
let integrationPoll = null;
async function openIntegration() {
  openDialog('#integration-dialog');
  await refreshIntegration();
  clearInterval(integrationPoll);
  integrationPoll = setInterval(() => { if ($('#integration-dialog').open) refreshIntegration(); else clearInterval(integrationPoll); }, 3000);
}
async function refreshIntegration() {
  try {
    const info = await call('integration') || state.integration;
    state.integration = info;
    renderIntegration();
    $('#extension-path').value = info.extensionPath || '';
    $('#integration-port').value = info.port ? `127.0.0.1:${info.port}` : 'Unavailable';
    $('#automatic-connection').textContent = info.connectionError
      ? `Setup needs attention: ${info.connectionError}`
      : info.connectedBrowsers?.length
        ? `${info.connectedBrowsers.map(b => b.browser).join(', ')} connected. Reload your video page to see the RedX button.`
        : info.packaged ? 'Waiting for the extension. Load it once and RedX connects automatically.' : 'Run the packaged app to connect a browser automatically.';
  } catch (error) { $('#automatic-connection').textContent = messageOf(error); }
}

/* ----------------------------------------------------------------- about */
async function openAbout() {
  if (!state.appInfo) state.appInfo = await call('appInfo').catch(() => null);
  if (state.appInfo?.version) $('#about-version').textContent = `Version ${state.appInfo.version}`;
  openDialog('#about-dialog');
}

/* -------------------------------------------------------------- progress */
function renderProgress() {
  const d = state.downloads.find(item => item.id === progressId);
  if (!d) return;
  const status = statusOf(d), percent = percentOf(d);
  const labels = { queued: 'Queued', scheduled: 'Scheduled', probing: 'Connecting', downloading: 'Downloading', assembling: 'Finishing', paused: 'Paused', complete: 'Complete', error: 'Failed', cancelled: 'Cancelled' };
  const pill = $('#p-status');
  pill.textContent = labels[status] || 'Working';
  pill.className = 'p-status' + (status === 'complete' ? ' complete' : ['error', 'cancelled'].includes(status) ? ' failed' : status === 'paused' ? ' paused' : '');
  $('#p-title').textContent = d.filename || 'Preparing…';
  $('#p-title').title = d.path || d.directory || '';
  $('#p-sub').textContent = d.qualityNote || d.error || d.path || d.directory || '';
  const urlField = $('#p-url');
  if (document.activeElement !== urlField) urlField.value = d.sourceUrl || d.url || '';
  const percentText = percent === null ? (status === 'complete' ? '100%' : '—') : `${Math.floor(percent)}%`;
  $('#p-pct').textContent = percentText;
  const headPercent = $('#p-pct-head');
  if (headPercent) headPercent.textContent = percentText;
  $('#p-bar').style.width = percent === null ? '0%' : `${percent}%`;
  $('#p-bar').parentElement.className = `bar large${status === 'complete' ? ' complete' : status === 'error' ? ' failed' : ''}`;
  const stateText = {
    downloading: 'Receiving data…', assembling: 'Finishing the file…', probing: 'Connecting…',
    queued: 'Queued — waiting for a free slot', scheduled: 'Scheduled for later',
    paused: 'Paused — resume to continue', complete: 'Complete', error: 'Failed', cancelled: 'Cancelled'
  }[status] || 'Working…';
  const stateNode = $('#p-state');
  if (stateNode) {
    stateNode.textContent = stateText;
    stateNode.className = status === 'complete' ? 'p-green' : ['error', 'cancelled'].includes(status) ? 'p-red' : status === 'paused' ? 'p-amber' : 'p-blue';
  }
  $('#p-total').textContent = sizeOf(d);
  $('#p-size').textContent = `${bytes(d.downloaded)}${percent === null ? '' : ` — ${Math.floor(percent)}%`}`;
  $('#p-speed').textContent = ['downloading', 'assembling'].includes(status) ? `${bytes(number(d.speedAvg) || number(d.speed))}/s` : '—';
  $('#p-eta').textContent = status === 'downloading' ? (etaOf(d) || 'Estimating…') : '—';
  $('#p-resume-cap').textContent = d.resumable === true ? 'Yes' : d.resumable === false ? 'No — restart' : 'Checking…';
  $('#p-conn').textContent = d.connections ? String(d.connections) : '—';
  if (document.activeElement !== $('#p-limit')) $('#p-limit').value = String(d.speedLimitKbps || 0);
  if (document.activeElement !== $('#p-oncomplete')) $('#p-oncomplete').value = d.onComplete || 'default';

  const segments = Array.isArray(d.connectionsProgress) ? d.connectionsProgress : [];
  const strip = $('#p-segments');
  const showStreams = segments.length > 1 && segments.length <= 64;
  const streamsSection = strip.parentElement;
  if (streamsSection) streamsSection.hidden = !showStreams;
  strip.replaceChildren();
  if (showStreams) {
    $('#p-streams-title').textContent = `Start positions and download progress by connections (${segments.length} Streams)`;
    segments.forEach((segment, index) => {
      const row = el('div', 'stream');
      const track = el('div', 'stream-bar');
      const fill = el('i');
      const total = segment.total || (segment.end !== null ? segment.end - segment.start + 1 : 0);
      const ratio = total ? Math.min(100, segment.downloaded / total * 100) : 0;
      fill.style.width = `${ratio}%`;
      if (ratio <= 0) track.classList.add('empty');
      track.append(fill);
      row.append(el('span', 'stream-no', String(index + 1)), track);
      row.title = `${bytes(segment.downloaded)}${total ? ` of ${bytes(total)}` : ''}`;
      strip.append(row);
    });
  }

  const note = $('#p-note');
  note.className = `progress-note${d.error ? ' error' : ''}`;
  note.textContent = d.error || (status === 'complete'
    ? `${d.verification?.state === 'verified' ? 'SHA-256 verified. ' : d.verification?.state === 'unavailable' ? 'SHA-256 calculated; no reference checksum. ' : ''}Saved to ${d.path || d.directory}`
    : d.needsReview ? 'Waiting for confirmation in the main window.' : d.resumable === false ? 'This source cannot resume; a restart begins again.' : 'Every byte is checkpointed, so this download survives a restart.');

  const details = $('#p-details');
  if (!details.hidden) {
    details.replaceChildren();
    const line = (label, value, mono) => {
      const row = el('div', 'row-line');
      row.append(el('span', '', label), el('b', mono ? 'hash' : '', value));
      details.append(row);
    };
    if (segments.length) {
      line('Connections', String(segments.length));
      segments.forEach((segment, index) => line(`Segment ${index + 1}`, `${bytes(segment.downloaded)}${segment.total ? ` / ${bytes(segment.total)}` : ''}`));
    }
    if (d.retryCount) line('Retries', String(d.retryCount));
    if (d.lastError) line('Last error', d.lastError);
    line('Resume', d.resumable === true ? 'Byte ranges + validator' : d.resumable === false ? 'Restart required' : 'Checking…');
    line('Folder', d.directory || '—');
    if (d.sha256) line('SHA-256', d.sha256, true);
    if (!details.childElementCount) details.append(el('span', '', 'No connection details yet.'));
  }

  const canPause = ['downloading', 'queued', 'probing', 'assembling'].includes(status);
  const pause = $('#p-pause');
  pause.textContent = canPause ? 'Pause' : ['paused', 'error', 'cancelled'].includes(status) ? 'Resume' : 'Finished';
  pause.disabled = status === 'complete';
  $('#p-cancel').hidden = status === 'complete';
  $('#p-open').hidden = status !== 'complete';
  document.title = status === 'complete' ? `Complete — ${d.filename}` : `${percent === null ? '' : `${Math.floor(percent)}% — `}${d.filename}`;
}

/* -------------------------------------------------------------- menu bar */
function wireMenus() {
  const menubar = $('#menubar');
  if (!menubar) return;
  const closeAll = () => {
    for (const menu of $$('.menu', menubar)) {
      menu.classList.remove('open');
      $('.menu-btn', menu).setAttribute('aria-expanded', 'false');
    }
  };
  const extra = {
    exit: () => call('windowControl', 'close'),
    selectAll: () => {
      if (!visible.length) return;
      selectedIds.clear();
      for (const d of visible) selectedIds.add(d.id);
      selectedId = visible[0]?.id || null;
      render();
    },
    verify: () => { if (selectedId) verifyDownload(selectedId); else toast('Select a download first.', { type: 'info' }); },
    openLogs: () => call('openLogs').catch(error => toast(messageOf(error), { type: 'error' })),
    toggleNetwork: async () => {
      const next = state.settings.showSpeedGraph === false;
      try { await call('settings', { showSpeedGraph: next }); await refresh(); }
      catch (error) { toast(messageOf(error), { type: 'error' }); }
    },
    toggleSidebar: () => document.body.classList.toggle('sidebar-collapsed'),
    fullscreen: () => call('windowControl', 'fullscreen').catch(() => {})
  };
  for (const button of $$('[data-column]', menubar)) {
    button.addEventListener('click', event => {
      event.stopPropagation();
      toggleColumn(button.dataset.column);
    });
  }
  for (const menu of $$('.menu', menubar)) {
    const button = $('.menu-btn', menu);
    button.addEventListener('click', event => {
      event.stopPropagation();
      const open = !menu.classList.contains('open');
      closeAll();
      if (open) { menu.classList.add('open'); button.setAttribute('aria-expanded', 'true'); }
    });
    button.addEventListener('pointerenter', () => {
      if (!menubar.querySelector('.menu.open') || menu.classList.contains('open')) return;
      closeAll();
      menu.classList.add('open');
      button.setAttribute('aria-expanded', 'true');
    });
    for (const item of $$('[data-command]', menu)) {
      item.addEventListener('click', () => {
        closeAll();
        const command = item.dataset.command;
        if (extra[command]) extra[command]();
        else handleCommand(command);
      });
    }
  }
  document.addEventListener('pointerdown', event => { if (!menubar.contains(event.target)) closeAll(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeAll(); });
}

/* ------------------------------------------------------------------ boot */
function wireStaticHandlers() {
  $('#win-min').addEventListener('click', () => call('windowControl', 'minimize'));
  $('#win-max').addEventListener('click', () => call('windowControl', 'maximize'));
  $('#win-close').addEventListener('click', () => call('windowControl', 'close'));
  // A frameless window has to emulate the title-bar gestures Windows users expect.
  $('#titlebar').addEventListener('dblclick', event => {
    if (event.target.closest('.window-controls')) return;
    call('windowControl', 'maximize').catch(() => {});
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'F11') { event.preventDefault(); call('windowControl', 'fullscreen').catch(() => {}); }
  });
  $('#set-skin')?.addEventListener('change', event => applySkin(event.target.value));
  wireMenus();
  $('#sidebar-collapse')?.addEventListener('click', () => document.body.classList.toggle('sidebar-collapsed'));

  // IDM Ribbon Command Bar
  $('#ribbon-add')?.addEventListener('click', () => openAdd());
  $('#ribbon-resume')?.addEventListener('click', () => {
    if (selectedIds.size) bulkSelected('resume');
    else bulkAction('resume');
  });
  $('#ribbon-stop')?.addEventListener('click', () => {
    if (selectedIds.size) bulkSelected('pause');
    else bulkAction('pause');
  });
  $('#ribbon-stop-all')?.addEventListener('click', () => bulkAction('pause'));
  $('#ribbon-delete')?.addEventListener('click', () => {
    if (selectedIds.size) bulkSelected('remove');
  });
  $('#ribbon-delete-completed')?.addEventListener('click', removeCompleted);
  $('#ribbon-options')?.addEventListener('click', () => openSettings());
  $('#ribbon-scheduler')?.addEventListener('click', () => { renderScheduler(); openDialog('#scheduler-dialog'); });
  $('#ribbon-start-queue')?.addEventListener('click', () => bulkAction('resume'));
  $('#ribbon-stop-queue')?.addEventListener('click', () => bulkAction('pause'));

  $('#new-download')?.addEventListener('click', () => openAdd());
  $('#empty-add')?.addEventListener('click', () => openAdd());
  $('#settings-button')?.addEventListener('click', () => openSettings());
  $('#about-button')?.addEventListener('click', openAbout);
  $('#integration-button')?.addEventListener('click', openIntegration);
  $('#scheduler-button')?.addEventListener('click', () => { renderScheduler(); openDialog('#scheduler-dialog'); });
  $('#resume-all')?.addEventListener('click', () => bulkAction('resume'));
  $('#pause-all')?.addEventListener('click', () => bulkAction('pause'));
  $('#remove-completed')?.addEventListener('click', removeCompleted);
  $('#graph-button').addEventListener('click', async () => {
    const next = state.settings.showSpeedGraph === false;
    try { await call('settings', { showSpeedGraph: next }); await refresh(); } catch (error) { toast(messageOf(error), { type: 'error' }); }
  });
  $('#inspector-close').addEventListener('click', closeInspector);
  $('#bulk-select-all').addEventListener('click', () => { selectedIds.clear(); for (const d of visible) selectedIds.add(d.id); selectedId = visible[0]?.id || null; render(); });
  $('#bulk-clear').addEventListener('click', () => { select(null); render(); });
  $('#bulk-pause').addEventListener('click', () => bulkSelected('pause'));
  $('#bulk-resume').addEventListener('click', () => bulkSelected('resume'));
  $('#bulk-retry').addEventListener('click', () => bulkSelected('retry'));
  $('#bulk-remove').addEventListener('click', () => bulkSelected('remove'));
  $('#bulk-delete').addEventListener('click', () => bulkSelected('delete'));
  $('#about-open').addEventListener('click', openAbout);

  for (const button of $$('.nav-item')) {
    button.addEventListener('click', () => {
      if (button.dataset.category) { category = category === button.dataset.category ? '' : button.dataset.category; filter = 'all'; }
      else { filter = button.dataset.filter; category = ''; }
      render();
    });
  }
  for (const button of $$('[data-sort]')) {
    button.addEventListener('click', () => {
      const next = button.dataset.sort;
      ascending = sort === next ? !ascending : true;
      sort = next;
      render();
    });
  }
  $('#search').addEventListener('input', event => { searchTerm = event.target.value.trim().toLowerCase(); render(); });

  for (const button of $$('[data-close]')) {
    button.addEventListener('click', () => {
      const dialog = button.closest('dialog');
      dialog.close();
      if (dialog.id === 'add-dialog') {
        if (pendingReviewId) dismissReview();
        pendingReviewId = null;
      }
      if (dialog.id === 'settings-dialog' && settingsSnapshot) applyTheme(settingsSnapshot.theme);
    });
  }

  $('#paste-button').addEventListener('click', async () => {
    try { $('#download-urls').value = await call('clipboard'); }
    catch (error) { $('#add-error').textContent = messageOf(error); $('#add-error').hidden = false; }
  });
  $('#add-browse').addEventListener('click', async () => {
    try { const folder = await call('chooseDirectory'); if (folder) $('#add-directory').value = folder; }
    catch (error) { toast(messageOf(error), { type: 'error' }); }
  });
  $('#download-category').addEventListener('change', event => {
    const folder = state.settings.categoryDirectories?.[event.target.value];
    if (folder) $('#add-directory').value = folder;
  });
  $('#add-form').addEventListener('submit', submitAdd);

  $$('.settings-nav button').forEach(button => button.addEventListener('click', () => showSettingsSection(button.dataset.section)));
  $('#settings-save').addEventListener('click', saveSettings);
  $('#set-theme').addEventListener('change', event => applyTheme(event.target.value));
  $('#choose-directory').addEventListener('click', async () => {
    try { const folder = await call('chooseDirectory'); if (folder) $('#set-directory').value = folder; }
    catch (error) { toast(messageOf(error), { type: 'error' }); }
  });
  $('#open-scheduler').addEventListener('click', () => { $('#settings-dialog').close(); renderScheduler(); openDialog('#scheduler-dialog'); });
  $('#start-queue').addEventListener('click', () => bulkAction('resume'));
  $('#stop-queue').addEventListener('click', () => bulkAction('pause'));
  $('#open-integration').addEventListener('click', () => { $('#settings-dialog').close(); openIntegration(); });
  $('#copy-extension').addEventListener('click', async () => {
    try { await call('browserSetup', { action: 'copy' }); toast('Extension folder path copied.', { type: 'success' }); }
    catch (error) { toast(messageOf(error), { type: 'error' }); }
  });
  $('#open-logs').addEventListener('click', async () => { try { await call('openLogs'); } catch (error) { toast(messageOf(error), { type: 'error' }); } });
  $('#copy-diagnostics').addEventListener('click', async () => {
    try {
      const info = await call('diagnostics');
      await call('copyText', { text: JSON.stringify({ version: state.appInfo?.version, ...info }, null, 2) });
      toast('Diagnostics copied.', { type: 'success' });
    } catch (error) { toast(messageOf(error), { type: 'error' }); }
  });

  $('#open-chrome').addEventListener('click', () => call('browserSetup', { action: 'open', browser: 'Chrome' }).catch(error => toast(messageOf(error), { type: 'error' })));
  $('#open-edge').addEventListener('click', () => call('browserSetup', { action: 'open', browser: 'Edge' }).catch(error => toast(messageOf(error), { type: 'error' })));
  $('#copy-folder').addEventListener('click', () => call('browserSetup', { action: 'copy' }).then(() => toast('Extension folder path copied.', { type: 'success' })).catch(error => toast(messageOf(error), { type: 'error' })));
  $('#show-folder').addEventListener('click', () => call('browserSetup', { action: 'folder' }).catch(error => toast(messageOf(error), { type: 'error' })));

  $('#schedule-new').addEventListener('click', () => {
    $('#scheduler-dialog').close();
    const future = new Date(Date.now() + 3600000);
    openAdd('', new Date(future.getTime() - future.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  });
  $('#scheduler-start').addEventListener('click', () => bulkAction('resume'));
  $('#scheduler-stop').addEventListener('click', () => bulkAction('pause'));

  document.addEventListener('keydown', event => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); if (!$$('dialog[open]').length) openAdd(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); $('#search').focus(); $('#search').select(); }
    else if ((event.ctrlKey || event.metaKey) && event.key === ',') { event.preventDefault(); openSettings(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && !typing && visible.length) {
      event.preventDefault(); selectedIds.clear(); for (const d of visible) selectedIds.add(d.id); selectedId = visible[0]?.id || null; render();
    }
    else if (event.key === 'Escape') { closeMenu(); }
    else if (!typing && event.key === 'Delete' && selectedId) { event.preventDefault(); removeDownload(selectedId); }
    else if (!typing && event.key === ' ' && selectedId) { event.preventDefault(); quickAction(selectedId); }
    else if (!typing && event.key === 'ArrowDown') {
      if (!visible.length) return;
      event.preventDefault();
      const index = visible.findIndex(d => d.id === selectedId);
      const next = visible[Math.min(visible.length - 1, index + 1)] || visible[0];
      select(next.id); rowNodes.get(next.id)?.row.scrollIntoView({ block: 'nearest' });
    } else if (!typing && event.key === 'ArrowUp') {
      if (!visible.length) return;
      event.preventDefault();
      const index = visible.findIndex(d => d.id === selectedId);
      const next = visible[Math.max(0, index - 1)] || visible[0];
      select(next.id); rowNodes.get(next.id)?.row.scrollIntoView({ block: 'nearest' });
    }
  });
  window.addEventListener('resize', () => drawGraph());
}

async function submitAdd(event) {
  event.preventDefault();
  const error = $('#add-error');
  error.hidden = true;
  const urls = $('#download-urls').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  const filename = $('#download-filename').value.trim();
  const scheduled = $('#download-schedule').value;
  const checksum = $('#download-checksum').value.trim();
  const directory = $('#add-directory').value;
  const selectedCategory = $('#download-category').value;
  const priority = Number($('#download-priority').value);
  const preferredQuality = $('#download-quality').value;
  const queueOnly = event.submitter?.value === 'later';
  const submitButtons = [$('#add-submit'), $('#add-later')];
  try {
    if (!urls.length) throw new Error('Enter at least one download address.');
    for (const value of urls) {
      let parsed;
      try { parsed = new URL(value); } catch { throw new Error(`Invalid address: ${value}`); }
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Download addresses must begin with http:// or https://.');
    }
    if (filename && urls.length !== 1) throw new Error('A custom file name can only be used for a single address.');
    if (checksum && !/^[a-f0-9]{64}$/i.test(checksum)) throw new Error('A SHA-256 checksum must be 64 hexadecimal characters.');
    const scheduledAt = scheduled ? new Date(scheduled).toISOString() : undefined;
    if (scheduledAt && new Date(scheduledAt).getTime() <= Date.now()) throw new Error('Choose a future start time or leave the start field empty.');
    submitButtons.forEach(button => { if (button) button.disabled = true; });
    let allowDuplicate = false;
    if (addMode === 'new' && urls.length === 1) allowDuplicate = await resolveDuplicate({ url: urls[0], filename: filename || undefined, directory: directory || undefined });
    if (addMode === 'new' && urls.length === 1 && !allowDuplicate) return;
    const payload = {
      ...(filename ? { filename } : {}), ...(scheduledAt ? { scheduledAt } : {}),
      ...(directory ? { directory } : {}), ...(selectedCategory ? { category: selectedCategory } : {}),
      ...(checksum ? { expectedSha256: checksum } : {}), priority, preferredQuality, description: $('#download-description').value.trim()
    };
    const ids = addMode === 'review'
      ? await call('review', { id: pendingReviewId, ...payload, queueOnly })
      : await call('add', { urls, ...payload, queueOnly, allowDuplicate: urls.length > 1 ? true : allowDuplicate });
    pendingReviewId = null;
    $('#add-dialog').close();
    await refresh();
    if (ids?.length) { select(ids[0]); if (!queueOnly && !scheduledAt && !progressId) openInspector(ids[0]); }
    toast(queueOnly ? 'Added to the queue.' : scheduledAt ? 'Scheduled.' : 'Download started.', { type: 'success', detail: urls.length > 1 ? `${urls.length} addresses` : urls[0] });
  } catch (err) {
    error.textContent = messageOf(err);
    error.hidden = false;
  } finally { submitButtons.forEach(button => { if (button) button.disabled = false; }); }
}

function handleCommand(payload) {
  const command = typeof payload === 'string' ? payload : payload?.command;
  if (command === 'queued') {
    refresh().then(() => {
      toast('Added to the queue', { type: 'info', detail: 'Start the queue when you are ready.', actions: [{ label: 'Start queue', onClick: () => bulkAction('resume') }] });
      if (payload?.id) select(payload.id);
    }).catch(() => {});
    return;
  }
  if (command === 'reviewDownload') {
    refresh().then(() => { if (!$$('dialog[open]').length) openReview(payload.id); }).catch(() => {});
    return;
  }
  if ($$('dialog[open]').length && !['pauseAll', 'resumeAll', 'removeCompleted', 'about'].includes(command)) return;
  const actions = {
    add: () => openAdd(), paste: async () => { try { openAdd(await call('clipboard')); } catch (error) { toast(messageOf(error), { type: 'error' }); } },
    details: () => { if (selectedId) openInspector(selectedId); }, remove: () => { if (selectedId) removeDownload(selectedId); },
    removeCompleted, pauseAll: () => bulkAction('pause'), resumeAll: () => bulkAction('resume'),
    find: () => { $('#search').focus(); $('#search').select(); }, settings: () => openSettings(),
    scheduler: () => { renderScheduler(); openDialog('#scheduler-dialog'); }, integration: openIntegration, about: openAbout,
    diagnostics: () => openSettings('diagnostics'),
    all: () => { filter = 'all'; category = ''; render(); }
  };
  actions[command]?.();
}

async function boot() {
  wireStaticHandlers();
  loadInterfacePrefs();
  if (progressId) {
    document.body.classList.add('progress-window');
    $('#progress-view').hidden = false;
    $('#app').hidden = true;
    $('#titlebar').hidden = true;
    const current = () => state.downloads.find(item => item.id === progressId);
    const act = async (action, value) => {
      const d = current();
      if (d) await performAction(d.id, action, value);
    };
    $('#p-close').addEventListener('click', () => call('closeProgress'));
    $('#p-min').addEventListener('click', () => call('windowControl', 'minimize'));
    $('#p-copy').addEventListener('click', async () => {
      const d = current();
      if (!d) return;
      try { await call('copyText', { text: d.sourceUrl || d.url || '' }); toast('Address copied.', { type: 'success' }); }
      catch (error) { toast(messageOf(error), { type: 'error' }); }
    });
    $('#p-folder').addEventListener('click', () => act('reveal'));
    $('#p-open').addEventListener('click', () => act('open'));
    $('#p-main').addEventListener('click', async () => { await call('openMain'); await call('closeProgress'); });
    $('#p-pause').addEventListener('click', () => {
      const d = current(); if (!d) return;
      const status = statusOf(d);
      act(['downloading', 'queued', 'probing', 'assembling'].includes(status) ? 'pause' : ['error', 'cancelled'].includes(status) ? 'retry' : 'resume');
    });
    // Cancelling is destructive, so it asks first; closing the window never does.
    $('#p-cancel').addEventListener('click', async () => {
      const d = current(); if (!d) return;
      const ok = await confirmDialog({ title: 'Cancel this download?', message: 'Partial data for this download will be deleted. The window will stay open until you close it.', ok: 'Cancel download', cancel: 'Keep downloading', danger: true });
      if (ok) await act('cancel');
    });
    $('#p-toggle').addEventListener('click', async () => {
      const details = $('#p-details');
      const open = details.hidden;
      details.hidden = !open;
      $('#p-toggle').setAttribute('aria-expanded', String(open));
      try { await call('resizeProgress', { expanded: open }); } catch { /* window closing */ }
      renderProgress();
    });
    $('#p-limit').addEventListener('change', event => act('limit', Number(event.target.value)));
    $('#p-oncomplete').addEventListener('change', event => act('onComplete', event.target.value === 'default' ? 'none' : event.target.value));
    for (const tab of $$('.p-tabs button')) {
      tab.addEventListener('click', () => {
        for (const other of $$('.p-tabs button')) {
          const active = other === tab;
          other.classList.toggle('active', active);
          other.setAttribute('aria-selected', String(active));
        }
        for (const panel of $$('.p-panel')) panel.hidden = panel.dataset.ppanel !== tab.dataset.ptab;
      });
    }
  }
  try {
    state.appInfo = await call('appInfo').catch(() => null);
    const version = state.appInfo?.version;
    if (version) {
      const badge = $('#brand-version');
      if (badge) badge.textContent = version;
      const aboutVersion = $('#about-version');
      if (aboutVersion) aboutVersion.textContent = `Version ${version}`;
      const settingsVersion = $('#settings-version');
      if (settingsVersion) settingsVersion.textContent = version;
    }
    await refresh();
  } catch (error) {
    toast(messageOf(error), { type: 'error' });
  }
  if (typeof api.subscribe === 'function') api.subscribe(snapshot => { if (snapshot?.downloads) acceptSnapshot(snapshot); });
  if (typeof api.onCommand === 'function') api.onCommand(handleCommand);
  if (typeof api.onClipboardLink === 'function') {
    api.onClipboardLink(({ url }) => {
      if (!url || progressId) return;
      toast('Download link detected', { type: 'info', detail: url, timeout: 20000, actions: [{ label: 'Download now', onClick: () => openAdd(url) }] });
    });
  }
  if (typeof api.onWindowState === 'function') {
    api.onWindowState(({ maximized }) => {
      const button = $('#win-max');
      button.replaceChildren(icon(maximized ? 'restore' : 'square'));
      button.setAttribute('aria-label', maximized ? 'Restore' : 'Maximise');
    });
  }
  setInterval(sampleNetwork, 1000);
  if (!progressId && state.integration.packaged && !state.integration.connectedBrowsers?.length && !localStorage.getItem('redx-browser-intro')) {
    localStorage.setItem('redx-browser-intro', '1');
    setTimeout(() => { if (!$$('dialog[open]').length) openIntegration(); }, 900);
  }
}

boot();
