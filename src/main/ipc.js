'use strict';

/**
 * The IPC channel registry (capability: ipc-contract).
 *
 * One declaration per channel: name, kind, payload schema and handler. The
 * registry validates every payload before the handler sees it and turns both
 * validation failures and handler exceptions into result envelopes, so a
 * renderer never waits on a rejected promise.
 */

const NAME_PATTERN = /^[a-z][a-z0-9]*:[a-z][a-zA-Z0-9]*$/;
const KINDS = new Set(['invoke', 'send']);

function errorMessage(error) {
  return error && typeof error.message === 'string' ? error.message : String(error);
}

function issueSummary(issues) {
  return issues.map((entry) => `${entry.path || '(root)'}: ${entry.code}`).join(', ');
}

/**
 * @param {{ logger?: { warn: Function, error: Function } | null }} [options]
 */
function createRegistry({ logger = null } = {}) {
  const channels = new Map();
  let registered = false;

  const log = (level, message) => {
    if (logger && typeof logger[level] === 'function') logger[level](message);
  };

  /**
   * @param {{ name?: string, kind?: string, schema?: any, handler?: Function }} [channel]
   */
  function defineChannel({ name, kind, schema, handler } = {}) {
    if (registered) {
      throw new Error('channels cannot be defined after register()');
    }
    if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
      throw new Error(
        `invalid channel name "${name}": expected domain:action with a lowercase domain and a camelCase action`
      );
    }
    if (!KINDS.has(kind)) {
      throw new Error(`channel ${name} has an invalid kind "${kind}": expected invoke or send`);
    }
    if (!schema || typeof schema.check !== 'function') {
      throw new Error(`channel ${name} has no payload schema`);
    }
    if (typeof handler !== 'function') {
      throw new Error(`channel ${name} has no handler`);
    }
    if (channels.has(name)) {
      throw new Error(`duplicate channel ${name}`);
    }
    channels.set(name, { name, kind, schema, handler });
    return api;
  }

  function validate(channel, payload) {
    const issues = channel.schema.check(payload);
    if (issues.length > 0) {
      log('warn', `ipc ${channel.name} rejected payload: ${issueSummary(issues)}`);
      return issues;
    }
    return null;
  }

  function register(ipcMain) {
    if (registered) throw new Error('registry already registered');
    registered = true;

    for (const channel of channels.values()) {
      if (channel.kind === 'invoke') {
        ipcMain.handle(channel.name, async (event, payload) => {
          const issues = validate(channel, payload);
          if (issues) return { ok: false, code: 'invalid-payload', issues };
          try {
            return { ok: true, value: await channel.handler(payload, event) };
          } catch (error) {
            log('error', `ipc ${channel.name} handler failed: ${errorMessage(error)}`);
            return { ok: false, code: 'handler-error' };
          }
        });
      } else {
        ipcMain.on(channel.name, (event, payload) => {
          const issues = validate(channel, payload);
          if (issues) return;
          try {
            channel.handler(payload, event);
          } catch (error) {
            log('error', `ipc ${channel.name} handler failed: ${errorMessage(error)}`);
          }
        });
      }
    }
    return api;
  }

  function describe() {
    return [...channels.values()].map(({ name, kind }) => ({ name, kind }));
  }

  const api = { defineChannel, register, describe };
  return api;
}

module.exports = { createRegistry, NAME_PATTERN };
