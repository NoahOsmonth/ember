'use strict';

/**
 * The test-only IPC surface.
 *
 * Imported unconditionally, but it registers nothing unless both EMBER_TEST=1
 * and an absolute EMBER_USER_DATA are present. The channel names live in one
 * frozen list so a unit test can prove that every advertised channel has a
 * handler, and the CI grep can prove that no `test:` channel is registered
 * anywhere else.
 */

/** Every channel this module owns. Later changes add to this list here. */
const TEST_CHANNEL_NAMES = Object.freeze(['test:setClock', 'test:advanceClock', 'test:setBounds']);

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean} true only for a safe test launch
 */
function isEnabled(env = process.env) {
  return (
    env.EMBER_TEST === '1' &&
    typeof env.EMBER_USER_DATA === 'string' &&
    env.EMBER_USER_DATA.length > 0
  );
}

/**
 * Build the handlers. Injected dependencies keep this module unit-testable
 * without Electron.
 *
 * @param {{ clock: { setNow: Function, advance: Function, now: Function }, getWindow: () => any }} deps
 */
function createHandlers({ clock, getWindow }) {
  return {
    'test:setClock': (_event, iso) => {
      const target = Date.parse(String(iso));
      if (!Number.isFinite(target)) {
        throw new Error('test:setClock expects an ISO timestamp');
      }
      clock.setNow(target);
      return new Date(clock.now()).toISOString();
    },
    'test:advanceClock': (_event, ms) => {
      const delta = Number(ms);
      if (!Number.isFinite(delta)) {
        throw new Error('test:advanceClock expects milliseconds');
      }
      clock.advance(delta);
      return new Date(clock.now()).toISOString();
    },
    'test:setBounds': (_event, bounds) => {
      const win = getWindow();
      if (!win || win.isDestroyed()) throw new Error('test:setBounds has no widget window');
      const current = win.getBounds();
      const next = {
        x: Number.isFinite(bounds && bounds.x) ? Math.round(bounds.x) : current.x,
        y: Number.isFinite(bounds && bounds.y) ? Math.round(bounds.y) : current.y,
        width: Number.isFinite(bounds && bounds.width) ? Math.round(bounds.width) : current.width,
        height: Number.isFinite(bounds && bounds.height)
          ? Math.round(bounds.height)
          : current.height,
      };
      win.setBounds(next);
      return win.getBounds();
    },
  };
}

/**
 * Register one channel. Kept as a named helper so a later change can add a
 * channel next to the built-in three without restructuring this file.
 */
function registerTestChannel(ipcMain, name, handler) {
  ipcMain.handle(name, handler);
}

/**
 * @param {{ ipcMain: any, clock: any, getWindow: () => any, env?: NodeJS.ProcessEnv }} options
 * @returns {string[]} the channels registered, empty when test mode is off
 */
function registerTestChannels({ ipcMain, clock, getWindow, env = process.env }) {
  if (!isEnabled(env)) return [];
  const handlers = createHandlers({ clock, getWindow });
  for (const name of TEST_CHANNEL_NAMES) {
    registerTestChannel(ipcMain, name, handlers[name]);
  }
  return TEST_CHANNEL_NAMES.slice();
}

module.exports = {
  TEST_CHANNEL_NAMES,
  createHandlers,
  isEnabled,
  registerTestChannel,
  registerTestChannels,
};
