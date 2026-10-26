const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const file = path.join(__dirname, 'tmp-test.html');
  fs.writeFileSync(file, '<html><body style="margin:0;background:#ff2638"><svg width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#0b0d12"/></svg></body></html>');
  const win = new BrowserWindow({ width: 64, height: 64, show: false, frame: false, transparent: true, webPreferences: { offscreen: false, sandbox: true } });
  try {
    await win.loadFile(file);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'tmp-test.png'), img.toPNG());
    console.log('OK', img.getSize(), fs.statSync(path.join(__dirname, 'tmp-test.png')).size);
  } catch (e) { console.error('FAIL', e.message); }
  app.quit();
});
