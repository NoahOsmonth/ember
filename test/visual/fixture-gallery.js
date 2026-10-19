/**
 * The visual fixture gallery.
 *
 * With `?state=<id>` it renders one fixture, which is what the screenshot
 * matrix uses. Without a state it renders every fixture in a grid for a quick
 * human review. Rendering goes through the real widget module, so the harness
 * cannot drift from the shipped renderer.
 */

import { createWidget } from '../../src/renderer/widget/widget.js';
import { FIXTURES, fixtureById } from '../fixtures/states.js';

const WIDGET_MARKUP = `
  <div id="app">
    <div class="time">
      <div class="digits" role="timer" aria-label="Time remaining" aria-live="off">25<span class="c">:</span>00</div>
      <div class="meta"><span class="state">ready</span><span class="pips"></span><span class="safe" hidden>safe mode</span></div>
    </div>
    <div class="strip">
      <div class="bars"></div>
      <div class="foot">
        <span class="note"></span>
        <div class="ctl">
          <button class="play" aria-label="Start or pause">
            <svg class="play-i" viewBox="0 0 12 12"><path d="M3 1.8v8.4L10 6z"/></svg>
            <svg class="pause-i" viewBox="0 0 12 12"><rect x="2.5" y="2" width="2.6" height="8" rx=".8"/><rect x="6.9" y="2" width="2.6" height="8" rx=".8"/></svg>
          </button>
          <button class="skip" aria-label="Skip"><svg viewBox="0 0 12 12"><path d="M2.5 2.5 7 6l-4.5 3.5z"/><path d="M9.5 2.5v7"/></svg></button>
          <button class="reset" aria-label="Reset"><svg viewBox="0 0 12 12"><path d="M2.2 6a3.8 3.8 0 1 0 1.2-2.8"/><path d="M2.2 1.6v2.2h2.2"/></svg></button>
          <button class="settings" aria-label="Settings"><svg viewBox="0 0 12 12"><path d="M1.5 3.5h9M1.5 8.5h9"/><circle cx="4" cy="3.5" r="1.3" fill="var(--bg, #0b0c10)"/><circle cx="8" cy="8.5" r="1.3" fill="var(--bg, #0b0c10)"/></svg></button>
        </div>
      </div>
    </div>
    <div class="fuse"><i></i></div>
    <div class="sr-only" aria-live="polite" aria-atomic="true"></div>
  </div>
`;

const query = new URLSearchParams(location.search);
const state = query.get('state');
const theme = query.get('theme') === 'mono' ? 'mono' : 'dusk';
const solid = query.get('solid') === '1';
const gallery = document.getElementById('gallery');

/**
 * @param {Readonly<import('../fixtures/states.js').Fixture>} fixture
 */
function mountFixture(fixture) {
  const container = document.createElement('div');
  container.className = 'fixture';
  container.innerHTML = WIDGET_MARKUP;
  gallery.appendChild(container);

  const widget = createWidget({
    root: container,
    api: null,
    now: () => 0,
    autoStart: false,
  });
  widget.render(fixture.snapshot, { ...fixture.settings, theme, solid });
  container.dataset.ready = 'true';
  return widget;
}

if (state) {
  mountFixture(fixtureById(state));
} else {
  gallery.classList.add('grid');
  for (const fixture of FIXTURES) mountFixture(fixture);
}

document.body.dataset.ready = 'true';
