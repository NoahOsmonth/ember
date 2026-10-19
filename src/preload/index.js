'use strict';

/**
 * The explicit renderer API.
 *
 * One named method per channel, grouped by the channel's domain. There is no
 * generic pass-through: a renderer cannot name a channel that this file does
 * not name. Every invoke resolves to the registry's `{ ok, value }` /
 * `{ ok: false, code }` envelope.
 *
 * This file stays self-contained because Electron sandboxes preload scripts:
 * a relative `require` of another local file is not available inside the
 * sandbox. The contract test evaluates this source with a fake `electron`.
 */

const { contextBridge, ipcRenderer } = require('electron');

const UNKNOWN_CHANNEL = /No handler registered/i;

/**
 * @param {{ invoke: Function, send: Function, on: Function }} renderer
 */
function createApi(renderer) {
  /**
   * @param {string} name
   * @param {unknown} [payload]
   */
  async function invoke(name, payload) {
    try {
      return await renderer.invoke(name, payload);
    } catch (error) {
      const message = error && typeof error.message === 'string' ? error.message : String(error);
      if (UNKNOWN_CHANNEL.test(message)) return { ok: false, code: 'unknown-channel' };
      return { ok: false, code: 'handler-error' };
    }
  }

  /**
   * @param {string} name
   * @param {unknown} [payload]
   */
  function send(name, payload) {
    renderer.send(name, payload);
  }

  /**
   * @param {string} name
   * @param {(value: unknown) => void} callback
   */
  function on(name, callback) {
    renderer.on(name, (_event, value) => callback(value));
  }

  return {
    state: {
      get: () => invoke('state:get'),
      set: (patch) => invoke('state:set', patch),
      reset: () => invoke('state:reset'),
    },
    win: {
      move: (delta) => send('win:move', delta),
      mini: (mini) => invoke('win:mini', { mini }),
      lock: (locked) => invoke('win:lock', { locked }),
      close: () => send('win:close'),
    },
    app: {
      quit: () => send('app:quit'),
    },
    menu: {
      show: () => send('menu:show'),
    },
    settings: {
      open: (tab) => invoke('settings:open', tab === undefined ? undefined : { tab }),
    },
    // Explicit test-only methods. They are harmless in a release build: no
    // handler is registered, so each resolves to `{ ok: false, code:
    // 'unknown-channel' }`. The contract test excludes this namespace.
    test: {
      setClock: (iso) => invoke('test:setClock', iso),
      advanceClock: (ms) => invoke('test:advanceClock', ms),
      setBounds: (bounds) => invoke('test:setBounds', bounds),
    },
    onSettings: (callback) => on('settings', callback),
    onCommand: (callback) => on('command', callback),
    onTab: (callback) => on('tab', callback),
  };
}

contextBridge.exposeInMainWorld('ember', createApi(ipcRenderer));

// Available to the contract test when the source is evaluated outside Electron.
if (typeof module !== 'undefined' && module.exports) module.exports = { createApi };
