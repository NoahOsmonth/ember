'use strict';

const { test, expect } = require('./helpers/fixtures');
const { launchEmber } = require('./helpers/launch');
const { advanceClock, setClock } = require('./helpers/clock');

/** The internal map Electron keeps for `ipcMain.handle` registrations. */
async function registeredTestChannels(app) {
  return app.evaluate(({ ipcMain }) => {
    const handlers = ipcMain._invokeHandlers;
    if (!handlers || typeof handlers.keys !== 'function') return null;
    return [...handlers.keys()].filter((name) => name.startsWith('test:')).sort();
  });
}

test('test mode registers exactly the three channels this change owns', async ({ ember }) => {
  expect(await registeredTestChannels(ember.app)).toEqual([
    'test:advanceClock',
    'test:setBounds',
    'test:setClock',
  ]);
});

test('the clock channels move the application clock', async ({ ember }) => {
  const fixed = '2026-01-02T03:04:05.000Z';
  expect(await setClock(ember.page, fixed)).toBe(fixed);
  const advanced = Date.parse(await advanceClock(ember.page, 60_000)) - Date.parse(fixed);
  expect(advanced).toBeGreaterThanOrEqual(60_000);
  expect(advanced).toBeLessThan(61_000);
});

test('the bounds channel moves the widget window', async ({ ember }) => {
  const result = await ember.page.evaluate(() =>
    /** @type {any} */ (window).ember.test.setBounds({ x: 40, y: 50 })
  );
  expect(result.ok).toBe(true);
  expect(result.value.x).toBe(40);
  expect(result.value.y).toBe(50);
  expect(result.value.width).toBeGreaterThan(0);
  expect(result.value.height).toBeGreaterThan(0);
});

test('a release launch answers no test channel', async () => {
  const ember = await launchEmber({ testMode: false });
  try {
    const result = await ember.page.evaluate(() =>
      /** @type {any} */ (window).ember.test.setClock(new Date().toISOString())
    );
    expect(result).toEqual({ ok: false, code: 'unknown-channel' });
  } finally {
    await ember.close();
  }
});
