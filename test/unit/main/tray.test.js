import { afterEach, describe, expect, it, vi } from 'vitest';
import trayModule from '../../../src/main/tray.js';

const { createTray, formatRemaining, formatTooltip } = trayModule;

class FakeTray {
  constructor(image) {
    this.image = image;
    this.destroyed = false;
    this.tooltips = [];
    this.handlers = {};
  }
  setToolTip(value) {
    this.tooltips.push(value);
  }
  isDestroyed() {
    return this.destroyed;
  }
  on(event, handler) {
    this.handlers[event] = handler;
  }
  destroy() {
    this.destroyed = true;
  }
}

class FakeMenu {
  static templates = [];
  static buildFromTemplate(template) {
    FakeMenu.templates.push(template);
    return {
      template,
      popup: vi.fn(),
    };
  }
}

function fakeWidget(visible = true) {
  return {
    isDestroyed: () => false,
    isVisible: () => visible,
  };
}

const running = { phase: 'focus', status: 'running', remainingMs: 12.5 * 60_000 };
const paused = { phase: 'short', status: 'paused', remainingMs: 4 * 60_000 };
const idle = { phase: 'long', status: 'idle', remainingMs: 15 * 60_000 };

function setup({ snapshot = running, widget = fakeWidget(), actions = {}, image = {} } = {}) {
  const created = [];
  const timer = { get: () => snapshot };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const tray = createTray({
    timer,
    windows: { getWidget: () => widget },
    actions,
    iconPath: 'icon.png',
    logger,
    TrayClass: class extends FakeTray {
      constructor(value) {
        super(value);
        created.push(this);
      }
    },
    MenuClass: FakeMenu,
    createImage: () => ({ isEmpty: () => false, ...image }),
    watchdogMs: 60_000,
  });
  return { tray, created, logger, timer };
}

const trays = [];

afterEach(() => {
  FakeMenu.templates = [];
  while (trays.length > 0) trays.pop().dispose();
});

function make(options) {
  const value = setup(options);
  trays.push(value.tray);
  return value;
}

describe('formatRemaining', () => {
  it('rounds up and pads both fields', () => {
    expect(formatRemaining(0)).toBe('00:00');
    expect(formatRemaining(1)).toBe('00:01');
    expect(formatRemaining(12.5 * 60_000)).toBe('12:30');
    expect(formatRemaining(180 * 60_000)).toBe('180:00');
  });

  it('never reports a negative time', () => {
    expect(formatRemaining(-5_000)).toBe('00:00');
    expect(formatRemaining(Number.NaN)).toBe('00:00');
  });
});

describe('formatTooltip', () => {
  it('names the phase and the remaining time', () => {
    expect(formatTooltip(running)).toBe('focus · 12:30');
    expect(formatTooltip(paused)).toBe('paused · short break · 04:00');
    expect(formatTooltip(idle)).toBe('long break · 15:00');
  });

  it('falls back to the product name without a snapshot', () => {
    expect(formatTooltip(null)).toBe('Ember');
    expect(formatTooltip({})).toBe('Ember');
  });
});

describe('createTray', () => {
  it('shows the tooltip at creation and after every snapshot', () => {
    const { tray, created } = make();
    expect(created).toHaveLength(1);
    expect(created[0].tooltips[0]).toBe('focus · 12:30');

    tray.applySnapshot(paused);
    expect(created[0].tooltips.at(-1)).toBe('paused · short break · 04:00');
  });

  it('rebuilds the menu with the live labels', () => {
    const { tray } = make();
    const runningMenu = tray.menu();
    expect(runningMenu.find((item) => item.id === 'toggle').label).toBe('Pause');
    expect(runningMenu.find((item) => item.id === 'showHide').label).toBe('Hide widget');

    tray.applySnapshot(paused);
    expect(tray.menu().find((item) => item.id === 'toggle').label).toBe('Resume');
    tray.applySnapshot(idle);
    expect(tray.menu().find((item) => item.id === 'toggle').label).toBe('Start');
  });

  it('offers every documented command', () => {
    const { tray } = make();
    expect(tray.describe().items.map((item) => item.id)).toEqual([
      'showHide',
      'bring',
      'toggle',
      'skip',
      'settings',
      'logs',
      'quit',
    ]);
  });

  it('routes menu commands to the actions', () => {
    const actions = {
      showHide: vi.fn(),
      bringToMe: vi.fn(),
      toggle: vi.fn(),
      skip: vi.fn(),
      settings: vi.fn(),
      openLogs: vi.fn(),
      quit: vi.fn(),
    };
    const { tray } = make({ actions });

    for (const id of ['showHide', 'bring', 'toggle', 'skip', 'settings', 'logs', 'quit']) {
      expect(tray.invoke(id)).toBe(true);
    }
    expect(actions.showHide).toHaveBeenCalledOnce();
    expect(actions.bringToMe).toHaveBeenCalledOnce();
    expect(actions.toggle).toHaveBeenCalledOnce();
    expect(actions.skip).toHaveBeenCalledOnce();
    expect(actions.settings).toHaveBeenCalledOnce();
    expect(actions.openLogs).toHaveBeenCalledOnce();
    expect(actions.quit).toHaveBeenCalledOnce();
    expect(tray.invoke('missing')).toBe(false);
  });

  it('labels show or hide from the widget visibility', () => {
    const { tray } = make({ widget: fakeWidget(false) });
    expect(tray.menu().find((item) => item.id === 'showHide').label).toBe('Show widget');
  });

  it('re-creates a destroyed icon without touching the timer', () => {
    const { tray, created } = make();
    created[0].destroyed = true;
    expect(tray.ensure()).toBe(true);
    expect(created).toHaveLength(2);
    expect(created[1].tooltips[0]).toBe('focus · 12:30');
    expect(tray.ensure()).toBe(false);
  });

  it('builds a fresh menu when the context menu opens', () => {
    const { created } = make();
    created[0].handlers['right-click']();
    expect(FakeMenu.templates).toHaveLength(1);
    expect(FakeMenu.templates[0].filter((item) => item.id).map((item) => item.id)).toEqual([
      'showHide',
      'bring',
      'toggle',
      'skip',
      'settings',
      'logs',
      'quit',
    ]);
  });

  it('warns once when the icon is empty but still creates the tray', () => {
    const { created, logger } = make({ image: { isEmpty: () => true } });
    expect(created).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith('tray icon is missing or empty at icon.png');
  });

  it('does not create an icon again after disposal', () => {
    const { tray, created } = make();
    tray.dispose();
    expect(created[0].destroyed).toBe(true);
    expect(tray.ensure()).toBe(false);
    expect(created).toHaveLength(1);
  });
});
