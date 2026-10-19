'use strict';

/**
 * Move the application clock from an e2e test.
 *
 * The calls go through the real `test:` IPC channels, so the test exercises the
 * same handler the app uses. `suspend(ms)` is added to this file by change 9,
 * once `src/main/power.js` has a resume handler to call.
 */

/**
 * @param {import('@playwright/test').Page} page
 * @param {string|Date} instant
 * @returns {Promise<string>} the clock value, as an ISO timestamp
 */
async function setClock(page, instant) {
  const iso = instant instanceof Date ? instant.toISOString() : String(instant);
  return page.evaluate(
    (value) => /** @type {any} */ (window).ember.invokeTest('test:setClock', value),
    iso
  );
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {number} ms
 * @returns {Promise<string>} the clock value, as an ISO timestamp
 */
async function advanceClock(page, ms) {
  return page.evaluate(
    (delta) => /** @type {any} */ (window).ember.invokeTest('test:advanceClock', delta),
    ms
  );
}

module.exports = { advanceClock, setClock };
