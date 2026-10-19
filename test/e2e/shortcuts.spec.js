'use strict';

const { test, expect } = require('./helpers/fixtures');

const getShortcuts = (page) =>
  page.evaluate(() => /** @type {any} */ (window).ember.shortcuts.get());
const getState = (page) => page.evaluate(() => /** @type {any} */ (window).ember.state.get());
const rebind = (page, id, accelerator) =>
  page.evaluate((payload) => /** @type {any} */ (window).ember.shortcuts.rebind(payload), {
    id,
    accelerator,
  });

/** Open the settings window and show its settings tab. */
async function openSettings(ember) {
  const opened = await ember.page.evaluate(() =>
    /** @type {any} */ (window).ember.settings.open('settings')
  );
  expect(opened.ok).toBe(true);

  await expect.poll(() => ember.app.windows().length).toBe(2);
  const settings = ember.app.windows().find((win) => win.url().includes('/settings/'));
  expect(settings).toBeTruthy();
  await settings.locator('#tabs button[data-tab="settings"]').click();
  await settings.locator('#pg-settings').waitFor({ state: 'visible' });
  return settings;
}

test('reports every configured binding with its accelerator', async ({ ember }) => {
  const result = await getShortcuts(ember.page);

  expect(result.ok).toBe(true);
  expect(result.value.safeMode).toBe(false);
  expect(result.value.bindings.map((binding) => [binding.id, binding.accelerator])).toEqual([
    ['showHide', 'Control+Alt+P'],
    ['toggle', 'Control+Alt+Space'],
    ['lock', 'Control+Alt+L'],
  ]);
});

test('rebinds through the settings window and releases the old accelerator', async ({ ember }) => {
  const settings = await openSettings(ember);
  const row = settings.locator('[data-shortcut-id="showHide"]');

  await row.locator('.s-shortcut-change').click();
  await expect(row.locator('.s-shortcut-capture')).toBeVisible();

  await settings.keyboard.press('Control+Alt+Shift+J');
  await row.locator('.s-shortcut-save').click();

  await expect(row.locator('.s-shortcut-status')).toHaveText('works');
  await expect(row.locator('.s-shortcut-change')).toContainText('J');

  const status = await getShortcuts(ember.page);
  const showHide = status.value.bindings.find((binding) => binding.id === 'showHide');
  expect(showHide).toMatchObject({ accelerator: 'Control+Alt+Shift+J', status: 'active' });

  const stored = await getState(ember.page);
  expect(stored.value.shortcuts.showHide).toBe('Control+Alt+Shift+J');

  const held = await ember.app.evaluate(({ globalShortcut }) => ({
    old: globalShortcut.isRegistered('Control+Alt+P'),
    next: globalShortcut.isRegistered('Control+Alt+Shift+J'),
  }));
  expect(held).toEqual({ old: false, next: true });
});

test('rejects a duplicate and keeps the existing binding', async ({ ember }) => {
  const result = await rebind(ember.page, 'showHide', 'Control+Alt+L');

  expect(result).toMatchObject({
    ok: true,
    value: { ok: false, code: 'conflict', conflictWith: 'lock' },
  });
  const stored = await getState(ember.page);
  expect(stored.value.shortcuts.showHide).toBe('Control+Alt+P');
});

test('rejects reserved and unparsable combinations', async ({ ember }) => {
  const reserved = await rebind(ember.page, 'showHide', 'Alt+Tab');
  expect(reserved.value).toMatchObject({ ok: false, code: 'reserved' });

  const invalid = await rebind(ember.page, 'showHide', 'not a key');
  expect(invalid.value).toMatchObject({ ok: false, code: 'invalid' });
});

test('reset restores the default accelerators', async ({ ember }) => {
  const changed = await rebind(ember.page, 'showHide', 'Control+Alt+Shift+J');
  expect(changed.value.ok).toBe(true);

  const reset = await ember.page.evaluate(() =>
    /** @type {any} */ (window).ember.shortcuts.reset()
  );
  expect(reset.value.ok).toBe(true);

  const stored = await getState(ember.page);
  expect(stored.value.shortcuts).toEqual({
    showHide: 'Control+Alt+P',
    toggle: 'Control+Alt+Space',
    lock: 'Control+Alt+L',
  });

  const status = await getShortcuts(ember.page);
  expect(status.value.bindings.map((binding) => binding.accelerator)).toEqual([
    'Control+Alt+P',
    'Control+Alt+Space',
    'Control+Alt+L',
  ]);
});
