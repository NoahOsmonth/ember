const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  globalShortcut,
  screen,
  powerMonitor,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { createStore } = require('./store');
const { createLogger } = require('./logger');
const { createClock } = require('./clock');
const { createRegistry } = require('./ipc');
const { channelSpecs } = require('./channels');
const { registerTestChannels } = require('./test-support');
const { createTimerService } = require('./timer-service');
const { createPowerWatcher } = require('./power');
const { createShortcuts } = require('./shortcuts');
const { createWidgetWindow } = require('./windows/widget-window');
const { WEB_PREFERENCES, hardenWindow } = require('./security');

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
  render: { background: 'auto' },
};

/**
 * Point Electron at a throwaway profile when the app is launched by a test.
 *
 * EMBER_TEST=1 requires EMBER_USER_DATA to be an absolute directory path; the
 * settings file and log directory live inside it so tests never touch the real
 * profile. Without EMBER_TEST the variable is ignored entirely.
 */
function configureTestProfile() {
  if (process.env.EMBER_TEST !== '1') return;
  const dir = process.env.EMBER_USER_DATA;
  if (!dir || !path.isAbsolute(dir)) {
    console.error(
      'EMBER_TEST=1 requires EMBER_USER_DATA to be set to an absolute directory path.\n' +
        'Create a throwaway directory for each run, for example:\n' +
        '  EMBER_TEST=1 EMBER_USER_DATA="$(mktemp -d)" electron .'
    );
    app.exit(1);
    return;
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  } catch (err) {
    console.error(`EMBER_TEST=1 could not prepare EMBER_USER_DATA at ${dir}: ${err.message}`);
    app.exit(1);
    return;
  }
  app.setPath('userData', dir);
  app.setPath('logs', path.join(dir, 'logs'));
}

configureTestProfile();

const stateFile = () => path.join(app.getPath('userData'), 'ember.json');
// One clock for the main process; the test channel moves its offset instead of
// introducing a parallel time path. The timer service will consume this clock.
const clock = createClock({ offsetMs: 0 });
let state = { ...DEFAULTS, placement: null, locked: false, tutorialSeen: false };
let store = null;
let logger = createLogger({});
let timerService = null;
let powerWatcher = null;
let shortcuts = null;
let widget = null;
let win, settingsWin;

// Support diagnosis switch: an opaque window regardless of the saved setting.
const ENV_SOLID = process.env.EMBER_SOLID === '1';
let gpuCrashes = 0;
let gpuSolid = false;

/**
 * The background the widget should actually paint.
 *
 * The environment override wins over everything, then a GPU fallback that lasts
 * for the session, then the saved mode.
 */
function effectiveSolid() {
  return ENV_SOLID || gpuSolid || (state.render && state.render.background === 'solid');
}

/** Why the background is forced opaque, if it is. */
function solidOverride() {
  if (ENV_SOLID) return 'env';
  if (gpuSolid) return 'gpu';
  return null;
}

/** Everything the settings document owns; `locked` is deliberately not persisted. */
const PERSISTED_KEYS = Object.keys(DEFAULTS).concat(['placement', 'tutorialSeen']);

function persisted() {
  const patch = {};
  for (const key of PERSISTED_KEYS) patch[key] = state[key];
  return patch;
}

/** Adopt the validated document as the live state. */
function adopt(document) {
  for (const key of PERSISTED_KEYS) {
    if (document[key] !== undefined) state[key] = document[key];
  }
}

function save() {
  if (!store) return;
  adopt(store.set(persisted()).value);
}

/**
 * Adopt a successful shortcut mutation. The shortcuts module persists directly
 * to the store, so the in-memory document has to follow or `state:get` would
 * keep reporting the old binding.
 *
 * @param {any} result
 */
function adoptShortcuts(result) {
  if (!result || !result.ok) return result;
  const next = {};
  for (const binding of result.bindings) next[binding.id] = binding.accelerator;
  state = /** @type {any} */ ({ ...state, shortcuts: next });
  broadcast();
  return result;
}

