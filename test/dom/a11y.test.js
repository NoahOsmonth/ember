import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createWidget } from '../../src/renderer/widget/widget.js';
import { fixtureById } from '../fixtures/states.js';

const source = fs.readFileSync(path.join(process.cwd(), 'src/renderer/widget/index.html'), 'utf8');
const parsed = new DOMParser().parseFromString(source, 'text/html');
const APP_MARKUP = parsed.getElementById('app').outerHTML;

function mountRoot() {
  document.body.innerHTML = '';
  const container = document.createElement('div');
  container.innerHTML = APP_MARKUP;
  document.body.append(container);
  return container;
}

const IDLE = fixtureById('idle').snapshot;
const SETTINGS = fixtureById('idle').settings;
const MINUTE = 60_000;

const SHORT = {
  phase: 'short',
  status: 'idle',
  remainingMs: 5 * MINUTE,
  durationMs: 5 * MINUTE,
  endsAtWall: null,
  rounds: 1,
  settingsRevision: 1,
};

describe('widget accessibility', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.documentElement.classList.remove('solid');
  });

  it('gives every control an accessible name and exposes the timer', () => {
    const root = mountRoot();
    const widget = createWidget({ root, now: () => 0, autoStart: false });
    widget.render(IDLE, SETTINGS);

    const buttons = [...root.querySelectorAll('.ctl button')];
    expect(buttons.map((button) => button.className)).toEqual([
      'play',
      'skip',
      'reset',
      'settings',
    ]);
    for (const button of buttons) {
      expect(button.getAttribute('aria-label')).toBeTruthy();
    }

    const digits = root.querySelector('.digits');
    expect(digits.getAttribute('role')).toBe('timer');
    expect(digits.getAttribute('aria-label')).toBe('focus, 25:00 remaining');
    expect(digits.getAttribute('aria-live')).toBe('off');
    widget.destroy();
  });

  it('keeps the controls in visual order for tabbing', () => {
    const root = mountRoot();
    const widget = createWidget({ root, now: () => 0, autoStart: false });
    widget.render(IDLE, SETTINGS);

    const tabbable = [...root.querySelectorAll('button')].filter(
      (button) => !button.disabled && button.tabIndex >= 0
    );
    expect(tabbable.map((button) => button.className)).toEqual([
      'play',
      'skip',
      'reset',
      'settings',
    ]);
    widget.destroy();
  });

  it('announces a phase transition once through the polite live region', () => {
    const root = mountRoot();
    const widget = createWidget({ root, now: () => 0, autoStart: false });
    widget.render(IDLE, SETTINGS);
    const live = root.querySelector('.sr-only');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.getAttribute('aria-atomic')).toBe('true');
    expect(live.textContent).toBe('');

    widget.applySnapshot(SHORT);
    expect(live.textContent).toBe('short break phase, 05:00 remaining');

    // A same-phase tick must not rewrite the region.
    widget.applySnapshot({ ...SHORT, remainingMs: 4 * MINUTE });
    expect(live.textContent).toBe('short break phase, 05:00 remaining');

    widget.applySnapshot({
      ...SHORT,
      phase: 'focus',
      remainingMs: 25 * MINUTE,
      durationMs: 25 * MINUTE,
    });
    expect(live.textContent).toBe('focus phase, 25:00 remaining');
    widget.destroy();
  });
});
