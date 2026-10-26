const path = require('node:path');
const fsSync = require('node:fs');
const { showProgress, closeCancelledProgress } = require('./progress-window.cjs');

const APP_NAME = 'RedX Downloader';
const APP_ID = 'com.teamredx.downloader';
const SHARED_FOLDER = '.redx-downloader';
const LEGACY_FOLDER = '.awesome-downloader';

if (process.argv.includes('--native-host')) {
  require('../integration/native-host.cjs').runNativeHost();
} else {
  const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Tray, Menu, nativeImage, Notification } = require('electron');
  app.setName(APP_NAME);
  app.setAppUserModelId(APP_ID);
  // AppData writes can be virtualized when launched by an MSIX development app.
  // Chrome launched normally must see the same connector, bridge, and history.
  const sharedDataDirectory = path.join(app.getPath('home'), SHARED_FOLDER);
  fsSync.mkdirSync(sharedDataDirectory, { recursive: true });
  app.setPath('userData', sharedDataDirectory);
  const logsDirectory = path.join(sharedDataDirectory, 'logs');
  fsSync.mkdirSync(logsDirectory, { recursive: true });
  const logPath = path.join(logsDirectory, 'redx.log');

  function logLine(message) {
    try {
      const stat = fsSync.existsSync(logPath) ? fsSync.statSync(logPath) : null;
      if (stat && stat.size > 1024 * 1024) fsSync.renameSync(logPath, path.join(logsDirectory, 'redx.previous.log'));
      fsSync.appendFileSync(logPath, `${new Date().toISOString()} ${String(message).replace(/[\r\n]+/g, ' ')}\n`);
    } catch { /* logging must never break the app */ }
  }

  const locked = app.requestSingleInstanceLock();
  let window, engine, bridge, tray, quitting = false, clipboardTimer, lastClipboardText = '', lastClipboardUrl = '';
  const progressWindows = new Map();
  const progressWindowSizes = new WeakMap();
  if (!locked) app.quit();
  else {
    app.on('second-instance', () => { window?.show(); window?.focus(); });
    app.whenReady().then(async () => {
      const fs = require('node:fs/promises');
      logLine(`starting v${app.getVersion()} packaged=${app.isPackaged} pid=${process.pid} electron=${process.versions.electron} rss=${Math.round(process.memoryUsage().rss / 1048576)}MB`);
      // One-time migration from the previous product name keeps history and
      // resumable partial files instead of starting from an empty list.
      const history = path.join(sharedDataDirectory, 'downloads.json');
      const legacyCandidates = [
        path.join(app.getPath('home'), LEGACY_FOLDER, 'downloads.json'),
        path.join(app.getPath('appData'), 'Awesome Downloader', 'downloads.json')
      ];
      if (!fsSync.existsSync(history)) {
        for (const candidate of legacyCandidates) {
          try {
            await fs.copyFile(candidate, history, fsSync.constants.COPYFILE_EXCL);
            logLine(`migrated download history from ${candidate}`);
            const legacyParts = path.join(path.dirname(candidate), 'parts');
            try { await fs.cp(legacyParts, path.join(sharedDataDirectory, 'parts'), { recursive: true, force: false, errorOnExist: false }); }
            catch (error) { if (error.code !== 'ENOENT') logLine(`partial data migration failed: ${error.message}`); }
            break;
          } catch (error) { if (!['ENOENT', 'EEXIST'].includes(error.code)) logLine(`history migration failed: ${error.message}`); }
        }
      }
      const { DownloadEngine } = await import('../core/engine.mjs');
      const { startBridge } = await import('../core/bridge.mjs');
      const { detectDownloadUrl } = await import('../core/clipboard.mjs');
      engine = await new DownloadEngine({ dataDirectory: app.getPath('userData'), downloadDirectory: app.getPath('downloads') }).init();
      let desktopReady;
      const readyForDownloads = new Promise(resolve => { desktopReady = resolve; });
      try {
        bridge = await startBridge(engine, {
          dataDirectory: app.getPath('userData'),
          onOpen: async () => { await readyForDownloads; if (window && !window.isDestroyed()) { window.show(); window.focus(); } },
          onDownload: async payload => {
            await readyForDownloads;
            const behaviour = payload.startNow === true ? 'auto' : (engine.settings.browserStartBehavior || 'auto');
            const reviewOnly = behaviour === 'ask';
            const ids = await engine.add({ ...payload, reviewOnly, queueOnly: behaviour === 'queue', reuseActive: true, allowDuplicate: true });
            const d = engine.downloads.find(item => item.id === ids[0]);
            if (behaviour === 'auto' && !d?.needsReview) await handlers.openProgress({ id: ids[0] });
            if (behaviour === 'queue' && window && !window.isDestroyed()) {
              window.webContents.send('downloader:command', { command: 'queued', id: ids[0] });
            }
            if (behaviour === 'ask' && d?.needsReview && window && !window.isDestroyed()) {
              showProgress(window);
              window.webContents.send('downloader:command', { command: 'reviewDownload', id: ids[0] });
            }
            return ids;
          }
        });
        logLine(`browser bridge listening on ${bridge.port}`);
      } catch (error) { logLine(`bridge failed: ${error.message}`); dialog.showErrorBox('Browser connection unavailable', error.message); }

      const root = path.join(__dirname, '..');
      // Windows needs a multi-resolution .ico for the taskbar and tray; a single
      // large PNG is downscaled by the shell and looks soft at 16/24/32 px.
      const icoPath = path.join(root, 'assets', 'app-icon.ico');
      const pngPath = path.join(root, 'assets', 'app-icon.png');
      const icoImage = nativeImage.createFromPath(icoPath);
      const iconFromIco = !icoImage.isEmpty();
      const appIconPath = iconFromIco ? icoPath : pngPath;
      const appIcon = iconFromIco ? icoImage : nativeImage.createFromPath(pngPath);

      // Windows taskbar identity: AppID, relaunch command and the icon the shell
      // shows for the running window, taken from the executable resource.
      const brandWindow = win => {
        if (process.platform !== 'win32' || !win || win.isDestroyed?.()) return;
        try {
          win.setIcon(appIcon);
          const iconPathForShell = app.isPackaged ? process.execPath : icoPath;
          win.setAppDetails({
            appId: APP_ID,
            relaunchCommand: process.execPath,
            relaunchDisplayName: APP_NAME,
            appIconPath: iconPathForShell,
            appIconIndex: 0
          });
        } catch (error) {
          logLine(`setAppDetails failed: ${error.message}`);
        }
      };
      logLine(`icon: ${path.basename(appIconPath)} loaded=${!appIcon.isEmpty()} size=${JSON.stringify(appIcon.getSize())} ico=${iconFromIco}`);
      let integrationRoot = root;
      if (app.isPackaged) {
        integrationRoot = path.join(sharedDataDirectory, 'BrowserIntegration');
        await fs.mkdir(integrationRoot, { recursive: true });
        // Extensions must be real files on disk, not paths inside the application's ASAR.
        await fs.cp(path.join(process.resourcesPath, 'browser', 'extension'), path.join(integrationRoot, 'extension'), { recursive: true });
        await fs.cp(path.join(process.resourcesPath, 'browser', 'integration'), path.join(integrationRoot, 'integration'), {
          recursive: true,
          // The native launcher may be running this very startup. Windows locks
          // executable files: do not overwrite an already identical connector.
          filter: require('./resource-copy.cjs').copyIfChanged
        });
      }
      const quoteBatch = value => String(value).replaceAll('%', '%%');
      await fs.writeFile(path.join(integrationRoot, 'integration', 'native-host.cmd'),
        `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${quoteBatch(app.getPath('exe'))}" "%~dp0native-host.cjs"\r\n`);
      let connectedBrowsers = [], connectionError = '';
      await require('./browser-registration.cjs').prepareNativeHost(integrationRoot, app.getPath('exe'));
      await fs.writeFile(path.join(integrationRoot, 'integration', 'desktop-launch.json'), JSON.stringify({ executable: app.getPath('exe'), args: app.isPackaged ? [] : [root] }));
      const connectBrowsers = async () => {
        try { connectedBrowsers = await require('./browser-registration.cjs').connectInstalledBrowsers({ dataDirectory: app.getPath('userData'), integrationRoot }); connectionError = ''; }
        catch (error) { connectionError = error.message; }
      };
      await connectBrowsers();
      const browserScan = setInterval(connectBrowsers, 15000);
      browserScan.unref();
      const integration = async () => { await connectBrowsers(); return integrationInfo(); };
      const integrationInfo = () => ({
        port: bridge?.port || null, connectedBrowsers, connectionError,
        extensionPath: path.join(integrationRoot, 'extension'),
        integrationPath: path.join(integrationRoot, 'integration'),
        packaged: app.isPackaged, executable: app.getPath('exe')
      });
      const snapshot = () => ({ ...engine.snapshot(), integration: integrationInfo() });
      const validUrlForCheck = value => { try { return new URL(String(value)).href; } catch { throw new Error('Invalid download address.'); } };
      const handlers = {
        snapshot,
        openProgress: async ({ id }) => {
          const d = engine.downloads.find(d => d.id === id); if (!d) throw new Error('Download not found.');
          if (progressWindows.has(id)) { showProgress(progressWindows.get(id)); return; }
          const progress = new BrowserWindow({
            width: 680, height: 660, minWidth: 600, minHeight: 520, title: d.filename, icon: appIcon,
            backgroundColor: '#0B0D12', frame: false, autoHideMenuBar: true, show: false,
            webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
          });
          progress.setMenu(null);
          progressWindows.set(id, progress);
          progressWindowSizes.set(progress, { expanded: { width: 680, height: 800 } });
          if (d.status === 'complete') { progress.setMinimumSize(480, 300); progress.setSize(520, 320); progress.setTitle('Download complete'); }
          progress.on('closed', () => progressWindows.delete(id));
          progress.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
          progress.webContents.on('will-navigate', event => event.preventDefault());
          brandWindow(progress);
          await progress.loadFile(path.join(root, 'renderer', 'index.html'), { query: { progress: id } });
          progress.show();
          showProgress(progress);
        },
        add: data => engine.add(data),
        review: data => engine.reviewDownload(data),
        action: async ({ id, action, value }) => {
          const d = engine.downloads.find(d => d.id === id);
          if (!d) throw new Error('Download not found.');
          if (action === 'open') {
            if (d.status !== 'complete' || !d.path) throw new Error('This download has not finished.');
            // Opening a potentially executable file always requires an explicit user action.
            const result = await shell.openPath(d.path); if (result) throw new Error(result);
          } else if (action === 'openWith') {
            if (d.status !== 'complete' || !d.path) throw new Error('This download has not finished.');
            await new Promise((resolve, reject) => require('node:child_process').execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenWith.exe'), [d.path], { windowsHide: true }, error => error ? reject(error) : resolve()));
          } else if (action === 'reveal') { if (d.path) shell.showItemInFolder(d.path); else await shell.openPath(d.directory); }
          else return engine.action(id, action, value);
        },
        settings: data => engine.updateSettings(data),
        chooseDirectory: async () => {
          const result = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] });
          return result.canceled ? null : result.filePaths[0];
        },
        clipboard: () => clipboard.readText(),
        copyText: ({ text } = {}) => {
          if (typeof text !== 'string' || text.length > 100000) throw new Error('Nothing to copy.');
          clipboard.writeText(text);
          return true;
        },
        duplicate: ({ url, filename, directory } = {}) => {
          const found = engine.duplicatesFor(validUrlForCheck(url), filename || null, directory || null);
          if (!found) return null;
          return { kind: found.kind, id: found.download.id, filename: found.download.filename, path: found.download.path || null, status: found.download.status };
        },
        integration,
        appInfo: () => ({
          name: APP_NAME, version: app.getVersion(), packaged: app.isPackaged,
          userData: app.getPath('userData'), logs: logPath, executable: app.getPath('exe'),
          downloads: engine.settings.defaultDirectory,
          attribution: { owner: 'Abdur Rehman Rajput', team: 'Team RedX' }
        }),
        diagnostics: async () => {
          let tail = '';
          try {
            const content = await fs.readFile(logPath, 'utf8');
            tail = content.split(/\r?\n/).filter(Boolean).slice(-120).join('\n');
          } catch { tail = 'No log entries yet.'; }
          return {
            executable: app.getPath('exe'), userData: app.getPath('userData'), logs: logPath,
            downloadsFolder: engine.settings.defaultDirectory, packaged: app.isPackaged,
            electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node,
            platform: `${process.platform} ${process.arch}`, tail
          };
        },
        openMain: async () => { if (window && !window.isDestroyed()) { window.show(); window.focus(); } return true; },
        // Deleting files is deliberately separate from removing list entries and
        // always goes through the Recycle Bin so a mistake stays reversible.
        deleteFiles: async ({ ids } = {}) => {
          if (!Array.isArray(ids) || !ids.length) throw new Error('Select at least one finished download.');
          const targets = engine.downloads.filter(d => ids.includes(d.id) && d.status === 'complete' && d.path);
          let trashed = 0, failed = 0;
          for (const d of targets) {
            try { await shell.trashItem(d.path); await engine.action(d.id, 'remove'); trashed += 1; }
            catch { failed += 1; }
          }
          return { trashed, failed, skipped: ids.length - targets.length };
        },
        openLogs: async () => { const error = await shell.openPath(logsDirectory); if (error) throw new Error(error); },
        openFolder: async ({ target } = {}) => {
          const folder = target === 'logs' ? logsDirectory : target === 'data' ? app.getPath('userData') : engine.settings.defaultDirectory;
          const error = await shell.openPath(folder); if (error) throw new Error(error);
        }
      };
      handlers.registerBrowser = data => require('./browser-registration.cjs').registerBrowser(data, { dataDirectory: app.getPath('userData'), integrationRoot });
      handlers.browserSetup = async ({ action, browser } = {}) => {
        if (action === 'open') return require('./browser-setup.cjs').openExtensions(browser);
        if (action === 'copy') { clipboard.writeText(path.join(integrationRoot, 'extension')); return; }
        if (action === 'folder') {
          const error = await shell.openPath(path.join(integrationRoot, 'extension'));
          if (error) throw new Error(error);
          return;
        }
        throw new Error('Unknown browser setup action.');
      };
      for (const [name, handler] of Object.entries(handlers)) ipcMain.handle(`downloader:${name}`, (event, data) => {
        if (![window, ...progressWindows.values()].some(w => w && !w.isDestroyed() && event.senderFrame === w.webContents.mainFrame)) throw new Error('Untrusted renderer.');
        return handler(data);
      });
      ipcMain.handle('downloader:closeProgress', event => { for (const progress of progressWindows.values()) if (event.senderFrame === progress.webContents.mainFrame) { progress.close(); break; } });
      ipcMain.handle('downloader:resizeProgress', (event, { expanded } = {}) => {
        for (const progress of progressWindows.values()) if (event.senderFrame === progress.webContents.mainFrame) {
          const remembered = progressWindowSizes.get(progress) || { expanded: { width: 680, height: 800 } }, [width, height] = progress.getSize();
          if (expanded) {
            progress.setMinimumSize(560, 540);
            progress.setSize(Math.max(600, remembered.expanded.width), Math.max(560, remembered.expanded.height), true);
          } else {
            if (height > 400) remembered.expanded = { width, height };
            progressWindowSizes.set(progress, remembered);
            progress.setMinimumSize(520, 330);
            progress.setSize(Math.max(520, width), 540, true);
          }
          return;
        }
      });
      ipcMain.handle('downloader:window', (event, { action } = {}) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) throw new Error('Unknown window.');
        if (action === 'minimize') win.minimize();
        else if (action === 'maximize') {
          // Restoring from full screen first keeps the taskbar button usable.
          if (win.isFullScreen()) win.setFullScreen(false);
          if (win.isMaximized()) win.unmaximize(); else win.maximize();
        }
        else if (action === 'fullscreen') win.setFullScreen(!win.isFullScreen());
        else if (action === 'close') { if (win === window && !quitting) win.hide(); else win.close(); }
        else if (action !== 'state') throw new Error('Unknown window action.');
        return { maximized: win.isMaximized(), fullscreen: win.isFullScreen() };
      });

      const boundsPath = path.join(sharedDataDirectory, 'window-state.json');
      let bounds = { width: 1200, height: 790 };
      try {
        const saved = JSON.parse(fsSync.readFileSync(boundsPath, 'utf8'));
        if (Number.isFinite(saved.width) && Number.isFinite(saved.height)) bounds = { ...bounds, ...saved };
      } catch { /* first run */ }

      window = new BrowserWindow({
        ...bounds, minWidth: 960, minHeight: 620, show: false,
        title: APP_NAME, icon: appIcon, backgroundColor: '#0B0D12',
        frame: false, autoHideMenuBar: true,
        webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', event => event.preventDefault());
      // A dead renderer leaves a blank window that looks like a crash. Downloads
      // live in the main process, so reloading the interface is safe.
      let rendererRecoveries = 0;
      window.webContents.on('render-process-gone', (_event, details) => {
        logLine(`renderer gone reason=${details.reason} exitCode=${details.exitCode} recoveries=${rendererRecoveries}`);
        if (details.reason === 'clean-exit') return;
        rendererRecoveries += 1;
        if (window.isDestroyed()) return;
        if (rendererRecoveries <= 3) { window.reload(); }
        else { dialog.showMessageBox(window, { type: 'error', message: 'The RedX interface stopped unexpectedly', detail: 'Downloads keep running in the background. Use View → Reload to reopen the interface.' }).catch(() => {}); }
      });
      window.on('unresponsive', () => logLine('window became unresponsive'));
      window.webContents.on('did-finish-load', () => logLine('renderer loaded'));
      brandWindow(window);
      window.once('ready-to-show', () => window.show());
      const saveBounds = () => {
        if (!window || window.isDestroyed() || window.isMaximized() || window.isMinimized()) return;
        try { fsSync.writeFileSync(boundsPath, JSON.stringify(window.getBounds())); } catch { /* ignore */ }
      };
      window.on('resized', saveBounds);
      window.on('moved', saveBounds);
      const pushWindowState = () => {
        if (window.isDestroyed()) return;
        window.webContents.send('downloader:windowState', {
          maximized: window.isMaximized(),
          fullscreen: window.isFullScreen()
        });
      };
      window.on('maximize', pushWindowState);
      window.on('unmaximize', pushWindowState);
      window.on('enter-full-screen', pushWindowState);
      window.on('leave-full-screen', pushWindowState);
      await window.loadFile(path.join(root, 'renderer', 'index.html'));
      desktopReady();

      const command = name => () => window.webContents.send('downloader:command', name);
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        {
          label: 'Tasks', submenu: [
            { label: 'Add new download…', accelerator: 'CmdOrCtrl+N', click: command('add') },
            { label: 'Add batch download from clipboard', accelerator: 'CmdOrCtrl+Shift+V', click: command('paste') },
            { type: 'separator' },
            {
              label: 'Export', submenu: [{
                label: 'To text file…', click: async () => {
                  const result = await dialog.showSaveDialog(window, { defaultPath: 'redx-downloads.txt', filters: [{ name: 'URL list', extensions: ['txt'] }] });
                  if (result.canceled) return;
                  try { await fs.writeFile(result.filePath, engine.downloads.map(d => d.url).join('\r\n'), 'utf8'); } catch (e) { dialog.showErrorBox('Could not export downloads', e.message); }
                }
              }]
            },
            {
              label: 'Import', submenu: [{
                label: 'From text file…', click: async () => {
                  const result = await dialog.showOpenDialog(window, { filters: [{ name: 'URL list', extensions: ['txt'] }], properties: ['openFile'] });
                  if (result.canceled) return;
                  try {
                    if ((await fs.stat(result.filePaths[0])).size > 2 * 1024 * 1024) throw new Error('URL list must be smaller than 2 MiB.');
                    const urls = (await fs.readFile(result.filePaths[0], 'utf8')).split(/\r?\n/).map(u => u.trim()).filter(Boolean);
                    await engine.add({ urls, queueOnly: true, allowDuplicate: true });
                    await dialog.showMessageBox(window, { message: `Imported ${urls.length} downloads.`, detail: 'The imported downloads are paused. Select Start Queue to begin.' });
                  } catch (e) { dialog.showErrorBox('Could not import downloads', e.message); }
                }
              }]
            },
            { type: 'separator' }, { label: 'Exit', click: () => app.quit() }
          ]
        },
        { label: 'File', submenu: [{ label: 'Download properties…', click: command('details') }, { label: 'Remove selected', accelerator: 'Delete', click: command('remove') }, { label: 'Remove completed downloads', click: command('removeCompleted') }] },
        {
          label: 'Downloads', submenu: [
            { label: 'Stop all', click: command('pauseAll') }, { label: 'Start queue', click: command('resumeAll') }, { type: 'separator' },
            { label: 'Scheduler…', click: command('scheduler') }, { label: 'Speed limit…', click: command('settings') }, { type: 'separator' },
            { label: 'Find', accelerator: 'CmdOrCtrl+F', click: command('find') }, { type: 'separator' }, { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: command('settings') }
          ]
        },
        { label: 'View', submenu: [{ label: 'All downloads', click: command('all') }, { type: 'separator' }, { role: 'togglefullscreen' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }] },
        {
          label: 'Help', submenu: [
            { label: 'Browser integration…', click: command('integration') },
            { label: 'Diagnostics…', click: command('diagnostics') },
            { type: 'separator' },
            { label: `About ${APP_NAME}`, click: command('about') }
          ]
        }
      ]));

      engine.on('change', () => {
        const data = snapshot();
        if (window && !window.isDestroyed()) window.webContents.send('downloader:change', data);
        for (const [id, progress] of progressWindows) {
          const d = data.downloads.find(d => d.id === id);
          if (closeCancelledProgress(progress, d)) continue;
          if (!d) continue;
          progress.setTitle(d.status === 'complete' ? 'Download complete' : `${d.total ? Math.floor(d.downloaded / d.total * 100) + '% ' : ''}${d.filename}`);
          progress.webContents.send('downloader:change', data);
        }
      });
      engine.on('complete', d => {
        const progress = progressWindows.get(d.id);
        if (progress && !progress.isDestroyed()) { if (engine.settings.hideCompletionDialog) progress.close(); else { progress.setMinimumSize(480, 300); progress.setSize(520, 330); progress.setTitle('Download complete'); } }
        // A per-download choice wins over the global defaults.
        const notify = d.onComplete ? d.onComplete === 'notify' : engine.settings.notifyOnComplete;
        const reveal = d.onComplete ? d.onComplete === 'open' : engine.settings.revealOnComplete;
        if (notify && Notification.isSupported()) new Notification({ title: 'Download complete', body: d.filename, icon: appIcon }).show();
        if (reveal && d.path) shell.showItemInFolder(d.path);
      });

      // Optional clipboard monitor: reads the clipboard only while enabled, only
      // checks whether the text is a single download link, and keeps no copy.
      clipboardTimer = setInterval(() => {
        if (!window || window.isDestroyed()) return;
        if (!engine.settings.clipboardMonitor) { lastClipboardText = ''; return; }
        let text = '';
        try { text = clipboard.readText().slice(0, 4096); } catch { return; }
        if (!text || text === lastClipboardText) return;
        lastClipboardText = text;
        const url = detectDownloadUrl(text);
        if (!url || url === lastClipboardUrl) return;
        if (engine.downloads.some(d => d.url === url && d.status !== 'cancelled')) return;
        lastClipboardUrl = url;
        window.webContents.send('downloader:clipboard', { url });
      }, 1500);
      clipboardTimer.unref?.();

      // The ICO carries dedicated 16/24/32 px entries; only the PNG fallback is
      // resized, because scaling a 256 px raster to 16 px loses the mark.
      let icon = appIcon;
      if (!iconFromIco && !icon.isEmpty()) icon = icon.resize({ width: 16, height: 16 });
      try {
        tray = new Tray(icon);
      } catch (error) {
        // Without a tray the window would become unreachable while hidden.
        tray = null;
        logLine(`tray unavailable: ${error.message}`);
      }
      if (tray) tray.setToolTip(APP_NAME);
      if (tray) {
        tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Show downloads', click: () => window.show() }, { label: 'Settings…', click: () => { window.show(); window.webContents.send('downloader:command', 'settings'); } }, { type: 'separator' }, { label: 'Quit', click: () => app.quit() }]));
        tray.on('double-click', () => window.show());
      }
      window.on('close', event => {
        saveBounds();
        // Close-to-tray only when a tray actually exists; otherwise let the
        // window close so the app cannot become invisible.
        if (quitting || !tray) return;
        event.preventDefault();
        window.hide();
      });
      app.on('activate', () => { if (window && !window.isDestroyed()) { window.show(); window.focus(); } });
      app.on('window-all-closed', () => {
        const busy = (engine?.downloads || []).some(d => ['queued', 'scheduled', 'probing', 'downloading', 'assembling'].includes(d.status));
        logLine(`all windows closed (active transfers: ${busy})`);
        // Keep running in the tray while transfers are alive; otherwise exit the
        // way a Windows user expects.
        if (!busy || !tray) app.quit();
      });
    }).catch(error => {
      logLine(`startup failed: ${error.stack || error.message}`);
      dialog.showErrorBox(`${APP_NAME} could not start`, error.stack || error.message);
      quitting = true; app.quit();
    });
    app.on('before-quit', event => {
      if (quitting) return;
      event.preventDefault(); quitting = true;
      clearInterval(clipboardTimer);
      Promise.resolve().then(() => bridge?.close()).then(() => engine?.close()).catch(error => logLine(`shutdown: ${error.message}`)).finally(() => app.quit());
    });
    // An uncaught main-process error leaves the app in an unknown state: record
    // it, flush progress, then restart through Electron with a loop guard.
    const restartMarker = path.join(logsDirectory, 'relaunch.json');
    let restartScheduled = false;
    const recoverFrom = (label, error) => {
      logLine(`${label}: ${error?.stack || error?.message || error}`);
      if (restartScheduled || quitting) return;
      restartScheduled = true;
      let recent = [];
      try { recent = JSON.parse(fsSync.readFileSync(restartMarker, 'utf8')).recent || []; } catch { recent = []; }
      const now = Date.now();
      recent = recent.filter(stamp => now - stamp < 10 * 60 * 1000);
      if (recent.length >= 3) {
        logLine('restart loop detected; staying down so the log can be read');
        dialog.showErrorBox(`${APP_NAME} stopped unexpectedly`, `The problem repeated several times. Diagnostics were written to:\n${logPath}`);
        app.exit(1);
        return;
      }
      recent.push(now);
      try { fsSync.writeFileSync(restartMarker, JSON.stringify({ recent })); } catch { /* best effort */ }
      Promise.resolve(engine?.persist?.()).catch(() => {}).finally(() => {
        app.relaunch();
        app.exit(0);
      });
    };
    process.on('uncaughtException', error => recoverFrom('uncaught exception', error));
    // Rejections are usually contained by their awaiting handler; log, do not restart.
    process.on('unhandledRejection', error => logLine(`unhandled rejection: ${error?.stack || error}`));
  }
}
