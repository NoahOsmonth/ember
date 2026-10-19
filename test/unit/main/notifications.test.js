import { describe, expect, it, vi } from 'vitest';
import notificationsModule from '../../../src/main/notifications.js';

const { createNotifier, completionText, missedText } = notificationsModule;

/** A local-time Date, so quiet-hour assertions do not depend on the zone. */
const at = (hours, minutes = 0) => new Date(2026, 0, 2, hours, minutes, 0);

function fakeNotificationClass({ supported = true, fail = false } = {}) {
  const shown = [];
  class FakeNotification {
    static isSupported() {
      return supported;
    }
    constructor(options) {
      if (fail) throw new Error('no notification service');
      this.options = options;
      this.handlers = {};
    }
    on(event, handler) {
      this.handlers[event] = handler;
    }
    show() {
      shown.push(this);
    }
  }
  return { FakeNotification, shown };
}

function fakeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const event = {
  type: 'phase-complete',
  completedPhase: 'focus',
  snapshot: { phase: 'short', status: 'paused' },
};

const settings =
  (overrides = {}) =>
  () => ({
    notify: true,
    sound: true,
    doNotDisturb: false,
    quietHours: { enabled: false, start: '22:00', end: '07:00' },
    ...overrides,
  });

/**
 * @param {{
 *   overrides?: Record<string, any>,
 *   notification?: { FakeNotification: any, shown: any[] },
 *   isFocused?: () => boolean,
 *   now?: () => Date,
 *   focusWidget?: () => any,
 *   logger?: any
 * }} [options]
 */
async function make({
  overrides = {},
  notification = fakeNotificationClass(),
  isFocused = () => false,
  now = () => at(12),
  focusWidget = vi.fn(),
  logger = fakeLogger(),
} = {}) {
  const notifier = await createNotifier({
    settings: settings(overrides),
    logger,
    focusWidget,
    isFocused,
    now,
    NotificationClass: notification.FakeNotification,
  });
  return { notifier, ...notification, focusWidget, logger };
}

describe('completionText', () => {
  it('names the phase that ended and the break that starts', () => {
    expect(completionText(event)).toEqual({
      title: 'Focus round done',
      body: 'Time for a short break.',
    });
    expect(completionText({ completedPhase: 'focus', snapshot: { phase: 'long' } })).toMatchObject({
      body: 'Time for a long break.',
    });
  });

  it('names a finished break and the next focus round', () => {
    expect(completionText({ completedPhase: 'short', snapshot: { phase: 'focus' } })).toEqual({
      title: 'Break over',
      body: 'Ready for the next focus round.',
    });
    expect(completionText(null)).toMatchObject({ title: 'Break over' });
  });
});

describe('missedText', () => {
  it('reports one sentence about the pause point', () => {
    expect(missedText({ completedPhase: 'focus', snapshot: { phase: 'short' } })).toEqual({
      title: 'A phase ended while away',
      body: 'Ember is paused at the start of the short break.',
    });
    expect(missedText(null).body).toBe('Ember is paused.');
  });
});

