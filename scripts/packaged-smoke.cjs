/* Launches the built application, drives it through CDP and reports what the
   packaged runtime actually produced (window, IPC, browser integration files). */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const exe = path.join(root, 'release-v4', 'win-unpacked', 'RedX Downloader.exe');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const report = { exe, exists: fs.existsSync(exe) };
  const child = spawn(exe, ['--remote-debugging-port=9333'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const { chromium } = require('playwright');
  let browser;
  try {
    for (let attempt = 0; attempt < 40; attempt++) {
      try { browser = await chromium.connectOverCDP('http://127.0.0.1:9333'); break; }
      catch { await delay(500); }
    }
    if (!browser) throw new Error('no devtools');
    let page = browser.contexts()[0].pages().find(p => p.url().includes('index.html'));
    if (!page) { page = await browser.contexts()[0].waitForEvent('page', { timeout: 15000 }); await page.waitForLoadState('domcontentloaded'); }
    await page.waitForFunction(() => typeof window.downloader?.snapshot === 'function', null, { timeout: 20000 });
    await delay(1500);
    report.title = await page.title();
    report.rows = await page.locator('.row').count();
    const snapshot = await page.evaluate(() => window.downloader.snapshot());
    report.integration = snapshot.integration;
    report.version = await page.evaluate(async () => (await window.downloader.appInfo()).version);
    report.settings = await page.evaluate(async () => { const s = await window.downloader.snapshot(); return { startBehaviour: s.settings.browserStartBehavior, cookies: s.settings.cookiesFromBrowser, verify: s.settings.verifyAfterDownload }; });
    report.progressMarkup = await page.evaluate(() => Boolean(document.querySelector('#p-limit') && document.querySelector('#p-oncomplete')));
    report.ui = await page.evaluate(() => ({ bulkBar: Boolean(document.querySelector('#bulk-bar')), aboutPanel: Boolean(document.querySelector('[data-panel="about"]')), sections: [...document.querySelectorAll('.settings-nav button')].map(b => b.textContent) }));
    await page.evaluate(() => openSettings('about'));
    await delay(400);
    report.aboutVersion = await page.locator('#settings-version').textContent().catch(() => null);
    await page.evaluate(() => document.querySelector('#about-button').click());
    await delay(400);
    report.aboutOwner = await page.locator('.about-owner').textContent();
    await page.evaluate(() => document.querySelector('#about-dialog').close());
    await page.screenshot({ path: path.join(__dirname, 'packaged-app.png') });
    const integrationDir = path.join(process.env.USERPROFILE, '.redx-downloader', 'BrowserIntegration', 'integration');
    report.integrationFiles = fs.existsSync(integrationDir) ? fs.readdirSync(integrationDir) : [];
    report.nativeHostExe = fs.existsSync(path.join(integrationDir, 'native-host.exe'));
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
