'use strict';

/**
 * Window constructors.
 *
 * The window modules live under `windows/`; this barrel is the single import
 * site for the main process, so a new window type is added here once.
 */

const { createWidgetWindow } = require('./windows/widget-window');
const { createSettingsWindow } = require('./windows/settings-window');
const { ensureReachable } = require('./windows/visibility');

module.exports = { createWidgetWindow, createSettingsWindow, ensureReachable };
