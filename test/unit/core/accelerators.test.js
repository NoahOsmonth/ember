import { describe, expect, it } from 'vitest';
import {
  RESERVED_ACCELERATORS,
  acceleratorFromCode,
  canonicalAccelerator,
  isReserved,
  parseAccelerator,
} from '../../../src/core/accelerators.js';

describe('accelerator parsing', () => {
  it('canonicalizes modifier order and aliases', () => {
    expect(canonicalAccelerator('ctrl+alt+p')).toBe('Control+Alt+P');
    expect(canonicalAccelerator('Alt+Control+Shift+F9')).toBe('Control+Alt+Shift+F9');
    expect(canonicalAccelerator('meta+space')).toBe('Super+Space');
    expect(canonicalAccelerator('CommandOrControl+L')).toBe('Control+L');
    expect(canonicalAccelerator('return')).toBe('Enter');
  });

  it('accepts named keys, function keys, numpad and punctuation', () => {
    for (const value of [
      'Control+Alt+Space',
      'Control+Alt+F24',
      'Control+num5',
      'Control+-',
      'Control+=',
      'Control+[',
      'Control+`',
      'Control+PrintScreen',
    ]) {
      expect(canonicalAccelerator(value)).toBe(value);
    }
  });

  it('rejects unparsable values instead of guessing', () => {
    for (const value of [
      '',
      'Banana',
      'Control+',
      '+P',
      'Control+Alt+Banana',
      'Control+Control+P',
      'Control++P',
      null,
      42,
      {},
    ]) {
      expect(parseAccelerator(value)).toBeNull();
      expect(canonicalAccelerator(value)).toBeNull();
    }
  });

  it('returns the parsed parts', () => {
    expect(parseAccelerator('Shift+Control+Space')).toEqual({
      accelerator: 'Control+Shift+Space',
      modifiers: ['Control', 'Shift'],
      key: 'Space',
    });
  });
});

describe('reserved combinations', () => {
  it('covers the documented list and every Windows-key binding', () => {
    for (const value of RESERVED_ACCELERATORS) expect(isReserved(value)).toBe(true);
    expect(isReserved('Super+Space')).toBe(true);
    expect(isReserved('Control+Super+L')).toBe(true);
  });

  it('leaves ordinary combinations alone', () => {
    expect(isReserved('Control+Alt+P')).toBe(false);
    expect(isReserved('Control+Alt+Shift+F9')).toBe(false);
    expect(isReserved('Banana')).toBe(false);
  });
});

describe('acceleratorFromCode', () => {
  it('maps letters, digits, function keys and named keys', () => {
    expect(acceleratorFromCode('KeyP', { ctrlKey: true, altKey: true })).toBe('Control+Alt+P');
    expect(acceleratorFromCode('Digit1', { ctrlKey: true })).toBe('Control+1');
    expect(acceleratorFromCode('F9', { ctrlKey: true, shiftKey: true })).toBe('Control+Shift+F9');
    expect(acceleratorFromCode('ArrowUp', { altKey: true })).toBe('Alt+Up');
    expect(acceleratorFromCode('Numpad3', { ctrlKey: true })).toBe('Control+num3');
    expect(acceleratorFromCode('Equal', { ctrlKey: true })).toBe('Control+=');
    expect(acceleratorFromCode('Minus', { ctrlKey: true })).toBe('Control+-');
    expect(acceleratorFromCode('Space', { metaKey: true })).toBe('Super+Space');
  });

  it('returns null for a modifier-only press or an unknown code', () => {
    expect(acceleratorFromCode('ControlLeft', { ctrlKey: true })).toBeNull();
    expect(acceleratorFromCode('Unidentified', { ctrlKey: true })).toBeNull();
    expect(acceleratorFromCode('KeyP', null)).toBeNull();
  });

  it('round-trips through the parser', () => {
    const accelerator = acceleratorFromCode('KeyJ', { ctrlKey: true, altKey: true });
    expect(canonicalAccelerator(accelerator)).toBe('Control+Alt+J');
  });
});
