'use strict';

/**
 * Move the application clock from an e2e test.
 *
 * The calls go through the real `test:` IPC channels, so the test exercises the
 * same handler the app uses. `suspend(ms)` is added to this file by change 9,
 * once `src/main/power.js` has a resume handler to call.
 */

function unwrap(result, channel) {
  if (!result || result.ok !== true) {
    throw new Error(`${channel} failed: ${JSON.stringify(result)}`);
  }
  return result.value;
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string|Date} instant
 * @returns {Promise<string>} the clock value, as an ISO timestamp
 */
async function setClock(page, instant) {
  const iso = instant instanceof Date ? instant.toISOString() : String(instant);
  const result = await page.evaluate(
    (value) => /** @type {any} */ (window).ember.test.setClock(value),
    iso
  );
  return unwrap(result, 'test:setClock');
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {number} ms
 * @returns {Promise<string>} the clock value, as an ISO timestamp
 */
async function advanceClock(page, ms) {
  const result = await page.evaluate(
    (delta) => /** @type {any} */ (window).ember.test.advanceClock(delta),
    ms
  );
  return unwrap(result, 'test:advanceClock');
}

module.exports = { advanceClock, setClock };
