'use strict';

/**
 * The widget window: creation, bounds, drag and placement persistence.
 *
 * The main process owns the geometry. The renderer reports only where the
 * pointer went down and when it came up; the window follows
 * `screen.getCursorScreenPoint()` on a 16 ms interval, so the position is
 * always in DIPs and keeps tracking when the pointer leaves the window.
 */

const { BrowserWindow } = require('electron');
const { WEB_PREFERENCES, hardenWindow } = require('../security');

const SIZES = { full: { width: 340, height: 96 }, mini: { width: 156, height: 58 } };
const DRAG_INTERVAL_MS = 16;
const PERSIST_DELAY_MS = 200;

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 * @typedef {{ width: number, height: number }} Size
 * @typedef {{ id: number, workArea: Rect, scaleFactor: number, isPrimary: boolean }} Display
 * @typedef {{ x: number, y: number, width: number, height: number, displayId: number | null, scaleFactor: number }} Placement
 */

const samePlacement = (a, b) =>
  !!a &&
  a.x === b.x &&
  a.y === b.y &&
  a.width === b.width &&
  a.height === b.height &&
  a.displayId === b.displayId &&
  a.scaleFactor === b.scaleFactor;

const intersects = (a, b) => {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
};

/**
 * @param {object} options
 * @param {any} options.screen Electron's screen module
 * @param {{ clampToWorkArea: Function, dockRight: Function, pickDisplay: Function, nextScaleFactor: Function }} options.geometry
 *   the pure `src/core/placement.js` namespace
 * @param {() => any} options.settings the live settings document
 * @param {(patch: object) => void} options.persist merge a patch and save it
 * @param {string} options.preload absolute preload path
 * @param {string} options.page absolute HTML path
 * @param {(win: any) => void} [options.onReady] after the page has loaded
 * @param {() => void} [options.onClosed] after the window is gone
 * @param {boolean} [options.safeMode] opaque window, never always-on-top
 * @param {any} [options.logger]
 */
