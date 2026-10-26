/*
 * Runs the built application and completes a real YouTube download through it.
 * This is the only way to prove the packaged path resolution for
 * resources/tools/yt-dlp.exe and the unpacked FFmpeg binary.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const exe = path.join(root, 'release-final', 'win-unpacked', 'RedX Downloader.exe');
const outDir = path.join(root, 'tmp-yt-packaged');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const report = { exe, outDir };
  const child = spawn(exe, ['--remote-debugging-port=9444'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const { chromium } = require('playwright');
  let browser;
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      try { browser = await chromium.connectOverCDP('http://127.0.0.1:9444'); break; }
      catch { await delay(500); }
    }
    if (!browser) throw new Error('devtools never became available');
    let page = browser.contexts()[0].pages().find(p => p.url().includes('index.html'));
    if (!page) { page = await browser.contexts()[0].waitForEvent('page', { timeout: 20000 }); await page.waitForLoadState('domcontentloaded'); }
    await page.waitForFunction(() => typeof window.downloader?.add === 'function', null, { timeout: 25000 });

    const info = await page.evaluate(async dir => {
      await window.downloader.settings({ defaultDirectory: dir, maxConcurrent: 1, connections: 4 });
      const ids = await window.downloader.add({ urls: ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'], youtubeFormat: '134+140', filename: 'packaged-check.mp4' });
      return ids[0];
    }, outDir);

    let item;
    for (let i = 0; i < 150; i++) {
      item = (await page.evaluate(() => window.downloader.snapshot())).downloads.find(d => d.id === info);
      if (item && ['complete', 'error', 'cancelled'].includes(item.status)) break;
      await delay(1000);
    }
    report.status = item?.status;
    report.error = item?.error || null;
    report.bytes = item?.total;
    report.duration = item?.duration;
    report.file = item?.path ? path.basename(item.path) : null;
    if (item?.path && fs.existsSync(item.path)) {
      report.fileBytes = fs.statSync(item.path).size;
      report.verifiedFile = true;
    }
    await page.screenshot({ path: path.join(__dirname, 'packaged-youtube.png') });
  } catch (error) {
    report.error = error.message;
    report.stderr = stderr.slice(-1200);
  } finally {
    try { await browser?.close(); } catch { /* ignore */ }
    child.kill();
    await delay(500);
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }
})();
