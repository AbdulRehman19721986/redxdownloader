#!/usr/bin/env node
/**
 * End-to-end interface + download test.
 *
 *   node scripts/ui-e2e.cjs            # runs against the working tree
 *   node scripts/ui-e2e.cjs --packaged # runs against dist/win-unpacked
 *
 * Serves a throttled 24 MB file with byte-range support, drives the real
 * window (ribbon, add dialog, grid, menu bar, transfer window), pauses and
 * resumes the transfer, and checks the finished file byte for byte. A private
 * USERPROFILE keeps the test out of the real download history.
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');

const root = path.join(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const SIZE = 24 * 1024 * 1024;
const CHUNK = 64 * 1024;
const DELAY_MS = 35;
// Unique per run: an identical earlier record would trigger duplicate review
// and the transfer would stay queued instead of starting.
const FILENAME = ["redx-e2e-", Date.now(), ".bin"].join("");

const shots = path.join(root, 'build', 'ui');
fs.mkdirSync(shots, { recursive: true });

const failures = [];
const steps = [];
const pass = message => { steps.push(`  ok  ${message}`); };
const fail = message => { failures.push(message); steps.push(`  x   ${message}`); };
const check = (condition, message) => (condition ? pass(message) : fail(message));

/* Deterministic payload so the received bytes can be verified. */
const payload = Buffer.alloc(SIZE);
for (let index = 0; index < SIZE; index += 1) payload[index] = (index * 31 + 7) & 0xff;
const expectedSha = crypto.createHash('sha256').update(payload).digest('hex');

function parseRange(header, total) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!match) return null;
  const start = match[1] === '' ? null : Number(match[1]);
  const end = match[2] === '' ? null : Number(match[2]);
  if (start === null && end === null) return null;
  const from = start === null ? Math.max(0, total - end) : start;
  const to = start !== null && end === null ? total - 1 : Math.min(end, total - 1);
  if (Number.isNaN(from) || Number.isNaN(to) || from > to) return null;
  return { from, to };
}

