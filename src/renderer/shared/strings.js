/**
 * Every string the renderers write at runtime.
 *
 * Static markup keeps its own labels in HTML; anything assembled in JavaScript
 * comes from here so both windows agree on wording and a future translation has
 * one place to start.
 */

export const STRINGS = Object.freeze({
  ready: 'ready',
  paused: 'paused',
  phases: Object.freeze({ focus: 'focus', short: 'short break', long: 'long break' }),
  commandFailed: 'command failed',
  settingsReset: 'settings reset',
  clickThrough: 'click-through',
  phaseEndedWhileAway: 'a phase ended while away',
  focusDoneTitle: 'Focus round done',
  focusDoneBody: 'Time for a break.',
  breakOverTitle: 'Break over',
  breakOverBody: 'Ready for the next focus round.',
  lockOn: 'On',
  lockOff: 'Turn on',
  autoPlayOn: 'Auto-play on',
  autoPlayOff: 'Auto-play off',
  shortcuts: Object.freeze({
    active: 'works',
    unavailable: 'taken by another app',
    invalid: 'not a valid combination',
    reserved: 'reserved by Windows',
    disabled: 'off in safe mode',
    conflict: (label) => `also used by ${label}`,
    capture: 'Press keys…',
    captureHint: 'Esc cancels',
    needsModifier: 'add Ctrl, Alt or Shift',
    save: 'Save',
    cancel: 'Cancel',
    change: 'Change',
    recheck: 'Re-check',
  }),
  ends: (time) => `ends ${time}`,
  glass: (percent) => `glass ${percent}%`,
  percent: (value) => `${value}%`,
  presetSummary: (preset) => `${preset.focus} / ${preset.short} / ${preset.long}`,
  stepLabel: (index, title) => `Step ${index + 1}: ${title}`,
  tutorial: Object.freeze([
    Object.freeze({
      title: 'Click to start',
      text: 'Click the time or press Space. Breaks start on their own, and the next focus round waits for you.',
    }),
    Object.freeze({
      title: 'Hover for controls',
      text: 'Pause, skip, reset and settings fade in when your mouse is on the widget.',
    }),
    Object.freeze({
      title: 'Drag it anywhere',
      text: 'Hold the glass and move it. Ember remembers where you left it.',
    }),
    Object.freeze({
      title: 'Scroll to set the glass',
      text: 'Scroll over the widget to make it more or less see-through.',
    }),
    Object.freeze({
      title: 'Right-click for more',
      text: 'Compact size, click-through, launch at login and settings are one click away.',
    }),
    Object.freeze({
      title: 'Shortcuts work from any app',
      text: 'Start, hide and click-through without leaving what you are doing.',
    }),
  ]),
});

/**
 * @param {string} phase
 * @returns {string}
 */
export function phaseLabel(phase) {
  return STRINGS.phases[phase] || phase;
}

/**
 * The line under the digits: ready, paused, or the phase name.
 *
 * @param {'ready' | 'running' | 'paused'} mode
 * @param {string} phase
 * @returns {string}
 */
export function statusLabel(mode, phase) {
  if (mode === 'paused') return STRINGS.paused;
  if (mode === 'ready') return phase === 'focus' ? STRINGS.ready : phaseLabel(phase);
  return phaseLabel(phase);
}
