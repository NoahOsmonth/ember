import { describe, expect, it, vi } from 'vitest';
import visibility from '../../../src/main/windows/visibility.js';

const { ensureReachable, intersectionArea, isReachable, reachableBounds } = visibility;

const primary = { id: 1, isPrimary: true, workArea: { x: 0, y: 0, width: 1_280, height: 720 } };
const secondary = { id: 2, workArea: { x: 1_280, y: 0, width: 1_920, height: 1_080 } };

function fakeWindow(bounds) {
  let current = { ...bounds };
  return {
    bounds: () => current,
    getBounds: () => ({ ...current }),
    setBounds: (next) => {
      current = { ...next };
    },
  };
}

describe('intersectionArea', () => {
  it('measures the shared rectangle', () => {
    expect(
      intersectionArea({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })
    ).toBe(25);
  });

  it('returns zero for a touching or separate rectangle', () => {
    expect(
      intersectionArea(
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 10, y: 0, width: 10, height: 10 }
      )
    ).toBe(0);
    expect(
      intersectionArea(
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 40, y: 40, width: 10, height: 10 }
      )
    ).toBe(0);
  });
});

describe('isReachable', () => {
  it('accepts any visible part of any display', () => {
    const displays = [primary, secondary];
    expect(isReachable({ x: 1_279, y: 10, width: 340, height: 96 }, displays)).toBe(true);
    expect(isReachable({ x: 1_500, y: 500, width: 340, height: 96 }, displays)).toBe(true);
  });

  it('rejects a window outside every work area', () => {
    expect(isReachable({ x: 5_000, y: 5_000, width: 340, height: 96 }, [primary])).toBe(false);
  });
});

describe('reachableBounds', () => {
  it('keeps a fitting window at its size and clamps it inside', () => {
    expect(reachableBounds({ x: -500, y: 900, width: 340, height: 96 }, primary.workArea)).toEqual({
      x: 0,
      y: 624,
      width: 340,
      height: 96,
    });
  });

  it('shrinks a window larger than the work area', () => {
    expect(reachableBounds({ x: 0, y: 0, width: 2_000, height: 2_000 }, primary.workArea)).toEqual({
      x: 0,
      y: 0,
      width: 1_280,
      height: 720,
    });
  });
});

describe('ensureReachable', () => {
  it('leaves a reachable window untouched', () => {
    const win = fakeWindow({ x: 100, y: 100, width: 340, height: 96 });
    const setBounds = vi.spyOn(win, 'setBounds');
    expect(ensureReachable([win], [primary])).toEqual([]);
    expect(setBounds).not.toHaveBeenCalled();
  });

  it('moves an off-screen window into the primary work area', () => {
    const win = fakeWindow({ x: 9_000, y: 9_000, width: 340, height: 96 });
    const moved = ensureReachable([win], [primary, secondary]);
    expect(moved).toHaveLength(1);
    expect(moved[0].bounds).toEqual({ x: 940, y: 624, width: 340, height: 96 });
    expect(win.bounds()).toEqual({ x: 940, y: 624, width: 340, height: 96 });
  });

  it('uses the display marked primary when several are available', () => {
    const win = fakeWindow({ x: -4_000, y: -4_000, width: 340, height: 96 });
    ensureReachable(win, [secondary, primary]);
    expect(win.bounds()).toEqual({ x: 0, y: 0, width: 340, height: 96 });
  });

  it('skips destroyed, malformed and non-finite windows', () => {
    const destroyed = {
      ...fakeWindow({ x: 9_000, y: 9_000, width: 1, height: 1 }),
      isDestroyed: () => true,
    };
    const malformed = { getBounds: () => null, setBounds: () => {} };
    const nonFinite = fakeWindow({ x: Number.NaN, y: 0, width: 340, height: 96 });
    expect(ensureReachable([destroyed, malformed, nonFinite, null], [primary])).toEqual([]);
  });

  it('does nothing without displays', () => {
    const win = fakeWindow({ x: 9_000, y: 9_000, width: 340, height: 96 });
    expect(ensureReachable([win], [])).toEqual([]);
    expect(ensureReachable([win], null)).toEqual([]);
    expect(win.bounds().x).toBe(9_000);
  });
});
