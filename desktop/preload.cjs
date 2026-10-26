const { contextBridge, ipcRenderer } = require('electron');
const api = {};
for (const name of ['snapshot', 'add', 'review', 'action', 'settings', 'chooseDirectory', 'clipboard', 'integration', 'browserSetup', 'registerBrowser', 'openProgress', 'closeProgress', 'resizeProgress', 'appInfo', 'diagnostics', 'openLogs', 'openFolder', 'copyText', 'duplicate', 'openMain', 'deleteFiles']) {
  api[name] = data => ipcRenderer.invoke(`downloader:${name}`, data);
}
api.windowControl = action => ipcRenderer.invoke('downloader:window', { action });
api.subscribe = callback => {
  const listener = (_event, data) => callback(data);
  ipcRenderer.on('downloader:change', listener);
  return () => ipcRenderer.removeListener('downloader:change', listener);
};
api.onCommand = callback => {
  const listener = (_event, command) => callback(command);
  ipcRenderer.on('downloader:command', listener);
  return () => ipcRenderer.removeListener('downloader:command', listener);
};
api.onClipboardLink = callback => {
  const listener = (_event, data) => callback(data);
  ipcRenderer.on('downloader:clipboard', listener);
  return () => ipcRenderer.removeListener('downloader:clipboard', listener);
};
api.onWindowState = callback => {
  const listener = (_event, data) => callback(data);
  ipcRenderer.on('downloader:windowState', listener);
  return () => ipcRenderer.removeListener('downloader:windowState', listener);
};
contextBridge.exposeInMainWorld('downloader', Object.freeze(api));
