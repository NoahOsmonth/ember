'use strict';

const fs = require('fs');
const path = require('path');
const base = require('@playwright/test');
const { launchEmber } = require('./helpers/launch');
const { advanceClock, setClock, suspend } = require('./helpers/clock');

/**
 * Every test here launches with debug logging so a suppressed signal can be
 * proven from the main log, not only from the absence of a toast.
 */
async function withEmber(testInfo, body) {
  const ember = await launchEmber({ env: { EMBER_LOG: 'debug' } });
  try {
    await body(ember);
  } catch (error) {
    await ember.attach(testInfo);
    await ember.close({ keep: true });
    throw error;
  }
  await ember.close();
}

const notifications = (page) =>
  page.evaluate(() => /** @type {any} */ (window).ember.test.notifications());

async function notificationCount(page) {
  const result = await notifications(page);
  return result && result.ok && result.value ? result.value.count : 0;
}

async function notificationState(page) {
  const result = await notifications(page);
  return result && result.ok && result.value
    ? result.value
    : { count: 0, last: null, supported: false };
}

/**
 * A platform that refuses notifications is a documented outcome: the refusal is
 * logged and the phase still transitions. Wait for whichever outcome applies.
 */
async function settledNotification(page) {
  let state = await notificationState(page);
  await base.expect
    .poll(async () => {
      state = await notificationState(page);
      return state.supported ? state.count : 1;
    })
    .toBeGreaterThan(0);
  return state;
}

const getTimer = (page) => page.evaluate(() => /** @type {any} */ (window).ember.timer.get());

const widgetFocused = (app) =>
  app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((entry) =>
      entry.webContents.getURL().includes('/widget/')
    );
    return win ? win.isFocused() : null;
  });

const focusWidget = (app) =>
  app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((entry) =>
      entry.webContents.getURL().includes('/widget/')
    );
    if (!win) return null;
    win.focus();
    return win.isFocused();
  });

/** Open settings and give it focus, so the widget is unambiguously unfocused. */
async function unfocusWidget(ember) {
  await ember.page.evaluate(() => /** @type {any} */ (window).ember.settings.open('settings'));
  await base.expect.poll(() => ember.app.windows().length).toBe(2);
  await ember.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((entry) =>
      entry.webContents.getURL().includes('/settings/')
    );
    if (win) win.focus();
  });
  await base.expect.poll(() => widgetFocused(ember.app)).toBe(false);
}

/** A one-minute focus phase keeps the completion tests fast. */
async function shortPhase(ember) {
  const result = await ember.page.evaluate(() =>
    /** @type {any} */ (window).ember.state.set({
      durations: { focus: 1, short: 1, long: 1 },
    })
  );
  if (!result || result.ok !== true) throw new Error('state:set failed');
}

/**
 * Advance past the end in two steps under the one-minute clock-jump threshold,
 * so the power watcher treats the time as elapsed rather than as a clock jump.
 */
async function completeShortPhase(page) {
  await advanceClock(page, 50_000);
  await page.waitForTimeout(1_400);
  await advanceClock(page, 20_000);
  await base.expect.poll(async () => (await getTimer(page)).value.phase).toBe('short');
}

const logText = (ember) => {
  const file = path.join(ember.userDataDir, 'logs', 'ember.log');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
};

base.test(
  'an unfocused completion shows one toast naming both phases',
  async ({ page: _page }, testInfo) => {
    await withEmber(testInfo, async (ember) => {
      await shortPhase(ember);
      await unfocusWidget(ember);

      await ember.page.evaluate(() => /** @type {any} */ (window).ember.timer.start());
      await completeShortPhase(ember.page);

      const state = await settledNotification(ember.page);
      if (state.supported) {
        base.expect(state.count).toBe(1);
        base.expect(state.last).toEqual({
          title: 'Focus round done',
          body: 'Time for a short break.',
        });
      } else {
        await base.expect
          .poll(() => logText(ember))
          .toContain('notifications are not supported on this platform');
      }
    });
  }
);

