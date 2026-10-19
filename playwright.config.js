const { defineConfig } = require('@playwright/test');
const { MAX_DIFF_PIXEL_RATIO } = require('./test/visual/tolerance');

/**
 * Playwright configuration.
 *
 * `e2e` launches the real Electron binary. `visual` loads the fixture gallery
 * in Chromium and compares committed baselines. Both run one worker at a time:
 * the app takes a single-instance lock, and a serial run keeps screenshots
 * comparable.
 */
module.exports = defineConfig({
  timeout: 60_000,
  retries: 1,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node test/visual/server.js',
    url: 'http://127.0.0.1:4173/test/visual/fixture-gallery.html',
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO },
  },
  projects: [
    {
      name: 'e2e',
      testDir: './test/e2e',
    },
    {
      name: 'visual',
      testDir: './test/visual',
      use: {
        baseURL: 'http://127.0.0.1:4173',
      },
    },
  ],
});