describe('createNotifier', () => {
  it('shows one notification and returns the shared signal decision', async () => {
    const { notifier, shown, logger } = await make();
    const decision = notifier.notifyPhaseComplete(event);

    expect(decision).toEqual({ toast: true, chime: true });
    expect(shown).toHaveLength(1);
    expect(shown[0].options).toEqual({
      title: 'Focus round done',
      body: 'Time for a short break.',
      silent: true,
    });
    expect(logger.debug).toHaveBeenCalledWith('notification shown: Focus round done');
    expect(notifier.describe()).toMatchObject({
      count: 1,
      last: { title: 'Focus round done' },
    });
  });

  it('focuses the widget from the notification click handler', async () => {
    const { notifier, shown, focusWidget } = await make();
    notifier.notifyPhaseComplete(event);
    shown[0].handlers.click();
    expect(focusWidget).toHaveBeenCalledOnce();
  });

  it('does not throw when the click handler itself fails', async () => {
    const focusWidget = vi.fn(() => {
      throw new Error('window gone');
    });
    const { notifier, shown, logger } = await make({ focusWidget });
    notifier.notifyPhaseComplete(event);
    expect(() => shown[0].handlers.click()).not.toThrow();
    expect(logger.debug).toHaveBeenCalledWith('notification click failed (window gone)');
  });

  it('suppresses the toast while the widget is focused but keeps the chime', async () => {
    const { notifier, shown } = await make({ isFocused: () => true });
    expect(notifier.notifyPhaseComplete(event)).toEqual({ toast: false, chime: true });
    expect(shown).toHaveLength(0);
  });

  it('suppresses both signals for do-not-disturb and quiet hours', async () => {
    const dnd = await make({ overrides: { doNotDisturb: true } });
    expect(dnd.notifier.notifyPhaseComplete(event)).toEqual({ toast: false, chime: false });
    expect(dnd.shown).toHaveLength(0);

    const quiet = await make({
      now: () => at(23),
      overrides: { quietHours: { enabled: true, start: '22:00', end: '07:00' } },
    });
    expect(quiet.notifier.notifyPhaseComplete(event)).toEqual({ toast: false, chime: false });
    expect(quiet.shown).toHaveLength(0);
    expect(quiet.logger.debug).toHaveBeenCalledWith('phase-completion signal suppressed');
  });

  it('treats notify=false as the master switch', async () => {
    const { notifier, shown } = await make({ overrides: { notify: false } });
    expect(notifier.notifyPhaseComplete(event)).toEqual({ toast: false, chime: false });
    expect(shown).toHaveLength(0);
  });

  it('reports a missed phase with one sentence', async () => {
    const { notifier, shown } = await make();
    const decision = notifier.notifyMissed({
      quiet: true,
      awayMs: 40 * 60_000,
      completedPhase: 'focus',
      snapshot: { phase: 'short' },
    });
    expect(decision).toEqual({ toast: true, chime: false });
    expect(shown[0].options).toMatchObject({
      title: 'A phase ended while away',
      body: 'Ember is paused at the start of the short break.',
    });
  });

  it('suppresses a missed-phase toast while focused', async () => {
    const { notifier, shown, logger } = await make({ isFocused: () => true });
    notifier.notifyMissed({ quiet: true, snapshot: { phase: 'short' } });
    expect(shown).toHaveLength(0);
    expect(logger.debug).toHaveBeenCalledWith('missed-phase signal suppressed');
  });

  it('logs and continues when the platform refuses a notification', async () => {
    const { notifier, logger } = await make({
      notification: fakeNotificationClass({ fail: true }),
    });
    expect(() => notifier.notifyPhaseComplete(event)).not.toThrow();
    expect(logger.debug).toHaveBeenCalledWith('notification failed (no notification service)');
    expect(notifier.describe().count).toBe(0);
  });

  it('logs and continues when notifications are unsupported', async () => {
    const { notifier, logger } = await make({
      notification: fakeNotificationClass({ supported: false }),
    });
    expect(notifier.notifyPhaseComplete(event)).toEqual({ toast: true, chime: true });
    expect(logger.debug).toHaveBeenCalledWith('notifications are not supported on this platform');
    expect(notifier.describe().count).toBe(0);
  });

  it('suppresses everything when the settings getter throws', async () => {
    const logger = fakeLogger();
    const notifier = await createNotifier({
      settings: () => {
        throw new Error('store gone');
      },
      logger,
      NotificationClass: fakeNotificationClass().FakeNotification,
    });
    expect(notifier.notifyPhaseComplete(event)).toEqual({ toast: false, chime: false });
    expect(logger.debug).toHaveBeenCalledWith('signal decision failed (store gone); suppressing');
  });

  it('bounds the history while keeping the total count', async () => {
    const { notifier } = await make();
    for (let index = 0; index < 25; index += 1) notifier.notifyPhaseComplete(event);
    const description = notifier.describe();
    expect(description.count).toBe(25);
    expect(description.history).toHaveLength(20);
    expect(description.last).toEqual({
      title: 'Focus round done',
      body: 'Time for a short break.',
    });
  });

  it('disposes without throwing', async () => {
    const { notifier } = await make();
    expect(() => notifier.dispose()).not.toThrow();
  });
});
