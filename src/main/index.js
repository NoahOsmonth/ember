const { app, BrowserWindow, ipcMain, Menu, globalShortcut, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const SIZES = { full: { width: 340, height: 96 }, mini: { width: 156, height: 58 } };
const PRESETS = {
  classic: { focus: 25, short: 5, long: 15 },
  deep: { focus: 50, short: 10, long: 30 },
  sprint: { focus: 15, short: 3, long: 10 },
  marathon: { focus: 90, short: 20, long: 30 },
};
const DEFAULTS = {
  durations: { focus: 25, short: 5, long: 15 },
  rounds: 4,
  autoBreak: true,
  autoFocus: false,
  sound: true,
  volume: 0.6,
  notify: true,
  theme: 'dusk',
  opacity: 0.62,
  mini: false,
  onTop: true,
};

const stateFile = () => path.join(app.getPath('userData'), 'ember.json');
let state = { ...DEFAULTS, x: null, y: null, locked: false, tutorialSeen: false };
let win, settingsWin;

function load() {
  try {
    state = { ...state, ...JSON.parse(fs.readFileSync(stateFile(), 'utf8')) };
  } catch {}
  state.locked = false; // never start click-through
}
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(stateFile(), JSON.stringify(state));
    } catch {}
  }, 250);
}

const publicState = () => ({ ...state, launch: app.getLoginItemSettings().openAtLogin });
function broadcast(except) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w !== except && !w.isDestroyed()) w.webContents.send('settings', publicState());
  }
}

function startPosition(size) {
  const area = screen.getPrimaryDisplay().workArea;
  const def = { x: area.x + area.width - size.width - 24, y: area.y + 24 };
  if (state.x == null) return def;
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return (
      state.x + 40 > a.x &&
      state.x < a.x + a.width - 40 &&
      state.y > a.y - 10 &&
      state.y < a.y + a.height - 40
    );
  });
  return visible ? { x: state.x, y: state.y } : def;
}

function setMini(mini) {
  state.mini = mini;
  const b = win.getBounds();
  const s = mini ? SIZES.mini : SIZES.full;
  // keep the right edge anchored so it collapses toward the corner it sits in
  win.setBounds({ x: b.x + b.width - s.width, y: b.y, width: s.width, height: s.height });
  state.x = win.getBounds().x;
  state.y = win.getBounds().y;
  save();
  broadcast();
}

function setLocked(locked) {
  state.locked = locked;
  win.setIgnoreMouseEvents(locked, { forward: true });
  broadcast();
}

function createWindow() {
  const size = state.mini ? SIZES.mini : SIZES.full;
  const pos = startPosition(size);
  win = new BrowserWindow({
    ...size,
    ...pos,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    title: 'Ember',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
    },
  });
  win.setAlwaysOnTop(state.onTop, 'screen-saver');
  win.loadFile('src/renderer/widget/index.html');
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('settings', publicState());
    if (!state.tutorialSeen) {
      state.tutorialSeen = true;
      save();
      openSettings('tutorial');
    }
  });
  win.on('move', () => {
    const b = win.getBounds();
    state.x = b.x;
    state.y = b.y;
    save();
  });
  win.on('closed', () => app.quit());
}

function openSettings(tab = 'settings') {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    settingsWin.webContents.send('tab', tab);
    return;
  }
  const area = screen.getDisplayMatching(win.getBounds()).workArea;
  const w = 460,
    h = Math.min(640, area.height - 40);
  settingsWin = new BrowserWindow({
    width: w,
    height: h,
    x: Math.round(area.x + (area.width - w) / 2),
    y: Math.round(area.y + (area.height - h) / 2),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: true,
    fullscreenable: false,
    hasShadow: false,
    title: 'Ember settings',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
    },
  });
  settingsWin.setAlwaysOnTop(true, 'screen-saver');
  settingsWin.loadFile('src/renderer/settings/index.html', { query: { tab } });
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
}

function showMenu() {
  const same = (a, b) => a.focus === b.focus && a.short === b.short && a.long === b.long;
  const menu = Menu.buildFromTemplate([
    { label: 'Settings…', click: () => openSettings('settings') },
    { label: 'How it works…', click: () => openSettings('tutorial') },
    { type: 'separator' },
    {
      label: 'Durations',
      submenu: Object.entries(PRESETS).map(([id, p]) => ({
        label: `${id[0].toUpperCase() + id.slice(1)}  (${p.focus} / ${p.short} / ${p.long} min)`,
        type: 'radio',
        checked: same(state.durations, p),
        click: () => {
          state.durations = { ...p };
          save();
          broadcast();
        },
      })),
    },
    {
      label: 'Compact size',
      type: 'checkbox',
      checked: state.mini,
      click: (m) => setMini(m.checked),
    },
    { label: 'Click-through   Ctrl+Alt+L', click: () => setLocked(true) },
    { type: 'separator' },
    { label: 'Quit Ember', click: () => app.quit() },
  ]);
  menu.popup({ window: win });
}

const fromEvent = (e) => BrowserWindow.fromWebContents(e.sender);

ipcMain.handle('state:get', () => publicState());
ipcMain.on('state:set', (e, patch) => {
  const { launch, ...rest } = patch;
  state = { ...state, ...rest };
  if ('onTop' in rest) win.setAlwaysOnTop(!!rest.onTop, 'screen-saver');
  if (launch !== undefined) app.setLoginItemSettings({ openAtLogin: !!launch });
  save();
  broadcast(fromEvent(e));
});
ipcMain.on('state:reset', () => {
  const keepMini = state.mini;
  state = { ...state, ...DEFAULTS, locked: state.locked };
  win.setAlwaysOnTop(true, 'screen-saver');
  if (keepMini !== state.mini) setMini(state.mini);
  else {
    save();
    broadcast();
  }
});
ipcMain.on('win:move', (e, x, y) => {
  const w = fromEvent(e);
  if (!w) return;
  const b = w.getBounds();
  w.setBounds({ x: Math.round(x), y: Math.round(y), width: b.width, height: b.height });
});
ipcMain.on('win:mini', (_e, mini) => setMini(!!mini));
ipcMain.on('win:lock', () => setLocked(true));
ipcMain.on('win:close', (e) => fromEvent(e)?.close());
ipcMain.on('app:quit', () => app.quit());
ipcMain.on('menu:show', showMenu);
ipcMain.on('settings:open', (_e, tab) => openSettings(tab));

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (win) {
      win.show();
      setLocked(false);
    }
  });
  app.whenReady().then(() => {
    load();
    createWindow();
    globalShortcut.register('Control+Alt+P', () => (win.isVisible() ? win.hide() : win.show()));
    globalShortcut.register('Control+Alt+Space', () => win.webContents.send('command', 'toggle'));
    globalShortcut.register('Control+Alt+L', () => setLocked(!state.locked));
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => app.quit());
}
