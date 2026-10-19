'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('./helpers/fixtures');
const { launchEmber } = require('./helpers/launch');

const widgetBounds = (app) =>
  app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    const widget = windows.find((win) => win.webContents.getURL().includes('/widget/'));
    return widget ? widget.getBounds() : null;
  });

const setBounds = (page, bounds) =>
  page.evaluate((next) => /** @type {any} */ (window).ember.test.setBounds(next), bounds);

const setDisplays = (page, displays) =>
  page.evaluate((next) => /** @type {any} */ (window).ember.test.setDisplays(next), displays);

const setCursor = (page, point) =>
  page.evaluate((next) => /** @type {any} */ (window).ember.test.setCursor(next), point);

test('clamps the widget fully inside the work area', async ({ ember }) => {
  const area = await ember.app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
  const size = await widgetBounds(ember.app);

  await setBounds(ember.page, { x: area.x - 5_000, y: area.y - 5_000 });
  const topLeft = await widgetBounds(ember.app);
  expect(topLeft.x).toBe(area.x);
  expect(topLeft.y).toBe(area.y);

  await setBounds(ember.page, { x: area.x + area.width + 5_000, y: area.y + area.height + 5_000 });
  const bottomRight = await widgetBounds(ember.app);
  expect(bottomRight.x).toBe(area.x + area.width - size.width);
  expect(bottomRight.y).toBe(area.y + area.height - size.height);
});

test('re-clamps onto the primary display when the widget display disappears', async ({ ember }) => {
  const primary = { id: 1, isPrimary: true, workArea: { x: 0, y: 0, width: 1_280, height: 720 } };
  const second = { id: 2, workArea: { x: 1_280, y: 0, width: 1_280, height: 720 } };

  await setDisplays(ember.page, [primary, second]);
  await setBounds(ember.page, { x: 1_400, y: 100 });
  expect((await widgetBounds(ember.app)).x).toBe(1_400);

  await setDisplays(ember.page, [primary]);
  const clamped = await widgetBounds(ember.app);
  expect(clamped.x + clamped.width).toBeLessThanOrEqual(primary.workArea.width);
  expect(clamped.y + clamped.height).toBeLessThanOrEqual(primary.workArea.height);
  expect(clamped.x).toBeGreaterThanOrEqual(0);
});

test('a drag on a 150 % display ends under the pointer', async ({ ember }) => {
  const display = {
    id: 7,
    isPrimary: true,
    scaleFactor: 1.5,
    workArea: { x: 0, y: 0, width: 1_280, height: 720 },
  };
  await setDisplays(ember.page, [display]);
  await setBounds(ember.page, { x: 200, y: 200 });

  // The pointer grabs the window at (220, 220), 20 DIPs inside its corner, and
  // then moves 300 DIPs right and 100 DIPs down.
  await setCursor(ember.page, { x: 220, y: 220 });
  await ember.page.evaluate(() =>
    /** @type {any} */ (window).ember.win.dragStart({ x: 220, y: 220 })
  );
  await setCursor(ember.page, { x: 520, y: 320 });

  await expect.poll(async () => widgetBounds(ember.app)).toMatchObject({ x: 500, y: 300 });

  await ember.page.evaluate(() => /** @type {any} */ (window).ember.win.dragEnd());
  await expect
    .poll(async () => {
      const state = await ember.page.evaluate(() => /** @type {any} */ (window).ember.state.get());
      return state.value.placement;
    })
    .toMatchObject({ x: 500, y: 300, displayId: 7, scaleFactor: 1.5 });
});

test('compact mode keeps the right edge and stays inside the work area', async ({ ember }) => {
  await setBounds(ember.page, { x: 300, y: 200 });
  const before = await widgetBounds(ember.app);

  const result = await ember.page.evaluate(() => /** @type {any} */ (window).ember.win.mini(true));
  expect(result.ok).toBe(true);

  const after = await widgetBounds(ember.app);
  expect(after.width).toBe(156);
  expect(after.height).toBe(58);
  expect(after.x + after.width).toBe(before.x + before.width);
  expect(after.y).toBe(before.y);
});

test('restores the saved position on the same display after a relaunch', async () => {
  const first = await launchEmber();
  let second;
  try {
    await setBounds(first.page, { x: 200, y: 150 });
    const before = await widgetBounds(first.app);

    // The placement write is debounced; quit flushes the store.
    await first.close({ keep: true });
    const file = path.join(first.userDataDir, 'ember.json');
    const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(disk.placement).toMatchObject({
      x: before.x,
      y: before.y,
      width: before.width,
      height: before.height,
    });
    expect(Number.isInteger(disk.placement.displayId)).toBe(true);

    second = await launchEmber({ userDataDir: first.userDataDir });
    const restored = await widgetBounds(second.app);
    expect(restored.x).toBe(before.x);
    expect(restored.y).toBe(before.y);
  } finally {
    if (second) {
      await second.close();
    } else {
      await first.close();
      fs.rmSync(first.userDataDir, { recursive: true, force: true });
    }
  }
});
