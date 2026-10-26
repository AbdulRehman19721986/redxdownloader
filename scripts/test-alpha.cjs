const { app, BrowserWindow } = require('electron'); const fs=require('node:fs'); const path=require('node:path');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const file = path.join(__dirname,'tmp-test.html');
  fs.writeFileSync(file,'<html><body style="margin:0;background:transparent"><svg width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#0b0d12"/></svg></body></html>');
  const win = new BrowserWindow({ width:64,height:64,show:false,frame:false,transparent:true,backgroundColor:'#00000000',webPreferences:{offscreen:false,sandbox:true} });
  await win.loadFile(file); await new Promise(r=>setTimeout(r,300));
  const bmp=(await win.webContents.capturePage()).toBitmap();
  const px=(x,y)=>{const i=(y*64+x)*4;return [bmp[i],bmp[i+1],bmp[i+2],bmp[i+3]];};
  console.log('corner',px(1,1),'center',px(32,32));
  app.quit();
});
