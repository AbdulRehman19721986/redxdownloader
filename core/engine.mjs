import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { validUrl, cleanHeaders, request, probe } from './http.mjs';
import { resolveHls, scopedHeaders } from './hls.mjs';
import { youtubeUrl, downloadYoutube } from './youtube.mjs';
import { streamProgress } from './stream-progress.mjs';
import { downloadSabr, normalizeSabrSession } from './sabr.mjs';
import { providerFor, resolvePageMedia, pickVariant, QUALITY_ORDER, isEphemeralMediaUrl } from './extract.mjs';
import { ytdlpFormats, ytdlpDownload } from './ytdlp.mjs';

const TRANSIENT = new Set(['downloading', 'probing', 'assembling']);
const ACTIVE = new Set(['queued', 'scheduled', 'probing', 'downloading', 'assembling']);
const SETTLED = new Set(['complete', 'cancelled', 'error']);
export const CATEGORY_PATTERNS = {
  Video: /\.(mp4|webm|mkv|mov|avi|m4v|flv|wmv)$/i,
  Audio: /\.(mp3|m4a|aac|flac|ogg|wav|opus|wma)$/i,
  Archives: /\.(zip|7z|rar|tar|gz|tgz|bz2|iso|xz)$/i,
  Documents: /\.(pdf|docx?|xlsx?|pptx?|txt|csv|epub|odt|rtf)$/i,
  Programs: /\.(exe|msi|msix|appx|apk|dmg|pkg|deb|rpm)$/i,
  Images: /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|tiff?)$/i
};
export const CATEGORIES = [...Object.keys(CATEGORY_PATTERNS), 'Other'];
const categoryFor = name => Object.entries(CATEGORY_PATTERNS).find(([, re]) => re.test(name))?.[0] || 'Other';

export function safeFilename(value) {
  let name = path.win32.basename(String(value || 'download')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 180);
  if (!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `download_${name || 'file'}`;
  return name;
}
function suggestedName(url, disposition) {
  const utf = /filename\*=UTF-8''([^;]+)/i.exec(disposition || '');
  const plain = /filename="([^"]+)"|filename=([^;]+)/i.exec(disposition || '');
  try { return safeFilename(utf ? decodeURIComponent(utf[1]) : plain ? (plain[1] || plain[2]).trim() : decodeURIComponent(new URL(url).pathname.split('/').pop()) || 'download'); }
  catch { return 'download'; }
}
export function normalizeUrl(value) {
  try { const url = new URL(value); url.hash = ''; return url.href; } catch { return String(value || ''); }
}
export async function hashFile(file, signal) {
  const hash = createHash('sha256');
  const handle = await fs.open(file, 'r');
  try {
    const stream = handle.createReadStream({ highWaterMark: 1024 * 1024 });
    for await (const chunk of stream) { signal?.throwIfAborted(); hash.update(chunk); }
  } finally { await handle.close(); }
  return hash.digest('hex');
}
const checksumOf = value => (typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value.trim()) ? value.trim().toLowerCase() : null);
const pct = (a, b) => (b ? Math.min(100, Math.max(0, a / b * 100)) : null);

export class DownloadEngine extends EventEmitter {
  constructor({ dataDirectory, downloadDirectory, tickMs = 500, resolvePage }) {
    super();
    // Injectable so provider resolution can be tested without the network.
    this.resolvePage = resolvePage || ((value, options) => resolvePageMedia(value, options));
    // An explicitly injected resolver takes precedence over the bundled extractor.
    this.resolvePageOverride = Boolean(resolvePage);
    this.dataDirectory = dataDirectory;
    this.statePath = path.join(dataDirectory, 'downloads.json');
    this.partsDirectory = path.join(dataDirectory, 'parts');
    this.settings = {
      defaultDirectory: downloadDirectory,
      maxConcurrent: 3,
      connections: 8,
      speedLimitKbps: 0,
      categoryDirectories: {},
      notifyOnComplete: true,
      revealOnComplete: false,
      confirmBrowserDownloads: true,
      // 'auto' starts a browser download immediately after the quality choice,
      // 'ask' keeps a confirmation step, 'queue' adds it without transferring.
      browserStartBehavior: 'auto',
      // Optional: let the extractor borrow the user's own browser session for
      // sources that need it. Only the browser name is stored.
      cookiesFromBrowser: '',
      hideCompletionDialog: false,
      theme: 'dark',
      clipboardMonitor: false,
      organizeByCategory: false,
      verifyAfterDownload: true,
      stallTimeoutSec: 25,
      retryLimit: 4,
      showSpeedGraph: true
    };
    this.downloads = [];
    this.jobs = new Map();
    this.persistChain = Promise.resolve();
    this.persistAt = 0;
    this.tickMs = tickMs;
    this.closing = false;
    this.rateTail = Promise.resolve();
    this.rateNext = new Map();
    this.sequence = 0;
  }

  async init() {
    await fs.mkdir(this.partsDirectory, { recursive: true });
    try {
      const state = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
      this.updateSettings(state.settings || {}, false);
      this.downloads = (state.downloads || []).map(d => this.upgradeRecord(d));
    } catch (error) { if (error.code !== 'ENOENT') throw new Error(`Could not load download history: ${error.message}`); }
    this.timer = setInterval(() => this.tick(), this.tickMs);
    this.timer.unref();
    this.tick();
    return this;
  }

  /* Downloads saved by earlier versions are upgraded in place: no data is
     dropped, and a download interrupted by the upgrade keeps its partial file. */
  upgradeRecord(d) {
    const status = TRANSIENT.has(d.status) ? 'paused' : d.status;
    return {
      ...d,
      status,
      speed: 0,
      speedAvg: 0,
      priority: Number.isInteger(d.priority) ? d.priority : 5,
      queuePosition: Number.isFinite(d.queuePosition) ? d.queuePosition : new Date(d.createdAt || Date.now()).getTime(),
      directory: d.directory || this.settings.defaultDirectory,
      expectedSha256: checksumOf(d.expectedSha256) || null,
      sha256: typeof d.sha256 === 'string' ? d.sha256 : null,
      verification: d.verification && typeof d.verification === 'object' ? d.verification : null
    };
  }

  snapshot() {
    return {
      downloads: this.downloads.map(({ segments, headers, validator, sabr, ...d }) => ({
        ...d,
        streamProgress: d.kind === 'hls' ? streamProgress(segments || []) : undefined,
        connectionsProgress: (segments || []).map(s => ({
          start: s.start, end: s.end, downloaded: s.downloaded,
          total: s.end === null ? null : s.end - s.start + 1,
          status: s.done || (s.end !== null && s.downloaded === s.end - s.start + 1) ? 'complete' : d.status
        }))
      })),
      settings: { ...this.settings }
    };
  }

