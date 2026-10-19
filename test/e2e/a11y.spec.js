'use strict';

const { test, expect } = require('./helpers/fixtures');
const { launchEmber } = require('./helpers/launch');

const widthOf = (page, text) =>
  page.evaluate((value) => {
    const digits = document.querySelector('#digits');
    digits.textContent = value;
    return digits.getBoundingClientRect().width;
  }, text);

test('every control has an accessible name and the timer exposes its state', async ({ ember }) => {
  const labels = await ember.page.evaluate(() =>
    [...document.querySelectorAll('#app .ctl button')].map((button) => ({
      label: button.getAttribute('aria-label'),
      title: button.getAttribute('title'),
    }))
  );
  expect(labels).toHaveLength(4);
  for (const control of labels) expect(control.label).toBeTruthy();

  const timer = await ember.page.evaluate(() => {
    const digits = document.querySelector('#digits');
    return {
      role: digits.getAttribute('role'),
      live: digits.getAttribute('aria-live'),
      label: digits.getAttribute('aria-label'),
    };
  });
  expect(timer.role).toBe('timer');
  expect(timer.live).toBe('off');
  expect(timer.label).toMatch(/^(focus|short break|long break), \d{2}:\d{2} remaining$/);
});

test('tab order follows the controls with a visible inset ring', async ({ ember }) => {
  const page = ember.page;
  const order = [];
  for (let step = 0; step < 4; step += 1) {
    await page.keyboard.press('Tab');
    order.push(
      await page.evaluate(() => {
        const active = document.activeElement;
        return active ? active.className : '';
      })
    );
  }
  expect(order).toEqual(['play', 'skip', 'reset', 'settings']);

  const ring = await page.evaluate(() => {
    const active = document.activeElement;
    const style = getComputedStyle(active);
    return {
      name: active.className,
      style: style.outlineStyle,
      width: style.outlineWidth,
      offset: style.outlineOffset,
    };
  });
  expect(ring.name).toBe('settings');
  expect(ring.style).toBe('solid');
  expect(ring.width).not.toBe('0px');
  expect(ring.offset).toBe('-2px');
});

test('09:59 and 09:58 occupy the same width with tabular figures', async ({ ember }) => {
  const page = ember.page;
  await page.evaluate(() => document.fonts.ready.then(() => true));
  const figures = await page.evaluate(
    () => getComputedStyle(document.querySelector('#digits')).fontVariantNumeric
  );
  expect(figures).toBe('tabular-nums');

  const first = await widthOf(page, '09:59');
  const second = await widthOf(page, '09:58');
  expect(Math.abs(first - second)).toBeLessThan(0.5);
});

test('EMBER_SOLID forces an opaque background and reports the override', async () => {
  const instance = await launchEmber({ env: { EMBER_SOLID: '1' } });
  try {
    const page = instance.page;
    const state = await page.evaluate(async () => {
      const result = await /** @type {any} */ (window).ember.state.get();
      return {
        value: result.value,
        solidClass: document.documentElement.classList.contains('solid'),
        background: getComputedStyle(document.querySelector('#app')).backgroundColor,
      };
    });
    expect(state.value.solid).toBe(true);
    expect(state.value.solidOverride).toBe('env');
    expect(state.solidClass).toBe(true);
    expect(state.background).toBe('rgb(8, 9, 13)');
  } finally {
    await instance.close();
  }
});

test('a solid background choice survives a restart', async () => {
  const first = await launchEmber();
  const profile = first.userDataDir;
  let settingsPage;
  try {
    // Change it from the settings window, the way a user does: the widget
    // learns about it through the broadcast.
    const opened = first.app.waitForEvent('window');
    await first.page.evaluate(() => /** @type {any} */ (window).ember.settings.open('settings'));
    settingsPage = await opened;
    await settingsPage.waitForLoadState('domcontentloaded');
    await settingsPage.evaluate(() =>
      /** @type {any} */ (window).ember.state.set({ render: { background: 'solid' } })
    );
    await expect
      .poll(() => first.page.evaluate(() => document.documentElement.classList.contains('solid')))
      .toBe(true);
  } finally {
    if (settingsPage && !settingsPage.isClosed()) await settingsPage.close();
    await first.close({ keep: true });
  }

  const second = await launchEmber({ userDataDir: profile });
  try {
    const state = await second.page.evaluate(async () => {
      const result = await /** @type {any} */ (window).ember.state.get();
      return {
        background: result.value.render.background,
        solid: document.documentElement.classList.contains('solid'),
      };
    });
    expect(state.background).toBe('solid');
    expect(state.solid).toBe(true);
  } finally {
    await second.close();
  }
});
