'use strict';

/**
 * The Windows application identity.
 *
 * A stable AppUserModelID is what lets the shell attribute a toast to Ember
 * instead of Electron. It must match `build.appId` in `electron-builder.yml`,
 * which the installer stamps onto the shortcut; a mismatch silently drops
 * notifications. A unit test reads both files and asserts they agree.
 */

const APP_USER_MODEL_ID = 'dev.sigmund.ember';

/**
 * Apply the identity. Safe to call more than once and on every platform: the
 * method is a no-op outside Windows.
 *
 * @param {{ setAppUserModelId?: (id: string) => void } | null | undefined} app
 * @returns {string} the identity that was applied
 */
function applyAppUserModelId(app) {
  if (app && typeof app.setAppUserModelId === 'function') {
    app.setAppUserModelId(APP_USER_MODEL_ID);
  }
  return APP_USER_MODEL_ID;
}

module.exports = { APP_USER_MODEL_ID, applyAppUserModelId };
