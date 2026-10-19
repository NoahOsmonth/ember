/**
 * The settings and tutorial renderer.
 *
 * Like the widget, this page is a view: settings changes go to the main process
 * and come back as a broadcast, so both windows always show the same document.
 * The tutorial is renderer-local animation and does not touch persisted state.
 */

import * as C from '../shared/common.js';
import { el, on, setStyle, text } from '../shared/dom.js';
import { STRINGS } from '../shared/strings.js';

/**
 * @param {{ api?: any, contrast?: (theme: string) => any }} [options]
 */
export function createSettings({
  api = /** @type {any} */ (globalThis).ember,
  contrast = C.themeContrast,
} = {}) {
  if (!api) {
    console.error('ember settings: the preload API is unavailable');
    return null;
  }

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

  // Unwrap the registry envelope once; a failed call is logged and the window
  // keeps running.
  async function call(method, ...args) {
    if (typeof method !== 'function') return undefined;
    const result = await method(...args);
    if (!result || result.ok !== true) {
      console.error('ember ipc failed', result);
      return undefined;
    }
    return result.value;
  }

  /** @type {any} */
  let cfg = { ...C.DEFAULTS, launch: false };

  /** Latest binding status from the main process. */
  let shortcutState = /** @type {{ safeMode: boolean, bindings: any[] }} */ ({
    safeMode: false,
    bindings: [],
  });
  /** The row currently listening for keys, if any. */
  let capture = /** @type {{ id: string, pending: string|null, error: string|null } | null} */ (
    null
  );

  /* ---------- tabs ---------- */
  const tabs = $$('#tabs button');
  function placePill() {
    const active = $('#tabs button.on');
    const pill = $('#pill');
    if (!active || !pill) return;
    setStyle(pill, 'width', `${active.offsetWidth}px`);
    setStyle(pill, 'transform', `translateX(${active.offsetLeft}px)`);
  }
  function switchTab(name) {
    tabs.forEach((button) => {
      const selected = button.dataset.tab === name;
      button.classList.toggle('on', selected);
      button.setAttribute('aria-selected', String(selected));
    });
    const settingsPage = $('#pg-settings');
    const tutorialPage = $('#pg-tutorial');
    if (settingsPage) settingsPage.hidden = name !== 'settings';
    if (tutorialPage) tutorialPage.hidden = name !== 'tutorial';
    placePill();
    if (name === 'tutorial') tutorial.start();
    else tutorial.stop();
  }
  tabs.forEach((button) => on(button, 'click', () => switchTab(button.dataset.tab)));
  if (api.onTab) api.onTab(switchTab);

  // drag the window by its header
  let drag = null;
  const head = $('#head');
  on(head, 'pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('button')) return;
    drag = { sx: event.screenX, sy: event.screenY };
    head.setPointerCapture?.(event.pointerId);
  });
  on(head, 'pointermove', (event) => {
    if (!drag) return;
    const dx = event.screenX - drag.sx;
    const dy = event.screenY - drag.sy;
    if (dx || dy) {
      api.win.move({ dx, dy });
      drag.sx = event.screenX;
      drag.sy = event.screenY;
    }
  });
  on(head, 'pointerup', () => {
    drag = null;
  });
  on($('#close'), 'click', () => api.win.close());
  on(window, 'keydown', (event) => {
    if (capture) {
      // The capture field owns the keyboard while it is open.
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        capture = null;
        renderShortcuts();
        return;
      }
      const accelerator = C.acceleratorFromCode(event.code, event);
      if (!accelerator) return;
      if (!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
        capture.error = STRINGS.shortcuts.needsModifier;
        renderShortcuts();
        return;
      }
      capture.pending = accelerator;
      capture.error = null;
      renderShortcuts();
      return;
    }
    if (event.key === 'Escape') api.win.close();
  });

  /* ---------- settings ---------- */
  function set(patch) {
    cfg = { ...cfg, ...patch };
    call(api.state.set, patch);
    paint();
  }

  // presets
  const presetsEl = $('#presets');
  Object.entries(C.PRESETS).forEach(([id, preset]) => {
    const button = el('button', { class: 's-chip', dataset: { id } });
    button.append(
      document.createTextNode(preset.name),
      el('small', { text: STRINGS.presetSummary(preset) })
    );
    on(button, 'click', () =>
      set({ durations: { focus: preset.focus, short: preset.short, long: preset.long } })
    );
    presetsEl.appendChild(button);
  });

  // themes: one source of truth, the core palette table
  const themesEl = $('#themes');
  C.themeNames().forEach((id) => {
    const palette = C.THEMES[id];
    const meter = el('span', { class: 'm' });
    for (let index = 0; index < 15; index += 1) {
      meter.append(el('i', { style: { '--c': C.barColor(id, 'focus', index, 15) } }));
    }
    const button = el('button', { class: 's-theme', dataset: { id } });
    button.append(meter, document.createTextNode(palette.name));
    on(button, 'click', () => set({ theme: id }));
    themesEl.appendChild(button);
  });

  // background: auto follows the GPU fallback, the other two force the look
  const bgModes = $('#bgModes');
  if (bgModes) {
    $$('button', bgModes).forEach((button) =>
      on(button, 'click', () =>
        set({ render: { ...(cfg.render || {}), background: button.dataset.bg } })
      )
    );
  }

  // steppers
  $$('.s-step').forEach((stepper) => {
    const key = stepper.dataset.key || '';
    const min = Number(stepper.dataset.min);
    const max = Number(stepper.dataset.max);
    const input = $('input', stepper);
    const read = () => (key.startsWith('dur.') ? cfg.durations[key.slice(4)] : cfg[key]);
    const write = (value) => {
      const next = Math.max(min, Math.min(max, Math.round(Number(value)) || read()));
      if (key.startsWith('dur.')) set({ durations: { ...cfg.durations, [key.slice(4)]: next } });
      else set({ [key]: next });
    };
    $$('button', stepper).forEach((button) =>
      on(button, 'click', (event) =>
        write(read() + Number(button.dataset.d) * (event.shiftKey ? 5 : 1))
      )
    );
    on(input, 'change', () => write(input.value));
    on(input, 'keydown', (event) => {
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        write(read() + 1);
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        write(read() - 1);
      }
      if (event.key === 'Enter') input.blur();
    });
  });

  // switches
  $$('.s-sw').forEach((sw) =>
    on(sw, 'click', () => {
      const key = sw.dataset.key || '';
      const value = !cfg[key];
      if (key === 'mini') {
        cfg.mini = value;
        call(api.win.mini, value);
        paint();
      } else set({ [key]: value });
    })
  );

  // sliders
  $$('input[type="range"]').forEach((range) =>
    on(range, 'input', () => set({ [range.dataset.key || '']: Number(range.value) / 100 }))
  );

  on($('#test'), 'click', () => C.chime('focus', cfg.volume));
  on($('#lock'), 'click', () => call(api.win.lock, true));
  on($('#replay'), 'click', () => switchTab('tutorial'));
  on($('#reset'), 'click', () => call(api.state.reset));
  on($('#safeReset'), 'click', () => call(api.state.reset));
  on($('#quit'), 'click', () => api.app.quit());

  function paint() {
    const durations = cfg.durations;
    $$('.s-chip').forEach((button) => {
      const preset = C.PRESETS[button.dataset.id];
      button.classList.toggle(
        'on',
        !!preset &&
          preset.focus === durations.focus &&
          preset.short === durations.short &&
          preset.long === durations.long
      );
    });
    $$('.s-theme').forEach((button) =>
      button.classList.toggle('on', button.dataset.id === cfg.theme)
    );
    const background = (cfg.render && cfg.render.background) || 'auto';
    $$('#bgModes button').forEach((button) =>
      button.classList.toggle('on', button.dataset.bg === background)
    );
    text(
      $('#bgNote'),
      cfg.solidOverride === 'safe'
        ? 'forced by safe mode'
        : cfg.solidOverride === 'env'
          ? 'forced by EMBER_SOLID'
          : cfg.solidOverride === 'gpu'
            ? 'solid after a GPU crash'
            : ''
    );
    const safeBanner = $('#safeBanner');
    if (safeBanner) safeBanner.hidden = cfg.safeMode !== true;
    const themeContrast = contrast(cfg.theme);
    const warning = $('#contrastWarn');
    if (warning) {
      warning.hidden = themeContrast.pass;
      if (!themeContrast.pass) {
        const worst = themeContrast.pairs.reduce((low, entry) =>
          entry.ratio < low.ratio ? entry : low
        );
        warning.textContent = `${themeContrast.theme}: ${worst.pair} is ${worst.ratio.toFixed(1)}:1, below ${C.MIN_CONTRAST}:1`;
      }
    }
    $$('.s-step').forEach((stepper) => {
      const key = stepper.dataset.key || '';
      const value = key.startsWith('dur.') ? durations[key.slice(4)] : cfg[key];
      const input = $('input', stepper);
      if (document.activeElement !== input) input.value = value;
    });
    $$('.s-sw').forEach((sw) =>
      sw.setAttribute('aria-checked', String(!!cfg[sw.dataset.key || '']))
    );
    $$('input[type="range"]').forEach((range) => {
      const key = range.dataset.key || '';
      const value = Math.round(cfg[key] * 100);
      if (document.activeElement !== range) range.value = value;
      const min = Number(range.min);
      const max = Number(range.max);
      setStyle(range, '--p', `${((value - min) / (max - min)) * 100}%`);
      text($(`#o-${key}`), STRINGS.percent(value));
    });
    text($('#lock'), cfg.locked ? STRINGS.lockOn : STRINGS.lockOff);
    setStyle(document.documentElement, '--acc', C.barColor(cfg.theme, 'focus', 7, 12));
    tutorial.theme();
    renderShortcuts();
  }

  if (api.onSettings)
    api.onSettings((settings) => {
      cfg = { ...cfg, ...settings };
      paint();
    });

  /* ---------- shortcuts ---------- */
  const shortcutList = $('#shortcutList');

  const displayKey = (part) => (part === 'Control' ? 'Ctrl' : part);

  /** @param {string} accelerator */
  function keyChips(accelerator) {
    const wrap = el('span', { class: 's-keys' });
    for (const part of accelerator.split('+')) {
      wrap.append(el('kbd', { text: displayKey(part) }));
    }
    return wrap;
  }

  /** @param {any} binding */
  function shortcutStatus(binding) {
    if (capture && capture.id === binding.id) {
      return capture.error || STRINGS.shortcuts.captureHint;
    }
    if (binding.status === 'conflict' && binding.message) return binding.message;
    return STRINGS.shortcuts[binding.status] || binding.status;
  }

  function renderShortcuts() {
    if (!shortcutList) return;
    shortcutList.replaceChildren();
    for (const binding of shortcutState.bindings) {
      const active = !capture || capture.id !== binding.id;
      const problem = active && binding.status !== 'active';
      const label = el('span');
      label.append(
        document.createTextNode(binding.label),
        el('small', {
          class: problem ? 's-shortcut-status bad' : 's-shortcut-status',
          text: shortcutStatus(binding),
        })
      );

      const actions = el('div', { class: 's-shortcut-actions' });
      if (!active) {
        if (capture && capture.pending) {
          actions.append(keyChips(capture.pending));
          const save = el('button', {
            class: 's-btn s-shortcut-save',
            text: STRINGS.shortcuts.save,
          });
          const cancel = el('button', {
            class: 's-btn s-shortcut-cancel',
            text: STRINGS.shortcuts.cancel,
          });
          on(save, 'click', () => saveCapture());
          on(cancel, 'click', () => {
            capture = null;
            renderShortcuts();
          });
          actions.append(save, cancel);
        } else {
          actions.append(
            el('button', {
              class: 's-btn s-shortcut-capture',
              text: STRINGS.shortcuts.capture,
            })
          );
        }
      } else {
        const change = el('button', {
          class: 's-btn s-shortcut-change',
          'aria-label': `Change ${binding.label}`,
        });
        change.append(keyChips(binding.accelerator));
        on(change, 'click', () => {
          capture = { id: binding.id, pending: null, error: null };
          renderShortcuts();
        });
        actions.append(change);
      }

      const row = el('div', { class: 's-row', dataset: { shortcutId: binding.id } });
      row.append(label, actions);
      shortcutList.append(row);
    }
  }

  async function saveCapture() {
    if (!capture || !capture.pending) return;
    const { id, pending } = capture;
    const result = await call(api.shortcuts.rebind, { id, accelerator: pending });
    if (result && result.ok) {
      shortcutState = { ...shortcutState, bindings: result.bindings };
      capture = null;
    } else if (result) {
      capture.error = result.message || STRINGS.shortcuts.invalid;
    }
    renderShortcuts();
  }

  on($('#shortcutRecheck'), 'click', async () => {
    const status = await call(api.shortcuts.check);
    if (status) {
      shortcutState = status;
      capture = null;
      renderShortcuts();
    }
  });

  /* ---------- tutorial ---------- */
  const tutorial = (() => {
    const stage = $('#stage');
    const win = $('#tWin');
    const cur = $('#tCur');
    const rip = $('#tRip');
    const badge = $('#tBadge');
    const tip = $('#tTip');
    const menu = $('#tMenu');
    const keys = $('#tKeys');
    const digits = $('.digits', win);
    const state = $('.state', win);
    const pips = $('.pips', win);
    const barsEl = $('.bars', win);
    const note = $('.note', win);
    const appEl = $('#app', win);
    const N = 25;
    const TOTAL = 25 * 60;
    const STEPS = STRINGS.tutorial;
    let bars = [];
    let progress = 0;
    let running = false;
    let token = 0;
    let active = false;
    let autoplay = true;
    let index = 0;
    let cx = 430;
    let cy = 250;
    let wx = 0;
    let wy = 0;
    let timer = 0;

    /* mock widget */
    function buildBars() {
      if (!barsEl) return;
      barsEl.replaceChildren();
      bars = [];
      for (let i = 0; i < N; i += 1) {
        const bar = el('i', { class: 'bar' + ((i + 1) % 5 === 0 ? ' tick' : '') });
        setStyle(bar, '--c', C.barColor(cfg.theme, 'focus', i, N));
        barsEl.appendChild(bar);
        bars.push(bar);
      }
      setStyle(barsEl, '--gap', '3px');
      if (pips) {
        pips.replaceChildren(
          el('i', { class: 'pip done' }),
          el('i', { class: 'pip now' }),
          el('i', { class: 'pip' }),
          el('i', { class: 'pip' })
        );
      }
    }
    function draw() {
      const remaining = Math.ceil(TOTAL * (1 - progress));
      if (digits) {
        digits.replaceChildren(
          document.createTextNode(String(Math.floor(remaining / 60)).padStart(2, '0')),
          el('span', { class: 'c', text: ':' }),
          document.createTextNode(String(remaining % 60).padStart(2, '0'))
        );
      }
      const position = progress * N;
      const activeBar = Math.min(N - 1, Math.floor(position));
      bars.forEach((bar, i) =>
        setStyle(
          bar,
          '--f',
          i < activeBar ? 0 : i === activeBar ? (1 - (position - activeBar)).toFixed(3) : 1
        )
      );
      const current = running ? 'running' : progress > 0 ? 'paused' : 'ready';
      win.classList.remove('running', 'paused', 'ready');
      win.classList.add(current);
      text(state, current === 'running' ? 'focus' : current);
      if (bars[activeBar]) {
        setStyle(win, '--accent', bars[activeBar].style.getPropertyValue('--c'));
      }
      setStyle(digits, 'color', running ? 'var(--accent)' : 'rgba(255,255,255,.9)');
      text(
        note,
        running
          ? STRINGS.ends(
              new Date(Date.now() + remaining * 1000).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
              })
            )
          : ''
      );
    }
    function theme() {
      buildBars();
      draw();
    }

    /* timeline helpers */
    class Cancel {}
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const mkW = (mine) => async (ms) => {
      await sleep(ms);
      if (mine !== token) throw new Cancel();
    };

    function stagePoint(element, fx = 0.5, fy = 0.5) {
      const rect = element.getBoundingClientRect();
      const bounds = stage.getBoundingClientRect();
      return [rect.left - bounds.left + rect.width * fx, rect.top - bounds.top + rect.height * fy];
    }
    async function curTo(x, y, W, ms = 850) {
      cur.style.transitionDuration = `${ms}ms`;
      cx = x;
      cy = y;
      cur.style.transform = `translate(${x}px, ${y}px)`;
      await W(ms + 40);
    }
    const moveTo = (element, W, fx, fy) => curTo(...stagePoint(element, fx, fy), W);
    async function click(W) {
      cur.classList.add('press');
      rip.style.transform = `translate(${cx}px, ${cy}px)`;
      rip.classList.remove('go');
      void rip.offsetWidth;
      rip.classList.add('go');
      await W(130);
      cur.classList.remove('press');
      await W(120);
    }
    async function burnTo(target, ms, W) {
      const from = progress;
      const start = performance.now();
      while (true) {
        const k = Math.min(1, (performance.now() - start) / ms);
        progress = from + (target - from) * k;
        draw();
        if (k >= 1) break;
        await W(33);
      }
    }
    function showTip(element, message) {
      const [x, y] = stagePoint(element, 0.5, 0);
      tip.textContent = message;
      tip.style.left = `${Math.max(8, x - 28)}px`;
      tip.style.top = `${y - 30}px`;
      tip.classList.add('show');
    }
    function setGlass(value) {
      setStyle(appEl, '--a', value);
    }

    function resetStage() {
      win.classList.remove('hov', 'gone', 'ghost');
      $$('.ctl button', win).forEach((button) => button.classList.remove('lit'));
      wx = 0;
      wy = 0;
      win.style.transform = '';
      menu.classList.remove('show');
      keys.classList.remove('show');
      badge.classList.remove('show');
      tip.classList.remove('show');
      $$('.t-key', keys).forEach((key) => key.classList.remove('on'));
      $$('div', menu).forEach((item) => item.classList.remove('on'));
      cur.classList.remove('press');
      setGlass(cfg.opacity);
      running = false;
      progress = 0;
      draw();
    }

    const script = [
      async (W) => {
        // 1 click to start
        await W(600);
        await moveTo(digits, W);
        await W(120);
        await click(W);
        running = true;
        await burnTo(0.5, 2700, W);
        await W(500);
      },
      async (W) => {
        // 2 hover controls
        running = true;
        progress = 0.3;
        draw();
        await W(250);
        await moveTo($('.bars', win), W, 0.5, 0.35);
        win.classList.add('hov');
        await W(450);
        for (const [selector, label] of [
          ['.play', 'Pause'],
          ['.skip', 'Skip'],
          ['.rst', 'Reset'],
          ['.gear', 'Settings'],
        ]) {
          const button = $(selector, win);
          await moveTo(button, W, 0.5, 0.6);
          button.classList.add('lit');
          showTip(button, label);
          await W(800);
          button.classList.remove('lit');
        }
        tip.classList.remove('show');
        await W(300);
      },
      async (W) => {
        // 3 drag
        running = true;
        progress = 0.3;
        draw();
        await W(250);
        await moveTo(win, W, 0.52, 0.88);
        await W(150);
        cur.classList.add('press');
        await W(200);
        for (const [dx, dy] of [
          [30, 70],
          [-34, 30],
          [4, -100],
        ]) {
          wx += dx;
          wy += dy;
          win.style.transform = `translate(${wx}px, ${wy}px)`;
          await curTo(cx + dx, cy + dy, W, 1100);
          await W(250);
        }
        cur.classList.remove('press');
        await W(500);
      },
      async (W) => {
        // 4 scroll
        running = true;
        progress = 0.3;
        draw();
        await W(250);
        await moveTo($('.bars', win), W, 0.5, 0.5);
        await W(200);
        badge.classList.add('show');
        for (const value of [0.9, 0.78, 0.6, 0.4, 0.24, 0.14, 0.3, 0.48, 0.62]) {
          setGlass(value);
          badge.textContent = STRINGS.glass(Math.round(value * 100));
          await W(420);
        }
        await W(500);
      },
      async (W) => {
        // 5 right-click
        running = true;
        progress = 0.3;
        draw();
        await W(250);
        await moveTo(win, W, 0.56, 0.86);
        await W(150);
        await click(W);
        const x = cx + 8;
        const y = cy + 6;
        menu.style.left = `${Math.min(x, 416 - 184)}px`;
        menu.style.top = `${Math.min(y, 222 - 176)}px`;
        menu.classList.add('show');
        await W(500);
        const first = $('div', menu);
        await moveTo(first, W, 0.3, 0.5);
        first.classList.add('on');
        await W(1300);
      },
      async (W) => {
        // 6 shortcuts
        running = true;
        progress = 0.3;
        draw();
        win.style.transform = 'translate(0,-6px)';
        await W(300);
        keys.classList.add('show');
        await W(500);
        const keyEls = $$('.t-key', keys);
        const select = (i) =>
          keyEls.forEach((element, j) => element.classList.toggle('on', i === j));
        select(0);
        running = !running;
        draw();
        await W(1100);
        select(0);
        running = !running;
        draw();
        await W(700);
        select(1);
        win.classList.add('gone');
        await W(1000);
        win.classList.remove('gone');
        await W(700);
        select(2);
        win.classList.add('ghost');
        await W(1300);
        win.classList.remove('ghost');
        await W(500);
        select(-1);
      },
    ];

    /* captions, dots, nav */
    const dots = $('#tDots');
    STEPS.forEach((step, i) => {
      const button = el('button', { 'aria-label': STRINGS.stepLabel(i, step.title) });
      on(button, 'click', () => go(i));
      dots.appendChild(button);
    });
    function caption(i) {
      const container = $('#tCap');
      if (!container) return;
      container.classList.add('swap');
      setTimeout(() => {
        text($('#tTitle'), STEPS[i].title);
        text($('#tText'), STEPS[i].text);
        container.classList.remove('swap');
      }, 180);
      $$('button', dots).forEach((button, j) => button.classList.toggle('on', j === i));
    }

    async function go(i) {
      index = (i + STEPS.length) % STEPS.length;
      const mine = ++token;
      clearTimeout(timer);
      caption(index);
      resetStage();
      cur.style.transitionDuration = '0ms';
      cur.style.transform = 'translate(430px, 250px)';
      cx = 430;
      cy = 250;
      await sleep(30);
      if (mine !== token) return;
      try {
        await script[index](mkW(mine));
        if (autoplay && mine === token) {
          await mkW(mine)(900);
          go(index + 1);
        }
      } catch (error) {
        if (!(error instanceof Cancel)) throw error;
      }
    }

    on($('#tPrev'), 'click', () => go(index - 1));
    on($('#tNext'), 'click', () => go(index + 1));
    on($('#tAuto'), 'click', (event) => {
      autoplay = !autoplay;
      event.currentTarget.setAttribute('aria-pressed', String(autoplay));
      text(event.currentTarget, autoplay ? STRINGS.autoPlayOn : STRINGS.autoPlayOff);
      if (autoplay) go(index + 1);
    });

    buildBars();
    draw();
    return {
      theme,
      start() {
        if (active) return;
        active = true;
        go(0);
      },
      stop() {
        active = false;
        token += 1;
        clearTimeout(timer);
      },
    };
  })();

  /* ---------- boot ---------- */
  call(api.state.get).then((settings) => {
    if (settings) {
      cfg = { ...cfg, ...settings };
      paint();
    }
  });
  call(api.shortcuts && api.shortcuts.get).then((status) => {
    if (status) {
      shortcutState = status;
      renderShortcuts();
    }
  });
  const tab = new URLSearchParams(location.search).get('tab');
  paint();
  on(window, 'load', () => {
    placePill();
    if (tab === 'tutorial') switchTab('tutorial');
  });
  if (document.fonts) document.fonts.ready.then(placePill);

  return { paint, switchTab };
}

// Only the packaged page has both the preload API and the settings panel.
if (
  typeof window !== 'undefined' &&
  /** @type {any} */ (window).ember &&
  document.getElementById('panel')
) {
  createSettings({ api: /** @type {any} */ (window).ember });
}
