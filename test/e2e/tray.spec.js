'use strict';

const { test, expect } = require('./helpers/fixtures');
const { advanceClock } = require('./helpers/clock');

const trayInfo = (page) => page.evaluate(() => /** @type {any} */ (window).ember.test.trayInfo());
const trayCommand = (page, id) =>
  page.evaluate((value) => /** @type {any} */ (window).ember.test.trayCommand(value), id);
const getTimer = (page) => page.evaluate(() => /** @type {any} */ (window).ember.timer.get());
const getState = (page) => page.evaluate(() => /** @type {any} */ (window).ember.state.get());

const widgetBounds = (app) =>
  app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    const widget = windows.find((win) => win.webContents.getURL().includes('/widget/'));
    return widget ? widget.getBounds() : null;
  });

const widgetFlag = (app, property) =>
  app.evaluate(({ BrowserWindow }, name) => {
    const windows = BrowserWindow.getAllWindows();
    const widget = windows.find((win) => win.webContents.getURL().includes('/widget/'));
    return widget ? widget[name]() : null;
  }, property);

test('the tray tooltip reports the phase and the remaining time', async ({ ember }) => {
  await ember.page.evaluate(() => /** @type {any} */ (window).ember.timer.start());
  await expect.poll(() => getTimer(ember.page)).toMatchObject({ value: { status: 'running' } });
  await advanceClock(ember.page, 12.5 * 60_000);

  await expect
    .poll(async () => {
      const result = await trayInfo(ember.page);
      return result.ok ? result.value.tooltip : null;
    })
    .toBe('focus · 12:30');

  const menu = await trayInfo(ember.page);
  expect(menu.value.items.find((item) => item.id === 'toggle').label).toBe('Pause');
});

test('pause from the tray drives the same timer as the widget', async ({ ember }) => {
  await ember.page.evaluate(() => /** @type {any} */ (window).ember.timer.start());
  await expect.poll(() => getTimer(ember.page)).toMatchObject({ value: { status: 'running' } });

  expect((await trayCommand(ember.page, 'toggle')).value).toBe(true);
  await expect
    .poll(() => getTimer(ember.page))
    .toMatchObject({ value: { phase: 'focus', status: 'paused' } });
  await expect(ember.page.locator('#state')).toHaveText('paused');

  await expect
    .poll(async () => (await trayInfo(ember.page)).value.tooltip)
    .toBe('paused · focus · 25:00');
});

test('bring to me moves the widget onto the display under the cursor', async ({ ember }) => {
  await ember.page.evaluate(() =>
    /** @type {any} */ (window).ember.test.setDisplays([
      { id: 1, isPrimary: true, workArea: { x: 0, y: 0, width: 1_280, height: 720 } },
      { id: 2, workArea: { x: 1_280, y: 0, width: 1_280, height: 720 } },
    ])
  );
  await ember.page.evaluate(() =>
    /** @type {any} */ (window).ember.test.setBounds({ x: 1_500, y: 120 })
  );
  expect((await widgetBounds(ember.app)).x).toBeGreaterThanOrEqual(1_280);

  await ember.page.evaluate(() =>
    /** @type {any} */ (window).ember.test.setCursor({ x: 20, y: 20 })
  );
  expect((await trayCommand(ember.page, 'bring')).value).toBe(true);

  await expect
    .poll(() => widgetBounds(ember.app))
    .toMatchObject({
      x: 470,
      y: 312,
      width: 340,
      height: 96,
    });
});

test('the watchdog returns an off-screen widget to the work area', async ({ ember }) => {
  const area = await ember.app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);

  await ember.app.evaluate(({ BrowserWindow }) => {
    const widget = BrowserWindow.getAllWindows().find((win) =>
      win.webContents.getURL().includes('/widget/')
    );
    widget.setBounds({ x: 9_000, y: 9_000, width: 340, height: 96 });
  });

  // The watchdog runs every 5 s, so a sample taken just after a tick waits a
  // full interval for the next one.
  await expect
    .poll(async () => widgetBounds(ember.app), { timeout: 12_000 })
    .toMatchObject({
      x: area.x + area.width - 340,
      y: area.y + area.height - 96,
    });
});

test('a second launch shows and focuses the running widget', async ({ ember }) => {
  await ember.app.evaluate(({ BrowserWindow }) => {
    const widget = BrowserWindow.getAllWindows().find((win) =>
      win.webContents.getURL().includes('/widget/')
    );
    widget.hide();
  });
  expect(await widgetFlag(ember.app, 'isVisible')).toBe(false);

  await ember.app.evaluate(({ app }) => {
    app.emit('second-instance', {}, [], process.cwd(), {});
  });

  await expect.poll(() => widgetFlag(ember.app, 'isVisible')).toBe(true);
  await expect.poll(() => widgetFlag(ember.app, 'isFocused')).toBe(true);
  expect((await getState(ember.page)).value.locked).toBe(false);
});