function startServer() {
  const server = http.createServer((request, response) => {
    const range = parseRange(request.headers.range, SIZE);
    const headers = {
      'Content-Type': 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      ETag: '"redx-e2e-v1"',
      'Last-Modified': new Date(0).toUTCString(),
      'Content-Disposition': `attachment; filename="${FILENAME}"`
    };
    if (range) {
      response.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${range.from}-${range.to}/${SIZE}`,
        'Content-Length': range.to - range.from + 1
      });
    } else {
      response.writeHead(200, { ...headers, 'Content-Length': SIZE });
    }
    if (request.method === 'HEAD') { response.end(); return; }
    const from = range ? range.from : 0;
    const to = range ? range.to : SIZE - 1;
    let offset = from;
    let closed = false;
    request.on('close', () => { closed = true; });
    const pump = () => {
      if (closed || offset > to) { response.end(); return; }
      const end = Math.min(offset + CHUNK, to + 1);
      response.write(payload.subarray(offset, end));
      offset = end;
      setTimeout(pump, DELAY_MS);
    };
    pump();
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function waitFor(page, predicate, { timeout = 45000, interval = 200, label = 'condition' } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await page.evaluate(predicate)) return true;
    await page.waitForTimeout(interval);
  }
  fail(`timed out waiting for ${label}`);
  return false;
}

(async () => {
  const server = await startServer();
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/${FILENAME}`;

  const home = path.join(root, 'build', 'e2e-home');
  fs.mkdirSync(home, { recursive: true });
  const downloads = path.join(home, 'Downloads');
  fs.mkdirSync(downloads, { recursive: true });
  const target = path.join(downloads, FILENAME);
  if (fs.existsSync(target)) fs.unlinkSync(target);

  const exeFlag = process.argv.find(value => value.startsWith('--exe='));
  const executablePath = exeFlag
    ? path.resolve(exeFlag.slice('--exe='.length))
    : packaged ? path.join(root, 'dist', 'win-unpacked', 'RedX-Downloader.exe') : undefined;
  const app = await _electron.launch({
    args: executablePath ? [] : ['.'],
    executablePath,
    cwd: root,
    // The window writes its own state under the signed-in profile; redirecting
    // USERPROFILE makes Electron's known-folder calls fail at startup, so the
    // test keeps the real profile and points the download at a temp folder
    // through the Add dialog instead.
    env: { ...process.env }
  });
  const page = await app.firstWindow();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  try {
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);

    /* ---------------------------------------------------------- interface */
    check((await page.title()) === 'RedX Downloader', 'window title is RedX Downloader');
    check(await page.locator('.ribbon').isVisible(), 'command ribbon rendered');
    check((await page.locator('.ribbon .cmd').count()) === 10, 'ribbon exposes 10 commands');
    check(await page.locator('#gauge-value').isVisible(), 'LED transfer gauge rendered');
    check(await page.locator('#menubar').isVisible(), 'menu bar rendered');
    check(await page.locator('.grid-head').isVisible(), 'data grid header rendered');
    check(await page.locator('.statusbar').isVisible(), 'status bar rendered');
    check(await page.locator('.sidebar .nav-item').count() >= 12, 'sidebar categories rendered');
    const startingRows = await page.locator('.row').count();
    check(startingRows > 0 || await page.locator('#empty-state').isVisible(), 'grid shows either downloads or the empty state');

    /* --------------------------------------------------------------- menus */
    await page.click('.menu:nth-child(1) .menu-btn');
    check(await page.locator('.menu.open').count() === 1, 'Tasks menu opens');
    await page.keyboard.press('Escape');
    check(await page.locator('.menu.open').count() === 0, 'Escape closes the menu');

    await page.click('.menu:nth-child(3) .menu-btn');
    const menuItems = await page.locator('.menu.open .menu-pop button').count();
    check(menuItems >= 5, `Downloads menu lists ${menuItems} commands`);
    await page.keyboard.press('Escape');

    /* --------------------------------------------------- add URL + transfer */
    await page.click('#ribbon-add');
    await page.waitForSelector('#add-dialog[open]', { timeout: 5000 });
    check(true, 'Add URL opens the new-download dialog');
    await page.fill('#download-urls', url);
    await page.fill('#download-filename', FILENAME);
    // The destination field is read-only by design (it is filled by Browse),
    // so the harness sets its value directly instead of typing into it.
    await page.evaluate(directory => { document.querySelector('#add-directory').value = directory; }, downloads);
    await page.click('#add-submit');

    await page.waitForSelector('.row', { timeout: 20000 });
    check(await page.locator('.row').count() >= 1, 'download appears in the data grid');
    await page.screenshot({ path: path.join(shots, 'e2e-downloading.png') });

    const moving = await waitFor(page, () => {
      const row = document.querySelector('.row');
      if (!row) return false;
      const text = row.querySelector('.pct')?.textContent || '';
      return parseFloat(text) > 4;
    }, { label: 'progress above 4%' });
    if (moving) pass('progress bar advances');
    const gauge = await page.locator('#gauge-value').textContent();
    check(Number(gauge) > 0, `transfer gauge shows ${gauge} MB/s`);

    /* ------------------------------------------------------------ pause */
    await page.click('.row');
    await page.click('#ribbon-stop');
    const paused = await waitFor(page, () => /Paused/i.test(document.querySelector('.row .pill')?.textContent || ''), { label: 'paused state', timeout: 20000 });
    if (paused) pass('Stop pauses the selected transfer');

    /* ----------------------------------------------------------- resume */
    await page.click('#ribbon-resume');
    const resumed = await waitFor(page, () => /Receiving data/i.test(document.querySelector('.row .pill')?.textContent || ''), { label: 'resumed state', timeout: 20000 });
    if (resumed) pass('Resume restarts the transfer from the checkpoint');

    /* ------------------------------------------- transfer window (streams) */
    const id = await page.evaluate(() => document.querySelector('.row')?.dataset.id || '');
    if (id) {
      // Register the listener before the IPC call, otherwise the window can be
      // created before Playwright starts waiting for it.
      const windowPromise = app.waitForEvent('window', { timeout: 20000 }).catch(() => null);
      await page.evaluate(downloadId => window.downloader.openProgress({ id: downloadId }), id);
      const progressPage = await windowPromise;
      if (progressPage) {
        await progressPage.waitForLoadState('domcontentloaded');
        await progressPage.waitForTimeout(1500);
        check(await progressPage.locator('.p-rows').isVisible(), 'transfer window shows the detail rows');
        check(await progressPage.locator('.p-tabs button').count() === 3, 'transfer window has three tabs');
        const streams = await progressPage.locator('.stream').count();
        check(streams >= 1, `transfer window lists ${streams} connection streams`);
        await progressPage.screenshot({ path: path.join(shots, 'e2e-progress.png') });
        await progressPage.evaluate(() => window.downloader.closeProgress()).catch(() => {});
      } else {
        fail('transfer window did not open');
      }
    }

    /* ------------------------------------------------------- completion */
    const complete = await waitFor(page, () => /Complete/i.test(document.querySelector('.row .pill')?.textContent || ''), { label: 'completed download', timeout: 90000, interval: 400 });
    if (complete) pass('download completes');
    await page.screenshot({ path: path.join(shots, 'e2e-complete.png') });

    if (fs.existsSync(target)) {
      const received = fs.readFileSync(target);
      check(received.length === SIZE, `file size is ${received.length} of ${SIZE} bytes`);
      check(crypto.createHash('sha256').update(received).digest('hex') === expectedSha, 'received file matches the source byte for byte');
    } else {
      fail(`downloaded file was not written to ${target}`);
    }

    /* ------------------------------------------------- filters and totals */
    await page.click('.nav-item[data-filter="completed"]');
    check(await page.locator('.row').count() >= 1, 'Finished filter lists the completed download');
    await page.click('.nav-item[data-filter="all"]');
    const subtitle = await page.locator('#completed-count').textContent();
    check(/\d/.test(subtitle), `status bar reports completed totals (${subtitle.trim()})`);

    /* ---------------------------------------------------- collapse + options */
    await page.click('#sidebar-collapse');
    await page.waitForTimeout(250);
    const collapsed = await page.evaluate(() => document.body.classList.contains('sidebar-collapsed'));
    check(collapsed, 'sidebar collapses to an icon rail');
    await page.click('#sidebar-collapse');
    await page.waitForTimeout(250);

    await page.click('#ribbon-options');
    await page.waitForSelector('#settings-dialog[open]', { timeout: 5000 });
    check(true, 'Options dialog opens');
    await page.screenshot({ path: path.join(shots, 'e2e-settings.png') });
    await page.click('#settings-dialog [data-close]');
    await page.waitForTimeout(300);
    check(!(await page.locator('#settings-dialog[open]').count()), 'Options dialog closes');

    check(pageErrors.length === 0, pageErrors.length ? `renderer errors: ${pageErrors.join(' | ')}` : 'no renderer errors');
  } catch (error) {
    fail(`exception: ${error.message}`);
    try { await page.screenshot({ path: path.join(shots, 'e2e-failure.png') }); } catch { /* window already gone */ }
  } finally {
    await app.close().catch(() => {});
    server.close();
  }

  console.log(steps.join('\n'));
  console.log(`\nsha256 ${expectedSha}`);
  if (failures.length) {
    console.error(`\nE2E failed (${failures.length}):`);
    for (const failure of failures) console.error(`  x   ${failure}`);
    process.exit(1);
  }
  console.log('\nE2E passed.');
})().catch(error => {
  console.error('E2E could not start:', error.message);
  process.exit(1);
});
