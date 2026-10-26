/*
 * Real Chrome test for the RedX extension: overlay hover persistence and
 * download hand-off. Chrome is launched by Playwright with the unpacked
 * extension loaded and the RedX desktop app running.
 */
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const extension = path.join(root, 'extension');
const userDataDir = path.join(os.tmpdir(), `redx-chrome-${Date.now()}`);
const hits = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const page = title => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px sans-serif;margin:32px;background:#fff}#dl{display:inline-block;padding:12px 18px;background:#0a7;color:#fff;border-radius:6px;text-decoration:none}</style>
</head><body><h1>${title}</h1>`;

const server = http.createServer((req, res) => {
  hits.push({ url: req.url, ua: String(req.headers['user-agent'] || '').slice(0, 40) });
  if (req.url === '/video') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(page('Video page') + '<video id="v" width="480" height="270" controls poster=""></video></body></html>');
    return;
  }
  if (req.url === '/download-page') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(page('Download page') + '<a id="dl" href="/test-file.zip">Download test file</a></body></html>');
    return;
  }
  if (req.url.startsWith('/test-file.zip')) {
    const body = Buffer.alloc(2 * 1024 * 1024, 7);
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
      res.writeHead(206, {
        'content-type': 'application/zip', 'accept-ranges': 'bytes', etag: '"redx"',
        'content-range': `bytes ${start}-${end}/${body.length}`, 'content-length': end - start + 1
      });
      res.end(body.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="test-file.zip"', 'content-length': body.length, 'accept-ranges': 'bytes', etag: '"redx"' });
    res.end(body);
    return;
  }
  res.writeHead(404); res.end();
});

(async () => {
  const report = { steps: [] };
  await new Promise(resolve => server.listen(8123, '127.0.0.1', resolve));
  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: undefined,
      headless: false,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run', '--no-default-browser-check']
    });
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20000 });
    const extensionId = new URL(worker.url()).host;
    report.extensionId = extensionId;

    const settings = await context.newPage();
    await settings.goto(`chrome-extension://${extensionId}/popup.html`);
    await settings.evaluate(() => new Promise(resolve => chrome.storage.local.set({ overlayEnabled: true }, resolve)));
    await settings.close();
    report.steps.push('extension loaded, interception enabled');

    const page = await context.newPage();
    await page.goto('http://127.0.0.1:8123/video', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const box = await page.locator('#v').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(600);
    const hostState = () => page.evaluate(() => {
      const host = [...document.documentElement.children].find(node => (node.getAttribute('style') || '').includes('2147483647'));
      if (!host) return null;
      const rect = host.getBoundingClientRect();
      return { display: host.style.display, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, w: rect.width };
    });
    const shown = await hostState();
    report.overlay = { shown: Boolean(shown && shown.display === 'block') };

    // Travel from the video to the button, pause, then idle away from it.
    if (shown && shown.w) {
      await page.mouse.move(shown.x, shown.y, { steps: 12 });
      await page.waitForTimeout(3000);
      report.overlay.visibleAfterTravel = (await hostState())?.display === 'block';
      await page.mouse.move(5, 5);
      await page.waitForTimeout(3000);
      report.overlay.visibleDuringGrace = (await hostState())?.display === 'block';
      await page.waitForTimeout(6500);
      report.overlay.hiddenAfterGrace = (await hostState())?.display === 'none';
    }
    await page.screenshot({ path: path.join(__dirname, 'chrome-overlay.png') });

    // A thumbnail that is removed from the page is the case the grace exists for.
    await page.evaluate(() => document.getElementById('v').remove());
    await page.mouse.move(5, 5);
    await page.waitForTimeout(1500);
    report.overlay.keptAfterRemoval = (await hostState())?.display === 'block';
    await page.waitForTimeout(7500);
    report.overlay.cleanedAfterGrace = (await hostState()) === null;

    // Hand-off: clicking a direct file link should not start a Chrome download.
    const downloadsBefore = hits.filter(hit => hit.url.startsWith('/test-file.zip')).length;
    const dl = await context.newPage();
    await dl.goto('http://127.0.0.1:8123/download-page', { waitUntil: 'domcontentloaded' });
    await dl.click('#dl');
    await delay(4000);
    const downloadsAfter = hits.filter(hit => hit.url.startsWith('/test-file.zip'));
    const fresh = downloadsAfter.slice(downloadsBefore);
    report.handoff = {
      pageStillOnDownloadPage: dl.url().includes('/download-page'),
      chromeFetches: fresh.filter(hit => /Chrome\//.test(hit.ua)).length,
      desktopFetches: fresh.filter(hit => /AwesomeDownloader/.test(hit.ua)).length,
      userAgents: [...new Set(fresh.map(hit => hit.ua))],
      ranges: fresh.map(hit => hit.range)
    };
    const statePath = path.join(process.env.USERPROFILE, '.redx-downloader', 'downloads.json');
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      const match = (state.downloads || []).filter(item => String(item.filename).includes('test-file'))
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0];
      report.handoff.desktopAccepted = Boolean(match);
      report.handoff.desktopStatus = match?.status || null;
      report.handoff.desktopUrl = match?.url || null;
      report.handoff.desktopError = match?.error || null;
      report.handoff.desktopFile = match?.path || null;
    }
    await dl.screenshot({ path: path.join(__dirname, 'chrome-handoff.png') });

    report.fallback = 'skipped-in-this-run';
  } catch (error) {
    report.error = error.message;
  } finally {
    try { await context?.close(); } catch { /* ignore */ }
    server.close();
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }
})();
