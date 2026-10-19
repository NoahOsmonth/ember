'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('./helpers/fixtures');
const { launchEmber } = require('./helpers/launch');
const { setClock } = require('./helpers/clock');

const getTimer = (page) => page.evaluate(() => /** @type {any} */ (window).ember.timer.get());

test('the play button starts and pauses the main-owned timer', async ({ ember }) => {
  await ember.page.locator('#bPlay').click({ force: true });
  await expect
    .poll(() => getTimer(ember.page))
    .toMatchObject({
      ok: true,
      value: { phase: 'focus', status: 'running' },
    });
  await expect(ember.page.locator('#state')).toHaveText('focus');

  await ember.page.locator('#bPlay').click({ force: true });
  await expect
    .poll(() => getTimer(ember.page))
    .toMatchObject({
      ok: true,
      value: { phase: 'focus', status: 'paused' },
    });
  await expect(ember.page.locator('#state')).toHaveText('paused');
});

test('skip and reset are commands to the main process', async ({ ember }) => {
  await ember.page.locator('#bPlay').click({ force: true });
  await expect.poll(() => getTimer(ember.page)).toMatchObject({ value: { status: 'running' } });

  await ember.page.locator('#bSkip').click({ force: true });
  await expect
    .poll(() => getTimer(ember.page))
    .toMatchObject({
      value: { phase: 'short', status: 'running' },
    });
  await expect(ember.page.locator('#state')).toHaveText('short break');

  await ember.page.locator('#bReset').click({ force: true });
  await expect
    .poll(() => getTimer(ember.page))
    .toMatchObject({
      value: { phase: 'focus', status: 'idle', rounds: 0 },
    });
});

test('a second window reads the same snapshot instead of owning a timer', async ({ ember }) => {
  await ember.page.evaluate(() => /** @type {any} */ (window).ember.timer.start());
  const widget = await getTimer(ember.page);

  await ember.page.evaluate(() => /** @type {any} */ (window).ember.settings.open('settings'));
  await expect.poll(() => ember.app.windows().length).toBe(2);
  const settings = ember.app.windows().find((win) => win.url().includes('/settings/'));
  expect(settings).toBeTruthy();

  const second = await settings.evaluate(() => /** @type {any} */ (window).ember.timer.get());
  expect(second.value.phase).toBe(widget.value.phase);
  expect(second.value.status).toBe(widget.value.status);
  expect(second.value.endsAtWall).toBe(widget.value.endsAtWall);
});

test('a widget reload keeps the running phase', async ({ ember }) => {
  await ember.page.evaluate(() => /** @type {any} */ (window).ember.timer.start());
  const before = await getTimer(ember.page);

  await ember.page.reload();
  await expect(ember.page.locator('#state')).toHaveText('focus');

  const after = await getTimer(ember.page);
  expect(after.value.status).toBe('running');
  expect(after.value.phase).toBe('focus');
  expect(after.value.endsAtWall).toBe(before.value.endsAtWall);
  expect(after.value.remainingMs).toBeLessThanOrEqual(before.value.remainingMs);
});

test('a running phase survives quit and relaunch', async () => {
  const first = await launchEmber();
  let second;
  try {
    // Put the main clock 45 seconds behind so the persisted end instant is
    // about 24 minutes away when the second process starts on the real clock.
    await setClock(first.page, new Date(Date.now() - 45_000));
    const started = await first.page.evaluate(() =>
      /** @type {any} */ (window).ember.timer.start()
    );
    expect(started.ok).toBe(true);

    await first.page.waitForTimeout(700);
    const before = await first.page.evaluate(() => /** @type {any} */ (window).ember.timer.get());
    expect(before.value).toMatchObject({ phase: 'focus', status: 'running' });

    await first.close({ keep: true });
    const file = path.join(first.userDataDir, 'ember.json');
    expect(fs.existsSync(file)).toBe(true);
    const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(disk.timer).toMatchObject({ phase: 'focus', status: 'running' });

    second = await launchEmber({ userDataDir: first.userDataDir });
    const restored = await second.page.evaluate(() =>
      /** @type {any} */ (window).ember.timer.get()
    );
    expect(restored.value).toMatchObject({ phase: 'focus', status: 'running' });
    expect(restored.value.remainingMs).toBeGreaterThan(23 * 60_000);
    expect(restored.value.remainingMs).toBeLessThan(25 * 60_000);
    await expect(second.page.locator('#digits')).toHaveText(/2[34]:\d{2}/);
    await expect(second.page.locator('#state')).toHaveText('focus');
  } finally {
    if (second) await second.close();
    else {
      await first.close();
      fs.rmSync(first.userDataDir, { recursive: true, force: true });
    }
  }
});
