import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ipcModule from '../../../src/main/ipc.js';
import channelsModule from '../../../src/main/channels.js';
import { v } from '../../../src/core/validate.js';

const { createRegistry } = ipcModule;
const { channelSpecs } = channelsModule;

const invoke = vi.fn();
const send = vi.fn();
const on = vi.fn();
const removeListener = vi.fn();

/**
 * Evaluate the real preload source with a fake `electron`. The preload is a
 * self-contained sandbox script, so a module mock cannot reach its `require`;
 * evaluating the source is the honest way to inspect what it exposes.
 */
const exposed = {};
const preloadSource = fs.readFileSync(path.resolve(process.cwd(), 'src/preload/index.js'), 'utf8');
vm.runInNewContext(
  preloadSource,
  {
    require(name) {
      if (name !== 'electron') throw new Error(`unexpected require(${name})`);
      return {
        contextBridge: {
          exposeInMainWorld(name, value) {
            exposed[name] = value;
          },
        },
        ipcRenderer: { invoke, send, on, removeListener },
      };
    },
    module: { exports: {} },
    exports: {},
    console,
  },
  { filename: 'src/preload/index.js' }
);
const api = exposed.ember;

function fakeIpcMain() {
  return { handle() {}, on() {} };
}

function registryNames() {
  const registry = createRegistry();
  for (const spec of channelSpecs(v)) {
    registry.defineChannel({ ...spec, handler: () => undefined });
  }
  registry.register(fakeIpcMain());
  return registry
    .describe()
    .map((channel) => channel.name)
    .sort();
}

function exposedChannels(surface) {
  const channels = new Map();
  for (const [namespace, value] of Object.entries(surface)) {
    if (namespace === 'test' || namespace.startsWith('on')) continue;
    if (!value || typeof value !== 'object') continue;
    for (const [action, fn] of Object.entries(value)) {
      if (typeof fn === 'function' && !action.startsWith('on')) {
        channels.set(`${namespace}:${action}`, fn);
      }
    }
  }
  return channels;
}

beforeEach(() => {
  invoke.mockReset();
  send.mockReset();
  on.mockReset();
  removeListener.mockReset();
  invoke.mockResolvedValue({ ok: true, value: undefined });
});

describe('preload and registry agree in both directions', () => {
  it('exposes exactly one method per registered channel', () => {
    const registry = registryNames();
    const preload = [...exposedChannels(api).keys()].sort();
    expect(registry.filter((name) => !preload.includes(name))).toEqual([]);
    expect(preload.filter((name) => !registry.includes(name))).toEqual([]);
    expect(preload).toEqual(registry);
  });

  it('namespaces every method by the channel domain', () => {
    for (const name of registryNames()) {
      const [domain, action] = name.split(':');
      expect(api[domain]).toBeTypeOf('object');
      expect(api[domain][action]).toBeTypeOf('function');
    }
  });

  it('has no generic pass-through and no method takes a channel name', () => {
    expect(api.invoke).toBeUndefined();
    expect(api.send).toBeUndefined();
    for (const fn of exposedChannels(api).values()) {
      expect(fn.length).toBeLessThanOrEqual(1);
    }
  });

  it('exposes the test channels explicitly, outside the contract namespaces', () => {
    expect(Object.keys(api.test).sort()).toEqual([
      'advanceClock',
      'setBounds',
      'setClock',
      'suspend',
    ]);
  });
});

