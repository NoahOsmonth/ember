/**
 * Renderer-facing facade: re-exports the pure core modules and keeps only the
 * helpers that are genuinely renderer-local — the preset labels and the chime.
 *
 * Loaded as an ES module by both the widget and the settings window, so there
 * is exactly one palette and one ruler rule in the whole app.
 */
import { defaults } from '../../core/schema.js';

export { computeRuler, unitFor } from '../../core/ruler.js';
export { THEMES, barColor, resolveTheme, themeNames } from '../../core/themes.js';
export { MIN_CONTRAST, contrastRatio, themeContrast } from '../../core/contrast.js';
export { acceleratorFromCode } from '../../core/accelerators.js';

/** The document a fresh install starts from; the store owns validation. */
export const DEFAULTS = defaults;

/** Preset durations, with the labels the settings window shows. */
export const PRESETS = Object.freeze({
  classic: Object.freeze({ name: 'Classic', focus: 25, short: 5, long: 15 }),
  deep: Object.freeze({ name: 'Deep', focus: 50, short: 10, long: 30 }),
  sprint: Object.freeze({ name: 'Sprint', focus: 15, short: 3, long: 10 }),
  marathon: Object.freeze({ name: 'Marathon', focus: 90, short: 20, long: 30 }),
});

let audioContext;
/**
 * Play the end-of-phase chime. Renderer-only: it needs WebAudio, and every
 * failure (no device, blocked autoplay) is swallowed so a missing chime can
 * never break the timer.
 *
 * @param {string} was the phase that just finished
 * @param {number} [volume] 0..1
 */
export function chime(was, volume = 0.6) {
  try {
    audioContext = audioContext || new AudioContext();
    const t = audioContext.currentTime;
    const peak = Math.max(0.01, 0.3 * volume);
    (was === 'focus' ? [523.25, 659.25, 783.99] : [783.99, 587.33]).forEach((f, i) => {
      const o = audioContext.createOscillator();
      const g = audioContext.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.16);
      g.gain.exponentialRampToValueAtTime(peak, t + i * 0.16 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 1.3);
      o.connect(g).connect(audioContext.destination);
      o.start(t + i * 0.16);
      o.stop(t + i * 0.16 + 1.4);
    });
  } catch {}
}
