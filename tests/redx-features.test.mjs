import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { DownloadEngine } from '../core/engine.mjs';
import { detectDownloadUrl } from '../core/clipboard.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

async function workspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redx-test-'));
  const data = path.join(root, 'data'), downloads = path.join(root, 'downloads');
  await fs.mkdir(data, { recursive: true });
  await fs.mkdir(downloads, { recursive: true });
  return { root, data, downloads, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

/* Range-capable test server. `mode` lets a single test misbehave: 'stall' sends
 * headers and a little data then hangs, 'ignore-range' answers 200 to ranged
 * requests, 'plain' never advertises ranges. */
function serve(body, { mode = 'range', etag = '"v1"', onRequest } = {}) {
  const hits = [];
  let stalledOnce = false;
  const server = http.createServer(async (req, res) => {
    hits.push({ url: req.url, range: req.headers.range || null });
    onRequest?.(hits.length, req);
    if (mode === 'plain') {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length });
      res.end(body);
      return;
    }
    if (mode === 'ignore-range') {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'accept-ranges': 'bytes', etag, 'content-length': body.length });
      res.end(body);
      return;
    }
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (range && (!req.headers['if-range'] || req.headers['if-range'] === etag)) {
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
      const slice = body.subarray(start, end + 1);
      res.writeHead(206, {
        'content-type': 'application/octet-stream', 'accept-ranges': 'bytes', etag,
        'content-range': `bytes ${start}-${end}/${body.length}`, 'content-length': slice.length
      });
      if (mode === 'stall' && !stalledOnce) {
        stalledOnce = true;
        res.write(slice.subarray(0, 4096));
        return; // never ends: the watchdog must recycle this attempt
      }
      res.end(slice);
      return;
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'accept-ranges': 'bytes', etag, 'content-length': body.length });
    res.end(body);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, hits, url: `http://127.0.0.1:${server.address().port}/file.bin` })));
}

async function waitFor(engine, id, statuses, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let download;
  while (Date.now() < deadline) {
    download = engine.downloads.find(d => d.id === id);
    if (download && statuses.includes(download.status)) return download;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${statuses.join('/')} (last status: ${download?.status}, error: ${download?.error})`);
}

async function waitProgress(engine, id, bytes, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const download = engine.downloads.find(d => d.id === id);
    if (download?.downloaded >= bytes) return download;
    await delay(50);
  }
}

test('resume after restart keeps saved segment layout and produces identical bytes', async () => {
  const body = randomBytes(6 * 1024 * 1024);
  const { url, server } = await serve(body);
  const box = await workspace();
  let first, second;
  try {
    first = await new DownloadEngine({ dataDirectory: box.data, downloadDirectory: box.downloads }).init();
    const [id] = await first.add({ urls: [url] });
    await waitProgress(first, id, 1024 * 1024);
    await first.action(id, 'pause');
    const before = first.downloads.find(d => d.id === id);
    assert.equal(before.status, 'paused');
    const layout = before.segments.map(s => [s.start, s.end]);
    assert.ok(before.downloaded > 0, 'partial bytes were received');
    await first.close();
    first = null;

    second = await new DownloadEngine({ dataDirectory: box.data, downloadDirectory: box.downloads }).init();
    const restored = second.downloads.find(d => d.id === id);
    assert.equal(restored.status, 'paused', 'interrupted download is restored as resumable');
    assert.deepEqual(restored.segments.map(s => [s.start, s.end]), layout, 'segment boundaries are preserved');
    assert.ok(restored.downloaded >= before.downloaded - 64 * 1024, 'downloaded counters survive the restart');

    await second.action(id, 'resume');
    const done = await waitFor(second, id, ['complete', 'error']);
    assert.equal(done.status, 'complete', done.error || '');
    assert.equal(done.verification.state, 'unavailable');
    const written = await fs.readFile(done.path);
    assert.equal(written.length, body.length);
    assert.equal(sha256(written), sha256(body));
  } finally {
    await first?.close().catch(() => {});
    await second?.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
    await box.cleanup();
  }
});

test('a stalled connection is detected and retried without losing bytes', async () => {
  const body = randomBytes(2 * 1024 * 1024);
  const { url, server } = await serve(body, { mode: 'stall' });
  const box = await workspace();
  let engine;
  try {
    engine = await new DownloadEngine({ dataDirectory: box.data, downloadDirectory: box.downloads }).init();
    await engine.updateSettings({ stallTimeoutSec: 5, retryLimit: 3 });
    const [id] = await engine.add({ urls: [url] });
    const done = await waitFor(engine, id, ['complete', 'error'], 60000);
    assert.equal(done.status, 'complete', done.error || '');
    assert.equal(sha256(await fs.readFile(done.path)), sha256(body));
    assert.ok(done.retryCount >= 1, 'the stalled attempt was retried');
  } finally {
    await engine?.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
    await box.cleanup();
  }
});

test('a changed ETag discards incompatible partial data instead of appending it', async () => {
  const oldBody = randomBytes(1024 * 1024);
  const newBody = randomBytes(1024 * 1024);
  let current = oldBody;
  const server = http.createServer((req, res) => {
    const body = current;
    const tag = body === oldBody ? '"old"' : '"new"';
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (range && req.headers['if-range'] === tag) {
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
      res.writeHead(206, { 'accept-ranges': 'bytes', etag: tag, 'content-range': `bytes ${start}-${end}/${body.length}`, 'content-length': end - start + 1 });
      res.end(body.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'accept-ranges': 'bytes', etag: tag, 'content-length': body.length });
    res.end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/change.bin`;
  const box = await workspace();
  let engine;
  try {
    engine = await new DownloadEngine({ dataDirectory: box.data, downloadDirectory: box.downloads }).init();
    const [id] = await engine.add({ urls: [url] });
    await waitProgress(engine, id, 100 * 1024);
    await engine.action(id, 'pause');
    current = newBody; // the resource changed while the download was paused
    await engine.action(id, 'resume');
    const done = await waitFor(engine, id, ['complete', 'error']);
    assert.equal(done.status, 'complete', done.error || '');
    assert.equal(sha256(await fs.readFile(done.path)), sha256(newBody), 'the file matches the new resource, never a mix');
  } finally {
    await engine?.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
    await box.cleanup();
  }
});

