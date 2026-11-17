const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onHudShow: (callback) => ipcRenderer.on('hud-show', () => callback()),
  onHudHide: (callback) => ipcRenderer.on('hud-hide', () => callback()),
  onDeepLink: (callback) =>
    ipcRenderer.on('deep-link', (_event, data) => callback(data)),
  showHud: () => ipcRenderer.send('show-hud'),
  hideHud: () => ipcRenderer.send('hide-hud'),
  toggleHud: () => ipcRenderer.send('toggle-hud')
});
