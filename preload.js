const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ember', {
  getState: () => ipcRenderer.invoke('state:get'),
  setState: patch => ipcRenderer.send('state:set', patch),
  reset: () => ipcRenderer.send('state:reset'),
  moveTo: (x, y) => ipcRenderer.send('win:move', x, y),
  setMini: mini => ipcRenderer.send('win:mini', mini),
  lock: () => ipcRenderer.send('win:lock'),
  closeWindow: () => ipcRenderer.send('win:close'),
  quit: () => ipcRenderer.send('app:quit'),
  showMenu: () => ipcRenderer.send('menu:show'),
  openSettings: tab => ipcRenderer.send('settings:open', tab),
  onSettings: cb => ipcRenderer.on('settings', (_e, s) => cb(s)),
  onCommand: cb => ipcRenderer.on('command', (_e, c) => cb(c)),
  onTab: cb => ipcRenderer.on('tab', (_e, t) => cb(t)),
});