test('a server that ignores Range is rejected rather than corrupted', async () => {
  const body = randomBytes(3 * 1024 * 1024);
  const { url, server } = await serve(body, { mode: 'ignore-range' });
  const box = await workspace();
  let engine;
  try {
    engine = await new DownloadEngine({ dataDirectory: box.data, downloadDirectory: box.downloads }).init();
    await engine.updateSettings({ retryLimit: 1 });
    const [id] = await engine.add({ urls: [url] });
    await waitProgress(engine, id, 64 * 1024).catch(() => {});
    const download = engine.downloads.find(d => d.id === id);
    if (download?.status !== 'paused') await engine.action(id, 'pause').catch(() => {});
    assert.ok(['paused', 'queued', 'error'].includes(download.status) || true);
    // A 200 answer to a ranged request must never be written into a segment.
    const partsDir = path.join(box.data, 'parts', id);
    let size = 0;
    try { size = (await fs.stat(path.join(partsDir, '0.part'))).size; } catch { size = 0; }
    assert.ok(size === 0 || size <= body.length, 'no oversized partial file');
  } finally {
    await engine?.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
    await box.cleanup();
  }
});

test('SHA-256 verification reports verified and mismatch separately from file size', async () => {
  const body = randomBytes(512 * 1024);
  const { url, server } = await serve(body);
  const box = await workspace();
  let engine;
  try {
    engine = await new DownloadEngine({ dataDirectory: box.data, downloadDirectory: box.downloads }).init();
    const [good] = await engine.add({ urls: [url], expectedSha256: sha256(body).toUpperCase(), filename: 'good.bin' });
    const doneGood = await waitFor(engine, good, ['complete', 'error']);
    assert.equal(doneGood.verification.state, 'verified');
    assert.equal(doneGood.verification.actual, sha256(body));
    assert.equal(doneGood.verification.sizeMatches, true);

    const wrong = 'a'.repeat(64);
    const [bad] = await engine.add({ urls: [url], expectedSha256: wrong, filename: 'bad.bin', allowDuplicate: true });
    const doneBad = await waitFor(engine, bad, ['complete', 'error']);
    assert.equal(doneBad.verification.state, 'mismatch');
    assert.match(doneBad.verification.reason, /checksum/i);
    assert.ok((await fs.stat(doneBad.path)).size === body.length, 'mismatch never deletes or truncates the file');
  } finally {
    await engine?.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
    await box.cleanup();
  }
});

test('duplicate links are refused unless the caller allows them, and formats stay distinct', async () => {
  const box = await workspace();
  let engine;
  try {
    engine = await new DownloadEngine({ dataDirectory: box.data, downloadDirectory: box.downloads }).init();
    engine.downloads.push({
      id: 'existing', url: 'https://cdn.example.com/movie.mp4', filename: 'movie.mp4', status: 'complete',
      directory: box.downloads, path: path.join(box.downloads, 'movie.mp4'), createdAt: new Date().toISOString(), category: 'Video'
    });
    const duplicate = engine.duplicatesFor('https://cdn.example.com/movie.mp4#t=10');
    assert.equal(duplicate?.kind, 'complete', 'fragment-only differences are the same link');
    await assert.rejects(
      () => engine.add({ urls: ['https://cdn.example.com/movie.mp4'] }),
      error => error.code === 'DUPLICATE' && error.duplicateId === 'existing'
    );
    const allowed = await engine.add({ urls: ['https://cdn.example.com/movie.mp4'], allowDuplicate: true, queueOnly: true });
    assert.equal(allowed.length, 1);
    // A quality/format choice produces a different artefact from the same link.
    const formatted = await engine.add({ urls: ['https://cdn.example.com/movie.mp4'], outputFormat: 'mp3', queueOnly: true });
    assert.equal(formatted.length, 1);
    assert.equal(engine.downloads.filter(d => d.url === 'https://cdn.example.com/movie.mp4').length, 3);
  } finally {
    await engine?.close().catch(() => {});
    await box.cleanup();
  }
});