function createWidgetWindow({
  screen,
  geometry,
  settings,
  persist,
  preload,
  page,
  onReady = () => {},
  onClosed = () => {},
  safeMode = false,
  logger = null,
}) {
  const { clampToWorkArea, dockRight, pickDisplay, nextScaleFactor } = geometry;
  let win = null;
  let drag = null;
  let persistTimer = null;
  /** @type {Display[] | null} */
  let testDisplays = null;
  /** @type {{ x: number, y: number } | null} */
  let testCursor = null;
  const listeners = [];

  const log = (level, message) => {
    if (logger && typeof logger[level] === 'function') logger[level](message);
  };

  /** @returns {Display[]} */
  function listDisplays() {
    if (testDisplays) return testDisplays;
    const primaryId = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((display) => ({
      id: display.id,
      workArea: display.workArea,
      scaleFactor: display.scaleFactor || 1,
      isPrimary: display.id === primaryId,
    }));
  }

  /** @returns {Display | null} */
  function primaryDisplay() {
    const displays = listDisplays();
    return displays.find((display) => display.isPrimary) || displays[0] || null;
  }

  /** @returns {Display | null} */
  function displayFor(bounds) {
    if (!testDisplays) {
      const display = screen.getDisplayMatching(bounds);
      if (display) {
        const primaryId = screen.getPrimaryDisplay().id;
        return {
          id: display.id,
          workArea: display.workArea,
          scaleFactor: display.scaleFactor || 1,
          isPrimary: display.id === primaryId,
        };
      }
    }
    const displays = listDisplays();
    let best = null;
    let bestArea = 0;
    for (const display of displays) {
      const area = intersects(bounds, display.workArea);
      if (area > bestArea) {
        best = display;
        bestArea = area;
      }
    }
    return best || primaryDisplay();
  }

  function cursorPoint() {
    if (testCursor) return { ...testCursor };
    return screen.getCursorScreenPoint();
  }

  /**
   * The display nearest a point, honouring the test display list.
   *
   * @param {{ x: number, y: number }} point
   * @returns {Display | null}
   */
  function displayAt(point) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    if (!testDisplays) {
      const display = screen.getDisplayNearestPoint(point);
      if (display) {
        const primaryId = screen.getPrimaryDisplay().id;
        return {
          id: display.id,
          workArea: display.workArea,
          scaleFactor: display.scaleFactor || 1,
          isPrimary: display.id === primaryId,
        };
      }
    }
    const distance = (display) => {
      const area = display.workArea;
      const dx = Math.max(area.x - point.x, 0, point.x - (area.x + area.width));
      const dy = Math.max(area.y - point.y, 0, point.y - (area.y + area.height));
      return dx * dx + dy * dy;
    };
    let best = null;
    let bestDistance = Infinity;
    for (const display of listDisplays()) {
      const value = distance(display);
      if (value < bestDistance) {
        best = display;
        bestDistance = value;
      }
    }
    return best || primaryDisplay();
  }

  /** @param {Size} size @param {Rect} area */
  function fit(size, area) {
    const factor = nextScaleFactor(size, area);
    return {
      width: Math.max(1, Math.round(size.width * factor)),
      height: Math.max(1, Math.round(size.height * factor)),
    };
  }

  /** @param {Rect} area @param {Size} size @returns {Rect} */
  function centred(area, size) {
    const fitted = fit(size, area);
    return clampToWorkArea(
      {
        x: Math.round(area.x + (area.width - fitted.width) / 2),
        y: Math.round(area.y + (area.height - fitted.height) / 2),
        ...fitted,
      },
      area
    );
  }

  /** @param {Size} size @returns {Rect} */
  function restore(size) {
    const saved = settings().placement;
    if (!saved) {
      const primary = primaryDisplay();
      return primary ? centred(primary.workArea, size) : { x: 0, y: 0, ...size };
    }
    const displays = listDisplays();
    const primary = primaryDisplay();
    const target = pickDisplay(displays, saved);
    if (!target || !primary) return { x: 0, y: 0, ...size };
    if (Number.isInteger(saved.displayId) && target.id !== saved.displayId) {
      // The monitor the widget lived on is gone; a stale absolute coordinate
      // is meaningless, so start centred on the primary display instead.
      return centred(primary.workArea, size);
    }
    const fitted = fit(size, target.workArea);
    return clampToWorkArea(
      { x: Math.round(saved.x), y: Math.round(saved.y), ...fitted },
      target.workArea
    );
  }

  function currentPlacement() {
    if (!win || win.isDestroyed()) return null;
    const bounds = win.getBounds();
    const display = displayFor(bounds);
    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      displayId: display ? display.id : null,
      scaleFactor: display ? display.scaleFactor : 1,
    };
  }

  function persistPlacement() {
    if (!win || win.isDestroyed()) return;
    const placement = currentPlacement();
    if (!placement) return;
    if (samePlacement(settings().placement, placement)) return;
    persist({ placement });
  }

  function schedulePersist() {
    if (persistTimer !== null) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistPlacement();
    }, PERSIST_DELAY_MS);
    if (typeof persistTimer.unref === 'function') persistTimer.unref();
  }

  function persistNow() {
    if (persistTimer !== null) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    persistPlacement();
  }

  /** Clamp the window into the work area it overlaps. */
  function clamp() {
    if (!win || win.isDestroyed()) return null;
    const bounds = win.getBounds();
    const display = displayFor(bounds);
    if (!display) return bounds;
    const next = clampToWorkArea(bounds, display.workArea);
    if (
      next.x !== bounds.x ||
      next.y !== bounds.y ||
      next.width !== bounds.width ||
      next.height !== bounds.height
    ) {
      win.setBounds(next);
    }
    return win.getBounds();
  }

  /**
   * Move the window to an explicit rectangle, clamped to its display.
   *
   * @param {Partial<Rect>} bounds
   */
  function setBounds(bounds) {
    if (!win || win.isDestroyed()) return null;
    const current = win.getBounds();
    const candidate = {
      x: Number.isFinite(bounds && bounds.x) ? Math.round(bounds.x) : current.x,
      y: Number.isFinite(bounds && bounds.y) ? Math.round(bounds.y) : current.y,
      width: Number.isFinite(bounds && bounds.width) ? Math.round(bounds.width) : current.width,
      height: Number.isFinite(bounds && bounds.height) ? Math.round(bounds.height) : current.height,
    };
    const display = displayFor(candidate);
    const next = display ? clampToWorkArea(candidate, display.workArea) : candidate;
    win.setBounds(next);
    persistNow();
    return win.getBounds();
  }

  /**
   * Toggle compact mode, keeping the right edge fixed.
   *
   * @param {boolean} mini
   */
  function setMini(mini) {
    if (!win || win.isDestroyed()) return null;
    const bounds = win.getBounds();
    const size = mini ? SIZES.mini : SIZES.full;
    const display = displayFor(bounds);
    const candidate = {
      x: bounds.x + bounds.width - size.width,
      y: bounds.y,
      ...size,
    };
    const next = display ? clampToWorkArea(candidate, display.workArea) : candidate;
    win.setBounds(next);
    persist({ mini, placement: currentPlacement() });
    return win.getBounds();
  }

  /** Move the widget to the right edge of its display. */
  function dock() {
    if (!win || win.isDestroyed()) return null;
    const bounds = win.getBounds();
    const display = displayFor(bounds);
    if (!display) return bounds;
    win.setBounds(dockRight(bounds, display.workArea));
    persistNow();
    return win.getBounds();
  }

  /**
   * Start following the cursor. The offset is captured once, in DIPs, so it
   * never accumulates error and survives the pointer leaving the window.
   *
   * @param {{ x: number, y: number }} point
   */
  function startDrag(point) {
    if (!win || win.isDestroyed()) return null;
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    if (drag) clearInterval(drag.timer);
    const bounds = win.getBounds();
    drag = {
      offsetX: point.x - bounds.x,
      offsetY: point.y - bounds.y,
      timer: setInterval(tickDrag, DRAG_INTERVAL_MS),
    };
    if (typeof drag.timer.unref === 'function') drag.timer.unref();
    return bounds;
  }

  function tickDrag() {
    if (!drag) return;
    if (!win || win.isDestroyed()) {
      endDrag();
      return;
    }
    const cursor = cursorPoint();
    const bounds = win.getBounds();
    const display = displayFor(bounds);
    if (!display) return;
    const next = clampToWorkArea(
      {
        x: Math.round(cursor.x - drag.offsetX),
        y: Math.round(cursor.y - drag.offsetY),
        width: bounds.width,
        height: bounds.height,
      },
      display.workArea
    );
    if (next.x !== bounds.x || next.y !== bounds.y) win.setPosition(next.x, next.y);
  }

  function endDrag() {
    if (!drag) return null;
    clearInterval(drag.timer);
    drag = null;
    clamp();
    persistNow();
    return win && !win.isDestroyed() ? win.getBounds() : null;
  }

  /** Replace the screen with a fixed display list (test mode only). */
  function setTestDisplays(displays) {
    if (!Array.isArray(displays) || displays.length === 0) {
      testDisplays = null;
    } else {
      testDisplays = displays.map((display, index) => {
        const area = display && display.workArea;
        if (
          !area ||
          !Number.isFinite(area.x) ||
          !Number.isFinite(area.y) ||
          !Number.isFinite(area.width) ||
          !Number.isFinite(area.height)
        ) {
          throw new Error('test:setDisplays expects every display to have a workArea');
        }
        return {
          id: Number.isInteger(display.id) ? display.id : index + 1,
          workArea: { x: area.x, y: area.y, width: area.width, height: area.height },
          scaleFactor:
            Number.isFinite(display.scaleFactor) && display.scaleFactor > 0
              ? display.scaleFactor
              : 1,
          isPrimary: display.isPrimary === true,
        };
      });
      if (!testDisplays.some((display) => display.isPrimary)) testDisplays[0].isPrimary = true;
    }
    clamp();
    persistNow();
    return listDisplays();
  }

  /** Put the cursor at a fixed point (test mode only). */
  function setTestCursor(point) {
    if (point === null || point === undefined) {
      testCursor = null;
      return null;
    }
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new Error('test:setCursor expects finite x and y');
    }
    testCursor = { x: point.x, y: point.y };
    return { ...testCursor };
  }

  function onDisplayChange() {
    clamp();
    persistNow();
  }

  function subscribeDisplays() {
    if (typeof screen.on !== 'function') return;
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.on(event, onDisplayChange);
      listeners.push(event);
    }
  }

  function unsubscribeDisplays() {
    if (typeof screen.removeListener !== 'function') return;
    for (const event of listeners.splice(0)) screen.removeListener(event, onDisplayChange);
  }

  function create() {
    if (win && !win.isDestroyed()) return win;
    const size = settings().mini ? SIZES.mini : SIZES.full;
    const bounds = restore(size);
    win = new BrowserWindow({
      ...bounds,
      frame: false,
      transparent: !safeMode,
      backgroundColor: safeMode ? '#08090d' : '#00000000',
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: !safeMode,
      title: 'Ember',
      webPreferences: {
        ...WEB_PREFERENCES,
        preload,
      },
    });
    hardenWindow(win, { file: page });
    win.setAlwaysOnTop(!safeMode && settings().onTop, 'screen-saver');
    win.loadFile(page);
    win.webContents.on('did-finish-load', () => onReady(win));
    win.on('move', schedulePersist);
    win.on('closed', () => {
      endDrag();
      if (persistTimer !== null) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      unsubscribeDisplays();
      win = null;
      onClosed();
    });
    subscribeDisplays();
    log('info', `widget placed at ${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}`);
    return win;
  }

  function dispose() {
    if (win && !win.isDestroyed()) persistPlacement();
    if (drag) {
      clearInterval(drag.timer);
      drag = null;
    }
    if (persistTimer !== null) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    unsubscribeDisplays();
  }

  return {
    create,
    getWindow: () => win,
    getBounds: () => (win && !win.isDestroyed() ? win.getBounds() : null),
    clamp,
    setBounds,
    setMini,
    dock,
    startDrag,
    endDrag,
    currentPlacement,
    listDisplays,
    displayAt,
    getCursor: cursorPoint,
    setTestDisplays,
    setTestCursor,
    dispose,
  };
}

module.exports = { SIZES, createWidgetWindow };