describe('preload forwards to the right channel', () => {
  const cases = {
    'state:get': { call: () => api.state.get(), method: 'invoke', args: ['state:get', undefined] },
    'state:set': {
      call: () => api.state.set({ opacity: 0.5 }),
      method: 'invoke',
      args: ['state:set', { opacity: 0.5 }],
    },
    'state:reset': {
      call: () => api.state.reset(),
      method: 'invoke',
      args: ['state:reset', undefined],
    },
    'win:move': {
      call: () => api.win.move({ dx: 3, dy: 4 }),
      method: 'send',
      args: ['win:move', { dx: 3, dy: 4 }],
    },
    'win:mini': {
      call: () => api.win.mini(true),
      method: 'invoke',
      args: ['win:mini', { mini: true }],
    },
    'win:lock': {
      call: () => api.win.lock(true),
      method: 'invoke',
      args: ['win:lock', { locked: true }],
    },
    'win:close': { call: () => api.win.close(), method: 'send', args: ['win:close', undefined] },
    'app:quit': { call: () => api.app.quit(), method: 'send', args: ['app:quit', undefined] },
    'menu:show': { call: () => api.menu.show(), method: 'send', args: ['menu:show', undefined] },
    'settings:open': {
      call: () => api.settings.open('tutorial'),
      method: 'invoke',
      args: ['settings:open', { tab: 'tutorial' }],
    },
    'timer:get': { call: () => api.timer.get(), method: 'invoke', args: ['timer:get', undefined] },
    'timer:start': {
      call: () => api.timer.start(),
      method: 'invoke',
      args: ['timer:start', undefined],
    },
    'timer:pause': {
      call: () => api.timer.pause(),
      method: 'invoke',
      args: ['timer:pause', undefined],
    },
    'timer:toggle': {
      call: () => api.timer.toggle(),
      method: 'invoke',
      args: ['timer:toggle', undefined],
    },
    'timer:skip': {
      call: () => api.timer.skip(),
      method: 'invoke',
      args: ['timer:skip', undefined],
    },
    'timer:reset': {
      call: () => api.timer.reset(),
      method: 'invoke',
      args: ['timer:reset', undefined],
    },
    'timer:subscribe': {
      call: () => api.timer.subscribe(),
      method: 'invoke',
      args: ['timer:subscribe', undefined],
    },
  };

  it('covers every registry channel', () => {
    expect(Object.keys(cases).sort()).toEqual(registryNames());
  });

  for (const [channel, entry] of Object.entries(cases)) {
    it(`forwards ${channel}`, async () => {
      await entry.call();
      const fn = entry.method === 'invoke' ? invoke : send;
      expect(fn).toHaveBeenCalledWith(...entry.args);
    });
  }

  it('sends no payload when settings:open has no tab', async () => {
    await api.settings.open();
    expect(invoke).toHaveBeenCalledWith('settings:open', undefined);
  });
});

describe('preload envelope handling', () => {
  it('returns the registry envelope unchanged', async () => {
    invoke.mockResolvedValueOnce({ ok: true, value: 42 });
    await expect(api.state.get()).resolves.toEqual({ ok: true, value: 42 });
  });

  it('maps an unregistered channel rejection to unknown-channel', async () => {
    invoke.mockRejectedValueOnce(
      new Error("Error invoking remote method 'state:get': No handler registered for 'state:get'")
    );
    await expect(api.state.get()).resolves.toEqual({ ok: false, code: 'unknown-channel' });
  });

  it('maps any other rejection to handler-error', async () => {
    invoke.mockRejectedValueOnce(new Error('boom'));
    await expect(api.state.get()).resolves.toEqual({ ok: false, code: 'handler-error' });
  });

  it('keeps the surface free of a generic channel-name invoke', () => {
    expect(preloadSource).not.toMatch(/return\s*\{[^}]*\binvoke\s*:/s);
  });
});

describe('preload event subscriptions', () => {
  it('forwards timer snapshots and returns an unsubscribe function', () => {
    const callback = vi.fn();
    const unsubscribe = api.timer.onSnapshot(callback);
    expect(on).toHaveBeenCalledWith('timer:snapshot', expect.any(Function));

    const listener = on.mock.calls.at(-1)[1];
    listener({}, { phase: 'short' });
    expect(callback).toHaveBeenCalledWith({ phase: 'short' });

    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith('timer:snapshot', listener);
  });

  it('forwards phase-complete events and returns an unsubscribe function', () => {
    const callback = vi.fn();
    const unsubscribe = api.timer.onPhaseComplete(callback);
    expect(on).toHaveBeenCalledWith('timer:phase-complete', expect.any(Function));

    const listener = on.mock.calls.at(-1)[1];
    listener({}, { type: 'phase-complete', completedPhase: 'focus' });
    expect(callback).toHaveBeenCalledWith({ type: 'phase-complete', completedPhase: 'focus' });

    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith('timer:phase-complete', listener);
  });
});
