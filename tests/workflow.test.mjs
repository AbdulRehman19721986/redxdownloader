import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
import os from 'node:os';
import path from 'node:path';
import { DownloadEngine } from '../core/engine.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function workspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redx-workflow-'));
  const data = path.join(root, 'data'), downloads = path.join(root, 'downloads');
  await fs.mkdir(data, { recursive: true });
  await fs.mkdir(downloads, { recursive: true });
  return { root, data, downloads, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

function serve(body) {
  const server = http.createServer((req, res) => {
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
      res.writeHead(206, { 'content-type': 'application/octet-stream', 'accept-ranges': 'bytes', etag: '"w"', 'content-range': `bytes ${start}-${end}/${body.length}`, 'content-length': end - start + 1 });
      res.end(body.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'accept-ranges': 'bytes', etag: '"w"', 'content-length': body.length });
    res.end(body);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/f.bin` })));
}

async function waitFor(engine, id, statuses = ['complete', 'error'], timeout = 40000) {
  const deadline = Date.now() + timeout;
  let d;
  while (Date.now() < deadline) {
    d = engine.downloads.find(item => item.id === id);
    if (d && statuses.includes(d.status)) return d;
    await delay(100);
  }
  throw new Error(`timeout: ${d?.status} ${d?.error || ''}`);
}

test('a per-download speed limit paces only that download', async () => {
  const body = randomBytes(768 * 1024);
  const { url, server } = await serve(body);
  const box = await workspace();
  let engine;
  try {
    engine = await new DownloadEngine({ dataDirectory: box.data, downloadDirectory: box.downloads }).init();
    // No global limit: the per-download cap must be what slows this transfer.
    await engine.updateSettings({ speedLimitKbps: 0, connections: 2 });
    const [id] = await engine.add({ urls: [url] });
    await engine.action(id, 'limit', 256);
    const started = Date.now();
    const done = await waitFor(engine, id);
    const elapsed = Date.now() - started;
    assert.equal(done.status, 'complete', done.error || '');
    assert.ok(elapsed >= 2000, `768 KiB at 256 KB/s finished in ${elapsed} ms`);
    assert.equal(done.speedLimitKbps, 256);
  } finally {
    await engine?.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
    await box.cleanup();
  }
});

test('per-download limit and completion action persist and validate', async () => {
  const box = await workspace();
  let engine, reloaded;
  try {
    engine = await new DownloadEngine({ dataDirectory: box.data, downloadDirectory: box.downloads }).init();
    const [id] = await engine.add({ urls: ['https://example.com/big.iso'], queueOnly: true });
    await engine.action(id, 'limit', 1024);
    await engine.action(id, 'onComplete', 'open');
    await assert.rejects(() => engine.action(id, 'onComplete', 'explode'), /Invalid completion action/);
    await assert.rejects(() => engine.action(id, 'limit', -5), /Invalid speed limit/);
    await engine.close();
    engine = null;

    reloaded = await new DownloadEngine({ dataDirectory: box.data, downloadDirectory: box.downloads }).init();
    const restored = reloaded.downloads.find(d => d.id === id);
    assert.equal(restored.speedLimitKbps, 1024);
    assert.equal(restored.onComplete, 'open');
  } finally {
    await engine?.close().catch(() => {});
    await reloaded?.close().catch(() => {});
    await box.cleanup();
  }
});

test('browser start behaviour defaults to automatic and persists', async () => {
  const box = await workspace();
  let engine, reloaded;
  try {
    engine = await new DownloadEngine({ dataDirectory: box.data, downloadDirectory: box.downloads }).init();
    assert.equal(engine.settings.browserStartBehavior, 'auto', 'automatic start is the default');
    // updateSettings validates synchronously, so wrap it to observe the rejection.
    await assert.rejects(async () => engine.updateSettings({ browserStartBehavior: 'sometimes' }), /Invalid download start behaviour/);
    await engine.updateSettings({ browserStartBehavior: 'queue' });
    await engine.close();
    engine = null;

    reloaded = await new DownloadEngine({ dataDirectory: box.data, downloadDirectory: box.downloads }).init();
    assert.equal(reloaded.settings.browserStartBehavior, 'queue');
  } finally {
    await engine?.close().catch(() => {});
    await reloaded?.close().catch(() => {});
    await box.cleanup();
  }
});

test('unlimited mode is the default and applies no artificial pacing', async () => {
  const body = randomBytes(3 * 1024 * 1024);
  const { url, server } = await serve(body);
  const box = await workspace();
  let engine;
  try {
    engine = await new DownloadEngine({ dataDirectory: box.data, downloadDirectory: box.downloads }).init();
    assert.equal(engine.settings.speedLimitKbps, 0, 'no global cap by default');
    const started = Date.now();
    const [id] = await engine.add({ urls: [url] });
    const done = await waitFor(engine, id);
    const elapsed = Date.now() - started;
    assert.equal(done.status, 'complete', done.error || '');
    assert.equal(done.speedLimitKbps, undefined, 'no per-download cap is set by default');
    // A 3 MiB loopback transfer through a limiter would take seconds; the only
    // bound here is the local round trip, not an application throttle.
    assert.ok(elapsed < 8000, `3 MiB took ${elapsed} ms with no limit configured`);
    assert.equal(sha256(await fs.readFile(done.path)), sha256(body));
  } finally {
    await engine?.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
    await box.cleanup();
  }
});