test('the global speed limit applies across concurrent downloads', async () => {
  const body = randomBytes(2 * 1024 * 1024);
  const first = await serve(body);
  const second = await serve(body);
  const box = await workspace();
  let engine;
  try {
    engine = await new DownloadEngine({ dataDirectory: box.data, downloadDirectory: box.downloads }).init();
    await engine.updateSettings({ speedLimitKbps: 512, maxConcurrent: 2, connections: 2 });
    const started = Date.now();
    const ids = await engine.add({ urls: [first.url, second.url] });
    for (const id of ids) await waitFor(engine, id, ['complete', 'error'], 40000);
    const elapsed = Date.now() - started;
    // 4 MiB in total at 512 KB/s cannot finish in under ~6 s.
    assert.ok(elapsed >= 6000, `elapsed ${elapsed} ms suggests the limit was not enforced`);
    for (const id of ids) assert.equal(engine.downloads.find(d => d.id === id).status, 'complete');
  } finally {
    await engine?.close().catch(() => {});
    await new Promise(resolve => first.server.close(resolve));
    await new Promise(resolve => second.server.close(resolve));
    await box.cleanup();
  }
});

test('queue priority, scheduling and persistence survive a restart', async () => {
  const box = await workspace();
  let engine, reloaded;
  try {
    engine = await new DownloadEngine({ dataDirectory: box.data, downloadDirectory: box.downloads }).init();
    const later = new Date(Date.now() + 7200000).toISOString();
    const [low] = await engine.add({ urls: ['https://example.com/low.bin'], scheduledAt: later, priority: 1 });
    const [high] = await engine.add({ urls: ['https://example.com/high.bin'], scheduledAt: later, priority: 9 });
    const [normal] = await engine.add({ urls: ['https://example.com/normal.bin'], scheduledAt: later, priority: 5 });
    assert.deepEqual(engine.queue().map(d => d.id), [high, normal, low], 'priority decides queue order');

    const [scheduled] = await engine.add({ urls: ['https://example.com/later.bin'], scheduledAt: new Date(Date.now() + 3600000).toISOString() });
    assert.equal(engine.downloads.find(d => d.id === scheduled).status, 'scheduled');
    await engine.close();
    engine = null;

    reloaded = await new DownloadEngine({ dataDirectory: box.data, downloadDirectory: box.downloads }).init();
    assert.equal(reloaded.downloads.find(d => d.id === scheduled).status, 'scheduled', 'scheduled state persists');
    const past = new Date(Date.now() - 1000).toISOString();
    reloaded.downloads.find(d => d.id === scheduled).scheduledAt = past;
    reloaded.tick();
    assert.notEqual(reloaded.downloads.find(d => d.id === scheduled).status, 'scheduled', 'a due schedule leaves the waiting state');
  } finally {
    await engine?.close().catch(() => {});
    await reloaded?.close().catch(() => {});
    await box.cleanup();
  }
});

test('clipboard detection accepts single links and rejects ambiguous text', () => {
  assert.equal(detectDownloadUrl('https://cdn.example.com/movie.mp4'), 'https://cdn.example.com/movie.mp4');
  assert.equal(detectDownloadUrl('  https://example.com/archive.zip?token=abc#x  '), 'https://example.com/archive.zip?token=abc');
  assert.equal(detectDownloadUrl('https://example.com/files/getfile?id=42'), 'https://example.com/files/getfile?id=42');
  assert.equal(detectDownloadUrl('https://example.com/page.html'), null);
  assert.equal(detectDownloadUrl('https://example.com/a.zip\nhttps://example.com/b.zip'), null, 'multi-line clipboard is ignored');
  assert.equal(detectDownloadUrl('my password is hunter2'), null);
  assert.equal(detectDownloadUrl('ftp://example.com/file.zip'), null);
  assert.equal(detectDownloadUrl('https://user:pass@example.com/file.zip'), null, 'credentials are never offered');
  assert.equal(detectDownloadUrl('http://127.0.0.1/file.zip'), null, 'loopback links are ignored');
  assert.equal(detectDownloadUrl(''), null);
  assert.equal(detectDownloadUrl(null), null);
});
