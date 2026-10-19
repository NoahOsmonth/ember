'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('@playwright/test');

const FIRST_SNAPSHOT_TIMEOUT = 20_000;

/**
 * Launch the real application against a throwaway profile.
 *
 * Test mode (the default) sets EMBER_TEST=1 and EMBER_USER_DATA, which makes the
 * app use the temporary directory for both the settings file and the log. Pass
 * `testMode: false` to launch the release configuration; the temporary profile
 * is then supplied through Chromium's `--user-data-dir` switch, so even that
 * launch cannot touch the developer's real profile.
 *
 * @param {{ testMode?: boolean, env?: Record<string, string>, userDataDir?: string }} [options]
 * @returns {Promise<{ app: any, page: any, userDataDir: string, close: (options?: { keep?: boolean }) => Promise<void>, attach: (testInfo: any) => Promise<void> }>}
 */
async function launchEmber({ testMode = true, env = {}, userDataDir: providedDir } = {}) {
  const userDataDir = providedDir || fs.mkdtempSync(path.join(os.tmpdir(), 'ember-e2e-'));
  const baseEnv = { ...process.env };
  delete baseEnv.EMBER_TEST;
  delete baseEnv.EMBER_USER_DATA;

  const args = ['.'];
  if (testMode) {
    baseEnv.EMBER_TEST = '1';
    baseEnv.EMBER_USER_DATA = userDataDir;
  } else {
    args.push(`--user-data-dir=${userDataDir}`);
  }

  let app;
  try {
    app = await electron.launch({ args, env: { ...baseEnv, ...env } });
    const page = await app.firstWindow();
    await page.waitForFunction(
      () => {
        const digits = document.querySelector('#digits');
        return !!digits && /^\d{2}:\d{2}$/.test((digits.textContent || '').trim());
      },
      null,
      { timeout: FIRST_SNAPSHOT_TIMEOUT }
    );

    let closed = false;
    const close = async ({ keep = false } = {}) => {
      if (closed) return;
      closed = true;
      if (app) {
        try {
          await app.close();
        } catch {
          /* the process may already be gone */
        }
      }
      if (!keep && process.env.KEEP_PROFILE !== '1') {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    };

    const attach = async (testInfo) => {
      const logFile = path.join(userDataDir, 'logs', 'ember.log');
      const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '(no main log)';
      await testInfo.attach('ember.log', { body: log, contentType: 'text/plain' });
      await testInfo.attach('profile-directory', {
        body: userDataDir,
        contentType: 'text/plain',
      });
    };

    return { app, page, userDataDir, close, attach };
  } catch (error) {
    const logFile = path.join(userDataDir, 'logs', 'ember.log');
    const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '(no main log)';
    if (app) {
      try {
        await app.close();
      } catch {
        /* the process may already be gone */
      }
    }
    if (process.env.KEEP_PROFILE !== '1') {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
    throw new Error(`${error.message}\n--- main log (${userDataDir}) ---\n${log}`, {
      cause: error,
    });
  }
}

module.exports = { launchEmber };
