const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ember', {
  getState: () => ipcRenderer.invoke('state:get'),
  setState: (patch) => ipcRenderer.send('state:set', patch),
  reset: () => ipcRenderer.send('state:reset'),
  moveTo: (x, y) => ipcRenderer.send('win:move', x, y),
  setMini: (mini) => ipcRenderer.send('win:mini', mini),
  lock: () => ipcRenderer.send('win:lock'),
  closeWindow: () => ipcRenderer.send('win:close'),
  quit: () => ipcRenderer.send('app:quit'),
  showMenu: () => ipcRenderer.send('menu:show'),
  openSettings: (tab) => ipcRenderer.send('settings:open', tab),
  onSettings: (cb) => ipcRenderer.on('settings', (_e, s) => cb(s)),
  onCommand: (cb) => ipcRenderer.on('command', (_e, c) => cb(c)),
  onTab: (cb) => ipcRenderer.on('tab', (_e, t) => cb(t)),
  // Test-only surface. The prefix is enforced here so the renderer can never
  // use this bridge to reach a production channel; release builds register no
  // `test:` handler, so the invoke rejects with Electron's unknown-channel
  // error. It answers nothing by itself.
  invokeTest: (name, ...args) => {
    if (typeof name !== 'string' || !name.startsWith('test:')) {
      return Promise.reject(new Error('invokeTest only accepts test: channels'));
    }
    return ipcRenderer.invoke(name, ...args);
  },
});
