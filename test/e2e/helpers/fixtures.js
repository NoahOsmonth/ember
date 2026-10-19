'use strict';

const base = require('@playwright/test');
const { launchEmber } = require('./launch');

/**
 * `ember` fixture: one isolated launch per test.
 *
 * A passing test removes its temporary profile. A failing test keeps it and
 * attaches the main log and the directory path, so the failure artifact carries
 * the evidence needed to reproduce it.
 */
const test = base.test.extend({
  // @ts-expect-error -- declared for runtime; consumers receive the untyped export below.
  // eslint-disable-next-line no-empty-pattern -- Playwright requires destructuring.
  ember: async ({}, use, testInfo) => {
    const instance = await launchEmber();
    await use(instance);
    if (testInfo.status !== testInfo.expectedStatus) {
      await instance.attach(testInfo);
      await instance.close({ keep: true });
    } else {
      await instance.close();
    }
  },
});

module.exports = { test: /** @type {any} */ (test), expect: base.expect };
