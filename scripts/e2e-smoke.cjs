/*
 * End-to-end smoke test against the real desktop app (desktop/main.cjs).
 * Starts a range-capable local server, launches Electron with the DevTools
 * protocol, drives the real preload IPC from the renderer, then verifies the
 * bytes on disk.
 *   node scripts/e2e-smoke.cjs
 */
const { spawn } = require('node:child_process');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'tmp-e2e');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const chunks = [];
for (let i = 0; i < 384; i++) chunks.push(crypto.randomBytes(65536));
const payload = Buffer.concat(chunks); // 24 MiB
const digest = crypto.createHash('sha256').update(payload).digest('hex');
const etag = '"' + digest.slice(0, 16) + '"';

const server = http.createServer((req, res) => {
  if (!req.url.startsWith('/test.bin')) { res.writeHead(404); res.end(); return; }
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
  if (range && req.headers['if-range'] === etag) {
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), payload.length - 1) : payload.length - 1;
    res.writeHead(206, {
      'content-type': 'application/octet-stream', 'accept-ranges': 'bytes', etag,
      'content-range': `bytes ${start}-${end}/${payload.length}`, 'content-length': end - start + 1
    });
    res.end(payload.subarray(start, end + 1));
    return;
  }
  res.writeHead(200, { 'content-type': 'application/octet-stream', 'accept-ranges': 'bytes', etag, 'content-length': payload.length });
  res.end(payload);
});

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  await new Promise(resolve => server.listen(8899, '127.0.0.1', resolve));
  const electron = spawn(path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--remote-debugging-port=9222'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, REDX_E2E: '1' }
  });
  let stderr = '';
  electron.stderr.on('data', chunk => { stderr += chunk.toString(); });

  const { chromium } = require('playwright');
  let browser, report = { steps: [] };
  try {
    for (let attempt = 0; attempt < 40; attempt++) {
      try { browser = await chromium.connectOverCDP('http://127.0.0.1:9222'); break; }
      catch { await delay(500); }
    }
    if (!browser) throw new Error('DevTools endpoint never became available');
    const context = browser.contexts()[0];
    let page = context.pages().find(p => p.url().includes('renderer/index.html'));
    if (!page) { page = await context.waitForEvent('page', { timeout: 20000 }); await page.waitForLoadState('domcontentloaded'); }
    await page.waitForFunction(() => typeof window.downloader?.snapshot === 'function', null, { timeout: 20000 });
    await page.waitForTimeout(1200);
    report.title = await page.title();
    report.rows = await page.locator('.row').count();
    report.menuBar = await page.evaluate(() => document.querySelector('#new-download')?.textContent?.trim());
    await page.screenshot({ path: path.join(__dirname, 'e2e-app.png') });

    await page.evaluate(async () => {
      const current = await window.downloader.snapshot();
      for (const d of current.downloads.filter(d => ['test.bin', 'second-copy.bin'].includes(d.filename))) {
        try { await window.downloader.action({ id: d.id, action: 'remove' }); } catch { /* stale */ }
      }
    });
    await page.evaluate(async dir => {
      await window.downloader.settings({ defaultDirectory: dir, maxConcurrent: 2, connections: 4, speedLimitKbps: 4096 });
      await window.downloader.add({ urls: ['http://127.0.0.1:8899/test.bin'] });
    }, outDir);
    report.steps.push('add via real IPC');

    let snapshot, item;
    for (let i = 0; i < 120; i++) {
      snapshot = await page.evaluate(() => window.downloader.snapshot());
      item = snapshot.downloads.filter(d => d.filename === 'test.bin').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
      if (item && ['complete', 'error', 'cancelled'].includes(item.status)) break;
      await delay(500);
    }
    report.download = { status: item.status, verification: item.verification?.state, bytes: item.downloaded, total: item.total, connections: item.connections, path: item.path, resumable: item.resumable, verification: item.verification?.state, error: item.error };
    if (item.path && fs.existsSync(item.path)) {
      const written = fs.readFileSync(item.path);
      report.download.fileBytes = written.length;
      report.download.sha256Matches = crypto.createHash('sha256').update(written).digest('hex') === digest;
      fs.rmSync(item.path, { force: true });
    }
    // Pause / resume against the same server.
    await page.evaluate(async dir => {
      await window.downloader.add({ urls: ['http://127.0.0.1:8899/test.bin?copy=2'], filename: 'second-copy.bin' });
    }, outDir);
    let second;
    for (let i = 0; i < 40; i++) {
      second = (await page.evaluate(() => window.downloader.snapshot())).downloads.find(d => d.filename.startsWith('second-copy'));
      if (second && second.status === 'downloading' && second.downloaded > 0) break;
      await delay(250);
    }
    await page.evaluate(id => window.downloader.action({ id, action: 'pause' }), second.id);
    await delay(400);
    const paused = (await page.evaluate(() => window.downloader.snapshot())).downloads.find(d => d.id === second.id);
    await page.evaluate(id => window.downloader.action({ id, action: 'resume' }), second.id);
    let resumed;
    for (let i = 0; i < 120; i++) {
      resumed = (await page.evaluate(() => window.downloader.snapshot())).downloads.find(d => d.id === second.id);
      if (['complete', 'error'].includes(resumed.status)) break;
      await delay(400);
    }
    report.pauseResume = { pausedStatus: paused.status, pausedBytes: paused.downloaded, finalStatus: resumed.status, finalBytes: resumed.downloaded, path: resumed.path, error: resumed.error || null };
    if (resumed.path && fs.existsSync(resumed.path)) {
      report.pauseResume.sha256Matches = crypto.createHash('sha256').update(fs.readFileSync(resumed.path)).digest('hex') === digest;
      fs.rmSync(resumed.path, { force: true });
    }
    await page.screenshot({ path: path.join(__dirname, 'e2e-after.png') });
  } catch (error) {
    report.error = error.message;
    report.stderr = stderr.slice(-1500);
  } finally {
    try { await browser?.close(); } catch { /* ignore */ }
    await pageCleanup();
    server.close();
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }

  async function pageCleanup() {
    try { electron.kill(); } catch { /* ignore */ }
    await delay(600);
    spawn('taskkill', ['/PID', String(electron.pid), '/T', '/F'], { stdio: 'ignore' });
  }
})();