  async persist() {
    const content = JSON.stringify({
      version: 2,
      settings: this.settings,
      downloads: this.downloads.map(d => ({ ...d, headers: undefined, sabr: undefined }))
    }, null, 2);
    this.persistChain = this.persistChain.catch(() => {}).then(async () => {
      const temp = `${this.statePath}.tmp`;
      await fs.writeFile(temp, content, { mode: 0o600 });
      await fs.rename(temp, this.statePath);
      this.persistAt = Date.now();
    });
    return this.persistChain;
  }
  // Checkpoints are cheap enough to write while bytes arrive, but not on every
  // chunk: a crash loses at most a few seconds of counters, never file data.
  checkpoint() {
    if (Date.now() - this.persistAt < 4000) return;
    this.persist().catch(() => {});
  }
  changed() { this.emit('change', this.snapshot()); }

  updateSettings(patch, save = true) {
    if (!patch || typeof patch !== 'object') throw new Error('Invalid settings.');
    const next = { ...this.settings };
    const numbers = [['maxConcurrent', 1, 16], ['connections', 1, 32], ['speedLimitKbps', 0, 1048576], ['stallTimeoutSec', 5, 300], ['retryLimit', 1, 10]];
    for (const [key, min, max] of numbers) {
      if (patch[key] === undefined) continue;
      const n = Number(patch[key]);
      if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid ${key}.`);
      next[key] = n;
    }
    if (patch.defaultDirectory !== undefined) {
      if (typeof patch.defaultDirectory !== 'string' || !path.isAbsolute(patch.defaultDirectory)) throw new Error('Choose an absolute download folder.');
      next.defaultDirectory = path.resolve(patch.defaultDirectory);
    }
    if (patch.categoryDirectories !== undefined) {
      if (!patch.categoryDirectories || typeof patch.categoryDirectories !== 'object' || Array.isArray(patch.categoryDirectories)) throw new Error('Invalid category folders.');
      next.categoryDirectories = {};
      for (const [category, folder] of Object.entries(patch.categoryDirectories)) {
        if (!CATEGORIES.includes(category) || typeof folder !== 'string' || !path.isAbsolute(folder)) throw new Error('Invalid category folder.');
        next.categoryDirectories[category] = path.resolve(folder);
      }
    }
    if (patch.theme !== undefined) {
      if (!['dark', 'light'].includes(patch.theme)) throw new Error('Invalid theme.');
      next.theme = patch.theme;
    }
    for (const key of ['notifyOnComplete', 'revealOnComplete', 'confirmBrowserDownloads', 'hideCompletionDialog', 'clipboardMonitor', 'organizeByCategory', 'verifyAfterDownload', 'showSpeedGraph']) {
      if (patch[key] === undefined) continue;
      if (typeof patch[key] !== 'boolean') throw new Error(`Invalid ${key}.`);
      next[key] = patch[key];
    }
    if (patch.cookiesFromBrowser !== undefined) {
      if (!['', 'chrome', 'edge', 'firefox', 'brave', 'opera', 'vivaldi'].includes(patch.cookiesFromBrowser)) throw new Error('Invalid browser session.');
      next.cookiesFromBrowser = patch.cookiesFromBrowser;
    }
    if (patch.browserStartBehavior !== undefined) {
      if (!['auto', 'ask', 'queue'].includes(patch.browserStartBehavior)) throw new Error('Invalid download start behaviour.');
      next.browserStartBehavior = patch.browserStartBehavior;
    }
    if (next.speedLimitKbps !== this.settings.speedLimitKbps) this.rateNext.clear();
    this.settings = next;
    if (save) return this.persist().then(() => { this.changed(); this.tick(); return this.snapshot(); });
  }

  directoryFor(category, directory) {
    if (directory) return path.resolve(directory);
    if (this.settings.categoryDirectories[category]) return this.settings.categoryDirectories[category];
    if (this.settings.organizeByCategory) return path.join(this.settings.defaultDirectory, category);
    return this.settings.defaultDirectory;
  }

  /* Duplicate detection compares normalised links and, when a name is already
     known, the destination file. Nothing is ever deleted or replaced: the
     caller decides whether to add, keep or open the existing entry. */
  duplicatesFor(url, filename, directory) {
    const key = normalizeUrl(url);
    const active = this.downloads.find(d => !SETTLED.has(d.status) && normalizeUrl(d.url) === key && d.status !== 'cancelled');
    if (active) return { kind: 'active', download: active };
    const complete = this.downloads.find(d => d.status === 'complete' && normalizeUrl(d.url) === key);
    if (complete) return { kind: 'complete', download: complete };
    if (filename) {
      const name = safeFilename(filename).toLowerCase();
      const folder = directory ? path.resolve(directory).toLowerCase() : null;
      const sameName = this.downloads.find(d => d.status === 'complete' && d.filename?.toLowerCase() === name && (!folder || String(d.path || '').toLowerCase().startsWith(folder)));
      if (sameName) return { kind: 'filename', download: sameName };
    }
    return null;
  }

  async add({ urls, url, audioUrl, outputFormat, youtubeFormat, providerFormat, providerNeedsAudio, providerAudioFormat, sabr, filename, scheduledAt, referer, headers, directory, category, description, preferredQuality, queueOnly = false, reviewOnly = false, reuseActive = false, allowDuplicate = false, priority, expectedSha256 } = {}) {
    const source = urls || (url ? [url] : []);
    if (!Array.isArray(source) || !source.length || source.length > 500) throw new Error('Add between 1 and 500 download URLs.');
    const normalized = source.map(validUrl);
    if (providerFormat !== undefined && (typeof providerFormat !== 'string' || providerFormat.length > 80 || !/^[\w.-]+$/.test(providerFormat))) throw new Error('Invalid provider format.');
    if (youtubeFormat !== undefined && (!/^(?:audio:)?[\w-]+(?:\+[\w-]+)?$/.test(youtubeFormat) || youtubeFormat.length > 80 || normalized.some(u => !youtubeUrl(u)))) throw new Error('Invalid YouTube format.');
    if (outputFormat !== undefined && !['mp4', 'mp3'].includes(outputFormat)) throw new Error('Invalid output format.');
    const sabrSession = sabr === undefined ? undefined : normalizeSabrSession(sabr);
    if (sabrSession && normalized.length !== 1) throw new Error('A SABR session requires exactly one YouTube stream.');
    const audio = audioUrl ? validUrl(audioUrl) : undefined;
    if (audio && normalized.length !== 1) throw new Error('A separate audio track requires exactly one video.');
    const when = scheduledAt ? new Date(scheduledAt).getTime() : null;
    if (when !== null && !Number.isFinite(when)) throw new Error('Invalid scheduled time.');
    if (normalized.some(u => /\.mpd(?:[?#]|$)/i.test(u))) throw new Error('DASH streams need a muxing engine; direct files and non-encrypted HLS VOD are supported.');
    if (directory !== undefined && (typeof directory !== 'string' || !path.isAbsolute(directory))) throw new Error('Choose an absolute save folder.');
    if (category !== undefined && !CATEGORIES.includes(category)) throw new Error('Invalid category.');
    if (description !== undefined && (typeof description !== 'string' || description.length > 4096)) throw new Error('Description is too long.');
    if (priority !== undefined && (!Number.isInteger(priority) || priority < 0 || priority > 9)) throw new Error('Invalid priority.');
    if (preferredQuality !== undefined && !['best', 'audio', ...QUALITY_ORDER].includes(preferredQuality) && !/^\d{3,4}p$/.test(preferredQuality)) throw new Error('Invalid quality.');
    const expected = checksumOf(expectedSha256);
    if (expectedSha256 && !expected) throw new Error('A SHA-256 checksum must be 64 hexadecimal characters.');
    if (reuseActive && normalized.length === 1) {
      const existing = this.downloads.find(d => !SETTLED.has(d.status) && d.status !== 'cancelled' && d.outputFormat === outputFormat &&
        (sabrSession ? d.sabr?.videoId === sabrSession.videoId && d.sabr?.videoItag === sabrSession.videoItag && d.sabr?.audioItag === sabrSession.audioItag : !d.sabr && d.url === normalized[0] && d.audioUrl === audio && d.youtubeFormat === youtubeFormat));
      if (existing) return [existing.id];
    }
    // A URL only identifies a download when no format choice narrows it: the
    // same HLS/YouTube link legitimately produces different files per quality.
    const comparable = !sabrSession && !youtubeFormat && !audio && !outputFormat;
    if (!allowDuplicate && comparable) {
      for (const u of normalized) {
        const duplicate = this.duplicatesFor(u, filename || null, directory);
        if (!duplicate) continue;
        const error = new Error(duplicate.kind === 'active'
          ? `“${duplicate.download.filename}” is already in the download list from this link.`
          : `“${duplicate.download.filename}” was already downloaded from this link.`);
        error.code = 'DUPLICATE';
        error.duplicateId = duplicate.download.id;
        error.duplicateKind = duplicate.kind;
        error.duplicateFilename = duplicate.download.filename;
        error.duplicatePath = duplicate.download.path || null;
        throw error;
      }
    }
    const added = normalized.map(u => {
      const name = safeFilename(filename || suggestedName(u));
      const selectedCategory = category || categoryFor(name);
      this.sequence += 1;
      return {
        id: randomUUID(), url: u, audioUrl: audio, outputFormat, youtubeFormat, providerFormat, providerNeedsAudio: providerNeedsAudio === true, providerAudioFormat, sabr: sabrSession,
        filename: name, explicitFilename: Boolean(filename), category: selectedCategory, explicitCategory: Boolean(category),
        description: description || '',
        status: queueOnly || reviewOnly ? 'paused' : when && when > Date.now() ? 'scheduled' : 'queued',
        needsReview: reviewOnly, scheduledAt: when ? new Date(when).toISOString() : null,
        downloaded: 0, total: null, speed: 0, speedAvg: 0, connections: 0, error: null, path: null,
        directory: this.directoryFor(selectedCategory, directory),
        pinnedDirectory: Boolean(directory),
        createdAt: new Date().toISOString(), segments: [], validator: null,
        preferredQuality: preferredQuality || 'best',
        priority: Number.isInteger(priority) ? priority : 5,
        queuePosition: Date.now() + this.sequence / 1000,
        expectedSha256: expected, sha256: null, verification: null,
        headers: cleanHeaders({ ...headers, ...(referer ? { referer } : {}) })
      };
    });
    this.downloads.push(...added);
    await this.persist();
    this.changed(); this.tick();
    return added.map(d => d.id);
  }

  async reviewDownload({ id, filename, directory, category, description = '', queueOnly = false, scheduledAt, priority, expectedSha256 } = {}) {
    const d = this.downloads.find(d => d.id === id);
    if (!d?.needsReview || this.jobs.has(id)) throw new Error('This download is not waiting for confirmation.');
    if (directory !== undefined && (typeof directory !== 'string' || !path.isAbsolute(directory))) throw new Error('Choose an absolute save folder.');
    if (category !== undefined && !CATEGORIES.includes(category)) throw new Error('Invalid category.');
    if (typeof description !== 'string' || description.length > 4096) throw new Error('Description is too long.');
    if (priority !== undefined && (!Number.isInteger(priority) || priority < 0 || priority > 9)) throw new Error('Invalid priority.');
    const expected = checksumOf(expectedSha256);
    if (expectedSha256 && !expected) throw new Error('A SHA-256 checksum must be 64 hexadecimal characters.');
    const when = scheduledAt ? new Date(scheduledAt).getTime() : null;
    if (when !== null && !Number.isFinite(when)) throw new Error('Invalid scheduled time.');
    if (filename) { d.explicitFilename ||= filename !== d.filename; d.filename = safeFilename(filename); }
    if (category) { d.category = category; d.explicitCategory = true; }
    if (directory) d.directory = path.resolve(directory);
    if (priority !== undefined) d.priority = priority;
    if (expected) d.expectedSha256 = expected;
    d.description = description; d.needsReview = false; d.scheduledAt = when ? new Date(when).toISOString() : null;
    d.status = queueOnly ? 'paused' : when && when > Date.now() ? 'scheduled' : 'queued';
    await this.persist(); this.changed(); this.tick();
    return [d.id];
  }

  async action(id, action, value) {
    const d = this.downloads.find(d => d.id === id);
    if (!d) throw new Error('Download not found.');
    if (!['pause', 'resume', 'retry', 'cancel', 'remove', 'verify', 'up', 'down', 'top', 'bottom', 'limit', 'onComplete'].includes(action)) throw new Error('Unknown download action.');
    if (action === 'limit') {
      const n = value === null || value === '' ? null : Number(value);
      if (n !== null && (!Number.isInteger(n) || n < 0 || n > 1048576)) throw new Error('Invalid speed limit.');
      d.speedLimitKbps = n;
      if (!n) this.rateNext.delete(d.id);
      await this.persist(); this.changed();
      return { speedLimitKbps: d.speedLimitKbps };
    }
    if (action === 'onComplete') {
      if (!['none', 'notify', 'open'].includes(value)) throw new Error('Invalid completion action.');
      d.onComplete = value;
      await this.persist(); this.changed();
      return { onComplete: d.onComplete };
    }
    if (['up', 'down', 'top', 'bottom'].includes(action)) { this.reorder(id, action); await this.persist(); this.changed(); this.tick(); return; }
    if (action === 'verify') {
      if (d.status !== 'complete' || !d.path) throw new Error('Only completed downloads can be verified.');
      await this.verify(d);
      await this.persist(); this.changed();
      return d.verification;
    }
    if (action === 'pause' || action === 'cancel' || action === 'remove') {
      const job = this.jobs.get(id);
      if (job) { job.controller.abort(); await job.promise; }
      if (action === 'pause' && d.status !== 'complete') d.status = 'paused';
      if (action === 'cancel' && d.status !== 'complete') { d.status = 'cancelled'; d.needsReview = false; }
      if (action === 'remove') this.downloads = this.downloads.filter(x => x.id !== id);
      if (action !== 'pause') { await fs.rm(path.join(this.partsDirectory, id), { recursive: true, force: true }); d.segments = []; if (d.status !== 'complete') d.downloaded = 0; }
    } else {
      if (d.needsReview) throw new Error('Confirm this browser download in Download File Info first.');
      if (this.jobs.has(id) || d.status === 'complete') return;
      // Provider media links expire: retry from the page that produced them.
      if (d.sourceUrl && d.sourceUrl !== d.url) d.url = d.sourceUrl;
      d.error = null; d.status = 'queued'; d.scheduledAt = null; d.queuePosition = Date.now();
    }
    d.speed = 0;
    await this.persist(); this.changed(); this.tick();
  }

  queue() {
    return this.downloads.filter(d => d.status === 'queued' || d.status === 'scheduled')
      .sort((a, b) => (b.priority || 5) - (a.priority || 5) || (a.queuePosition || 0) - (b.queuePosition || 0));
  }
  reorder(id, direction) {
    const queue = this.queue().filter(d => d.status === 'queued');
    const index = queue.findIndex(d => d.id === id);
    if (index < 0) return;
    const [item] = queue.splice(index, 1);
    if (direction === 'up') queue.splice(Math.max(0, index - 1), 0, item);
    else if (direction === 'down') queue.splice(Math.min(queue.length, index + 1), 0, item);
    else if (direction === 'top') queue.unshift(item);
    else queue.push(item);
    const base = Math.min(...queue.map(d => d.queuePosition || 0), Date.now());
    queue.forEach((d, i) => { d.queuePosition = base + i; });
  }

  tick() {
    if (this.closing) return;
    for (const d of this.downloads) {
      if (d.status === 'scheduled' && new Date(d.scheduledAt).getTime() <= Date.now()) d.status = 'queued';
    }
    for (const d of this.queue()) {
      if (this.jobs.size >= this.settings.maxConcurrent) break;
      if (d.status !== 'queued' || this.jobs.has(d.id)) continue;
      const controller = new AbortController();
      const job = { controller, promise: null };
      this.jobs.set(d.id, job);
      job.promise = this.run(d, controller.signal).catch(error => {
        d.status = controller.signal.aborted ? 'paused' : 'error';
        d.error = controller.signal.aborted ? null : error.message;
      }).finally(async () => {
        d.speed = 0;
        // Keep the job owned until all cleanup and its final checkpoint finish.
        try { await this.persist(); } catch (error) { d.status = 'error'; d.error = `History checkpoint failed: ${error.message}`; }
        this.jobs.delete(d.id); if (!this.jobs.size) this.rateNext.clear(); this.changed(); this.tick();
      });
    }
  }

  /* A download can cap itself; otherwise the global limit applies. Both are
     paced per job so concurrent transfers cannot borrow each other's budget. */
  async throttle(bytes, signal, d) {
    const now = Date.now();
    const waits = [];
    // The global budget is shared by every job; a per-download cap is an
    // additional ceiling on top of it, never a private replacement.
    const pace = (key, kbps) => {
      if (!kbps) return;
      const cost = bytes * 1000 / (kbps * 1024);
      const next = Math.max(now, this.rateNext.get(key) || 0) + cost;
      this.rateNext.set(key, next);
      waits.push(next - cost - now);
    };
    pace('global', this.settings.speedLimitKbps);
    if (d && Number.isFinite(d.speedLimitKbps) && d.speedLimitKbps > 0) pace(d.id, d.speedLimitKbps);
    const wait = Math.max(0, ...waits);
    if (wait > 0) await delay(wait, undefined, { signal });
  }

  async ensureSpace(directory, total) {
    if (!Number.isFinite(total) || total <= 0) return;
    try {
      const stats = await fs.statfs(directory);
      const free = Number(stats.bavail) * Number(stats.bsize);
      if (Number.isFinite(free) && free > 0 && free < total + 64 * 1024 * 1024) {
        throw new Error(`Not enough free disk space: ${Math.round(free / 1048576)} MB available, ${Math.round(total / 1048576)} MB needed.`);
      }
    } catch (error) { if (/Not enough free disk space/.test(error.message)) throw error; }
  }

  speedSample(d, instant) {
    d.speed = instant;
    // Smoothed figure keeps the interface steady while segments report unevenly.
    d.speedAvg = d.speedAvg ? d.speedAvg * 0.72 + instant * 0.28 : instant;
    this.checkpoint();
  }

  async run(d, signal) {
    d.status = 'probing'; d.error = null; d.lastTry = new Date().toISOString(); this.changed();
    if (d.sabr) { await this.runSabr(d, cleanHeaders(d.headers), signal); return; }
    if (youtubeUrl(d.url)) {
      const dir = path.join(this.partsDirectory, d.id); await fs.mkdir(dir, { recursive: true });
      d.kind = 'youtube'; d.resumable = true; d.connections = 1;
      const result = await downloadYoutube({
        url: d.url, formatKey: d.youtubeFormat, directory: dir, signal, speedLimitKbps: this.settings.speedLimitKbps,
        onMetadata: choice => { if (!d.explicitFilename) d.filename = safeFilename(choice.title + '.' + choice.outputFormat); d.duration = choice.duration; this.changed(); },
        onProgress: p => { Object.assign(d, p); d.segments = [{ start: 0, end: p.total ? p.total - 1 : null, downloaded: p.downloaded }]; this.changed(); }
      });
      if (!d.explicitFilename) d.filename = safeFilename(result.choice.title + '.' + result.choice.outputFormat);
      d.duration = result.choice.duration; d.category = result.choice.outputFormat === 'mp3' ? 'Audio' : 'Video';
      d.total = d.downloaded = result.size; d.estimated = false;
      d.segments = [{ start: 0, end: result.size - 1, downloaded: result.size, done: true }];
      await this.assemble(d, dir, signal, [result.output], true); return;
    }
    if (isEphemeralMediaUrl(d.url)) {
      throw new Error('This is a temporary TikTok media link, not a video page. Open the video and use the RedX button there so a fresh link can be issued.');
    }
    if (!this.resolvePageOverride && providerFor(d.url) && await this.runPageProvider(d, signal)) return;
    await this.resolvePageSource(d, signal);
    const headers = cleanHeaders(d.headers);
    if (/\.m3u8(?:[?#]|$)/i.test(d.url)) { await this.runHls(d, headers, signal); return; }
    if (d.audioUrl) { await this.runPairedTracks(d, headers, signal); return; }
    const info = await probe(d.url, headers, signal);
    const mime = String(info.headers['content-type'] || '');
    if (/mpegurl/i.test(mime)) { await this.runHls(d, headers, signal); return; }
    if (/dash\+xml/i.test(mime)) throw new Error('DASH streams need a muxing engine, which is not included yet.');
    if (!d.explicitFilename) { d.filename = suggestedName(info.url, info.headers['content-disposition']); if (!d.explicitCategory) d.category = categoryFor(d.filename); }
    if (this.settings.organizeByCategory && !d.pinnedDirectory) d.directory = this.directoryFor(d.category);
    const dir = path.join(this.partsDirectory, d.id);
    await fs.mkdir(dir, { recursive: true });
    // Resume only when both resource identity and range support can be established.
    if (!info.ranges || !info.validator || d.validator !== info.validator || d.total !== info.total) {
      await fs.rm(dir, { recursive: true, force: true });
      await fs.mkdir(dir, { recursive: true });
      d.segments = [];
    }
    d.total = info.total; d.validator = info.validator;
    d.resumable = Boolean(info.ranges && info.validator);
    await this.ensureSpace(d.directory, info.total);
    // Segment count follows the file size so small files are not split into
    // connections that spend more time on handshakes than on data.
    const wanted = info.total === null ? 1 : Math.min(this.settings.connections, Math.max(1, Math.ceil(info.total / (2 * 1024 * 1024))));
    const count = info.ranges && info.total > 1024 * 1024 ? Math.max(1, Math.min(wanted, Math.ceil(info.total / (512 * 1024)))) : 1;
    // An interrupted download keeps the segment layout it was saved with: the
    // .part files are addressed by segment index, so remapping them would mix
    // unrelated byte ranges. Only brand-new transfers use the adaptive count.
    if (!d.segments.length) {
      d.segments = Array.from({ length: count }, (_, i) => ({
        start: info.total === null ? 0 : Math.floor(info.total * i / count),
        end: info.total === null ? null : Math.floor(info.total * (i + 1) / count) - 1,
        downloaded: 0
      }));
    }
    for (let i = 0; i < d.segments.length; i++) {
      let size = 0;
      try { size = (await fs.stat(path.join(dir, `${i}.part`))).size; } catch (e) { if (e.code !== 'ENOENT') throw e; }
      const s = d.segments[i];
      if (s.end !== null && size > s.end - s.start + 1) throw new Error('Partial file is larger than its segment. Remove and re-add this download.');
      s.downloaded = size; s.done = s.end !== null && size === s.end - s.start + 1;
    }
    d.downloaded = d.segments.reduce((n, s) => n + s.downloaded, 0);
    d.connections = d.segments.length; d.status = 'downloading'; await this.persist(); this.changed();
    let lastBytes = d.downloaded, lastAt = Date.now();
    const progress = setInterval(() => {
      const now = Date.now();
      this.speedSample(d, (d.downloaded - lastBytes) * 1000 / Math.max(1, now - lastAt));
      lastBytes = d.downloaded; lastAt = now; this.changed();
    }, this.tickMs);
    const siblings = new AbortController();
    const transferSignal = AbortSignal.any([signal, siblings.signal]);
    try {
      const outcomes = await Promise.allSettled(d.segments.map((segment, i) => this.transfer(d, info, segment, path.join(dir, `${i}.part`), headers, transferSignal).catch(error => { siblings.abort(); throw error; })));
      const failure = outcomes.find(r => r.status === 'rejected' && r.reason.name !== 'AbortError') || outcomes.find(r => r.status === 'rejected');
      if (failure) throw failure.reason;
    } finally { clearInterval(progress); }
    await this.assemble(d, dir, signal);
  }

  async assemble(d, dir, signal, files = d.segments.map((_, i) => path.join(dir, `${i}.part`)), converted = false) {
    signal.throwIfAborted();
    d.status = 'assembling'; d.speed = 0; this.changed();
    if (d.outputFormat && !converted) {
      const { convertMedia } = await import('./mux.mjs');
      const output = await convertMedia(dir, files, d.outputFormat, signal);
      d.filename = safeFilename(d.filename.replace(/\.[^.]+$/, '') + '.' + d.outputFormat);
      if (!d.explicitCategory) d.category = d.outputFormat === 'mp3' ? 'Audio' : 'Video';
      return this.assemble(d, dir, signal, [output], true);
    }
    await fs.mkdir(d.directory, { recursive: true });
    // Exclusive creation prevents collision with user files or another download.
    let destination, out;
    for (let n = 0; n < 10000; n++) {
      const ext = path.extname(d.filename), base = path.basename(d.filename, ext);
      destination = path.join(d.directory, n ? `${base} (${n})${ext}` : d.filename);
      try { out = await fs.open(destination, 'wx'); break; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
    if (!out) throw new Error('Could not choose a free output filename.');
    let complete = false;
    try {
      for (const file of files) {
        const input = await fs.open(file, 'r');
        try {
          for await (const chunk of input.createReadStream()) { signal.throwIfAborted(); await out.writeFile(chunk); }
        } finally { await input.close(); }
      }
      await out.sync(); complete = true;
    } finally { await out.close(); if (!complete) await fs.unlink(destination); }
    d.path = destination; d.filename = path.basename(destination);
    d.speed = 0; d.speedAvg = 0;
    const size = (await fs.stat(destination)).size;
    if (!d.total) d.total = size;
    // Hash before announcing completion: the status must never claim success
    // before the integrity check has produced a result.
    await this.verify(d, signal);
    d.status = 'complete';
    d.completedAt = new Date().toISOString();
    await this.persist();
    try { await fs.rm(dir, { recursive: true, force: true }); }
    catch (error) { d.cleanupError = `Downloaded file is complete; temporary segments could not be removed: ${error.message}`; }
    this.emit('complete', { ...d });
  }

  async verify(d, signal) {
    if (!d.path) return null;
    const expected = checksumOf(d.expectedSha256);
    const checkedAt = new Date().toISOString();
    if (!this.settings.verifyAfterDownload && !expected) {
      d.verification = { state: 'skipped', expected: null, actual: null, checkedAt };
      return d.verification;
    }
    try {
      const size = (await fs.stat(d.path)).size;
      const actual = await hashFile(d.path, signal);
      d.sha256 = actual;
      const sizeMatches = !d.total || Number(d.total) === size;
      d.verification = {
        state: !expected ? 'unavailable' : actual === expected && sizeMatches ? 'verified' : 'mismatch',
        expected: expected || null, actual, size, sizeMatches, checkedAt
      };
      if (d.verification.state === 'mismatch') d.verification.reason = sizeMatches ? 'The SHA-256 checksum does not match the expected value.' : 'The file size does not match the expected size.';
      this.emit('verified', { id: d.id, verification: d.verification });
    } catch (error) {
      d.verification = { state: 'error', expected: expected || null, actual: null, checkedAt, reason: error.message };
    }
    this.changed();
    return d.verification;
  }

  /* TikTok and X: let the bundled extractor resolve the page and download the
     signed stream it produces. Replaying a CDN URL captured earlier is what
     caused HTTP 403, because those links expire and need extractor headers. */
  async runPageProvider(d, signal) {
    const dir = path.join(this.partsDirectory, d.id);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    d.sourceUrl ||= d.url;
    let listing;
    try { listing = await ytdlpFormats(d.url, { signal }); }
    catch (error) {
      if (error.code === 'YTDLP_MISSING') return false; // scraper fallback
      throw error;
    }
    d.kind = 'ytdlp'; d.connections = 1; d.resumable = false; d.provider = providerFor(d.url);
    d.qualities = listing.rows.map(row => ({ quality: row.quality, height: row.height, format: row.format, bitrate: row.bitrate, size: row.size }));
    if (listing.title && !d.explicitFilename) { d.filename = safeFilename(`${listing.title}.mp4`); d.explicitFilename = true; }
    if (!d.explicitCategory) d.category = 'Video';
    if (listing.duration) d.duration = listing.duration;
    const wanted = /^(\d{3,4})p$/.exec(d.preferredQuality || '');
    const pick = d.providerFormat ? listing.rows.find(row => row.youtubeFormat === d.providerFormat)
      : !wanted ? listing.rows[0]
      : listing.rows.find(row => row.height === Number(wanted[1]))
        || listing.rows.find(row => row.height && row.height <= Number(wanted[1]))
        || listing.rows[listing.rows.length - 1];
    if (!pick) throw new Error('No downloadable formats were published for this link.');
    if (wanted && pick.height && pick.height < Number(wanted[1])) d.qualityNote = `Requested ${d.preferredQuality} is not available for this link; using ${pick.quality}.`;
    d.total = pick.size || null;
    d.status = 'downloading'; await this.persist(); this.changed();
    const result = await ytdlpDownload({
      url: d.url, formatId: d.providerFormat || pick.youtubeFormat, needsAudio: d.providerFormat ? d.providerNeedsAudio : pick.needsAudio, audioFormatId: d.providerFormat ? d.providerAudioFormat : pick.audioFormatId,
      directory: dir, signal, cookiesFromBrowser: this.settings.cookiesFromBrowser || undefined,
      onProgress: progress => {
        d.downloaded = progress.downloaded;
        if (progress.total) d.total = progress.total;
        this.speedSample(d, progress.speed);
        this.changed();
      }
    });
    d.total = d.downloaded = result.size;
    d.segments = [{ start: 0, end: result.size - 1, downloaded: result.size, done: true }];
    d.status = 'assembling'; this.changed();
    await this.assemble(d, dir, signal, [result.path], true);
    return true;
  }

  /* TikTok and X publish no direct link on the page itself, so the stream is
     resolved first and then handed to the normal segmented transfer path. */
  async resolvePageSource(d, signal) {
    const provider = providerFor(d.url);
    const pageLike = !provider && /(?:\/(?:[\w-]+\.)?(?:html?|php|aspx?|jsp)|\/)(?:[?#]|$)/i.test(d.url);
    if (!provider && !pageLike) return;
    if (!provider && d.explicitFilename) return;
    let media = null;
    try { media = await this.resolvePage(d.url, { signal }); }
    catch (error) {
      // A known provider that cannot be read is a real failure; an ordinary web
      // page simply falls back to the plain download it always had.
      if (provider) throw new Error(provider === 'tiktok' ? `TikTok: ${error.message}` : `X: ${error.message}`);
      return;
    }
    const picked = pickVariant(media?.variants || [], d.preferredQuality || 'best');
    if (!picked) { if (provider) throw new Error('No downloadable video was found on that page.'); return; }
    d.sourceUrl ||= d.url;
    d.provider = media.provider;
    d.kind = 'page';
    d.qualities = (media.variants || []).map(item => ({ quality: item.quality, height: item.height, format: item.format, bitrate: item.bitrate, size: item.size }));
    const wanted = /^(\d{3,4})p$/.exec(d.preferredQuality || '');
    if (wanted && picked.height && Number(picked.height) < Number(wanted[1])) {
      d.qualityNote = `Requested ${d.preferredQuality} is not available for this link; using ${picked.quality}.`;
    }
    d.url = picked.url;
    d.total = picked.size || null;
    if (media.title && !d.explicitFilename) {
      d.filename = safeFilename(`${media.title}.${String(picked.format || 'mp4').toLowerCase()}`);
      // The page title is a better name than the CDN file name, so keep it.
      d.explicitFilename = true;
    }
    if (media.author) d.author = media.author;
    if (media.duration) d.duration = media.duration;
    if (!d.explicitCategory) d.category = 'Video';
    if (media.provider === 'tiktok') d.headers = { ...d.headers, referer: 'https://www.tiktok.com/' };
    this.changed();
  }

  async runHls(d, headers, signal) {
    const plan = await resolveHls(d.url, headers, signal);
    if (d.audioUrl) plan.audio = await resolveHls(d.audioUrl, scopedHeaders(headers, d.url, d.audioUrl), signal);
    const videoCount = plan.urls.length;
    if (plan.audio) { plan.urls.push(...plan.audio.urls); plan.identity += ':' + plan.audio.identity; plan.extension = '.mp4'; }
    const dir = path.join(this.partsDirectory, d.id);
    if (d.playlistIdentity !== plan.identity) {
      await fs.rm(dir, { recursive: true, force: true }); d.segments = [];
    }
    await fs.mkdir(dir, { recursive: true });
    d.playlistIdentity = plan.identity; d.duration = plan.duration; d.resumable = true; d.kind = 'hls';
    if (!d.explicitFilename && !d.hlsFilenameResolved) { d.filename = safeFilename(d.filename.replace(/\.(m3u8|mpd)$/i, '') + plan.extension); d.hlsFilenameResolved = true; }
    if (!d.explicitCategory) d.category = 'Video';
    d.total = null; d.downloaded = 0;
    d.segments = await Promise.all(plan.urls.map(async (url, i) => {
      let size = 0, done = false;
      try { size = (await fs.stat(path.join(dir, `${i}.part`))).size; done = true; } catch (e) { if (e.code !== 'ENOENT') throw e; }
      d.downloaded += size;
      return { url, start: 0, end: null, downloaded: size, done };
    }));
    d.connections = Math.min(this.settings.connections, d.segments.length);
    d.status = 'downloading'; await this.persist(); this.changed();
    let index = 0, lastBytes = d.downloaded, lastTime = Date.now();
    const progress = setInterval(() => {
      const now = Date.now();
      this.speedSample(d, (d.downloaded - lastBytes) * 1000 / Math.max(1, now - lastTime));
      lastBytes = d.downloaded; lastTime = now; this.changed();
    }, this.tickMs);
    const siblings = new AbortController(), groupSignal = AbortSignal.any([signal, siblings.signal]);
    const worker = async () => {
      while (index < d.segments.length) {
        groupSignal.throwIfAborted();
        const i = index++, segment = d.segments[i];
        if (segment.done) continue;
        const temp = path.join(dir, `${i}.receiving`);
        for (let attempt = 0; attempt < this.settings.retryLimit; attempt++) {
          d.downloaded -= segment.downloaded; segment.downloaded = 0;
          const out = await fs.open(temp, 'w'); let response;
          try {
            response = await request(segment.url, { headers: scopedHeaders(headers, plan.source, segment.url), signal: groupSignal });
            if (response.statusCode !== 200) throw new Error(`HLS segment returned HTTP ${response.statusCode}.`);
            const expected = Number(response.headers['content-length']);
            for await (const chunk of response) { groupSignal.throwIfAborted(); await this.throttle(chunk.length, groupSignal, d); await out.writeFile(chunk); segment.downloaded += chunk.length; d.downloaded += chunk.length; }
            if (Number.isFinite(expected) && expected !== segment.downloaded) throw new Error('Incomplete HLS segment.');
            await out.sync(); await out.close();
            await fs.rename(temp, path.join(dir, `${i}.part`)); segment.done = true;
            await this.persist(); break;
          } catch (error) {
            await out.close();
            if (groupSignal.aborted || attempt === this.settings.retryLimit - 1) throw error;
            await delay(250 * 2 ** attempt + Math.random() * 150, undefined, { signal: groupSignal });
          } finally { response?.destroy(); }
        }
      }
    };
    try {
      const outcomes = await Promise.allSettled(Array.from({ length: d.connections }, () => worker().catch(error => { siblings.abort(); throw error; })));
      const error = outcomes.find(o => o.status === 'rejected' && o.reason.name !== 'AbortError') || outcomes.find(o => o.status === 'rejected');
      if (error) throw error.reason;
    } finally { clearInterval(progress); }
    d.total = d.downloaded;
    if (plan.audio) {
      d.status = 'assembling'; d.speed = 0; this.changed();
      const { muxTracks } = await import('./mux.mjs');
      const combined = await muxTracks(dir, videoCount, plan.urls.length, signal);
      d.filename = safeFilename(d.filename.replace(/\.[^.]+$/, '') + '.mp4');
      await this.assemble(d, dir, signal, [combined]);
    } else await this.assemble(d, dir, signal);
  }

  async runPairedTracks(d, headers, signal) {
    const urls = [d.url, d.audioUrl];
    const trackHeaders = urls.map(url => scopedHeaders(headers, d.url, url));
    const infos = await Promise.all(urls.map((url, i) => probe(url, trackHeaders[i], signal)));
    const dir = path.join(this.partsDirectory, d.id); await fs.mkdir(dir, { recursive: true });
    // Direct adaptive tracks are separate files; concatenating them corrupts MP4.
    d.kind = 'paired'; d.resumable = false; d.downloaded = 0;
    d.total = infos.every(i => i.total !== null) ? infos.reduce((n, i) => n + i.total, 0) : null;
    await this.ensureSpace(d.directory, d.total);
    d.segments = infos.map(i => ({ start: 0, end: i.total === null ? null : i.total - 1, downloaded: 0 }));
    d.status = 'downloading'; d.connections = 2; this.changed();
    let last = 0, at = Date.now();
    const timer = setInterval(() => { const now = Date.now(); this.speedSample(d, (d.downloaded - last) * 1000 / Math.max(1, now - at)); last = d.downloaded; at = now; this.changed(); }, this.tickMs);
    const siblings = new AbortController(), group = AbortSignal.any([signal, siblings.signal]);
    try {
      const outcomes = await Promise.allSettled(urls.map(async (url, i) => { try { const file = path.join(dir, i + '.part'); await fs.writeFile(file, Buffer.alloc(0)); await this.transfer(d, infos[i], d.segments[i], file, trackHeaders[i], group, url); } catch (error) { siblings.abort(); throw error; } }));
      const failed = outcomes.find(o => o.status === 'rejected' && o.reason.name !== 'AbortError') || outcomes.find(o => o.status === 'rejected'); if (failed) throw failed.reason;
    } finally { clearInterval(timer); }
    signal.throwIfAborted(); d.status = 'assembling'; d.speed = 0; this.changed();
    const { muxTracks } = await import('./mux.mjs'); const combined = await muxTracks(dir, 1, 2, signal);
    d.total = d.downloaded = (await fs.stat(combined)).size;
    await this.assemble(d, dir, signal, [combined], true);
  }

  async runSabr(d, headers, signal) {
    const dir = path.join(this.partsDirectory, d.id);
    await fs.rm(dir, { recursive: true, force: true }); await fs.mkdir(dir, { recursive: true });
    d.kind = 'sabr'; d.resumable = false; d.downloaded = 0;
    const selected = normalizeSabrSession(d.sabr), hasVideo = selected.videoItag !== undefined;
    const picked = selected.formats.filter(f => f.itag === selected.audioItag || f.itag === selected.videoItag);
    d.total = picked.every(f => Number(f.contentLength) > 0) ? picked.reduce((sum, f) => sum + Number(f.contentLength), 0) : null;
    d.segments = picked.map(f => ({ start: 0, end: Number(f.contentLength) > 0 ? Number(f.contentLength) - 1 : null, downloaded: 0 }));
    d.connections = picked.length; d.status = 'downloading'; await this.persist(); this.changed();
    let networkDownloaded = 0, last = 0, at = Date.now();
    const timer = setInterval(() => { const now = Date.now(); this.speedSample(d, (networkDownloaded - last) * 1000 / Math.max(1, now - at)); last = networkDownloaded; at = now; this.changed(); }, this.tickMs);
    let result;
    try {
      result = await downloadSabr({
        session: selected, headers, videoPath: path.join(dir, '0.part'), audioPath: path.join(dir, hasVideo ? '1.part' : '0.part'), signal,
        onProgress: progress => {
          d.downloaded = progress.downloaded; if (progress.total !== null) d.total = progress.total;
          networkDownloaded = progress.networkDownloaded;
          for (let i = 0; i < d.segments.length; i++) d.segments[i].downloaded = progress.tracks[picked[i].itag] || 0;
        }
      });
    } finally { clearInterval(timer); }
    signal.throwIfAborted(); d.status = 'assembling'; d.speed = 0; d.duration = result.duration || undefined; this.changed();
    let output;
    if (hasVideo) { const { muxTracks } = await import('./mux.mjs'); output = await muxTracks(dir, 1, 2, signal); }
    else { const { convertMedia } = await import('./mux.mjs'); output = await convertMedia(dir, [path.join(dir, '0.part')], 'mp3', signal); }
    d.total = d.downloaded = (await fs.stat(output)).size; d.segments = [{ start: 0, end: d.total - 1, downloaded: d.total, done: true }];
    await this.assemble(d, dir, signal, [output], true);
  }

  async transfer(d, info, segment, file, headers, signal, url = d.url) {
    const expected = segment.end === null ? null : segment.end - segment.start + 1;
    if (expected !== null && segment.downloaded === expected) { await fs.appendFile(file, Buffer.alloc(0)); return; }
    const stallMs = Math.max(5, this.settings.stallTimeoutSec) * 1000;
    for (let attempt = 0; attempt < this.settings.retryLimit; attempt++) {
      signal.throwIfAborted();
      const attemptController = new AbortController();
      const attemptSignal = AbortSignal.any([signal, attemptController.signal]);
      let stalled = false, lastActivity = Date.now();
      // A socket that stops producing bytes is indistinguishable from a very
      // slow one until enough time passes; only then is the attempt recycled.
      const watchdog = setInterval(() => {
        if (Date.now() - lastActivity >= stallMs) { stalled = true; attemptController.abort(); }
      }, Math.max(1000, Math.min(5000, stallMs / 2)));
      let response;
      try {
        const ranged = info.ranges && info.total !== null;
        if (!ranged && segment.downloaded) { d.downloaded -= segment.downloaded; segment.downloaded = 0; await fs.writeFile(file, Buffer.alloc(0)); }
        const start = segment.start + segment.downloaded;
        const h = { ...headers };
        if (ranged) { h.Range = `bytes=${start}-${segment.end}`; if (info.validator) h['If-Range'] = info.validator; }
        response = await request(url, { headers: h, signal: attemptSignal });
        if ((ranged && response.statusCode !== 206) || (!ranged && response.statusCode !== 200)) {
          response.destroy(); throw new Error(`Server returned HTTP ${response.statusCode}${ranged ? ' instead of a byte range' : ''}.`);
        }
        if (ranged) {
          const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers['content-range'] || '');
          if (!match || Number(match[1]) !== start || Number(match[2]) !== segment.end || Number(match[3]) !== info.total) { response.destroy(); throw new Error('Server returned an inconsistent byte range.'); }
        }
        if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') { response.destroy(); throw new Error('Server ignored identity encoding; refusing to save corrupt ranges.'); }
        const out = await fs.open(file, 'a');
        try {
          for await (const chunk of response) {
            signal.throwIfAborted();
            if (stalled) throw new Error('Connection stalled.');
            if (expected !== null && segment.downloaded + chunk.length > expected) throw new Error('Server sent more bytes than requested.');
            await this.throttle(chunk.length, attemptSignal, d);
            await out.writeFile(chunk); segment.downloaded += chunk.length; d.downloaded += chunk.length;
            lastActivity = Date.now();
          }
          await out.sync();
        } finally { await out.close(); response.destroy(); }
        if (expected !== null && segment.downloaded !== expected) throw new Error('Connection ended before the segment finished.');
        return;
      } catch (error) {
        const message = stalled ? 'Connection stalled; retrying.' : error.message;
        const retryable = !signal.aborted && attempt < this.settings.retryLimit - 1;
        if (!retryable) {
          if (signal.aborted) throw error;
          if (stalled) throw new Error('The server stopped sending data. Select Resume to continue from the saved bytes.');
          throw error;
        }
        d.lastError = message;
        d.retryCount = (d.retryCount || 0) + 1;
        this.changed();
        // Exponential backoff with jitter avoids synchronised retry storms.
        await delay(250 * 2 ** attempt + Math.random() * 300, undefined, { signal });
      } finally { clearInterval(watchdog); response?.destroy(); }
    }
  }

  async close() {
    if (this.closePromise) return this.closePromise;
    this.closePromise = this.shutdown();
    return this.closePromise;
  }
  async shutdown() {
    this.closing = true; clearInterval(this.timer);
    for (const job of this.jobs.values()) job.controller.abort();
    await Promise.allSettled([...this.jobs.values()].map(j => j.promise));
    await this.persist();
  }
}
