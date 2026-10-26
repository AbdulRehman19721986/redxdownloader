const { app, BrowserWindow } = require('electron'); const fs=require('node:fs'); const path=require('node:path');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const file = path.join(__dirname,'tmp-test.html');
  fs.writeFileSync(file,'<html><body style="margin:0;background:transparent"><div style="width:100vw;height:100vh;background:#ff2638"></div></body></html>');
  for (const size of [16,24,32,48,64,128,256]) {
    const win = new BrowserWindow({width:size,height:size,show:false,frame:false,transparent:true,useContentSize:true,resizable:false,webPreferences:{offscreen:false,sandbox:true}});
    try { await win.loadFile(file); await new Promise(r=>setTimeout(r,80)); const img = await win.webContents.capturePage(); console.log(size, 'ok', JSON.stringify(img.getSize())); }
    catch (e) { console.log(size, 'FAIL', e.code, e.errno, win.isDestroyed(), win.getSize()); }
    win.destroy();
  }
  app.quit();
});
