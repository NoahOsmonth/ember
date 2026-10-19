'use strict';

/**
 * One tolerance for every visual case. Small enough to catch a moved element,
 * large enough to absorb anti-aliasing differences between the same Windows
 * build. Changing it is a reviewed change, not a per-case tweak.
 */
const MAX_DIFF_PIXEL_RATIO = 0.002;

module.exports = { MAX_DIFF_PIXEL_RATIO };
