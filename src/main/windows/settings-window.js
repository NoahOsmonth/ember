'use strict';

/**
 * The settings window (capability: tray-recovery).
 *
 * Split out of the main process wiring so the widget and the settings panel are
 * created by separate modules. The window is frameless and transparent like the
 * widget, but it is resizable in height only and it is never click-through.
 */

const { BrowserWindow } = require('electron');
const { WEB_PREFERENCES, hardenWindow } = require('../security');

const WIDTH = 460;
const MAX_HEIGHT = 640;
const MARGIN = 40;

/**
 * @param {object} options
 * @param {any} options.screen Electron's screen module
 * @param {() => any} [options.getWidget] the live widget window, if any
 * @param {string} options.preload absolute preload path
 * @param {string} options.page absolute HTML path
 * @param {boolean} [options.safeMode] safe mode never pins the panel on top
 * @param {() => void} [options.onClosed]
 */
function createSettingsWindow({
  screen,
  getWidget = () => null,
  preload,
  page,
  safeMode = false,
  onClosed = () => {},
}) {
  /** @type {any} */
  let win = null;

  function areaFor() {
    const widget = getWidget();
    const bounds = widget && !widget.isDestroyed() ? widget.getBounds() : null;
    return bounds
      ? screen.getDisplayMatching(bounds).workArea
      : screen.getPrimaryDisplay().workArea;
  }

  /**
   * Ask a live window to switch tabs. A window that is still loading gets the
   * message after its load event, so the page's own `?tab=` handling cannot
   * overwrite it.
   */
  function sendTab(target, tab) {
    const contents = target.webContents;
    if (contents.isLoadingMainFrame()) {
      contents.once('did-finish-load', () => {
        if (!target.isDestroyed()) contents.send('tab', tab);
      });
    } else {
      contents.send('tab', tab);
    }
  }

  function open(tab = 'settings') {
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
      sendTab(win, tab);
      return win;
    }
    const area = areaFor();
    const height = Math.min(MAX_HEIGHT, area.height - MARGIN);
    win = new BrowserWindow({
      width: WIDTH,
      height,
      x: Math.round(area.x + (area.width - WIDTH) / 2),
      y: Math.round(area.y + (area.height - height) / 2),
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
        preload,
      },
    });
    hardenWindow(win, { file: page });
    win.setAlwaysOnTop(!safeMode, 'screen-saver');
    win.loadFile(page, { query: { tab } });
    win.on('closed', () => {
      win = null;
      onClosed();
    });
    return win;
  }

  /** Re-apply the window level after unlock or a display change. */
  function reassert() {
    if (win && !win.isDestroyed()) win.setAlwaysOnTop(!safeMode, 'screen-saver');
  }

  return {
    open,
    reassert,
    getWindow: () => win,
    close() {
      if (win && !win.isDestroyed()) win.close();
    },
    dispose() {
      if (win && !win.isDestroyed()) win.destroy();
      win = null;
    },
  };
}

module.exports = { createSettingsWindow, MAX_HEIGHT, WIDTH };
