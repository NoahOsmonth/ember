import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  clampToWorkArea,
  dockRight,
  nextScaleFactor,
  pickDisplay,
} from '../../../src/core/placement.js';

const rectArbitrary = fc.record({
  x: fc.integer({ min: -10_000, max: 10_000 }),
  y: fc.integer({ min: -10_000, max: 10_000 }),
  width: fc.integer({ min: 1, max: 4_000 }),
  height: fc.integer({ min: 1, max: 4_000 }),
});

const workAreaArbitrary = fc.record({
  x: fc.integer({ min: -5_000, max: 5_000 }),
  y: fc.integer({ min: -5_000, max: 5_000 }),
  width: fc.integer({ min: 1, max: 4_000 }),
  height: fc.integer({ min: 1, max: 4_000 }),
});

const inside = (rect, area) =>
  rect.x >= area.x &&
  rect.y >= area.y &&
  rect.x + rect.width <= area.x + area.width &&
  rect.y + rect.height <= area.y + area.height;

describe('clampToWorkArea', () => {
  it('always lands fully inside the work area', () => {
    fc.assert(
      fc.property(rectArbitrary, workAreaArbitrary, (bounds, area) => {
        expect(inside(clampToWorkArea(bounds, area), area)).toBe(true);
      })
    );
  });

  it('never grows the input', () => {
    fc.assert(
      fc.property(rectArbitrary, workAreaArbitrary, (bounds, area) => {
        const result = clampToWorkArea(bounds, area);
        expect(result.width).toBeLessThanOrEqual(bounds.width);
        expect(result.height).toBeLessThanOrEqual(bounds.height);
      })
    );
  });

  it('is a fixed point for rectangles already inside', () => {
    fc.assert(
      fc.property(rectArbitrary, workAreaArbitrary, (bounds, area) => {
        const first = clampToWorkArea(bounds, area);
        expect(clampToWorkArea(first, area)).toEqual(first);
      })
    );
  });

  it('keeps a rectangle that is already inside untouched', () => {
    fc.assert(
      fc.property(workAreaArbitrary, (area) => {
        const insideRect = { x: area.x, y: area.y, width: area.width, height: area.height };
        expect(clampToWorkArea(insideRect, area)).toEqual(insideRect);
      })
    );
  });

  it('pins a window larger than the area to the area origin', () => {
    const area = { x: 100, y: 200, width: 800, height: 600 };
    expect(clampToWorkArea({ x: -50, y: -50, width: 1_000, height: 900 }, area)).toEqual({
      x: 100,
      y: 200,
      width: 800,
      height: 600,
    });
  });

  it('falls back to an empty rectangle for invalid input', () => {
    expect(clampToWorkArea(null, { x: 0, y: 0, width: 10, height: 10 })).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });
});

describe('dockRight', () => {
  it('keeps the right edge on the work area edge', () => {
    fc.assert(
      fc.property(rectArbitrary, workAreaArbitrary, (bounds, area) => {
        const result = dockRight(bounds, area);
        expect(inside(result, area)).toBe(true);
        if (bounds.width <= area.width) {
          expect(result.x + result.width).toBe(area.x + area.width);
        }
        expect(result.y).toBe(clampToWorkArea(bounds, area).y);
      })
    );
  });

  it('docks a normal widget to the right of the primary area', () => {
    expect(
      dockRight(
        { x: 20, y: 30, width: 340, height: 96 },
        { x: 0, y: 0, width: 1_920, height: 1_040 }
      )
    ).toEqual({
      x: 1_580,
      y: 30,
      width: 340,
      height: 96,
    });
  });
});

describe('nextScaleFactor', () => {
  it('stays in (0, 1] and makes the scaled rectangle fit', () => {
    fc.assert(
      fc.property(rectArbitrary, workAreaArbitrary, (bounds, area) => {
        const factor = nextScaleFactor(bounds, area);
        expect(factor).toBeGreaterThan(0);
        expect(factor).toBeLessThanOrEqual(1);
        expect(bounds.width * factor).toBeLessThanOrEqual(area.width + 1e-9);
        expect(bounds.height * factor).toBeLessThanOrEqual(area.height + 1e-9);
      })
    );
  });

  it('is exactly 1 when the rectangle already fits', () => {
    const area = { x: 0, y: 0, width: 1_920, height: 1_040 };
    expect(nextScaleFactor({ x: 0, y: 0, width: 340, height: 96 }, area)).toBe(1);
  });

  it('shrinks to the limiting axis', () => {
    const area = { x: 0, y: 0, width: 800, height: 600 };
    expect(nextScaleFactor({ x: 0, y: 0, width: 1_600, height: 600 }, area)).toBe(0.5);
    expect(nextScaleFactor({ x: 0, y: 0, width: 800, height: 1_200 }, area)).toBe(0.5);
  });

  it('returns 1 for invalid or degenerate input', () => {
    expect(nextScaleFactor(null, null)).toBe(1);
    expect(
      nextScaleFactor({ x: 0, y: 0, width: 0, height: 10 }, { x: 0, y: 0, width: 10, height: 10 })
    ).toBe(1);
    expect(
      nextScaleFactor({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 0, height: 10 })
    ).toBe(1);
  });
});

describe('pickDisplay', () => {
  const primary = { id: 1, workArea: { x: 0, y: 0, width: 1_920, height: 1_040 }, isPrimary: true };
  const secondary = { id: 2, workArea: { x: 1_920, y: 0, width: 1_280, height: 1_024 } };

  it('returns the display with the saved id when it is present', () => {
    expect(pickDisplay([primary, secondary], { x: 0, y: 0, displayId: 2 })).toBe(secondary);
  });

  it('falls back to the primary display when the saved id is absent', () => {
    expect(pickDisplay([secondary, primary], { x: 0, y: 0, displayId: 99 })).toBe(primary);
    expect(pickDisplay([secondary, primary], { x: 0, y: 0, displayId: null })).toBe(primary);
    expect(pickDisplay([secondary, primary], null)).toBe(primary);
  });

  it('resolves duplicate ids to the first entry', () => {
    const duplicate = { id: 2, workArea: { x: 0, y: 0, width: 800, height: 600 } };
    expect(pickDisplay([duplicate, secondary], { x: 0, y: 0, displayId: 2 })).toBe(duplicate);
  });

  it('uses the first display when none is marked primary', () => {
    expect(pickDisplay([secondary, { id: 3, workArea: primary.workArea }], null)).toBe(secondary);
  });

  it('returns null for an empty list', () => {
    expect(pickDisplay([], { x: 0, y: 0, displayId: 1 })).toBeNull();
    expect(pickDisplay(null, null)).toBeNull();
  });
});