base.test('a focused widget suppresses the toast', async ({ page: _page }, testInfo) => {
  await withEmber(testInfo, async (ember) => {
    await shortPhase(ember);
    base.expect(await focusWidget(ember.app)).toBe(true);
    await base.expect.poll(() => widgetFocused(ember.app)).toBe(true);

    await ember.page.evaluate(() => /** @type {any} */ (window).ember.timer.start());
    await completeShortPhase(ember.page);
    await ember.page.waitForTimeout(800);

    base.expect(await notificationCount(ember.page)).toBe(0);
  });
});

base.test(
  'quiet hours suppress the toast and chime but not the phase change',
  async ({ page: _page }, testInfo) => {
    await withEmber(testInfo, async (ember) => {
      // Local 23:00 is inside the default 22:00–07:00 window.
      await setClock(ember.page, new Date(2026, 0, 2, 23, 0, 0));
      await ember.page.waitForTimeout(1_300);
      await ember.page.evaluate(() =>
        /** @type {any} */ (window).ember.state.set({
          quietHours: { enabled: true, start: '22:00', end: '07:00' },
        })
      );
      await unfocusWidget(ember);

      await ember.page.evaluate(() => /** @type {any} */ (window).ember.timer.start());
      await suspend(ember.page, 26 * 60_000);

      await base.expect.poll(async () => (await getTimer(ember.page)).value.phase).toBe('short');
      base.expect(await notificationCount(ember.page)).toBe(0);
      await base.expect.poll(() => logText(ember)).toContain('missed-phase signal suppressed');
    });
  }
);

base.test(
  'a multi-phase resume reports exactly one missed phase',
  async ({ page: _page }, testInfo) => {
    await withEmber(testInfo, async (ember) => {
      await unfocusWidget(ember);
      await ember.page.evaluate(() => {
        const target = /** @type {any} */ (window);
        target.__completions = [];
        target.ember.timer.onPhaseComplete((event) => target.__completions.push(event));
      });

      await ember.page.evaluate(() => /** @type {any} */ (window).ember.timer.start());
      await suspend(ember.page, 40 * 60_000);

      await base.expect
        .poll(async () => (await getTimer(ember.page)).value)
        .toMatchObject({ phase: 'short', status: 'paused' });
      const state = await settledNotification(ember.page);
      if (state.supported) {
        base.expect(state.count).toBe(1);
        base.expect(state.last.title).toBe('A phase ended while away');
        base.expect(state.last.body).toBe('Ember is paused at the start of the short break.');
      } else {
        await base.expect
          .poll(() => logText(ember))
          .toContain('notifications are not supported on this platform');
      }

      const events = await ember.page.evaluate(() => /** @type {any} */ (window).__completions);
      base.expect(events).toHaveLength(1);
      // A missed phase is reported, never chimed.
      base.expect(events[0].signals).toEqual({ toast: true, chime: false });
    });
  }
);

base.test(
  'the tray do-not-disturb toggle silences the next completion',
  async ({ page: _page }, testInfo) => {
    await withEmber(testInfo, async (ember) => {
      const toggled = await ember.page.evaluate(() =>
        /** @type {any} */ (window).ember.test.trayCommand('dnd')
      );
      base.expect(toggled).toEqual({ ok: true, value: true });

      const menu = await ember.page.evaluate(() =>
        /** @type {any} */ (window).ember.test.trayInfo()
      );
      const item = menu.value.items.find((entry) => entry.id === 'dnd');
      base.expect(item).toMatchObject({ label: 'Do not disturb', checked: true });
      await base.expect(ember.page.locator('#dndBadge')).toBeVisible();

      const state = await ember.page.evaluate(() => /** @type {any} */ (window).ember.state.get());
      base.expect(state.value.doNotDisturb).toBe(true);

      await shortPhase(ember);
      await unfocusWidget(ember);
      await ember.page.evaluate(() => /** @type {any} */ (window).ember.timer.start());
      await completeShortPhase(ember.page);
      await ember.page.waitForTimeout(800);

      base.expect(await notificationCount(ember.page)).toBe(0);
      await base.expect.poll(() => logText(ember)).toContain('phase-completion signal suppressed');
    });
  }
);
