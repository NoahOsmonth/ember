const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');

/**
 * Launch smoke test.
 *
 * Boots the real Electron binary against a throwaway profile, proves the widget
 * window renders the initial 25:00 focus timer and that the run persisted its
 * settings inside the directory handed to it, then cleans everything up.
 */
test('the widget boots into a 25:00 focus timer', async () => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-smoke-'));
  let app;

  try {
    app = await electron.launch({
      args: ['.'],
      env: { ...process.env, EMBER_TEST: '1', EMBER_USER_DATA: profileDir },
    });

    const win = await app.firstWindow();
    await win.waitForSelector('#digits');

    await expect(win.locator('#digits')).toHaveText('25:00');
    await expect(win.locator('#state')).toHaveText('ready');
    await expect(win).toHaveTitle('25:00 focus');

    await expect
      .poll(() => fs.existsSync(path.join(profileDir, 'ember.json')), { timeout: 5_000 })
      .toBe(true);
    expect(fs.existsSync(path.join(profileDir, 'logs'))).toBe(true);
  } finally {
    if (app) await app.close();
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
});
