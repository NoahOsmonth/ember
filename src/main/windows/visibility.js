'use strict';

/**
 * Window reachability (capability: tray-recovery).
 *
 * A frameless window with `skipTaskbar: true` can end up on a display that no
 * longer exists, or outside every work area after a resolution change. Nothing
 * in the operating system brings it back, so the app treats reachability as a
 * periodic invariant: if no display shows any part of the window, it is moved
 * into the primary display's work area.
 */

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 * @typedef {{ workArea: Rect, isPrimary?: boolean }} DisplayLike
 * @typedef {{
 *   getBounds: () => Rect,
 *   setBounds: (bounds: Rect) => void,
 *   isDestroyed?: () => boolean
 * }} WindowLike
 */

/**
 * Area shared by two rectangles; zero when they do not overlap.
 *
 * @param {Rect} a
 * @param {Rect} b
 * @returns {number}
 */
function intersectionArea(a, b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * True when at least one display shows part of the bounds.
 *
 * @param {Rect} bounds
 * @param {DisplayLike[]} displays
 * @returns {boolean}
 */
function isReachable(bounds, displays) {
  return displays.some((display) => intersectionArea(bounds, display.workArea) > 0);
}

/**
 * The closest rectangle inside `area` that keeps the original size when it
 * fits, and is shrunk when the work area is smaller than the window.
 *
 * @param {Rect} bounds
 * @param {Rect} area
 * @returns {Rect}
 */
function reachableBounds(bounds, area) {
  const areaWidth = Math.max(1, Math.round(area.width));
  const areaHeight = Math.max(1, Math.round(area.height));
  const width = Math.max(1, Math.min(Math.round(bounds.width), areaWidth));
  const height = Math.max(1, Math.min(Math.round(bounds.height), areaHeight));
  const maxX = area.x + areaWidth - width;
  const maxY = area.y + areaHeight - height;
  return {
    x: Math.min(Math.max(Math.round(bounds.x), area.x), maxX),
    y: Math.min(Math.max(Math.round(bounds.y), area.y), maxY),
    width,
    height,
  };
}

/**
 * Move every unreachable window into the primary display's work area.
 *
 * @param {WindowLike[] | WindowLike | null} windows
 * @param {DisplayLike[] | null} displays
 * @returns {Array<{ window: WindowLike, bounds: Rect }>} the windows that moved
 */
function ensureReachable(windows, displays) {
  const list = Array.isArray(windows) ? windows : windows ? [windows] : [];
  if (!Array.isArray(displays) || displays.length === 0) return [];
  const usable = displays.filter((display) => display && display.workArea);
  if (usable.length === 0) return [];
  const primary = usable.find((display) => display.isPrimary) || usable[0];

  const moved = [];
  for (const win of list) {
    if (!win || typeof win.getBounds !== 'function' || typeof win.setBounds !== 'function')
      continue;
    if (typeof win.isDestroyed === 'function' && win.isDestroyed()) continue;
    const bounds = win.getBounds();
    if (
      !bounds ||
      !Number.isFinite(bounds.x) ||
      !Number.isFinite(bounds.y) ||
      !Number.isFinite(bounds.width) ||
      !Number.isFinite(bounds.height)
    ) {
      continue;
    }
    if (isReachable(bounds, usable)) continue;
    const next = reachableBounds(bounds, primary.workArea);
    win.setBounds(next);
    moved.push({ window: win, bounds: next });
  }
  return moved;
}

module.exports = { ensureReachable, intersectionArea, isReachable, reachableBounds };
