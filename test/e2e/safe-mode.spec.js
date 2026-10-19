'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { launchEmber } = require('./helpers/launch');

const getState = (page) => page.evaluate(() => /** @type {any} */ (window).ember.state.get());
const getShortcuts = (page) =>
  page.evaluate(() => /** @type {any} */ (window).ember.shortcuts.get());

const widgetFlag = (app, property) =>
  app.evaluate(({ BrowserWindow }, name) => {
    const widget = BrowserWindow.getAllWindows().find((win) =>
      win.webContents.getURL().includes('/widget/')
    );
    return widget ? widget[name]() : null;
  }, property);

const registeredShortcuts = (app, accelerators) =>
  app.evaluate(
    ({ globalShortcut }, list) => list.map((item) => globalShortcut.isRegistered(item)),
    accelerators
  );

const BINDINGS = ['Control+Alt+P', 'Control+Alt+Space', 'Control+Alt+L'];

test('safe mode marks the widget and turns the overrides off', async () => {
  const ember = await launchEmber({ env: { EMBER_SAFE_MODE: '1' } });
  try {
    const state = await getState(ember.page);
    expect(state.value.safeMode).toBe(true);
    expect(state.value.solid).toBe(true);
    expect(state.value.solidOverride).toBe('safe');
    expect(state.value.onTop).toBe(false);

    await expect(ember.page.locator('#safeBadge')).toBeVisible();
    await expect(ember.page.locator('#safeBadge')).toHaveText('safe mode');
    expect(await widgetFlag(ember.app, 'isAlwaysOnTop')).toBe(false);

    const log = fs.readFileSync(path.join(ember.userDataDir, 'logs', 'ember.log'), 'utf8');
    expect(log).toContain('safe mode active');
  } finally {
    await ember.close();
  }
});

test('the --safe-mode flag is equivalent to the environment variable', async () => {
  const ember = await launchEmber({ args: ['--safe-mode'] });
  try {
    expect((await getState(ember.page)).value.safeMode).toBe(true);
    await expect(ember.page.locator('#safeBadge')).toBeVisible();
  } finally {
    await ember.close();
  }
});

test('safe mode reports every shortcut as off and registers none', async () => {
  const ember = await launchEmber({ env: { EMBER_SAFE_MODE: '1' } });
  try {
    const status = await getShortcuts(ember.page);
    expect(status.value.safeMode).toBe(true);
    expect(status.value.bindings.map((binding) => binding.status)).toEqual([
      'disabled',
      'disabled',
      'disabled',
    ]);
    expect(await registeredShortcuts(ember.app, BINDINGS)).toEqual([false, false, false]);

    const rebind = await ember.page.evaluate(
      (payload) => /** @type {any} */ (window).ember.shortcuts.rebind(payload),
      { id: 'showHide', accelerator: 'Control+Alt+Shift+J' }
    );
    expect(rebind).toMatchObject({ ok: true, value: { ok: false, code: 'unavailable' } });
  } finally {
    await ember.close();
  }
});

test('the settings window explains safe mode and offers a session reset', async () => {
  const ember = await launchEmber({ env: { EMBER_SAFE_MODE: '1' } });
  try {
    const opened = await ember.page.evaluate(() =>
      /** @type {any} */ (window).ember.settings.open('settings')
    );
    expect(opened.ok).toBe(true);
    await expect.poll(() => ember.app.windows().length).toBe(2);
    const settings = ember.app.windows().find((win) => win.url().includes('/settings/'));
    await settings.locator('#pg-settings').waitFor({ state: 'visible' });

    const banner = settings.locator('#safeBanner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('--safe-mode');
    await expect(banner).toContainText('EMBER_SAFE_MODE=1');
    await expect(settings.locator('#bgNote')).toHaveText('forced by safe mode');
    await expect(settings.locator('[data-shortcut-id="showHide"] .s-shortcut-status')).toHaveText(
      'off in safe mode'
    );

    await settings.locator('#safeReset').click();
    await expect
      .poll(async () => (await getState(ember.page)).value)
      .toMatchObject({ theme: 'dusk', opacity: 0.62, safeMode: true });
  } finally {
    await ember.close();
  }
});

test('a safe-mode session never writes to the settings file', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-safe-'));
  const file = path.join(profile, 'ember.json');
  try {
    const normal = await launchEmber({ userDataDir: profile });
    await normal.page.evaluate(() =>
      /** @type {any} */ (window).ember.state.set({ theme: 'mono' })
    );
    await expect.poll(async () => (await getState(normal.page)).value.theme).toBe('mono');
    await normal.close({ keep: true });

    // The write is debounced; wait for the flushed document before comparing.
    await expect
      .poll(() => {
        try {
          return JSON.parse(fs.readFileSync(file, 'utf8')).theme;
        } catch {
          return null;
        }
      })
      .toBe('mono');
    const before = fs.readFileSync(file, 'utf8');

    const safe = await launchEmber({ userDataDir: profile, env: { EMBER_SAFE_MODE: '1' } });
    try {
      expect((await getState(safe.page)).value.theme).toBe('dusk');
      await safe.page.evaluate(() =>
        /** @type {any} */ (window).ember.state.set({ theme: 'solar', opacity: 0.5 })
      );
      const changed = await getState(safe.page);
      expect(changed.value.theme).toBe('solar');
      expect(changed.value.opacity).toBe(0.5);
    } finally {
      await safe.close({ keep: true });
    }

    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
