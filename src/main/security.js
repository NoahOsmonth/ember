'use strict';

/**
 * The window hardening policy.
 *
 * Every BrowserWindow gets the same four explicit web preferences and the same
 * navigation guards. They are stated here once so a new window cannot quietly
 * inherit a weaker default.
 */

const { pathToFileURL } = require('url');

/** The only schemes an external link may use. */
const EXTERNAL_SCHEMES = new Set(['https:', 'mailto:']);

/** Stated explicitly even where Electron's current defaults agree. */
const WEB_PREFERENCES = Object.freeze({
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  webviewTag: false,
});

/**
 * @param {unknown} url
 * @returns {boolean} true only for an absolute https: or mailto: URL
 */
function isAllowedExternal(url) {
  if (typeof url !== 'string' || url.length === 0) return false;
  try {
    return EXTERNAL_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * Open an external link, but only when its scheme is on the allowlist.
 *
 * `shell` is injectable for tests and otherwise required lazily so this module
 * can be loaded outside Electron.
 *
 * @param {string} url
 * @param {{ openExternal: (url: string) => Promise<void> }} [shell]
 * @returns {Promise<boolean>} whether the request was handed to the OS
 */
async function openExternal(url, shell = null) {
  if (!isAllowedExternal(url)) return false;
  const target = shell || require('electron').shell;
  await target.openExternal(url);
  return true;
}

/**
 * Cancel navigation away from the packaged page and deny every new window.
 *
 * A reload of the same document is allowed, with or without its query string
 * (the settings window loads with `?tab=`). Anything else is cancelled.
 *
 * @param {any} window a BrowserWindow
 * @param {{ file: string }} options the packaged document this window owns
 */
function hardenWindow(window, { file }) {
  const allowed = pathToFileURL(file).href;
  const contents = window.webContents;

  contents.on('will-navigate', (event, url) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      event.preventDefault();
      return;
    }
    if (target.protocol !== 'file:' || target.pathname !== new URL(allowed).pathname) {
      event.preventDefault();
    }
  });

  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

module.exports = {
  EXTERNAL_SCHEMES,
  WEB_PREFERENCES,
  hardenWindow,
  isAllowedExternal,
  openExternal,
};
