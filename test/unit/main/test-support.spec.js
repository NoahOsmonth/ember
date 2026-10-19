import { describe, expect, it, vi } from 'vitest';
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

  it('routes bounds through the injected placement setter', () => {
    const setBounds = vi.fn(() => ({ x: 0, y: 0, width: 340, height: 96 }));
    const handlers = createHandlers({ clock: fakeClock(), getWindow: () => null, setBounds });
    expect(handlers['test:setBounds'](null, { x: 40, y: 50 })).toEqual({
      ok: true,
      value: { x: 0, y: 0, width: 340, height: 96 },
    });
    expect(setBounds).toHaveBeenCalledWith({ x: 40, y: 50 });
  });

  it('exposes cursor and display fixtures only when injected', () => {
    const setCursor = vi.fn((point) => point);
    const setDisplays = vi.fn(() => [{ id: 1 }]);
    const handlers = createHandlers({
      clock: fakeClock(),
      getWindow: () => null,
      setCursor,
      setDisplays,
    });
    expect(handlers['test:setCursor'](null, { x: 3, y: 4 })).toEqual({
      ok: true,
      value: { x: 3, y: 4 },
    });
    expect(handlers['test:setDisplays'](null, [{ id: 1 }])).toEqual({
      ok: true,
      value: [{ id: 1 }],
    });
    const bare = createHandlers({ clock: fakeClock(), getWindow: () => null });
    expect(() => bare['test:setCursor'](null, { x: 0, y: 0 })).toThrow(/unavailable/);
    expect(() => bare['test:setDisplays'](null, [])).toThrow(/unavailable/);
  });

  it('reports and drives the tray through the injected adapter', () => {
    const trayInfo = vi.fn(() => ({ tooltip: 'focus · 25:00', items: [] }));
    const trayCommand = vi.fn(() => true);
    const handlers = createHandlers({
      clock: fakeClock(),
      getWindow: () => null,
      trayInfo,
      trayCommand,
    });
    expect(handlers['test:trayInfo']()).toEqual({
      ok: true,
      value: { tooltip: 'focus · 25:00', items: [] },
    });
    expect(handlers['test:trayCommand'](null, 'toggle')).toEqual({ ok: true, value: true });
    expect(trayCommand).toHaveBeenCalledWith('toggle');

    const bare = createHandlers({ clock: fakeClock(), getWindow: () => null });
    expect(bare['test:trayInfo']()).toEqual({ ok: true, value: null });
    expect(() => bare['test:trayCommand'](null, 'toggle')).toThrow(/unavailable/);
  });

  it('advances the clock and then drives the resume handler', () => {
    const clock = fakeClock();
    const suspend = vi.fn(() => ({ phase: 'short' }));
    const handlers = createHandlers({ clock, getWindow: () => fakeWindow(), suspend });
    expect(handlers['test:suspend'](null, 40 * 60_000)).toEqual({
      ok: true,
      value: { now: '2026-01-02T03:44:05.000Z', awayMs: 2_400_000 },
    });
    expect(suspend).toHaveBeenCalledWith(2_400_000);
    expect(clock.now()).toBe(Date.parse('2026-01-02T03:44:05.000Z'));
  });

  it('rejects a negative or non-finite suspend duration', () => {
    const clock = fakeClock();
    const suspend = vi.fn();
    const handlers = createHandlers({ clock, getWindow: () => fakeWindow(), suspend });
    expect(() => handlers['test:suspend'](null, -1)).toThrow(/non-negative milliseconds/);
    expect(() => handlers['test:suspend'](null, Number.NaN)).toThrow(/non-negative milliseconds/);
    expect(suspend).not.toHaveBeenCalled();
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
