'use strict';

const { test, expect } = require('./helpers/fixtures');
const { suspend } = require('./helpers/clock');

const getTimer = (page) => page.evaluate(() => /** @type {any} */ (window).ember.timer.get());

/** Record every phase-complete payload the widget receives. */
const recordCompletions = (page) =>
  page.evaluate(() => {
    const target = /** @type {any} */ (window);
    target.__completions = [];
    target.ember.timer.onPhaseComplete((event) => target.__completions.push(event));
  });

const completions = (page) => page.evaluate(() => /** @type {any} */ (window).__completions || []);

test('a short suspend keeps the phase running with less time remaining', async ({ ember }) => {
  await ember.page.evaluate(() => /** @type {any} */ (window).ember.timer.start());
  const before = await getTimer(ember.page);
  expect(before.value).toMatchObject({ phase: 'focus', status: 'running' });

  const result = await suspend(ember.page, 3 * 60_000);
  expect(result.awayMs).toBe(3 * 60_000);

  const after = await getTimer(ember.page);
  expect(after.value).toMatchObject({ phase: 'focus', status: 'running' });
  expect(after.value.remainingMs).toBeGreaterThan(21 * 60_000);
  expect(after.value.remainingMs).toBeLessThanOrEqual(22 * 60_000);
  await expect(ember.page.locator('#state')).toHaveText('focus');
});

test('a suspend across the end lands on the break, paused, with one quiet notice', async ({
  ember,
}) => {
  await recordCompletions(ember.page);
  await ember.page.evaluate(() => /** @type {any} */ (window).ember.timer.start());

  await suspend(ember.page, 40 * 60_000);

  const after = await getTimer(ember.page);
  expect(after.value).toMatchObject({ phase: 'short', status: 'paused' });
  await expect(ember.page.locator('#state')).toHaveText('paused');

  const events = await completions(ember.page);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: 'phase-complete',
    completedPhase: 'focus',
    quiet: true,
    awayMs: 40 * 60_000,
  });
});

test('a duplicate resume does not advance the timer again', async ({ ember }) => {
  await recordCompletions(ember.page);
  await ember.page.evaluate(() => /** @type {any} */ (window).ember.timer.start());
  await suspend(ember.page, 40 * 60_000);

  await suspend(ember.page, 0);

  const after = await getTimer(ember.page);
  expect(after.value).toMatchObject({ phase: 'short', status: 'paused' });
  expect(await completions(ember.page)).toHaveLength(1);
});

test('a suspend during a paused phase changes nothing', async ({ ember }) => {
  await ember.page.evaluate(() => /** @type {any} */ (window).ember.timer.start());
  await ember.page.evaluate(() => /** @type {any} */ (window).ember.timer.pause());
  const before = await getTimer(ember.page);

  await suspend(ember.page, 30 * 60_000);

  const after = await getTimer(ember.page);
  expect(after.value).toMatchObject({ phase: 'focus', status: 'paused' });
  expect(after.value.remainingMs).toBe(before.value.remainingMs);
});
