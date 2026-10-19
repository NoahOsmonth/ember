const { defineConfig } = require('@playwright/test');

/**
 * End-to-end configuration.
 *
 * The suite launches the real Electron binary (see test/e2e/smoke.spec.js) rather
 * than a browser, so there are no browser projects here. Tests run one at a time
 * because they share the desktop and the user profile.
 */
module.exports = defineConfig({
  testDir: './test/e2e',
  timeout: 30_000,
  retries: 1,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'on-first-retry',
  },
});
