'use strict';

/**
 * Global shortcut ownership (capability: shortcut-bindings).
 *
 * Every registration result is kept: a shortcut that another application owns
 * is reported, not silently ignored. The module owns the binding table, the
 * per-binding status and the register-then-commit rebind order; the settings
 * window only renders the status and sends a candidate accelerator.
 */

const path = require('path');
const { pathToFileURL } = require('url');

/** The actions the app binds, in the order the settings window lists them. */
const DEFAULT_BINDINGS = Object.freeze([
  Object.freeze({ id: 'showHide', label: 'Show or hide', accelerator: 'Control+Alt+P' }),
  Object.freeze({ id: 'toggle', label: 'Start or pause', accelerator: 'Control+Alt+Space' }),
  Object.freeze({ id: 'lock', label: 'Click-through', accelerator: 'Control+Alt+L' }),
]);

/** The closed set of rebind outcomes. */
const CODES = Object.freeze({
  ok: 'ok',
  conflict: 'conflict',
  unavailable: 'unavailable',
  invalid: 'invalid',
  reserved: 'reserved',
});

/**
 * @typedef {{
 *   ok: boolean,
 *   code: string,
 *   message?: string,
 *   conflictWith?: string,
 *   binding?: any,
 *   bindings: any[]
 * }} RebindResult
 */

/**
 * @param {{
 *   store?: { get: () => any, set: (patch: any, value?: any) => any } | null,
 *   logger?: { warn?: Function, info?: Function } | null,
 *   onAction?: (id: string) => void,
 *   safeMode?: boolean | (() => boolean),
 *   globalShortcut: { register: (accelerator: string, handler: Function) => boolean, unregister: (accelerator: string) => void }
 * }} options
 */