/**
 * Bring up the settings store.
 *
 * `src/core` is ESM (docs/adr/0004-core-module-format.md) and this file is
 * CommonJS, so the schema is loaded with a dynamic import and injected into the
 * store rather than required.
 */
async function initSettings() {
  const schemaUrl = pathToFileURL(path.join(__dirname, '../core/schema.js')).href;
  try {
    const schema = await import(schemaUrl);
    logger = createLogger({ dir: app.getPath('logs') });
    store = createStore({ file: stateFile(), schema, logger, debounceMs: 250 });
    state = { ...state, ...store.get() };
    state.locked = false; // never start click-through
    logger.info(
      `ember ${app.getVersion()} ready; settings mode=${store.mode} recovered=${store.recovered}`
    );
  } catch (error) {
    store = null;
    logger.error(`settings unavailable (${error && error.message}); running on defaults`);
  }
}

const publicState = () => {
  const rest = /** @type {any} */ ({ ...state });
  delete rest.timer;
  return {
    ...rest,
    launch: app.getLoginItemSettings().openAtLogin,
    settingsRecovered: store ? store.recovered : false,
    solid: effectiveSolid(),
    solidOverride: solidOverride(),
  };
};
function broadcast(except) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w !== except && !w.isDestroyed()) w.webContents.send('settings', publicState());
  }
}

/** Push a timer payload to every open window. */
function broadcastTimer(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

/** Settings fields that the core timer reads. */
function timerSettingsChanged(previous, next) {
  return (
    JSON.stringify(previous.durations) !== JSON.stringify(next.durations) ||
    previous.rounds !== next.rounds ||
    previous.autoBreak !== next.autoBreak ||
    previous.autoFocus !== next.autoFocus
  );
}

/**
 * Construct the one timer owner after the store and before the first window.
 * The service restores the persisted snapshot itself and queues a missed-phase
 * notice for the widget's first subscribe.
 */
async function initTimer() {
  const timerStore = store || {
    get: () => ({}),
    set: () => ({ value: {}, issues: [] }),
    flush: () => {},
  };
  try {
    timerService = await createTimerService({
      store: timerStore,
      clock,
      broadcast: broadcastTimer,
      logger,
      onPhaseComplete: (event) => broadcastTimer('timer:phase-complete', event),
    });
    logger.info('timer service ready');
  } catch (error) {
    timerService = null;
    logger.error(`timer unavailable (${error && error.message}); the widget cannot start a phase`);
  }
}

/**
 * Route a registered shortcut to the same action the menu uses.
 *
 * @param {string} id
 */
function shortcutAction(id) {
  if (id === 'showHide') {
    if (!win || win.isDestroyed()) return;
    if (win.isVisible()) win.hide();
    else win.show();
    return;
  }
  if (id === 'toggle') {
    timerService?.toggle();
    return;
  }
  if (id === 'lock') setLocked(!state.locked);
}

/**
 * Construct the shortcut owner after settings load, so safe mode is known, and
 * register every binding. A failed registration is recorded, not thrown away.
 */
async function initShortcuts() {
  try {
    shortcuts = await createShortcuts({
      store,
      logger,
      onAction: shortcutAction,
      safeMode: false,
      globalShortcut,
    });
    const status = shortcuts.registerAll();
    const inactive = status.bindings.filter((binding) => binding.status !== 'active');
    logger.info(
      inactive.length === 0
        ? 'global shortcuts ready'
        : `global shortcuts inactive: ${inactive.map((binding) => binding.id).join(', ')}`
    );
  } catch (error) {
    shortcuts = null;
    logger.error(`shortcuts unavailable (${error && error.message})`);
  }
}

/**
 * Construct the widget window owner. The geometry module is ESM, so it is
 * imported here and injected; everything that touches placement arithmetic
 * then goes through one place.
 */
async function initWidget() {
  const placementUrl = pathToFileURL(path.join(__dirname, '../core/placement.js')).href;
  const geometry = await import(placementUrl);
  widget = createWidgetWindow({
    screen,
    geometry,
    settings: () => state,
    persist: (patch) => {
      state = { ...state, ...patch };
      save();
      broadcast();
    },
    preload: path.join(__dirname, '../preload/index.js'),
    page: path.join(__dirname, '../renderer/widget/index.html'),
    logger,
    onReady: (window) => {
      window.webContents.send('settings', publicState());
      if (!state.tutorialSeen) {
        state.tutorialSeen = true;
        save();
        openSettings('tutorial');
      }
    },
    onClosed: () => {
      win = null;
      app.quit();
    },
  });
}

/** Reassert the window level after unlock or a display change. */
function reassertWindows() {
  if (win && !win.isDestroyed()) {
    win.setAlwaysOnTop(state.onTop, 'screen-saver');
  }
  if (widget) widget.clamp();
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.setAlwaysOnTop(true, 'screen-saver');
  }
}

