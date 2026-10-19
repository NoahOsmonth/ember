/**
 * The widget renderer.
 *
 * The widget is a view over the main process's timer snapshots. It never owns
 * a phase or writes a setting directly: every action becomes an IPC call, and
 * every paint comes from a snapshot (with local interpolation between snapshots
 * so the bars move smoothly).
 *
 * The page loads this module with `<script type="module">`. `createWidget` is
 * exported so the DOM tests and the visual fixture can render the same code
 * against fabricated snapshots without starting the real application.
 */

import { DEFAULTS, chime } from '../shared/common.js';
import { computeRuler } from '../../core/ruler.js';
import { barColor } from '../../core/themes.js';
import { el, on, setStyle, text } from '../shared/dom.js';
import { createScheduler } from '../shared/scheduler.js';
import { STRINGS, phaseLabel, statusLabel } from '../shared/strings.js';

/** @returns {number} a monotonic-enough renderer clock */
function defaultNow() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * @param {{
 *   root?: HTMLElement,
 *   api?: any,
 *   now?: () => number,
 *   autoStart?: boolean,
 *   scheduler?: any
 * }} [options]
 */
export function createWidget({
  root = document.body,
  api = null,
  now = defaultNow,
  autoStart = true,
  scheduler = null,
} = {}) {
  const doc = root.ownerDocument || document;
  const view = doc.defaultView || globalThis;
  const global = root === doc.body;
  const styleRoot = global ? doc.documentElement : root;
  const pick = (selector) => root.querySelector(selector);

  const nodes = {
    digits: pick('.digits'),
    state: pick('.state'),
    pips: pick('.pips'),
    bars: pick('.bars'),
    note: pick('.note'),
    fuse: pick('.fuse'),
    announce: pick('.sr-only'),
    safe: pick('.safe'),
    dnd: pick('.dnd'),
    play: pick('.play'),
    skip: pick('.skip'),
    reset: pick('.reset'),
    settings: pick('.settings'),
  };

  /** @type {any} */
  let cfg = { ...DEFAULTS, locked: false };
  let snap = {
    phase: 'focus',
    status: 'idle',
    remainingMs: DEFAULTS.durations.focus * 60_000,
    durationMs: DEFAULTS.durations.focus * 60_000,
    endsAtWall: null,
    rounds: 0,
    settingsRevision: 0,
  };
  let pending = null;
  let bars = [];
  let lastIdx = -2;
  let lastText = '';
  let lastBuild = '';
  let lastFraction = null;
  let lastFuse = null;
  let flashUntil = 0;
  let flashMsg = '';
  let announcedRecovery = false;
  let announcedSolid = false;
  let anchorRemaining = snap.remainingMs;
  let anchorAt = now();
  let opacityTimer = null;
  const cleanups = [];

  const loops =
    scheduler ||
    createScheduler({
      onTick: () => {
        if (mode() === 'running') renderDigits();
      },
      onFrame: () => paintMotion(),
    });

  const total = () =>
    snap.durationMs || (cfg.durations[snap.phase] || cfg.durations.focus) * 60_000;

  function remaining() {
    const limit = total();
    if (snap.status === 'running') {
      return Math.max(0, Math.min(limit, anchorRemaining - (now() - anchorAt)));
    }
    return Math.max(0, Math.min(limit, snap.remainingMs));
  }

  /** mm:ss, rounded up so a fresh 25-minute phase reads 25:00, not 24:59. */
  function formatRemaining(ms) {
    const secs = Math.ceil(Math.max(0, ms) / 1000);
    return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  }

  function mode() {
    if (pending === 'paused') return 'paused';
    if (pending === 'running') return 'running';
    if (snap.status === 'running') return 'running';
    if (snap.status === 'paused') return 'paused';
    return 'ready';
  }

  // Geometry comes from the core ruler: the unit grows so a long phase still
  // shows at most 30 bars, and the palette decides each bar's color.
  function build() {
    const ruler = computeRuler({ durationMs: total() });
    const count = ruler.count;
    setStyle(nodes.bars, '--gap', count > 20 ? '3px' : '5px');
    if (nodes.bars) nodes.bars.replaceChildren();
    bars = [];
    for (let index = 0; index < count; index += 1) {
      const bar = el('i', {
        class: 'bar' + ((index + 1) % 5 === 0 || index === count - 1 ? ' tick' : ''),
      });
      setStyle(bar, '--c', barColor(cfg.theme, snap.phase, index, count));
      if (nodes.bars) nodes.bars.append(bar);
      bars.push(bar);
    }
    lastIdx = -2;
    lastFraction = null;
    lastFuse = null;
  }

  function flash(message, ms = 1400) {
    flashUntil = now() + ms;
    flashMsg = message;
    renderAll();
    globalThis.setTimeout(() => renderAll(), ms + 10);
  }

  function renderDigits() {
    const secs = Math.ceil(remaining() / 1000);
    const minutes = String(Math.floor(secs / 60)).padStart(2, '0');
    const seconds = String(secs % 60).padStart(2, '0');
    const value = `${minutes}:${seconds}`;
    if (nodes.digits) {
      nodes.digits.setAttribute('aria-label', STRINGS.timerLabel(phaseLabel(snap.phase), value));
    }
    if (value === lastText) return;
    if (nodes.digits) {
      nodes.digits.replaceChildren(
        doc.createTextNode(minutes),
        el('span', { class: 'c', text: ':' }),
        doc.createTextNode(seconds)
      );
    }
    lastText = value;
    if (global) doc.title = `${value} ${phaseLabel(snap.phase)}`;
  }

  function renderMeta() {
    const current = mode();
    root.className = (
      (global ? '' : 'fixture ') +
      (cfg.mini ? 'mini ' : '') +
      current +
      (cfg.locked ? ' locked' : '') +
      (cfg.doNotDisturb ? ' dnd' : '')
    ).trim();
    if (doc.documentElement) doc.documentElement.classList.toggle('solid', cfg.solid === true);
    setStyle(styleRoot, '--a', cfg.opacity);

    text(nodes.state, now() < flashUntil ? flashMsg : statusLabel(current, snap.phase));
    if (nodes.safe) nodes.safe.hidden = cfg.safeMode !== true;
    if (nodes.dnd) nodes.dnd.hidden = cfg.doNotDisturb !== true;

    const rounds = Math.max(0, Math.round(cfg.rounds));
    if (nodes.pips && nodes.pips.children.length !== rounds) {
      nodes.pips.replaceChildren(
        ...Array.from({ length: rounds }, () => el('i', { class: 'pip' }))
      );
    }
    if (nodes.pips) {
      const done = Math.min(snap.rounds, rounds);
      [...nodes.pips.children].forEach((pip, index) => {
        pip.className =
          'pip' + (index < done ? ' done' : index === done && snap.phase === 'focus' ? ' now' : '');
      });
    }

    let note = '';
    if (snap.status === 'running') {
      if (snap.endsAtLabel) note = snap.endsAtLabel;
      else if (snap.endsAtWall) {
        note = STRINGS.ends(
          new Date(snap.endsAtWall).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
          })
        );
      }
    }
    text(nodes.note, note);
  }

  /**
   * Paint the ruler and the fuse. Called from the frame loop while running and
   * once from every full render, so a paused window shows the final frame and
   * then stops.
   */
  function paintMotion() {
    if (bars.length === 0) return;
    const limit = total();
    const rem = remaining();
    const ruler = computeRuler({ durationMs: limit, elapsedMs: limit - rem });
    const index = Math.min(bars.length - 1, ruler.bars.filter((bar) => bar.fill >= 1).length);

    if (index !== lastIdx) {
      bars.forEach((bar, position) => setStyle(bar, '--f', position < index ? 0 : 1));
      lastIdx = index;
      lastFraction = null;
      const accent = bars[index] ? bars[index].style.getPropertyValue('--c') : '';
      setStyle(styleRoot, '--accent', accent || '#fff');
    }

    const fill = Math.max(0, Math.min(1, 1 - (ruler.bars[index] ? ruler.bars[index].fill : 0)));
    const fraction = fill.toFixed(3);
    if (fraction !== lastFraction) {
      setStyle(bars[index], '--f', fraction);
      lastFraction = fraction;
    }

    const fuse = (limit > 0 ? rem / limit : 0).toFixed(4);
    if (fuse !== lastFuse) {
      setStyle(nodes.fuse, '--p', fuse);
      lastFuse = fuse;
    }
  }

  function renderAll() {
    const buildKey = `${snap.phase}|${total()}|${cfg.theme}`;
    if (buildKey !== lastBuild) {
      build();
      lastBuild = buildKey;
    }
    renderMeta();
    renderDigits();
    paintMotion();
  }

  function syncLoops() {
    if (!autoStart) return;
    if (mode() === 'running') {
      loops.startTicks();
      loops.requestFrames();
    } else {
      loops.stop();
    }
  }

  function applySnapshot(next) {
    if (!next) return;
    const previousPhase = snap.phase;
    snap = next;
    pending = null;
    anchorRemaining = next.remainingMs;
    anchorAt = now();
    // The digits update every second and are deliberately silent; one polite
    // sentence per phase transition is the whole announcement budget.
    if (next.phase !== previousPhase) {
      text(
        nodes.announce,
        STRINGS.phaseAnnouncement(phaseLabel(next.phase), formatRemaining(next.remainingMs))
      );
    }
    renderAll();
    syncLoops();
  }

  function applySettings(next) {
    if (!next) return;
    const previous = cfg;
    cfg = { ...cfg, ...next };
    renderAll();
    if (cfg.locked && !previous.locked) flash(STRINGS.clickThrough, 4000);
    if (cfg.settingsRecovered && !announcedRecovery) {
      announcedRecovery = true;
      flash(STRINGS.settingsReset, 4000);
    }
    if (cfg.solidOverride === 'gpu' && !announcedSolid) {
      announcedSolid = true;
      flash(STRINGS.solidFallback, 5000);
    }
  }

  async function call(method, ...args) {
    if (typeof method !== 'function') return undefined;
    const result = await method(...args);
    if (!result || result.ok !== true) {
      console.error('ember ipc failed', result);
      return undefined;
    }
    return result.value;
  }

  async function command(method, label) {
    if (label) {
      pending = label;
      renderAll();
    }
    const result = await method();
    if (!result || result.ok !== true) {
      pending = null;
      flash(STRINGS.commandFailed, 2000);
      return;
    }
    if (result.value && result.value.phase) applySnapshot(result.value);
    else {
      pending = null;
      renderAll();
    }
  }

  function toggle() {
    command(api.timer.toggle, mode() === 'running' ? 'paused' : 'running');
  }

  /** Wire the real API. Fixtures and tests call `render` without this. */
  function mount() {
    if (!api) return;
    cleanups.push(on(nodes.digits, 'click', toggle));
    cleanups.push(on(nodes.play, 'click', toggle));
    cleanups.push(on(nodes.skip, 'click', () => command(api.timer.skip)));
    cleanups.push(on(nodes.reset, 'click', () => command(api.timer.reset)));
    cleanups.push(on(nodes.settings, 'click', () => call(api.settings.open, 'settings')));

    cleanups.push(
      on(view, 'keydown', (event) => {
        if (event.code === 'Space') {
          event.preventDefault();
          toggle();
        } else if (event.key === 'r' || event.key === 'R') command(api.timer.reset);
        else if (event.key === 's' || event.key === 'S') command(api.timer.skip);
        else if (event.key === 'm' || event.key === 'M') call(api.win.mini, !cfg.mini);
      })
    );

    // Drag from anywhere that is not a control. The main process follows the
    // cursor itself; this side only says where the drag began and when it ended.
    let dragging = false;
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      api.win.dragEnd();
    };
    cleanups.push(
      on(view, 'pointerdown', (event) => {
        if (
          event.button !== 0 ||
          event.target.closest('button') ||
          event.target.closest('.digits')
        ) {
          return;
        }
        dragging = true;
        doc.body.setPointerCapture?.(event.pointerId);
        api.win.dragStart({ x: event.screenX, y: event.screenY });
      })
    );
    cleanups.push(on(view, 'pointerup', endDrag));
    cleanups.push(on(view, 'pointercancel', endDrag));
    cleanups.push(on(view, 'blur', endDrag));
    cleanups.push(
      on(view, 'dblclick', (event) => {
        if (!event.target.closest('button, .digits')) call(api.win.mini, !cfg.mini);
      })
    );
    cleanups.push(
      on(view, 'contextmenu', (event) => {
        event.preventDefault();
        api.menu.show();
      })
    );

    // wheel over the widget: glass opacity
    cleanups.push(
      on(
        view,
        'wheel',
        (event) => {
          event.preventDefault();
          cfg.opacity = Math.max(
            0.12,
            Math.min(0.96, +(cfg.opacity + (event.deltaY < 0 ? 0.05 : -0.05)).toFixed(2))
          );
          setStyle(styleRoot, '--a', cfg.opacity);
          flash(STRINGS.glass(Math.round(cfg.opacity * 100)));
          globalThis.clearTimeout(opacityTimer);
          opacityTimer = globalThis.setTimeout(
            () => call(api.state.set, { opacity: cfg.opacity }),
            300
          );
        },
        { passive: false }
      )
    );

    cleanups.push(
      api.onSettings ? api.onSettings((settings) => applySettings(settings)) : () => {}
    );
    cleanups.push(api.timer.onSnapshot((next) => applySnapshot(next)));
    cleanups.push(
      api.timer.onPhaseComplete((event) => {
        if (!event) return;
        // The main process decides both signals once, so the toast and the
        // chime cannot disagree; older payloads fall back to the local rule.
        const chimeAllowed = event.signals
          ? event.signals.chime === true
          : !event.quiet && cfg.sound;
        if (chimeAllowed) chime(event.completedPhase, cfg.volume);
      })
    );
    cleanups.push(
      api.onCommand
        ? api.onCommand((commandName) => {
            if (commandName === 'toggle') toggle();
          })
        : () => {}
    );

    call(api.state.get).then((settings) => {
      if (settings) cfg = { ...cfg, ...settings };
      setStyle(styleRoot, '--a', cfg.opacity);
      if (cfg.solidOverride === 'gpu' && !announcedSolid) {
        announcedSolid = true;
        flash(STRINGS.solidFallback, 5000);
      } else if (cfg.settingsRecovered) {
        announcedRecovery = true;
        flash(STRINGS.settingsReset, 4000);
      } else {
        renderAll();
      }
    });

    call(api.timer.subscribe).then((result) => {
      if (!result) return;
      if (result.snapshot) applySnapshot(result.snapshot);
      if (result.notice) flash(STRINGS.phaseEndedWhileAway, 4000);
    });
  }

  /**
   * Render a snapshot and settings without touching the IPC surface. Used by
   * the DOM tests and the visual fixture gallery.
   */
  function render(next, settings) {
    if (next) {
      snap = next;
      anchorRemaining = next.remainingMs;
      anchorAt = now();
    }
    if (settings) cfg = { ...cfg, ...settings };
    renderAll();
  }

  function destroy() {
    loops.stop();
    globalThis.clearTimeout(opacityTimer);
    for (const off of cleanups.splice(0)) off();
  }

  return {
    render,
    applySnapshot,
    applySettings,
    toggle,
    command,
    mount,
    destroy,
    get snapshot() {
      return snap;
    },
    get settings() {
      return cfg;
    },
  };
}

/**
 * Start the widget against the real preload API.
 *
 * @param {{ root?: HTMLElement, api?: any }} [options]
 */
export function boot({ root = document.body, api = /** @type {any} */ (globalThis).ember } = {}) {
  if (!api) return null;
  const widget = createWidget({ root, api });
  widget.mount();
  return widget;
}

// The packaged page opts in by exposing the preload API and containing #app.
// The fixture gallery and the DOM tests import `createWidget` directly and
// never satisfy both conditions, so they do not start an IPC-driven widget.
if (
  typeof window !== 'undefined' &&
  /** @type {any} */ (window).ember &&
  document.getElementById('app')
) {
  boot({ api: /** @type {any} */ (window).ember });
}
