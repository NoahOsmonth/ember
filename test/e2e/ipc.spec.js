'use strict';

const { test, expect } = require('./helpers/fixtures');

const widgetBounds = (app) =>
  app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    const widget = windows.find((win) => win.webContents.getURL().includes('/widget/'));
    return widget ? widget.getBounds() : null;
  });

test('state:set validates a patch and returns the merged document', async ({ ember }) => {
  const result = await ember.page.evaluate(() =>
    /** @type {any} */ (window).ember.state.set({ opacity: 0.5 })
  );
  expect(result.ok).toBe(true);
  expect(result.value.opacity).toBe(0.5);
});

test('state:set rejects a wrong type without changing the state', async ({ ember }) => {
  const before = await ember.page.evaluate(() => /** @type {any} */ (window).ember.state.get());
  const result = await ember.page.evaluate(() =>
    /** @type {any} */ (window).ember.state.set({ opacity: 'bright' })
  );
  expect(result).toMatchObject({ ok: false, code: 'invalid-payload' });
  expect(result.issues[0]).toMatchObject({ path: 'opacity', code: 'type' });

  const after = await ember.page.evaluate(() => /** @type {any} */ (window).ember.state.get());
  expect(after.value.opacity).toBe(before.value.opacity);
});

test('state:set rejects an unknown key instead of ignoring it', async ({ ember }) => {
  const result = await ember.page.evaluate(() =>
    /** @type {any} */ (window).ember.state.set({ notASetting: true })
  );
  expect(result).toMatchObject({ ok: false, code: 'invalid-payload' });
  expect(result.issues[0]).toMatchObject({ path: 'notASetting', code: 'unknown-key' });
});

test('the widget still drags through the send channel', async ({ ember }) => {
  await ember.page.evaluate(() =>
    /** @type {any} */ (window).ember.test.setBounds({ x: 120, y: 120 })
  );
  const before = await widgetBounds(ember.app);

  await ember.page.mouse.move(30, 80);
  await ember.page.mouse.down();
  await ember.page.mouse.move(70, 110, { steps: 6 });
  await ember.page.mouse.up();

  await expect
    .poll(async () => {
      const after = await widgetBounds(ember.app);
      return after.x - before.x;
    })
    .toBeGreaterThanOrEqual(20);
  await expect
    .poll(async () => {
      const after = await widgetBounds(ember.app);
      return after.y - before.y;
    })
    .toBeGreaterThanOrEqual(10);
});

test('the settings window opens and saves a switch through state:set', async ({ ember }) => {
  const opened = await ember.page.evaluate(() =>
    /** @type {any} */ (window).ember.settings.open('settings')
  );
  expect(opened.ok).toBe(true);

  await expect.poll(() => ember.app.windows().length).toBe(2);
  const settings = ember.app.windows().find((win) => win.url().includes('/settings/'));
  expect(settings).toBeTruthy();

  // First run opens on the tutorial tab; switch explicitly so the settings
  // controls are visible regardless of when the `tab` event arrived.
  await settings.locator('#tabs button[data-tab="settings"]').click();
  await settings.locator('#pg-settings').waitFor({ state: 'visible' });

  const autoBreak = settings.locator('.s-sw[data-key="autoBreak"]');
  await autoBreak.click();

  await expect
    .poll(() => ember.page.evaluate(() => /** @type {any} */ (window).ember.state.get()))
    .toMatchObject({ ok: true, value: { autoBreak: false } });
});
