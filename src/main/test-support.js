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
const TEST_CHANNEL_NAMES = Object.freeze([
  'test:setClock',
  'test:advanceClock',
  'test:setBounds',
  'test:setCursor',
  'test:setDisplays',
  'test:suspend',
  'test:trayCommand',
  'test:trayInfo',
]);

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
 * @param {{
 *   clock: { setNow: Function, advance: Function, now: Function },
 *   getWindow: () => any,
 *   suspend?: (ms: number) => any,
 *   setBounds?: (bounds: any) => any,
 *   setDisplays?: (displays: any) => any,
 *   setCursor?: (point: any) => any,
 *   trayInfo?: () => any,
 *   trayCommand?: (id: string) => boolean
 * }} deps
 */
function createHandlers({
  clock,
  getWindow,
  suspend = () => null,
  setBounds = null,
  setDisplays = null,
  setCursor = null,
  trayInfo = null,
  trayCommand = null,
}) {
  return {
    'test:setClock': (_event, iso) => {
      const target = Date.parse(String(iso));
      if (!Number.isFinite(target)) {
        throw new Error('test:setClock expects an ISO timestamp');
      }
      clock.setNow(target);
      return { ok: true, value: new Date(clock.now()).toISOString() };
    },
    'test:advanceClock': (_event, ms) => {
      const delta = Number(ms);
      if (!Number.isFinite(delta)) {
        throw new Error('test:advanceClock expects milliseconds');
      }
      clock.advance(delta);
      return { ok: true, value: new Date(clock.now()).toISOString() };
    },
    'test:setBounds': (_event, bounds) => {
      if (setBounds) return { ok: true, value: setBounds(bounds) };
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
      return { ok: true, value: win.getBounds() };
    },
    'test:setCursor': (_event, point) => {
      if (!setCursor) throw new Error('test:setCursor is unavailable');
      return { ok: true, value: setCursor(point) };
    },
    'test:setDisplays': (_event, displays) => {
      if (!setDisplays) throw new Error('test:setDisplays is unavailable');
      return { ok: true, value: setDisplays(displays) };
    },
    'test:suspend': (_event, ms) => {
      const delta = Number(ms);
      if (!Number.isFinite(delta) || delta < 0) {
        throw new Error('test:suspend expects non-negative milliseconds');
      }
      clock.advance(delta);
      suspend(delta);
      return { ok: true, value: { now: new Date(clock.now()).toISOString(), awayMs: delta } };
    },
    'test:trayInfo': () => ({ ok: true, value: trayInfo ? trayInfo() : null }),
    'test:trayCommand': (_event, id) => {
      if (!trayCommand) throw new Error('test:trayCommand is unavailable');
      return { ok: true, value: trayCommand(String(id)) };
    },
  };
}

/**
 * Register one channel. Kept as a named helper so a later change can add a
 * channel next to the built-in set without restructuring this file.
 */
function registerTestChannel(ipcMain, name, handler) {
  ipcMain.handle(name, handler);
}

/**
 * @param {{
 *   ipcMain: any, clock: any, getWindow: () => any,
 *   suspend?: (ms: number) => any,
 *   setBounds?: (bounds: any) => any,
 *   setDisplays?: (displays: any) => any,
 *   setCursor?: (point: any) => any,
 *   trayInfo?: () => any,
 *   trayCommand?: (id: string) => boolean,
 *   env?: NodeJS.ProcessEnv
 * }} options
 * @returns {string[]} the channels registered, empty when test mode is off
 */
function registerTestChannels({
  ipcMain,
  clock,
  getWindow,
  suspend,
  setBounds,
  setDisplays,
  setCursor,
  trayInfo,
  trayCommand,
  env = process.env,
}) {
  if (!isEnabled(env)) return [];
  const handlers = createHandlers({
    clock,
    getWindow,
    suspend,
    setBounds,
    setDisplays,
    setCursor,
    trayInfo,
    trayCommand,
  });
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
