/* Renders the compact download window with sample data for visual checks. */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const size = 4.8 * 1024 ** 3;
const item = {
  id: 'p1', filename: 'Movie_4K_2160p.mkv', url: 'https://cdn.example.com/Movie_4K_2160p.mkv',
  sourceUrl: 'https://www.tiktok.com/@studio/video/7412345678901234567',
  category: 'Video', status: 'downloading', total: size, downloaded: size * 0.45,
  speedAvg: 10.8 * 1024 ** 2, connections: 8, resumable: true, directory: 'D:\\Downloads\\Movies',
  createdAt: new Date().toISOString(), speedLimitKbps: 0, onComplete: 'default',
  connectionsProgress: Array.from({ length: 8 }, (_, i) => ({ start: i * 100, end: i * 100 + 99, downloaded: 45, total: 100 }))
};
const snapshot = {
  downloads: [item],
  settings: { defaultDirectory: 'D:\\Downloads', theme: 'dark', showSpeedGraph: true, maxConcurrent: 3 },
  integration: { connectedBrowsers: [], packaged: true }
};
const handlers = {
  snapshot: () => snapshot, appInfo: () => ({ version: '1.0.0' }), action: () => null,
  settings: () => snapshot, copyText: () => true, closeProgress: () => null, resizeProgress: () => null,
  windowControl: () => ({ maximized: false }), openMain: () => true, duplicate: () => null,
  diagnostics: () => ({}), integration: () => snapshot.integration, openLogs: () => null, openFolder: () => null,
  browserSetup: () => null, registerBrowser: () => null, chooseDirectory: () => 'D:\\Downloads',
  clipboard: () => '', openProgress: () => null, add: () => [], review: () => []
};
for (const [name, handler] of Object.entries(handlers)) ipcMain.handle(`downloader:${name}`, (_event, data) => handler(data));

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 640, height: 620, show: true, frame: false, backgroundColor: '#0B0D12',
    webPreferences: { preload: path.join(root, 'desktop', 'preload.cjs'), contextIsolation: true, sandbox: true }
  });
  const problems = [];
  window.webContents.on('console-message', (_e, level, message) => { if (level >= 2) problems.push(message); });
  await window.loadFile(path.join(root, 'renderer', 'index.html'), { query: { progress: 'p1' } });
  await new Promise(resolve => setTimeout(resolve, 900));
  await window.webContents.capturePage().then(image => fs.writeFileSync(path.join(__dirname, 'progress-status.png'), image.toPNG()));
  await window.webContents.executeJavaScript("document.querySelector('#p-toggle').click(); true");
  await new Promise(resolve => setTimeout(resolve, 700));
  await window.webContents.capturePage().then(image => fs.writeFileSync(path.join(__dirname, 'progress-details.png'), image.toPNG()));
  await window.webContents.executeJavaScript("document.querySelector('[data-ptab=\"limit\"]').click(); true");
  await new Promise(resolve => setTimeout(resolve, 400));
  await window.webContents.capturePage().then(image => fs.writeFileSync(path.join(__dirname, 'progress-limit.png'), image.toPNG()));
  console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'no console errors');
  app.quit();
});
