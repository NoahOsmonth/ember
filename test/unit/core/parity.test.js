import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeRuler } from '../../../src/core/ruler.js';
import { THEMES, barColor } from '../../../src/core/themes.js';
import { PRESETS } from '../../../src/renderer/shared/common.js';

/**
 * The fixture in test/fixtures/parity.json was recorded from the implementation
 * this change replaced (window.EmberCommon plus the widget's inline geometry).
 * Every comparison here is "identical string / identical fill", so a visual
 * change cannot slip through as a refactor.
 */
const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'test/fixtures/parity.json'), 'utf8')
);
const plain = (value) => JSON.parse(JSON.stringify(value));

describe('palette parity', () => {
  it('keeps the recorded palette table', () => {
    expect(plain(THEMES)).toEqual(fixture.themes);
  });

  it('keeps the recorded preset labels and durations', () => {
    expect(plain(PRESETS)).toEqual(fixture.presets);
  });

  it('produces the recorded color string for every theme, phase and bar', () => {
    for (const theme of fixture.themeIds) {
      for (const phase of ['focus', 'short', 'long']) {
        for (const [count, expected] of Object.entries(fixture.colors[theme][phase])) {
          const actual = expected.map((_, index) => barColor(theme, phase, index, expected.length));
          expect(actual, `${theme}/${phase}/${count}`).toEqual(expected);
        }
      }
    }
  });
});

describe('ruler parity', () => {
  for (const [preset, phases] of Object.entries(fixture.rulers)) {
    for (const [phase, recorded] of Object.entries(phases)) {
      it(`${preset}/${phase} keeps the recorded unit, count and fills`, () => {
        for (const sample of recorded.cases) {
          const ruler = computeRuler({
            durationMs: recorded.durationMs,
            elapsedMs: sample.elapsedMs,
          });
          expect(ruler.unitMs).toBe(recorded.unitMs);
          expect(ruler.count).toBe(recorded.count);
          const remaining = ruler.bars.map((bar) => Number((1 - bar.fill).toFixed(3)));
          expect(remaining, `elapsed ${sample.elapsedMs}ms`).toEqual(sample.remaining);
        }
      });
    }
  }
});
