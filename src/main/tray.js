'use strict';

/**
 * The tray icon (capability: tray-recovery).
 *
 * A frameless, skip-taskbar window has no recovery surface, so the tray is the
 * one always-present way back: show/hide, bring to me, start or pause, skip,
 * settings, the log folder and quit. The menu is rebuilt every time it opens so
 * its labels always match the live timer.
 *
 * Windows offers no event when Explorer restarts and the icon vanishes, so the
 * module re-creates the icon on demand and from a 30 s watchdog.
 */

const path = require('path');
const { Tray, Menu, nativeImage } = require('electron');

const WATCHDOG_MS = 30_000;
const PHASE_LABELS = Object.freeze({
  focus: 'focus',
  short: 'short break',
  long: 'long break',
});

/**
 * @param {number} ms
 * @returns {string} mm:ss, rounded up like the widget
 */
function formatRemaining(ms) {
  const secs = Math.ceil(Math.max(0, Number(ms) || 0) / 1000);
  return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
}

/**
 * Tooltip text for a timer snapshot.
 *
 * @param {{ phase?: string, status?: string, remainingMs?: number } | null} snapshot
 * @returns {string}
 */
function formatTooltip(snapshot) {
  if (!snapshot || typeof snapshot.phase !== 'string') return 'Ember';
  const phase = PHASE_LABELS[snapshot.phase] || snapshot.phase;
  const prefix = snapshot.status === 'paused' ? 'paused · ' : '';
  return `${prefix}${phase} · ${formatRemaining(snapshot.remainingMs)}`;
}

/**
 * @param {object} options
 * @param {{ get?: () => any } | null} [options.timer]
 * @param {{ getWidget?: () => any }} [options.windows]
 * @param {() => any} [options.settings] the live settings document
 * @param {Record<string, Function>} [options.actions]
 * @param {string} [options.iconPath] absolute path of the tray image
 * @param {any} [options.logger]
 * @param {any} [options.TrayClass]
 * @param {any} [options.MenuClass]
 * @param {(file: string) => any} [options.createImage]
 * @param {number} [options.watchdogMs]
 */
function createTray({
  timer = null,
  windows = {},
  settings = () => ({}),
  actions = {},
  iconPath = path.join(__dirname, '../../build/trayTemplate.png'),
  logger = null,
  TrayClass = Tray,
  MenuClass = Menu,
  createImage = (file) => nativeImage.createFromPath(file),
  watchdogMs = WATCHDOG_MS,
} = {}) {
  /** @type {any} */
  let tray = null;
  /** @type {any} */
  let snapshot = timer && typeof timer.get === 'function' ? timer.get() : null;
  let disposed = false;

  const log = (level, message) => {
    if (logger && typeof logger[level] === 'function') logger[level](message);
  };

  function widget() {
    return typeof windows.getWidget === 'function' ? windows.getWidget() : null;
  }

  function widgetVisible() {
    const win = widget();
    return !!win && !win.isDestroyed() && win.isVisible();
  }

  /** The live menu, rebuilt on every open so labels cannot go stale. */
  function menuTemplate() {
    const running = !!snapshot && snapshot.status === 'running';
    const paused = !!snapshot && snapshot.status === 'paused';
    return [
      {
        id: 'showHide',
        label: widgetVisible() ? 'Hide widget' : 'Show widget',
        click: () => actions.showHide && actions.showHide(),
      },
      {
        id: 'bring',
        label: 'Bring to me',
        click: () => actions.bringToMe && actions.bringToMe(),
      },
      { type: 'separator' },
      {
        id: 'toggle',
        label: running ? 'Pause' : paused ? 'Resume' : 'Start',
        click: () => actions.toggle && actions.toggle(),
      },
      { id: 'skip', label: 'Skip', click: () => actions.skip && actions.skip() },
      { type: 'separator' },
      {
        id: 'dnd',
        label: 'Do not disturb',
        type: 'checkbox',
        checked: !!(settings() || {}).doNotDisturb,
        click: () => actions.toggleDnd && actions.toggleDnd(),
      },
      { type: 'separator' },
      {
        id: 'settings',
        label: 'Settings…',
        click: () => actions.settings && actions.settings(),
      },
      {
        id: 'logs',
        label: 'Open logs folder',
        click: () => actions.openLogs && actions.openLogs(),
      },
      { type: 'separator' },
      { id: 'quit', label: 'Quit Ember', click: () => actions.quit && actions.quit() },
    ];
  }

  function update() {
    if (!tray || (typeof tray.isDestroyed === 'function' && tray.isDestroyed())) return;
    tray.setToolTip(formatTooltip(snapshot));
  }

  function popup() {
    if (!tray) return;
    const menu = MenuClass.buildFromTemplate(menuTemplate());
    const win = widget();
    menu.popup(win && !win.isDestroyed() ? { window: win } : {});
  }

  function build() {
    let image = null;
    try {
      image = createImage(iconPath);
    } catch (error) {
      log('warn', `tray icon could not be loaded (${error && error.message})`);
    }
    if (!image || (typeof image.isEmpty === 'function' && image.isEmpty())) {
      log('warn', `tray icon is missing or empty at ${iconPath}`);
    }
    tray = new TrayClass(image || iconPath);
    update();
    if (typeof tray.on === 'function') {
      tray.on('click', () => actions.showHide && actions.showHide());
      tray.on('right-click', popup);
    }
    log('info', 'tray icon ready');
    return tray;
  }

  /** Create the icon if it is gone; safe to call as often as the watchdog likes. */
  function ensure() {
    if (disposed) return false;
    if (tray && !(typeof tray.isDestroyed === 'function' && tray.isDestroyed())) {
      update();
      return false;
    }
    try {
      build();
      return true;
    } catch (error) {
      log('warn', `tray icon could not be created (${error && error.message})`);
      tray = null;
      return false;
    }
  }

  function applySnapshot(next) {
    if (!next) return;
    snapshot = next;
    update();
  }

  function describe() {
    return {
      tooltip: formatTooltip(snapshot),
      items: menuTemplate()
        .filter((item) => item.id)
        .map((item) => ({
          id: item.id,
          label: item.label,
          ...(item.type === 'checkbox' ? { checked: !!item.checked } : {}),
        })),
    };
  }

  /** Run a menu command by id. Used by the test channel. */
  function invoke(id) {
    const item = menuTemplate().find((entry) => entry.id === id);
    if (!item || typeof item.click !== 'function') return false;
    item.click();
    return true;
  }

  build();
  const watchdog = setInterval(ensure, watchdogMs);
  if (typeof watchdog.unref === 'function') watchdog.unref();

  return {
    ensure,
    applySnapshot,
    menu: menuTemplate,
    describe,
    invoke,
    getTray: () => tray,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearInterval(watchdog);
      if (tray && typeof tray.destroy === 'function') tray.destroy();
      tray = null;
    },
  };
}

module.exports = { createTray, formatRemaining, formatTooltip, WATCHDOG_MS };
