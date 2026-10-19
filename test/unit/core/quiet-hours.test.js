import { describe, expect, it } from 'vitest';
import {
  isQuiet,
  normalizeClockTime,
  parseClockTime,
  shouldSignal,
} from '../../../src/core/quiet-hours.js';

/** A local-time Date, so the assertions do not depend on the machine's zone. */
const at = (hours, minutes = 0, seconds = 0) => new Date(2026, 0, 2, hours, minutes, seconds);

const overnight = { enabled: true, start: '22:00', end: '07:00' };
const daytime = { enabled: true, start: '09:00', end: '17:00' };

describe('clock parsing', () => {
  it('parses HH:MM and H:MM into minutes after midnight', () => {
    expect(parseClockTime('00:00')).toBe(0);
    expect(parseClockTime('07:30')).toBe(450);
    expect(parseClockTime('7:05')).toBe(425);
    expect(parseClockTime('23:59')).toBe(1439);
  });

  it('rejects anything that is not a clock time', () => {
    for (const value of [null, undefined, 7, '', '24:00', '12:60', 'noon', '1:2:3']) {
      expect(parseClockTime(value)).toBeNull();
    }
  });

  it('canonicalizes the padding without changing the instant', () => {
    expect(normalizeClockTime('7:05')).toBe('07:05');
    expect(normalizeClockTime('22:00')).toBe('22:00');
    expect(normalizeClockTime('nope')).toBeNull();
  });
});

describe('isQuiet', () => {
  it('is never quiet when the window is disabled', () => {
    expect(isQuiet(at(23), { ...overnight, enabled: false })).toBe(false);
    expect(isQuiet(at(12), { ...daytime, enabled: false })).toBe(false);
    expect(isQuiet(at(12), null)).toBe(false);
    expect(isQuiet(at(12), {})).toBe(false);
  });

  it('covers a window that does not cross midnight', () => {
    expect(isQuiet(at(9), daytime)).toBe(true);
    expect(isQuiet(at(12, 30), daytime)).toBe(true);
    expect(isQuiet(at(16, 59), daytime)).toBe(true);
    expect(isQuiet(at(8, 59), daytime)).toBe(false);
    expect(isQuiet(at(17), daytime)).toBe(false);
    expect(isQuiet(at(23), daytime)).toBe(false);
  });

  it('covers a window that crosses midnight', () => {
    expect(isQuiet(at(22), overnight)).toBe(true);
    expect(isQuiet(at(23, 30), overnight)).toBe(true);
    expect(isQuiet(at(0), overnight)).toBe(true);
    expect(isQuiet(at(2, 30), overnight)).toBe(true);
    expect(isQuiet(at(6, 59), overnight)).toBe(true);
    expect(isQuiet(at(7), overnight)).toBe(false);
    expect(isQuiet(at(12), overnight)).toBe(false);
    expect(isQuiet(at(21, 59), overnight)).toBe(false);
  });

  it('treats the start as inclusive and the end as exclusive', () => {
    expect(isQuiet(at(22, 0, 0), overnight)).toBe(true);
    expect(isQuiet(at(7, 0, 0), overnight)).toBe(false);
    expect(isQuiet(at(9, 0, 0), daytime)).toBe(true);
    expect(isQuiet(at(17, 0, 0), daytime)).toBe(false);
    // Seconds inside the final minute do not extend the window past its end.
    expect(isQuiet(at(16, 59, 59), daytime)).toBe(true);
  });

  it('treats an empty or malformed window as never quiet', () => {
    expect(isQuiet(at(12), { enabled: true, start: '09:00', end: '09:00' })).toBe(false);
    expect(isQuiet(at(12), { enabled: true, start: 'nope', end: '17:00' })).toBe(false);
    expect(isQuiet(at(12), { enabled: true, start: '09:00', end: undefined })).toBe(false);
  });

  it('accepts epoch milliseconds and rejects an invalid date', () => {
    expect(isQuiet(at(23).getTime(), overnight)).toBe(true);
    expect(isQuiet(new Date(Number.NaN), overnight)).toBe(false);
  });
});

describe('shouldSignal', () => {
  const noon = at(12);
  const enabled = { notify: true, sound: true, doNotDisturb: false, quietHours: overnight };

  it('allows both signals by default', () => {
    expect(shouldSignal(noon, enabled, false)).toEqual({ toast: true, chime: true });
    expect(shouldSignal(noon, {}, false)).toEqual({ toast: true, chime: true });
    expect(shouldSignal(noon, undefined, false)).toEqual({ toast: true, chime: true });
  });

  it('suppresses the toast but keeps the chime while the widget is focused', () => {
    expect(shouldSignal(noon, enabled, true)).toEqual({ toast: false, chime: true });
  });

  it('treats notify as the master switch', () => {
    expect(shouldSignal(noon, { ...enabled, notify: false }, false)).toEqual({
      toast: false,
      chime: false,
    });
  });

  it('lets sound disable only the chime', () => {
    expect(shouldSignal(noon, { ...enabled, sound: false }, false)).toEqual({
      toast: true,
      chime: false,
    });
  });

  it('silences both signals for do-not-disturb', () => {
    expect(shouldSignal(noon, { ...enabled, doNotDisturb: true }, false)).toEqual({
      toast: false,
      chime: false,
    });
  });

  it('silences both signals inside the quiet window', () => {
    expect(shouldSignal(at(2, 30), enabled, false)).toEqual({ toast: false, chime: false });
    expect(shouldSignal(noon, enabled, false)).toEqual({ toast: true, chime: true });
  });

  it('keeps the chime off while quiet even if the widget is focused', () => {
    expect(shouldSignal(at(23), enabled, true)).toEqual({ toast: false, chime: false });
  });
});
