'use strict';

const { test, expect } = require('@playwright/test');
const { MAX_DIFF_PIXEL_RATIO } = require('./tolerance');

const SCALINGS = [1, 1.25, 1.5];
const STATES = ['idle', 'running', 'paused'];
const THEMES = ['dusk', 'mono'];

test.describe('widget visual matrix', () => {
  const canRun = process.platform === 'win32' || process.env.EMBER_VISUAL_FORCE === '1';
  test.skip(!canRun, 'visual baselines are Windows-only');
  test.use({ viewport: { width: 340, height: 96 } });

  for (const scale of SCALINGS) {
    test.describe(`widget at ${scale}x`, () => {
      test.use({ deviceScaleFactor: scale });

      for (const state of STATES) {
        for (const theme of THEMES) {
          test(`${state} in the ${theme} theme`, async ({ page }) => {
            await page.goto(`/test/visual/fixture-gallery.html?state=${state}&theme=${theme}`);
            await page.waitForFunction(() => document.body.dataset.ready === 'true');
            await page.evaluate(() => document.fonts.ready.then(() => true));

            await expect(page.locator('#app')).toHaveScreenshot(
              `widget-${theme}-${state}-${scale}x.png`,
              {
                animations: 'disabled',
                caret: 'hide',
                maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO,
              }
            );
          });
        }
      }
    });
  }
});
