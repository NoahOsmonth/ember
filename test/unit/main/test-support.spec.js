import { describe, expect, it } from 'vitest';
import supportModule from '../../../src/main/test-support.js';

const { TEST_CHANNEL_NAMES, createHandlers, isEnabled, registerTestChannel, registerTestChannels } =
  supportModule;

function fakeClock(start = Date.parse('2026-01-02T03:04:05.000Z')) {
  let now = start;
  return {
    now: () => now,
    setNow: (ms) => {
      now = ms;
      return 0;
    },
    advance: (ms) => {
      now += ms;
      return 0;
    },
  };
}

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(name, handler) {
      handlers.set(name, handler);
    },
  };
}

function fakeWindow(bounds = { x: 10, y: 20, width: 340, height: 96 }) {
  let current = { ...bounds };
  return {
    isDestroyed: () => false,
    getBounds: () => ({ ...current }),
    setBounds: (next) => {
      current = { ...next };
    },
  };
}

describe('isEnabled', () => {
  it('requires both the test flag and a non-empty profile path', () => {
    expect(isEnabled({ EMBER_TEST: '1', EMBER_USER_DATA: '/tmp/profile' })).toBe(true);
    expect(isEnabled({ EMBER_TEST: '1' })).toBe(false);
    expect(isEnabled({ EMBER_TEST: '1', EMBER_USER_DATA: '' })).toBe(false);
    expect(isEnabled({ EMBER_TEST: '0', EMBER_USER_DATA: '/tmp/profile' })).toBe(false);
    expect(isEnabled({ EMBER_USER_DATA: '/tmp/profile' })).toBe(false);
    expect(isEnabled({})).toBe(false);
  });
});

describe('createHandlers', () => {
  it('sets the clock to an absolute instant', () => {
    const handlers = createHandlers({ clock: fakeClock(), getWindow: () => fakeWindow() });
    expect(handlers['test:setClock'](null, '2030-06-01T00:00:00.000Z')).toEqual({
      ok: true,
      value: '2030-06-01T00:00:00.000Z',
    });
  });

  it('rejects an unparseable instant', () => {
    const handlers = createHandlers({ clock: fakeClock(), getWindow: () => fakeWindow() });
    expect(() => handlers['test:setClock'](null, 'not a date')).toThrow(/ISO timestamp/);
  });

  it('advances the clock by a finite number of milliseconds', () => {
    const handlers = createHandlers({ clock: fakeClock(), getWindow: () => fakeWindow() });
    expect(handlers['test:advanceClock'](null, 90_000)).toEqual({
      ok: true,
      value: '2026-01-02T03:05:35.000Z',
    });
    expect(() => handlers['test:advanceClock'](null, Number.NaN)).toThrow(/milliseconds/);
  });

  it('moves the widget window, filling in omitted dimensions', () => {
    const win = fakeWindow();
    const handlers = createHandlers({ clock: fakeClock(), getWindow: () => win });
    expect(handlers['test:setBounds'](null, { x: 40, y: 50 })).toEqual({
      ok: true,
      value: { x: 40, y: 50, width: 340, height: 96 },
    });
    expect(handlers['test:setBounds'](null, { width: 156, height: 58 })).toEqual({
      ok: true,
      value: { x: 40, y: 50, width: 156, height: 58 },
    });
  });

  it('fails clearly when the widget window is gone', () => {
    const handlers = createHandlers({ clock: fakeClock(), getWindow: () => null });
    expect(() => handlers['test:setBounds'](null, {})).toThrow(/no widget window/);
    const destroyed = { isDestroyed: () => true };
    const handlers2 = createHandlers({ clock: fakeClock(), getWindow: () => destroyed });
    expect(() => handlers2['test:setBounds'](null, {})).toThrow(/no widget window/);
  });
});

describe('registerTestChannels', () => {
  it('registers nothing when test mode is off', () => {
    const ipcMain = fakeIpcMain();
    const registered = registerTestChannels({
      ipcMain,
      clock: fakeClock(),
      getWindow: () => fakeWindow(),
      env: {},
    });
    expect(registered).toEqual([]);
    expect(ipcMain.handlers.size).toBe(0);
  });

  it('registers every advertised channel exactly once', () => {
    const ipcMain = fakeIpcMain();
    const registered = registerTestChannels({
      ipcMain,
      clock: fakeClock(),
      getWindow: () => fakeWindow(),
      env: { EMBER_TEST: '1', EMBER_USER_DATA: '/tmp/profile' },
    });
    expect(registered).toEqual([...TEST_CHANNEL_NAMES]);
    expect([...ipcMain.handlers.keys()].sort()).toEqual([...TEST_CHANNEL_NAMES].sort());
    for (const name of TEST_CHANNEL_NAMES) {
      expect(typeof ipcMain.handlers.get(name)).toBe('function');
    }
  });

  it('exposes one reusable registration helper for later channels', () => {
    const ipcMain = fakeIpcMain();
    registerTestChannel(ipcMain, 'test:future', () => 'ok');
    expect(ipcMain.handlers.get('test:future')()).toBe('ok');
  });
});
