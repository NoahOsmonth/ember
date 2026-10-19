'use strict';

const { test, expect } = require('./helpers/fixtures');

/**
 * Renderer hardening, proven against the real Electron binary.
 *
 * The unit tests check the policy in isolation; these assertions read the
 * preferences Electron actually applied and watch the live page reject an
 * injected script, a new window and an external navigation.
 */

test('every window is created with the hardened web preferences', async ({ ember }) => {
  await expect.poll(() => ember.app.windows().length).toBe(2);

  const preferences = await ember.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((win) => win.webContents.getLastWebPreferences())
  );

  expect(preferences).toHaveLength(2);
  for (const prefs of preferences) {
    expect(prefs.sandbox).toBe(true);
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.nodeIntegration).toBe(false);
    expect(prefs.webviewTag).toBe(false);
  }
});

test('the CSP blocks an inline script added at runtime', async ({ ember }) => {
  const result = await ember.page.evaluate(async () => {
    const view = /** @type {any} */ (window);
    const before = document.getElementById('digits').textContent;
    view.__inlineRan = false;
    const script = document.createElement('script');
    script.textContent = 'window.__inlineRan = true';
    document.head.appendChild(script);
    await new Promise((resolve) => setTimeout(resolve, 150));
    return {
      ran: view.__inlineRan,
      before,
      after: document.getElementById('digits').textContent,
    };
  });

  expect(result.ran).toBe(false);
  expect(result.after).toBe(result.before);
  expect(result.after).toMatch(/^\d{2}:\d{2}$/);
});

test('window.open is denied and external navigation is cancelled', async ({ ember }) => {
  const beforeUrl = ember.page.url();
  // The first run also opens the tutorial window; count only widget windows so
  // that window can never be mistaken for one opened by `window.open`.
  const widgets = () =>
    ember.app.evaluate(
      ({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().filter((win) => win.webContents.getURL().includes('/widget/'))
          .length
    );
  const beforeCount = await widgets();

  await ember.page.evaluate(() => {
    window.open('https://example.com');
  });
  await ember.page.waitForTimeout(500);

  expect(await widgets()).toBe(beforeCount);

  // Schedule the assignment so `evaluate` itself does not become a navigation
  // the harness waits on; the main process cancels it via `will-navigate`.
  await ember.page.evaluate(() => {
    setTimeout(() => {
      window.location.href = 'https://example.com/';
    }, 0);
  });
  await ember.page.waitForTimeout(600);

  // Playwright keeps a cancelled navigation in its "navigating" state forever,
  // so inspect the surviving document through the main process instead.
  const after = await ember.app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((entry) =>
      entry.webContents.getURL().includes('/widget/')
    );
    return {
      url: win.webContents.getURL(),
      digits: await win.webContents.executeJavaScript(
        "(document.querySelector('#digits') || {}).textContent || ''"
      ),
    };
  });
  expect(after.url).toBe(beforeUrl);
  expect(after.digits).toMatch(/^\d{2}:\d{2}$/);
});
