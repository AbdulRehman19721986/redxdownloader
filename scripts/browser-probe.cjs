/* Diagnostic: does this Chrome build load the unpacked extension from CLI? */
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');

const extension = path.join(__dirname, '..', 'extension');
const dir = path.join(os.tmpdir(), `redx-probe-${Date.now()}`);

(async () => {
  const out = { attempts: [] };
  for (const channel of ['chrome', undefined]) {
    try {
      const context = await chromium.launchPersistentContext(path.join(dir, channel || 'chromium'), {
        channel, headless: false,
        args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run', '--no-default-browser-check']
      });
      await new Promise(resolve => setTimeout(resolve, 3000));
      const session = await context.browser()?.newBrowserCDPSession();
      let targets = [];
      if (session) {
        const result = await session.send('Target.getTargets');
        targets = result.targetInfos.map(info => ({ type: info.type, url: info.url.slice(0, 90) }));
        await session.detach();
      }
      out.attempts.push({
        channel: channel || 'bundled-chromium',
        version: context.browser()?.version(),
        workers: context.serviceWorkers().map(w => w.url()),
        extensionTargets: targets.filter(t => t.url.startsWith('chrome-extension://') || t.type.includes('service_worker')),
        pages: context.pages().length
      });
      await context.close();
    } catch (error) {
      out.attempts.push({ channel: channel || 'bundled-chromium', error: error.message.split('\n')[0] });
    }
  }
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})();
