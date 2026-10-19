/**
 * Accelerator parsing and the reserved-combination policy.
 *
 * Pure ESM: the settings schema uses it to validate a stored document, the main
 * process uses it to compare and canonicalize bindings, and the settings window
 * uses it to turn a captured keydown into the same string. One parser keeps
 * those three from disagreeing.
 */

/** Canonical modifier names, in the order an accelerator is written. */
const MODIFIER_ORDER = Object.freeze(['Control', 'Alt', 'Shift', 'Super']);

/** Aliases accepted on input. `CommandOrControl` is Control on Windows. */
const MODIFIER_ALIASES = new Map([
  ['control', 'Control'],
  ['ctrl', 'Control'],
  ['commandorcontrol', 'Control'],
  ['alt', 'Alt'],
  ['shift', 'Shift'],
  ['super', 'Super'],
  ['meta', 'Super'],
  ['cmd', 'Super'],
  ['command', 'Super'],
]);

/** Named keys, keyed by their lowercase input spelling. */
const NAMED_KEYS = new Map([
  ['space', 'Space'],
  ['tab', 'Tab'],
  ['enter', 'Enter'],
  ['return', 'Enter'],
  ['backspace', 'Backspace'],
  ['delete', 'Delete'],
  ['insert', 'Insert'],
  ['home', 'Home'],
  ['end', 'End'],
  ['pageup', 'PageUp'],
  ['pagedown', 'PageDown'],
  ['up', 'Up'],
  ['down', 'Down'],
  ['left', 'Left'],
  ['right', 'Right'],
  ['escape', 'Escape'],
  ['esc', 'Escape'],
  ['plus', 'Plus'],
  ['printscreen', 'PrintScreen'],
  ['volumeup', 'VolumeUp'],
  ['volumedown', 'VolumeDown'],
  ['volumemute', 'VolumeMute'],
  ['medianexttrack', 'MediaNextTrack'],
  ['mediaprevioustrack', 'MediaPreviousTrack'],
  ['mediastop', 'MediaStop'],
  ['mediaplaypause', 'MediaPlayPause'],
]);

/** Punctuation Electron accepts as a literal key token. */
const PUNCTUATION = new Set(['-', '=', '[', ']', '\\', ';', "'", ',', '.', '/', '`']);

/**
 * Combinations the operating system keeps for itself. The list is explicitly
 * incomplete: anything else falls through to the registration result.
 */
export const RESERVED_ACCELERATORS = Object.freeze([
  'Control+Alt+Delete',
  'Alt+Tab',
  'Alt+F4',
  'Control+Escape',
  'Control+Shift+Escape',
]);

const RESERVED = new Set(RESERVED_ACCELERATORS);

/**
 * @param {string} token
 * @returns {string|null} the canonical key token, or null when it is unknown
 */
function normalizeKey(token) {
  if (/^[a-z]$/i.test(token)) return token.toUpperCase();
  if (/^[0-9]$/.test(token)) return token;
  if (/^f(?:[1-9]|1[0-9]|2[0-4])$/i.test(token)) return token.toUpperCase();
  if (/^num[0-9]$/i.test(token)) return token.toLowerCase();
  const named = NAMED_KEYS.get(token.toLowerCase());
  if (named) return named;
  if (PUNCTUATION.has(token)) return token;
  return null;
}

/**
 * Parse an accelerator into its parts.
 *
 * @param {unknown} value
 * @returns {{ accelerator: string, modifiers: string[], key: string } | null}
 */
export function parseAccelerator(value) {
  if (typeof value !== 'string') return null;
  const parts = value.split('+').map((part) => part.trim());
  if (parts.length === 0 || parts.some((part) => part.length === 0)) return null;

  const key = normalizeKey(parts[parts.length - 1]);
  if (key === null) return null;

  const modifiers = new Set();
  for (const part of parts.slice(0, -1)) {
    const modifier = MODIFIER_ALIASES.get(part.toLowerCase());
    if (!modifier || modifiers.has(modifier)) return null;
    modifiers.add(modifier);
  }

  const ordered = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier));
  return {
    accelerator: [...ordered, key].join('+'),
    modifiers: ordered,
    key,
  };
}

/**
 * @param {unknown} value
 * @returns {string|null} the canonical spelling, or null when unparsable
 */
export function canonicalAccelerator(value) {
  const parsed = parseAccelerator(value);
  return parsed ? parsed.accelerator : null;
}

/**
 * @param {unknown} value an accelerator string or a parsed result
 * @returns {boolean}
 */
export function isReserved(value) {
  const parsed =
    typeof value === 'string'
      ? parseAccelerator(value)
      : /** @type {{ accelerator: string, modifiers: string[] } | null} */ (value);
  if (!parsed) return false;
  // The Windows key is owned by the shell, with or without another key.
  if (parsed.modifiers.includes('Super')) return true;
  return RESERVED.has(parsed.accelerator);
}

/**
 * Build an accelerator from a `KeyboardEvent`-shaped input.
 *
 * Returns null for a modifier-only press, so a capture field can wait for the
 * actual key. Pure so the settings window and the tests share one mapping.
 *
 * @param {string} code `KeyboardEvent.code`
 * @param {{ ctrlKey?: boolean, altKey?: boolean, shiftKey?: boolean, metaKey?: boolean }} event
 * @returns {string|null}
 */
export function acceleratorFromCode(code, event) {
  if (typeof code !== 'string' || !event) return null;

  let key = null;
  const letter = /^Key([A-Z])$/.exec(code);
  const digit = /^Digit([0-9])$/.exec(code);
  const numpad = /^Numpad([0-9])$/.exec(code);
  const functionKey = /^F(?:[1-9]|1[0-9]|2[0-4])$/.exec(code);
  const named = {
    Space: 'Space',
    Tab: 'Tab',
    Enter: 'Enter',
    NumpadEnter: 'Enter',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Escape: 'Escape',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backquote: '`',
    PrintScreen: 'PrintScreen',
    VolumeUp: 'VolumeUp',
    VolumeDown: 'VolumeDown',
    VolumeMute: 'VolumeMute',
    MediaNextTrack: 'MediaNextTrack',
    MediaPreviousTrack: 'MediaPreviousTrack',
    MediaStop: 'MediaStop',
    MediaPlayPause: 'MediaPlayPause',
  };

  if (letter) key = letter[1];
  else if (digit) key = digit[1];
  else if (numpad) key = `num${numpad[1]}`;
  else if (functionKey) key = code;
  else if (named[code]) key = named[code];
  if (!key) return null;

  const parts = [];
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Super');
  parts.push(key);
  return parts.join('+');
}
