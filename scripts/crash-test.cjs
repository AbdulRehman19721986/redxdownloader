/*
 * Crashes the renderer of the running desktop app and checks that the app
 * survives and restores its interface (downloads live in the main process).
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const logPath = path.join(os.homedir(), '.redx-downloader', 'logs', 'redx.log');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const report = {};
  const app = spawn(path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--remote-debugging-port=9555'], { cwd: root, stdio: 'ignore' });
  let browser;
  try {
    for (let i = 0; i < 40; i++) {
      try { browser = await chromium.connectOverCDP('http://127.0.0.1:9555'); break; }
      catch { await delay(500); }
    }
    if (!browser) throw new Error('devtools unavailable');
    const context = browser.contexts()[0];
    let page = context.pages().find(p => p.url().includes('index.html'));
    if (!page) { page = await context.waitForEvent('page', { timeout: 15000 }); await page.waitForLoadState('domcontentloaded'); }
    report.initialTitle = await page.title().catch(error => `unavailable: ${error.message.split('\n')[0]}`);
    report.aliveBefore = !app.killed && app.exitCode === null;

    await delay(1000);
    const cdp = await context.newCDPSession(page);
    cdp.send('Page.crash').catch(() => {});
    await delay(5000);

    const pages = context.pages().filter(p => p.url().includes('index.html'));
    report.pagesAfterCrash = pages.length;
    const recovered = pages[pages.length - 1];
    if (recovered) {
      await recovered.waitForLoadState('domcontentloaded').catch(() => {});
      await delay(2500);
      report.recoveredTitle = await recovered.title().catch(() => null);
      report.recoveredRows = await recovered.locator('.row').count().catch(() => -1);
      report.ipcAlive = await recovered.evaluate(() => typeof window.downloader?.snapshot === 'function').catch(() => false);
    }
    report.processAlive = app.exitCode === null;
    const log = fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/);
    report.log = log.filter(line => /renderer|uncaught|fatal|restart|relaunch/i.test(line)).slice(-6);
  } catch (error) {
    report.error = error.message;
  } finally {
    try { await browser?.close(); } catch { /* ignore */ }
    app.kill();
    await delay(500);
    spawn('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' });
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }
})();
