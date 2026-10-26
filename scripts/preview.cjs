/*
 * Development harness: renders the real interface with a sample snapshot so the
 * layout, theme and dialogs can be inspected (and screenshotted) without a live
 * download engine. Not part of the shipped application.
 *   npx electron scripts/preview.cjs
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const now = Date.now();
const downloads = [
  { id: 'a1', filename: 'Ubuntu-24.04-desktop-amd64.iso', url: 'https://releases.ubuntu.com/24.04/ubuntu.iso', category: 'Programs', status: 'downloading', total: 5.2 * 1024 ** 3, downloaded: 3.54 * 1024 ** 3, speedAvg: 12.4 * 1024 ** 2, connections: 8, resumable: true, directory: 'D:\\Downloads', createdAt: new Date(now - 90000).toISOString(), verification: { state: 'unavailable' } },
  { id: 'a2', filename: 'Movie_4K_2160p.mkv', url: 'https://cdn.example.com/Movie_4K_2160p.mkv', category: 'Video', status: 'downloading', total: 4.8 * 1024 ** 3, downloaded: 2.16 * 1024 ** 3, speedAvg: 10.8 * 1024 ** 2, connections: 8, resumable: true, directory: 'D:\\Downloads\\Movies', createdAt: new Date(now - 80000).toISOString() },
  { id: 'a3', filename: 'Music_Collection.zip', url: 'https://cdn.example.com/music.zip', category: 'Archives', status: 'complete', total: 1.2 * 1024 ** 3, downloaded: 1.2 * 1024 ** 3, path: 'D:\\Downloads\\Music_Collection.zip', sha256: '9f2c8b1d4e6a7c3b5d8e1f0a2b4c6d8e0f1a3b5c7d9e1f2a4b6c8d0e2f4a6b8c', verification: { state: 'verified' }, directory: 'D:\\Downloads', createdAt: new Date(now - 3600000).toISOString() },
  { id: 'a4', filename: 'Setup.exe', url: 'https://cdn.example.com/setup.exe', category: 'Programs', status: 'paused', total: 780 * 1024 ** 2, downloaded: 179 * 1024 ** 2, speedAvg: 0, resumable: true, directory: 'D:\\Downloads', createdAt: new Date(now - 4000000).toISOString() },
  { id: 'a5', filename: 'Document.pdf', url: 'https://cdn.example.com/report.pdf', category: 'Documents', status: 'scheduled', scheduledAt: new Date(now + 3600000).toISOString(), total: 12 * 1024 ** 2, downloaded: 0, directory: 'D:\\Downloads', createdAt: new Date(now - 5000000).toISOString() },
  { id: 'a6', filename: 'Archive_files.rar', url: 'https://cdn.example.com/archive.rar', category: 'Archives', status: 'error', error: 'Server returned HTTP 404.', total: 2.4 * 1024 ** 3, downloaded: 0, directory: 'D:\\Downloads', createdAt: new Date(now - 6000000).toISOString() },
  { id: 'a7', filename: 'Video_1080p.mp4', url: 'https://cdn.example.com/video.mp4', category: 'Video', status: 'downloading', total: null, downloaded: 240 * 1024 ** 2, speedAvg: 8.5 * 1024 ** 2, connections: 4, kind: 'hls', streamProgress: { completed: 12, total: 48, estimatedBytes: 1024 ** 3 }, directory: 'D:\\Downloads', createdAt: new Date(now - 7000000).toISOString() },
  { id: 'a8', filename: 'Photo_pack.zip', url: 'https://cdn.example.com/photos.zip', category: 'Images', status: 'queued', total: 320 * 1024 ** 2, downloaded: 0, priority: 9, directory: 'D:\\Downloads', createdAt: new Date(now - 8000000).toISOString() }
];
const settings = {
  defaultDirectory: 'D:\\Downloads', maxConcurrent: 3, connections: 8, speedLimitKbps: 0,
  categoryDirectories: {}, notifyOnComplete: true, revealOnComplete: false, confirmBrowserDownloads: true,
  hideCompletionDialog: false, theme: 'dark', clipboardMonitor: true, organizeByCategory: false,
  verifyAfterDownload: true, stallTimeoutSec: 25, retryLimit: 4, showSpeedGraph: true
};
const snapshot = {
  downloads,
  settings,
  integration: { port: 17843, connectedBrowsers: [{ browser: 'Chrome' }], connectionError: '', extensionPath: 'C:\\Users\\abdul\\.redx-downloader\\BrowserIntegration\\extension', packaged: true, executable: 'C:\\Program Files\\RedX Downloader\\RedX Downloader.exe' }
};

const handlers = {
  snapshot: () => snapshot,
  appInfo: () => ({ name: 'RedX Downloader', version: '1.0.0', packaged: true, userData: 'C:\\Users\\abdul\\.redx-downloader', logs: 'C:\\Users\\abdul\\.redx-downloader\\logs\\redx.log', executable: 'C:\\Program Files\\RedX Downloader\\RedX Downloader.exe', downloads: 'D:\\Downloads' }),
  diagnostics: () => ({ packaged: true, electron: '44.9.0', chrome: '140', node: '22', platform: 'win32 x64', downloadsFolder: 'D:\\Downloads', userData: 'C:\\Users\\abdul\\.redx-downloader', logs: 'C:\\Users\\abdul\\.redx-downloader\\logs\\redx.log', tail: '2026-10-26T12:00:00.000Z starting 1.0.0 (packaged=true)\n2026-10-26T12:00:01.000Z browser bridge listening on 17843' }),
  integration: () => snapshot.integration,
  duplicate: () => null,
  settings: () => snapshot,
  action: () => null,
  add: () => ['new-id'],
  review: () => ['new-id'],
  windowControl: () => ({ maximized: false }),
  clipboard: () => 'https://example.com/file.zip',
  copyText: () => true,
  openLogs: () => null,
  openFolder: () => null,
  browserSetup: () => null,
  registerBrowser: () => ({}),
  chooseDirectory: () => 'D:\\Downloads',
  openProgress: () => null,
  closeProgress: () => null,
  resizeProgress: () => null
};
for (const [name, handler] of Object.entries(handlers)) ipcMain.handle(`downloader:${name}`, (_event, data) => handler(data));

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1280, height: 820, show: true, frame: false, backgroundColor: '#0B0D12',
    webPreferences: { preload: path.join(root, 'desktop', 'preload.cjs'), contextIsolation: true, sandbox: true }
  });
  const problems = [];
  window.webContents.on('console-message', (_event, level, message) => { if (level >= 2) problems.push(message); });
  window.webContents.on('render-process-gone', (_e, details) => problems.push(`renderer gone ${JSON.stringify(details)}`));
  await window.loadFile(path.join(root, 'renderer', 'index.html'));
  await new Promise(resolve => setTimeout(resolve, 900));
  const capture = async name => {
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, name), image.toPNG());
    console.log(`captured ${name}`);
  };
  await capture('preview-main.png');
  const probe = await window.webContents.executeJavaScript("(() => { try { openSettings('appearance'); return 'open=' + document.querySelector('#settings-dialog').open + ' typeof=' + typeof openSettings; } catch (e) { return 'ERR ' + e.message; } })()");
  console.log('settings probe:', probe);
  await new Promise(resolve => setTimeout(resolve, 700));
  await capture('preview-settings.png');
  await window.webContents.executeJavaScript("document.querySelector('#settings-dialog').close(); openInspector('a2'); true");
  await new Promise(resolve => setTimeout(resolve, 700));
  await capture('preview-inspector.png');
  await window.webContents.executeJavaScript("closeInspector(); openAbout(); true");
  await new Promise(resolve => setTimeout(resolve, 700));
  await capture('preview-about.png');
  await window.webContents.executeJavaScript("document.querySelector('#about-dialog').close(); openAdd('https://example.com/report.pdf'); true");
  await new Promise(resolve => setTimeout(resolve, 700));
  await capture('preview-add.png');
  await window.webContents.executeJavaScript("document.querySelector('#add-dialog').close(); document.querySelector('#bulk-select-all').click(); true");
  await new Promise(resolve => setTimeout(resolve, 500));
  const diag = await window.webContents.executeJavaScript("(() => { const bar=document.querySelector('#bulk-bar'); return { exists: !!bar, hidden: bar?.hidden, display: bar && getComputedStyle(bar).display, count: document.querySelector('#bulk-count')?.textContent, selectedRows: document.querySelectorAll('.row.selected').length, err: window.__bulkErr || null }; })()");
  console.log('bulk diag:', JSON.stringify(diag));
  await capture('preview-bulk.png');
  const stack = await window.webContents.executeJavaScript("refresh().then(() => 'ok').catch(error => error.stack || error.message)");
  console.log('refresh stack:', stack);
  const title = await window.webContents.executeJavaScript("document.querySelector('#view-title').textContent + ' | rows=' + document.querySelectorAll('.row').length");
  console.log('state:', title);
  console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'no console errors');
  app.quit();
});
