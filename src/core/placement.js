/**
 * Window placement arithmetic.
 *
 * Pure ESM module: no Electron, no DOM, no filesystem. Bounds and work areas
 * are plain `{ x, y, width, height }` objects in DIPs, which is the unit both
 * `screen.getCursorScreenPoint()` and `BrowserWindow.setBounds()` use.
 *
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 * @typedef {{ id: number, workArea: Rect, scaleFactor?: number, isPrimary?: boolean }} Display
 * @typedef {{ x: number, y: number, displayId?: number | null }} SavedPlacement
 */

/**
 * @param {unknown} value
 * @returns {value is Rect}
 */
function isRect(value) {
  if (typeof value !== 'object' || value === null) return false;
  const rect = /** @type {any} */ (value);
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height)
  );
}

/**
 * The largest factor at or below 1 that makes `bounds` fit inside `workArea`.
 *
 * A saved window can be larger than the work area of the display it lands on
 * (a 340 DIP widget is fine, a persisted custom size on a small laptop screen
 * may not be). Invalid input yields 1 so callers can multiply unconditionally.
 *
 * @param {Rect} bounds
 * @param {Rect} workArea
 * @returns {number} a factor in (0, 1]
 */
export function nextScaleFactor(bounds, workArea) {
  if (!isRect(bounds) || !isRect(workArea)) return 1;
  if (bounds.width <= 0 || bounds.height <= 0) return 1;
  if (workArea.width <= 0 || workArea.height <= 0) return 1;
  return Math.min(1, workArea.width / bounds.width, workArea.height / bounds.height);
}

/**
 * Clamp a window rectangle so it sits fully inside one work area.
 *
 * The result is never larger than the input: a window bigger than the work
 * area shrinks to the area. A rectangle already inside is returned unchanged.
 *
 * @param {Rect} bounds
 * @param {Rect} workArea
 * @returns {Rect}
 */
export function clampToWorkArea(bounds, workArea) {
  if (!isRect(bounds) || !isRect(workArea)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;
  return {
    x: Math.min(Math.max(bounds.x, workArea.x), maxX),
    y: Math.min(Math.max(bounds.y, workArea.y), maxY),
    width,
    height,
  };
}

/**
 * Move a window to the right edge of a work area, keeping its vertical place
 * and clamping it when it is taller than the area.
 *
 * @param {Rect} bounds
 * @param {Rect} workArea
 * @returns {Rect}
 */
export function dockRight(bounds, workArea) {
  if (!isRect(bounds) || !isRect(workArea)) return clampToWorkArea(bounds, workArea);
  return clampToWorkArea(
    {
      x: workArea.x + workArea.width - bounds.width,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    },
    workArea
  );
}

/**
 * Choose the display a saved placement belongs to.
 *
 * A present `displayId` wins. Otherwise the primary display is the fallback,
 * so a stale absolute position from a different monitor never decides where
 * the window appears. Duplicate ids resolve to the first entry.
 *
 * @param {Display[]} displays
 * @param {SavedPlacement | null | undefined} saved
 * @returns {Display | null}
 */
export function pickDisplay(displays, saved) {
  if (!Array.isArray(displays) || displays.length === 0) return null;
  const wanted = saved && Number.isInteger(saved.displayId) ? saved.displayId : null;
  if (wanted !== null) {
    const match = displays.find((display) => display && display.id === wanted);
    if (match) return match;
  }
  return displays.find((display) => display && display.isPrimary) || displays[0] || null;
}