function setMini(mini) {
  return widget ? widget.setMini(mini) : null;
}

function setLocked(locked) {
  state.locked = locked;
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(locked, { forward: true });
  broadcast();
}

function createWindow() {
  if (widget) win = widget.create();
}

function openSettings(tab = 'settings') {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    settingsWin.webContents.send('tab', tab);
    return;
  }
  const bounds = win && !win.isDestroyed() ? win.getBounds() : null;
  const area = bounds
    ? screen.getDisplayMatching(bounds).workArea
    : screen.getPrimaryDisplay().workArea;
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
      ...WEB_PREFERENCES,
      preload: path.join(__dirname, '../preload/index.js'),
    },
  });
  hardenWindow(settingsWin, { file: path.join(__dirname, '../renderer/settings/index.html') });
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
          timerService?.applySettings(state);
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
  menu.popup(win && !win.isDestroyed() ? { window: win } : {});
}

const fromEvent = (e) => BrowserWindow.fromWebContents(e.sender);

/**
 * Declare every channel once, with its schema, and register the surface.
 *
 * `src/core` is ESM, so the validator is imported dynamically and injected into
 * the CommonJS registry. The renderer never sees an unvalidated payload: the
 * registry checks it before the handler runs.
 */
async function initIpc() {
  const validateUrl = pathToFileURL(path.join(__dirname, '../core/validate.js')).href;
  const { v } = await import(validateUrl);
  const registry = createRegistry({ logger });

  const handlers = {
    'state:get': () => publicState(),
    'state:set': (patch, event) => {
      const previous = state;
      const { launch, ...rest } = patch;
      state = { ...state, ...rest };
      if ('onTop' in rest && win && !win.isDestroyed()) {
        win.setAlwaysOnTop(!!rest.onTop, 'screen-saver');
      }
      if (launch !== undefined) app.setLoginItemSettings({ openAtLogin: !!launch });
      save();
      if (timerSettingsChanged(previous, state)) timerService?.applySettings(state);
      broadcast(fromEvent(event));
      return publicState();
    },
    'state:reset': () => {
      const previous = state;
      const keepMini = state.mini;
      state = { ...state, ...DEFAULTS, locked: state.locked };
      if (win && !win.isDestroyed()) win.setAlwaysOnTop(true, 'screen-saver');
      save();
      if (timerSettingsChanged(previous, state)) timerService?.applySettings(state);
      if (keepMini !== state.mini) setMini(state.mini);
      else broadcast();
      return publicState();
    },
    'win:dragStart': (point, event) => {
      if (widget && fromEvent(event) === win) widget.startDrag(point);
    },
    'win:dragEnd': (_payload, event) => {
      if (widget && fromEvent(event) === win) widget.endDrag();
    },
    'win:dock': () => (widget ? widget.dock() : null),
    'win:setScale': ({ scaleFactor }) => {
      if (win && !win.isDestroyed()) win.webContents.setZoomFactor(scaleFactor);
      return { scaleFactor };
    },
    'win:move': ({ dx, dy }, event) => {
      const w = fromEvent(event);
      if (!w || w.isDestroyed()) return;
      const b = w.getBounds();
      w.setBounds({
        x: Math.round(b.x + dx),
        y: Math.round(b.y + dy),
        width: b.width,
        height: b.height,
      });
    },
    'win:mini': ({ mini }) => setMini(mini),
    'win:lock': ({ locked }) => setLocked(locked),
    'win:close': (_payload, event) => fromEvent(event)?.close(),
    'app:quit': () => app.quit(),
    'menu:show': () => showMenu(),
    'settings:open': (payload) => openSettings(payload && payload.tab),
    'timer:get': () => timerService.get(),
    'timer:start': () => timerService.start(),
    'timer:pause': () => timerService.pause(),
    'timer:toggle': () => timerService.toggle(),
    'timer:skip': () => timerService.skip(),
    'timer:reset': () => timerService.reset(),
    'timer:subscribe': () => timerService.subscribe(),
    'shortcuts:get': () => (shortcuts ? shortcuts.getStatus() : { safeMode: false, bindings: [] }),
    'shortcuts:rebind': (payload) =>
      adoptShortcuts(
        shortcuts
          ? shortcuts.rebind(payload.id, payload.accelerator)
          : { ok: false, code: 'unavailable', message: 'shortcuts unavailable', bindings: [] }
      ),
    'shortcuts:reset': () =>
      adoptShortcuts(
        shortcuts
          ? shortcuts.reset()
          : { ok: false, code: 'unavailable', message: 'shortcuts unavailable', bindings: [] }
      ),
    'shortcuts:check': () =>
      shortcuts ? shortcuts.registerAll() : { safeMode: false, bindings: [] },
  };

  for (const spec of channelSpecs(v)) {
    registry.defineChannel({ ...spec, handler: handlers[spec.name] });
  }

  registry.register(ipcMain);
  logger.info(`ipc registry: ${registry.describe().length} channels`);
  return registry;
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (win) {
      win.show();
      setLocked(false);
    }
  });
  // A transparent window without a working GPU renders as a black box. Two
  // crashes in one session are enough evidence to stop trying; the decision is
  // not persisted, so a driver update restores the intended look.
  app.on('child-process-gone', (_event, details) => {
    if (!details || details.type !== 'GPU') return;
    gpuCrashes += 1;
    if (gpuCrashes < 2) {
      logger.warn(`GPU process gone (${details.reason || 'unknown'}); waiting for a second`);
      return;
    }
    if (gpuSolid) return;
    gpuSolid = true;
    logger.warn('GPU process crashed twice this session; switching to a solid background');
    broadcast();
  });
  app.whenReady().then(async () => {
    await initSettings();
    await initTimer();
    await initShortcuts();
    await initWidget();
    await initIpc();
    createWindow();
    powerWatcher = createPowerWatcher({
      clock,
      timer: timerService,
      windows: { reassert: reassertWindows },
      logger,
      powerMonitor,
      screen,
    });
    // Registers only when EMBER_TEST=1 and EMBER_USER_DATA are both set.
    registerTestChannels({
      ipcMain,
      clock,
      getWindow: () => win,
      suspend: (ms) => (powerWatcher ? powerWatcher.handleResume(ms) : null),
      setBounds: (bounds) => (widget ? widget.setBounds(bounds) : null),
      setDisplays: (displays) => (widget ? widget.setTestDisplays(displays) : null),
      setCursor: (point) => (widget ? widget.setTestCursor(point) : null),
    });
  });
  app.on('before-quit', () => {
    if (widget) widget.dispose();
    if (powerWatcher) powerWatcher.dispose();
    if (shortcuts) shortcuts.dispose();
    if (timerService) timerService.dispose();
    if (store) store.flush();
  });
  app.on('will-quit', () => {
    if (widget) widget.dispose();
    if (powerWatcher) powerWatcher.dispose();
    if (shortcuts) shortcuts.dispose();
    if (timerService) timerService.dispose();
    if (store) store.flush();
    globalShortcut.unregisterAll();
  });
  app.on('window-all-closed', () => {
    if (widget) widget.dispose();
    if (powerWatcher) powerWatcher.dispose();
    if (timerService) timerService.dispose();
    if (store) store.flush();
    app.quit();
  });
}
