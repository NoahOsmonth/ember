'use strict';

const { test, expect } = require('@playwright/test');
const { MAX_DIFF_PIXEL_RATIO } = require('./tolerance');

const THEMES = ['dusk', 'mono'];

test.describe('settings visual matrix', () => {
  const canRun = process.platform === 'win32' || process.env.EMBER_VISUAL_FORCE === '1';
  test.skip(!canRun, 'visual baselines are Windows-only');
  test.use({ viewport: { width: 460, height: 640 } });

  for (const theme of THEMES) {
    test(`settings window in the ${theme} theme`, async ({ page }) => {
      await page.goto('/src/renderer/settings/index.html');
      await page.addStyleTag({ content: 'html,body{background:#1b1f27 !important;}' });
      await page.waitForSelector('#themes .s-theme');
      await page.locator(`#themes .s-theme[data-id="${theme}"]`).click();
      await expect(page.locator(`#themes .s-theme[data-id="${theme}"]`)).toHaveClass(/on/);
      await page.evaluate(() => document.fonts.ready.then(() => true));

      await expect(page.locator('#panel')).toHaveScreenshot(`settings-${theme}.png`, {
        animations: 'disabled',
        caret: 'hide',
        maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO,
      });
    });
  }
});
