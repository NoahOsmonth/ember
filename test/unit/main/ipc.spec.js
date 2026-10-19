import { describe, expect, it, vi } from 'vitest';
import ipcModule from '../../../src/main/ipc.js';
import { v } from '../../../src/core/validate.js';

const { createRegistry } = ipcModule;

function fakeIpcMain() {
  const handlers = new Map();
  const listeners = new Map();
  return {
    handlers,
    listeners,
    handle(name, fn) {
      handlers.set(name, fn);
    },
    on(name, fn) {
      listeners.set(name, fn);
    },
  };
}

function recordingLogger() {
  const entries = [];
  const record = (level) => (message) => entries.push({ level, message });
  return {
    entries,
    warn: record('warn'),
    error: record('error'),
    info: record('info'),
    debug: record('debug'),
  };
}

const schema = v.object({ count: v.number({ min: 1 }) });

describe('createRegistry definition rules', () => {
  it('accepts a conforming channel and describes it', () => {
    const registry = createRegistry();
    registry.defineChannel({
      name: 'state:get',
      kind: 'invoke',
      schema,
      handler: () => 'ok',
    });
    expect(registry.describe()).toEqual([{ name: 'state:get', kind: 'invoke' }]);
  });

  it('rejects a name that does not follow domain:action', () => {
    const registry = createRegistry();
    for (const name of ['setOpacity', 'State:Get', 'state-get', 'state:', ':get', 'state:Get']) {
      expect(() => registry.defineChannel({ name, kind: 'invoke', schema, handler() {} })).toThrow(
        /domain:action/
      );
    }
  });

  it('rejects an invalid kind', () => {
    const registry = createRegistry();
    expect(() =>
      registry.defineChannel({ name: 'state:get', kind: 'request', schema, handler() {} })
    ).toThrow(/invoke or send/);
  });

  it('rejects a missing schema and a missing handler', () => {
    const registry = createRegistry();
    expect(() =>
      registry.defineChannel({ name: 'state:get', kind: 'invoke', handler() {} })
    ).toThrow(/no payload schema/);
    expect(() => registry.defineChannel({ name: 'state:get', kind: 'invoke', schema })).toThrow(
      /no handler/
    );
  });

  it('rejects a duplicate name at definition time', () => {
    const registry = createRegistry();
    registry.defineChannel({ name: 'state:get', kind: 'invoke', schema, handler() {} });
    expect(() =>
      registry.defineChannel({ name: 'state:get', kind: 'invoke', schema, handler() {} })
    ).toThrow(/duplicate channel state:get/);
  });

  it('refuses to define a channel after register()', () => {
    const registry = createRegistry();
    registry.register(fakeIpcMain());
    expect(() =>
      registry.defineChannel({ name: 'state:get', kind: 'invoke', schema, handler() {} })
    ).toThrow(/after register/);
    expect(() => registry.register(fakeIpcMain())).toThrow(/already registered/);
  });
});

describe('createRegistry invoke channels', () => {
  it('validates the payload and returns an envelope', async () => {
    const ipcMain = fakeIpcMain();
    const handler = vi.fn((payload) => payload.count * 2);
    const registry = createRegistry();
    registry.defineChannel({ name: 'state:get', kind: 'invoke', schema, handler });
    registry.register(ipcMain);

    const result = await ipcMain.handlers.get('state:get')(null, { count: 2 });
    expect(handler).toHaveBeenCalledWith({ count: 2 }, null);
    expect(result).toEqual({ ok: true, value: 4 });
  });

  it('never calls the handler for an invalid payload and names the issue', async () => {
    const ipcMain = fakeIpcMain();
    const logger = recordingLogger();
    const handler = vi.fn();
    const registry = createRegistry({ logger });
    registry.defineChannel({ name: 'state:get', kind: 'invoke', schema, handler });
    registry.register(ipcMain);

    const result = await ipcMain.handlers.get('state:get')(null, { count: 'bright' });
    expect(handler).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid-payload');
    expect(result.issues[0]).toMatchObject({ path: 'count', code: 'type' });
    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0].level).toBe('warn');
    expect(logger.entries[0].message).toContain('state:get');
  });

  it('rejects unknown keys', async () => {
    const ipcMain = fakeIpcMain();
    const registry = createRegistry();
    registry.defineChannel({ name: 'state:get', kind: 'invoke', schema, handler: () => 'ok' });
    registry.register(ipcMain);

    const result = await ipcMain.handlers.get('state:get')(null, { count: 1, extra: true });
    expect(result.code).toBe('invalid-payload');
    expect(result.issues[0]).toMatchObject({ path: 'extra', code: 'unknown-key' });
  });

  it('turns a throwing handler into handler-error and logs it', async () => {
    const ipcMain = fakeIpcMain();
    const logger = recordingLogger();
    const registry = createRegistry({ logger });
    registry.defineChannel({
      name: 'state:get',
      kind: 'invoke',
      schema,
      handler: () => {
        throw new Error('boom');
      },
    });
    registry.register(ipcMain);

    const result = await ipcMain.handlers.get('state:get')(null, { count: 1 });
    expect(result).toEqual({ ok: false, code: 'handler-error' });
    expect(logger.entries[0]).toMatchObject({ level: 'error' });
    expect(logger.entries[0].message).toContain('boom');
  });

  it('works without a logger', async () => {
    const ipcMain = fakeIpcMain();
    const registry = createRegistry();
    registry.defineChannel({ name: 'state:get', kind: 'invoke', schema, handler: () => 1 });
    registry.register(ipcMain);
    await expect(ipcMain.handlers.get('state:get')(null, { count: 'no' })).resolves.toMatchObject({
      ok: false,
    });
  });
});

describe('createRegistry send channels', () => {
  it('validates the payload before calling a send handler', () => {
    const ipcMain = fakeIpcMain();
    const logger = recordingLogger();
    const handler = vi.fn();
    const registry = createRegistry({ logger });
    registry.defineChannel({ name: 'win:move', kind: 'send', schema, handler });
    registry.register(ipcMain);

    ipcMain.listeners.get('win:move')(null, { count: 1 });
    expect(handler).toHaveBeenCalledTimes(1);

    ipcMain.listeners.get('win:move')(null, { count: 0 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(logger.entries[0].message).toContain('win:move');
  });

  it('logs a throwing send handler instead of propagating it', () => {
    const ipcMain = fakeIpcMain();
    const logger = recordingLogger();
    const registry = createRegistry({ logger });
    registry.defineChannel({
      name: 'win:move',
      kind: 'send',
      schema,
      handler: () => {
        throw new Error('nope');
      },
    });
    registry.register(ipcMain);

    expect(() => ipcMain.listeners.get('win:move')(null, { count: 1 })).not.toThrow();
    expect(logger.entries[0]).toMatchObject({ level: 'error' });
    expect(logger.entries[0].message).toContain('nope');
  });
});
