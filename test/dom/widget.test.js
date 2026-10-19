import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createWidget } from '../../src/renderer/widget/widget.js';
import { FIXTURES, fixtureById } from '../fixtures/states.js';

const source = fs.readFileSync(path.join(process.cwd(), 'src/renderer/widget/index.html'), 'utf8');
const parsed = new DOMParser().parseFromString(source, 'text/html');
const APP_MARKUP = parsed.getElementById('app').outerHTML;

/** Mount the real widget markup in a fresh container. */
function mountRoot() {
  document.body.innerHTML = '';
  const container = document.createElement('div');
  container.innerHTML = APP_MARKUP;
  document.body.append(container);
  return container;
}

function mountBody() {
  document.body.innerHTML = APP_MARKUP;
  return document.body;
}

const digitsOf = (root) => root.querySelector('.digits').textContent;
const stateOf = (root) => root.querySelector('.state').textContent;
const pipClasses = (root) => [...root.querySelectorAll('.pips .pip')].map((pip) => pip.className);
const bars = (root) => [...root.querySelectorAll('.bars .bar')];

const RUNNING = fixtureById('running').snapshot;
const PAUSED = fixtureById('paused').snapshot;
const IDLE = fixtureById('idle').snapshot;

describe('widget fixture rendering', () => {
  let root;

  beforeEach(() => {
    root = mountRoot();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders idle: 25:00, ready, 25 bars and a four-round pip row', () => {
    const widget = createWidget({ root, now: () => 0, autoStart: false });
    widget.render(IDLE, fixtureById('idle').settings);

    expect(digitsOf(root)).toBe('25:00');
    expect(stateOf(root)).toBe('ready');
    expect(bars(root)).toHaveLength(25);
    expect(root.querySelectorAll('.bars .bar.tick')).toHaveLength(5);
    expect(pipClasses(root)).toEqual(['pip now', 'pip', 'pip', 'pip']);
    expect(root.querySelector('.note').textContent).toBe('');
    expect(root.className).toContain('fixture');
    expect(root.className).toContain('ready');
    expect(root.style.getPropertyValue('--a')).toBe('0.62');
    widget.destroy();
  });

  it('renders running: 15:00, focus, the end label and a done/now pip pair', () => {
    const widget = createWidget({ root, now: () => 0, autoStart: false });
    widget.render(RUNNING, fixtureById('running').settings);

    expect(digitsOf(root)).toBe('15:00');
    expect(stateOf(root)).toBe('focus');
    expect(root.querySelector('.note').textContent).toBe('ends 10:25');
    expect(pipClasses(root)).toEqual(['pip done', 'pip now', 'pip', 'pip']);
    expect(root.className).toContain('running');
    widget.destroy();
  });

  it('renders paused: paused label, no end note and the paused class', () => {
    const widget = createWidget({ root, now: () => 0, autoStart: false });
    widget.render(PAUSED, fixtureById('paused').settings);

    expect(digitsOf(root)).toBe('15:00');
    expect(stateOf(root)).toBe('paused');
    expect(root.querySelector('.note').textContent).toBe('');
    expect(root.className).toContain('paused');
    widget.destroy();
  });

  it('renders a long break with every pip done', () => {
    const fixture = fixtureById('long-break');
    const widget = createWidget({ root, now: () => 0, autoStart: false });
    widget.render(fixture.snapshot, fixture.settings);

    expect(digitsOf(root)).toBe('15:00');
    expect(stateOf(root)).toBe('long break');
    expect(bars(root)).toHaveLength(15);
    expect(root.querySelectorAll('.bars .bar.tick')).toHaveLength(3);
    expect(pipClasses(root)).toEqual(['pip done', 'pip done', 'pip done', 'pip done']);
    widget.destroy();
  });

  it('renders a one-minute phase as a single bar', () => {
    const fixture = fixtureById('one-bar');
    const widget = createWidget({ root, now: () => 0, autoStart: false });
    widget.render(fixture.snapshot, fixture.settings);

    expect(digitsOf(root)).toBe('01:00');
    expect(bars(root)).toHaveLength(1);
    expect(root.querySelectorAll('.bars .bar.tick')).toHaveLength(1);
    widget.destroy();
  });

  it('caps a 90-minute phase at 30 bars', () => {
    const fixture = fixtureById('full-bars');
    const widget = createWidget({ root, now: () => 0, autoStart: false });
    widget.render(fixture.snapshot, fixture.settings);

    expect(digitsOf(root)).toBe('90:00');
    expect(bars(root)).toHaveLength(30);
    expect(root.querySelectorAll('.bars .bar.tick')).toHaveLength(6);
    widget.destroy();
  });

  it('renders every fixture without throwing', () => {
    const widget = createWidget({ root, now: () => 0, autoStart: false });
    for (const fixture of FIXTURES) {
      expect(() => widget.render(fixture.snapshot, fixture.settings)).not.toThrow();
      expect(digitsOf(root)).toMatch(/^\d{2,}:\d{2}$/);
    }
    widget.destroy();
  });

  it('moves the accent to the current bar as the phase drains', () => {
    const widget = createWidget({ root, now: () => 0, autoStart: false });
    widget.render(IDLE, fixtureById('idle').settings);
    const firstAccent = root.style.getPropertyValue('--accent');
    expect(firstAccent).toMatch(/^oklch\(/);

    widget.render({ ...IDLE, remainingMs: 10 * 60_000 }, fixtureById('idle').settings);
    expect(root.style.getPropertyValue('--accent')).not.toBe(firstAccent);
    expect(bars(root)[14].style.getPropertyValue('--f')).toBe('0');
    expect(bars(root)[15].style.getPropertyValue('--f')).toBe('1.000');
    widget.destroy();
  });

  it('rebuilds the ruler when the theme changes', () => {
    const widget = createWidget({ root, now: () => 0, autoStart: false });
    widget.render(IDLE, fixtureById('idle').settings);
    const dusk = bars(root)[0].style.getPropertyValue('--c');

    widget.render(IDLE, { ...fixtureById('idle').settings, theme: 'mono' });
    expect(bars(root)[0].style.getPropertyValue('--c')).toBe('oklch(0.600 0.000 0.0)');
    expect(bars(root)[0].style.getPropertyValue('--c')).not.toBe(dusk);
    widget.destroy();
  });

  it('applies mini, locked and opacity settings', () => {
    vi.useFakeTimers();
    const widget = createWidget({ root, now: () => 0, autoStart: false });
    widget.render(IDLE, fixtureById('idle').settings);
    widget.applySettings({ mini: true, locked: true, opacity: 0.3, rounds: 2 });

    expect(root.className).toContain('mini');
    expect(root.className).toContain('locked');
    expect(root.style.getPropertyValue('--a')).toBe('0.3');
    expect(root.querySelectorAll('.pips .pip')).toHaveLength(2);
    expect(stateOf(root)).toBe('click-through');
    vi.runAllTimers();
    widget.destroy();
    vi.useRealTimers();
  });

  it('sets the document title only when it owns the body', () => {
    const body = mountBody();
    const widget = createWidget({ root: body, now: () => 0, autoStart: false });
    widget.render(IDLE, fixtureById('idle').settings);
    expect(document.title).toBe('25:00 focus');
    expect(body.className).toBe('ready');
    widget.destroy();
    document.title = '';
    document.body.innerHTML = '';
  });
});

describe('widget scheduler wiring', () => {
  let root;

  beforeEach(() => {
    root = mountRoot();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function fakeScheduler() {
    return {
      starts: 0,
      frames: 0,
      stops: 0,
      startTicks() {
        this.starts += 1;
      },
      stopTicks() {},
      requestFrames() {
        this.frames += 1;
      },
      stopFrames() {},
      stop() {
        this.stops += 1;
      },
    };
  }

  it('starts both loops for a running snapshot and stops them otherwise', () => {
    const scheduler = fakeScheduler();
    const widget = createWidget({
      root,
      now: () => 0,
      autoStart: true,
      scheduler,
    });

    widget.applySnapshot(RUNNING);
    expect(scheduler.starts).toBe(1);
    expect(scheduler.frames).toBe(1);

    widget.applySnapshot(PAUSED);
    expect(scheduler.stops).toBe(1);

    widget.applySnapshot(IDLE);
    expect(scheduler.stops).toBe(2);
    expect(scheduler.starts).toBe(1);
    widget.destroy();
  });

  it('never starts the loops when autoStart is off', () => {
    const scheduler = fakeScheduler();
    const widget = createWidget({
      root,
      now: () => 0,
      autoStart: false,
      scheduler,
    });
    widget.applySnapshot(RUNNING);
    expect(scheduler.starts).toBe(0);
    expect(scheduler.frames).toBe(0);
    widget.destroy();
  });

  it('updates the digits once per second while running and freezes when paused', () => {
    vi.useFakeTimers();
    let clock = 0;
    const widget = createWidget({ root, now: () => clock, autoStart: true });
    widget.applySnapshot(RUNNING);
    expect(digitsOf(root)).toBe('15:00');

    clock = 1_000;
    vi.advanceTimersByTime(1_000);
    expect(digitsOf(root)).toBe('14:59');

    clock = 2_000;
    vi.advanceTimersByTime(1_000);
    expect(digitsOf(root)).toBe('14:58');

    widget.applySnapshot(PAUSED);
    expect(digitsOf(root)).toBe('15:00');
    clock = 30_000;
    vi.advanceTimersByTime(10_000);
    expect(digitsOf(root)).toBe('15:00');

    widget.destroy();
    vi.useRealTimers();
  });
});

describe('widget command handling', () => {
  let root;

  beforeEach(() => {
    root = mountRoot();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  /** @returns {any} */
  function fakeApi(overrides = {}) {
    const calls = [];
    const record =
      (name, result) =>
      async (...args) => {
        calls.push({ name, args });
        return typeof result === 'function' ? result(...args) : result;
      };
    const ok = (value = null) => ({ ok: true, value });
    const api = {
      calls,
      state: {
        get: record('state.get', ok(fixtureById('idle').settings)),
        set: record('state.set', ok()),
        reset: record('state.reset', ok()),
      },
      timer: {
        toggle: record('timer.toggle', ok(PAUSED)),
        skip: record('timer.skip', ok()),
        reset: record('timer.reset', ok()),
        subscribe: record('timer.subscribe', ok({ snapshot: IDLE, notice: null })),
        onSnapshot: () => () => {},
        onPhaseComplete: () => () => {},
      },
      settings: { open: record('settings.open', ok()) },
      win: {
        mini: record('win.mini', ok()),
        move: (...args) => calls.push({ name: 'win.move', args }),
      },
      menu: { show: () => calls.push({ name: 'menu.show', args: [] }) },
      onSettings: () => () => {},
      onCommand: () => () => {},
      ...overrides,
    };
    return api;
  }

  async function flush() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  it('mounts without an API and leaves the fixture render intact', () => {
    const widget = createWidget({ root, now: () => 0, autoStart: false });
    expect(() => widget.mount()).not.toThrow();
    widget.render(IDLE, fixtureById('idle').settings);
    expect(digitsOf(root)).toBe('25:00');
    widget.destroy();
  });

  it('toggles from the play button and applies the returned snapshot', async () => {
    const api = fakeApi();
    const widget = createWidget({ root, now: () => 0, autoStart: false, api });
    widget.mount();
    await flush();
    expect(digitsOf(root)).toBe('25:00');

    root.querySelector('.play').click();
    await flush();

    expect(api.calls.some((call) => call.name === 'timer.toggle')).toBe(true);
    expect(digitsOf(root)).toBe('15:00');
    expect(stateOf(root)).toBe('paused');
    widget.destroy();
  });

  it('flashes a failure when a command is rejected', async () => {
    const api = fakeApi();
    api.timer.toggle = async () => ({ ok: false, code: 'handler-error' });
    const widget = createWidget({ root, now: () => 0, autoStart: false, api });
    widget.mount();
    await flush();

    root.querySelector('.play').click();
    await flush();

    expect(stateOf(root)).toBe('command failed');
    widget.destroy();
  });

  it('wires skip, reset and settings buttons', async () => {
    const api = fakeApi();
    const widget = createWidget({ root, now: () => 0, autoStart: false, api });
    widget.mount();
    await flush();

    root.querySelector('.skip').click();
    root.querySelector('.reset').click();
    root.querySelector('.settings').click();
    await flush();

    expect(api.calls.map((call) => call.name)).toEqual(
      expect.arrayContaining(['timer.skip', 'timer.reset', 'settings.open'])
    );
    expect(api.calls.find((call) => call.name === 'settings.open').args).toEqual(['settings']);
    widget.destroy();
  });

  it('handles Space, S, R and M from the keyboard', async () => {
    const api = fakeApi();
    const widget = createWidget({ root, now: () => 0, autoStart: false, api });
    widget.mount();
    await flush();
    api.calls.length = 0;

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'R' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
    await flush();

    expect(api.calls.map((call) => call.name)).toEqual(
      expect.arrayContaining(['timer.toggle', 'timer.skip', 'timer.reset', 'win.mini'])
    );
    expect(api.calls.find((call) => call.name === 'win.mini').args).toEqual([true]);
    widget.destroy();
  });

  it('drags the window from the glass but not from a control', async () => {
    const Pointer = globalThis.PointerEvent || MouseEvent;
    const api = fakeApi();
    const widget = createWidget({ root, now: () => 0, autoStart: false, api });
    widget.mount();
    await flush();
    api.calls.length = 0;

    root
      .querySelector('.play')
      .dispatchEvent(
        new Pointer('pointerdown', { button: 0, screenX: 0, screenY: 0, bubbles: true })
      );
    window.dispatchEvent(new Pointer('pointermove', { screenX: 40, screenY: 20 }));
    expect(api.calls.some((call) => call.name === 'win.move')).toBe(false);

    root
      .querySelector('.digits')
      .dispatchEvent(
        new Pointer('pointerdown', { button: 0, screenX: 0, screenY: 0, bubbles: true })
      );
    window.dispatchEvent(new Pointer('pointermove', { screenX: 40, screenY: 20 }));
    expect(api.calls.some((call) => call.name === 'win.move')).toBe(false);

    root
      .querySelector('.note')
      .dispatchEvent(
        new Pointer('pointerdown', { button: 0, screenX: 10, screenY: 10, bubbles: true })
      );
    window.dispatchEvent(new Pointer('pointermove', { screenX: 40, screenY: 30 }));
    window.dispatchEvent(new Pointer('pointerup', { screenX: 40, screenY: 30 }));
    expect(api.calls.find((call) => call.name === 'win.move').args).toEqual([{ dx: 30, dy: 20 }]);
    widget.destroy();
  });

  it('toggles compact size on double click and opens the menu on right click', async () => {
    const api = fakeApi();
    const widget = createWidget({ root, now: () => 0, autoStart: false, api });
    widget.mount();
    await flush();
    api.calls.length = 0;

    root.querySelector('.note').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const context = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    root.querySelector('.note').dispatchEvent(context);
    await flush();

    expect(api.calls.find((call) => call.name === 'win.mini').args).toEqual([true]);
    expect(api.calls.some((call) => call.name === 'menu.show')).toBe(true);
    expect(context.defaultPrevented).toBe(true);
    widget.destroy();
  });

  it('changes the glass opacity with the wheel and persists it once', async () => {
    vi.useFakeTimers();
    const api = fakeApi();
    const widget = createWidget({ root, now: () => 0, autoStart: false, api });
    widget.mount();
    await flush();
    api.calls.length = 0;

    window.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true }));
    expect(root.style.getPropertyValue('--a')).toBe('0.67');

    vi.advanceTimersByTime(300);
    expect(api.calls.find((call) => call.name === 'state.set').args).toEqual([{ opacity: 0.67 }]);

    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }));
    expect(root.style.getPropertyValue('--a')).toBe('0.62');
    widget.destroy();
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it('applies settings broadcasts and the subscribe snapshot', async () => {
    const api = fakeApi();
    /** @type {(value?: any) => void} */
    let emitSettings = () => {};
    /** @type {(value?: any) => void} */
    let emitSnapshot = () => {};
    api.onSettings = (handler) => {
      emitSettings = handler;
      return () => {};
    };
    api.timer.onSnapshot = (handler) => {
      emitSnapshot = handler;
      return () => {};
    };

    const widget = createWidget({ root, now: () => 0, autoStart: false, api });
    widget.mount();
    await flush();

    emitSettings({ theme: 'mono', rounds: 3 });
    expect(bars(root)[0].style.getPropertyValue('--c')).toBe('oklch(0.600 0.000 0.0)');
    expect(root.querySelectorAll('.pips .pip')).toHaveLength(3);

    emitSnapshot(RUNNING);
    expect(digitsOf(root)).toBe('15:00');
    expect(stateOf(root)).toBe('focus');
    widget.destroy();
  });

  it('removes every listener on destroy', async () => {
    const api = fakeApi();
    const widget = createWidget({ root, now: () => 0, autoStart: false, api });
    widget.mount();
    await flush();
    widget.destroy();
    api.calls.length = 0;

    root.querySelector('.play').click();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }));
    await flush();

    expect(api.calls).toEqual([]);
  });
});