async function createShortcuts({
  store = null,
  logger = null,
  onAction = () => {},
  safeMode = false,
  globalShortcut,
}) {
  if (!globalShortcut) throw new Error('createShortcuts requires globalShortcut');
  const acceleratorsUrl = pathToFileURL(path.join(__dirname, '../core/accelerators.js')).href;
  const { canonicalAccelerator, isReserved } = await import(acceleratorsUrl);

  /** @type {Map<string, { id: string, label: string, accelerator: string, status: string, message: string }>} */
  const bindings = new Map(
    DEFAULT_BINDINGS.map((binding) => [binding.id, { ...binding, status: 'invalid', message: '' }])
  );
  /** Accelerators this process currently holds. @type {Map<string, string>} */
  const registered = new Map();
  let disposed = false;

  const isSafe = () => (typeof safeMode === 'function' ? !!safeMode() : !!safeMode);

  function warn(message) {
    if (logger && typeof logger.warn === 'function') logger.warn(message);
  }

  function publicBinding(binding) {
    return {
      id: binding.id,
      label: binding.label,
      accelerator: binding.accelerator,
      status: binding.status,
      message: binding.message,
    };
  }

  function getStatus() {
    return { safeMode: isSafe(), bindings: [...bindings.values()].map(publicBinding) };
  }

  /** Adopt the stored accelerators. A missing or non-string value keeps the default. */
  function configured() {
    const document = store && typeof store.get === 'function' ? store.get() : null;
    const values =
      document && document.shortcuts && typeof document.shortcuts === 'object'
        ? document.shortcuts
        : {};
    for (const binding of DEFAULT_BINDINGS) {
      const value = values[binding.id];
      bindings.get(binding.id).accelerator =
        typeof value === 'string' ? value : binding.accelerator;
    }
  }

  /** Release every accelerator this process holds. */
  function releaseAll() {
    for (const accelerator of registered.keys()) globalShortcut.unregister(accelerator);
    registered.clear();
  }

  function mark(binding, status, message = '') {
    binding.status = status;
    binding.message = message;
    if (status !== 'active') warn(`shortcut ${binding.id} (${binding.accelerator}): ${message}`);
  }

  /**
   * Register every configured binding from a clean slate, recording the result
   * of each attempt instead of discarding it.
   */
  function registerAll() {
    releaseAll();
    configured();

    if (isSafe()) {
      for (const binding of bindings.values()) mark(binding, 'disabled', 'safe mode is active');
      return getStatus();
    }

    const seen = new Map();
    for (const binding of bindings.values()) {
      const accelerator = canonicalAccelerator(binding.accelerator);
      if (accelerator === null) {
        mark(binding, 'invalid', 'not a valid combination');
        continue;
      }
      if (isReserved(accelerator)) {
        mark(binding, 'reserved', 'reserved by the operating system');
        continue;
      }
      if (seen.has(accelerator)) {
        mark(binding, 'conflict', `already used by ${seen.get(accelerator)}`);
        continue;
      }
      seen.set(accelerator, binding.label);

      if (globalShortcut.register(accelerator, () => onAction(binding.id))) {
        registered.set(accelerator, binding.id);
        binding.status = 'active';
        binding.message = '';
      } else {
        mark(binding, 'unavailable', 'taken by another app');
      }
    }
    return getStatus();
  }

  function persist(id, accelerator) {
    if (!store || typeof store.set !== 'function') return;
    const document = store.get() || {};
    const shortcuts = { ...(document.shortcuts || {}), [id]: accelerator };
    const result = store.set('shortcuts', shortcuts);
    if (result && Array.isArray(result.issues) && result.issues.length > 0) {
      const summary = result.issues.map((entry) => `${entry.path}: ${entry.code}`).join(', ');
      warn(`shortcut setting rejected: ${summary}`);
    }
  }

  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, any>} [extra]
   * @returns {RebindResult}
   */
  function failure(code, message, extra = {}) {
    return { ok: false, code, message, ...extra, bindings: getStatus().bindings };
  }

  /**
   * Validate a candidate, register it while the old one is still held, then
   * release the old one and persist. A rejection leaves the old binding intact.
   *
   * @param {string} id
   * @param {unknown} candidate
   * @returns {RebindResult}
   */
  function rebind(id, candidate) {
    const binding = bindings.get(id);
    if (!binding) return failure(CODES.invalid, `unknown shortcut "${id}"`);
    if (isSafe()) return failure(CODES.unavailable, 'safe mode disables global shortcuts');

    const accelerator = canonicalAccelerator(candidate);
    if (accelerator === null) {
      return failure(CODES.invalid, `"${String(candidate)}" is not a valid combination`);
    }
    if (isReserved(accelerator)) {
      return failure(CODES.reserved, `${accelerator} is reserved by the operating system`);
    }
    for (const other of bindings.values()) {
      if (other.id !== id && canonicalAccelerator(other.accelerator) === accelerator) {
        return failure(CODES.conflict, `already used by ${other.label}`, {
          conflictWith: other.id,
        });
      }
    }

    const previous = canonicalAccelerator(binding.accelerator);
    if (previous === accelerator && registered.has(accelerator)) {
      binding.status = 'active';
      binding.message = '';
      persist(id, accelerator);
      return {
        ok: true,
        code: CODES.ok,
        binding: publicBinding(binding),
        bindings: getStatus().bindings,
      };
    }

    if (!globalShortcut.register(accelerator, () => onAction(id))) {
      return failure(CODES.unavailable, `${accelerator} is taken by another app`);
    }

    if (previous !== null && previous !== accelerator && registered.has(previous)) {
      globalShortcut.unregister(previous);
      registered.delete(previous);
    }
    registered.set(accelerator, id);
    binding.accelerator = accelerator;
    binding.status = 'active';
    binding.message = '';
    persist(id, accelerator);
    return {
      ok: true,
      code: CODES.ok,
      binding: publicBinding(binding),
      bindings: getStatus().bindings,
    };
  }

  /** Restore the three defaults and register them. */
  function reset() {
    if (isSafe()) return failure(CODES.unavailable, 'safe mode disables global shortcuts');
    releaseAll();
    const shortcuts = {};
    for (const binding of DEFAULT_BINDINGS) shortcuts[binding.id] = binding.accelerator;
    if (store && typeof store.set === 'function') store.set('shortcuts', shortcuts);
    registerAll();
    return { ok: true, code: CODES.ok, bindings: getStatus().bindings };
  }

  return {
    registerAll,
    rebind,
    reset,
    getStatus,
    unregisterAll: releaseAll,
    dispose() {
      if (disposed) return;
      disposed = true;
      releaseAll();
    },
  };
}

module.exports = { CODES, DEFAULT_BINDINGS, createShortcuts };
