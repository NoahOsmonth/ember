'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('./helpers/fixtures');

/**
 * Launch smoke test.
 *
 * Boots the real Electron binary against a throwaway profile, proves the widget
 * window renders the initial 25:00 focus timer and that the run persisted its
 * settings inside the directory handed to it.
 */
test('the widget boots into a 25:00 focus timer', async ({ ember }) => {
  await expect(ember.page.locator('#digits')).toHaveText('25:00');
  await expect(ember.page.locator('#state')).toHaveText('ready');
  await expect(ember.page).toHaveTitle('25:00 focus');

  await expect
    .poll(() => fs.existsSync(path.join(ember.userDataDir, 'ember.json')), { timeout: 5_000 })
    .toBe(true);
  expect(fs.existsSync(path.join(ember.userDataDir, 'logs'))).toBe(true);
});
