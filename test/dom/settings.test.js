import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createSettings } from '../../src/renderer/settings/settings.js';
import * as C from '../../src/renderer/shared/common.js';
import { STRINGS } from '../../src/renderer/shared/strings.js';

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/renderer/settings/index.html'),
  'utf8'
);
const parsed = new DOMParser().parseFromString(source, 'text/html');
const BODY_MARKUP = parsed.body.innerHTML;

function mountPage() {
  document.body.innerHTML = BODY_MARKUP;
  return document.body;
}

const $id = (id) => /** @type {any} */ (document.getElementById(id));
const $sel = (selector) => /** @type {any} */ (document.querySelector(selector));
const $all = (selector) => /** @type {any[]} */ ([...document.querySelectorAll(selector)]);

const ok = (value = null) => ({ ok: true, value });

function fakeApi() {
  const calls = [];
  /** @type {(value?: any) => void} */
  let settingsHandler = () => {};
  /** @type {(value?: any) => void} */
  let tabHandler = () => {};
  return {
    calls,
    state: {
      get: async () => ok({ ...C.DEFAULTS, launch: false }),
      set: async (patch) => {
        calls.push({ name: 'state.set', args: [patch] });
        return ok();
      },
      reset: async () => {
        calls.push({ name: 'state.reset', args: [] });
        return ok();
      },
    },
    win: {
      move: (delta) => calls.push({ name: 'win.move', args: [delta] }),
      close: () => calls.push({ name: 'win.close', args: [] }),
      mini: async (value) => {
        calls.push({ name: 'win.mini', args: [value] });
        return ok();
      },
      lock: async (value) => {
        calls.push({ name: 'win.lock', args: [value] });
        return ok();
      },
    },
    app: { quit: () => calls.push({ name: 'app.quit', args: [] }) },
    onSettings: (handler) => {
      settingsHandler = handler;
      return () => {};
    },
    onTab: (handler) => {
      tabHandler = handler;
      return () => {};
    },
    emitSettings: (settings) => settingsHandler(settings),
    emitTab: (tab) => tabHandler(tab),
  };
}

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const byKey = (key) => /** @type {any} */ ($sel(`.s-step[data-key="${key}"]`));
const switchByKey = (key) => /** @type {any} */ ($sel(`.s-sw[data-key="${key}"]`));
const rangeByKey = (key) => /** @type {any} */ ($sel(`input[type="range"][data-key="${key}"]`));
const inputOf = (key) => byKey(key).querySelector('input');
const plusOf = (key) => byKey(key).querySelector('button[data-d="1"]');
const minusOf = (key) => byKey(key).querySelector('button[data-d="-1"]');

describe('settings renderer', () => {
  let api;
  let settings;

  beforeEach(async () => {
    mountPage();
    api = fakeApi();
    settings = createSettings({ api });
    await flush();
  });

  afterEach(() => {
    settings?.switchTab('settings');
    document.body.innerHTML = '';
    history.replaceState(null, '', '/');
  });

  it('refuses to start without the preload API', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(createSettings({ api: null })).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('builds one preset chip and one theme card per option', () => {
    const chips = $all('#presets .s-chip');
    expect(chips).toHaveLength(Object.keys(C.PRESETS).length);
    expect(chips.map((chip) => chip.dataset.id)).toEqual(Object.keys(C.PRESETS));
    expect(chips[0].querySelector('small').textContent).toBe(
      STRINGS.presetSummary(C.PRESETS.classic)
    );

    const themes = $all('#themes .s-theme');
    expect(themes).toHaveLength(C.themeNames().length);
    expect(themes.map((theme) => theme.dataset.id)).toEqual(C.themeNames());
    for (const theme of themes) {
      expect(theme.querySelectorAll('.m i')).toHaveLength(15);
    }
  });

  it('paints the default document into every control', () => {
    expect($sel('.s-chip.on').dataset.id).toBe('classic');
    expect($sel('.s-theme.on').dataset.id).toBe('dusk');
    expect(inputOf('dur.focus').value).toBe('25');
    expect(inputOf('dur.short').value).toBe('5');
    expect(inputOf('dur.long').value).toBe('15');
    expect(inputOf('rounds').value).toBe('4');
    expect(switchByKey('autoBreak').getAttribute('aria-checked')).toBe('true');
    expect(switchByKey('autoFocus').getAttribute('aria-checked')).toBe('false');
    expect(switchByKey('sound').getAttribute('aria-checked')).toBe('true');
    expect(switchByKey('notify').getAttribute('aria-checked')).toBe('true');
    expect(switchByKey('onTop').getAttribute('aria-checked')).toBe('true');
    expect(switchByKey('launch').getAttribute('aria-checked')).toBe('false');
    expect(switchByKey('mini').getAttribute('aria-checked')).toBe('false');
    expect(rangeByKey('opacity').value).toBe('62');
    expect(rangeByKey('volume').value).toBe('60');
    expect($id('o-opacity').textContent).toBe('62%');
    expect($id('o-volume').textContent).toBe('60%');
    expect($id('lock').textContent).toBe(STRINGS.lockOff);
    expect(document.documentElement.style.getPropertyValue('--acc')).toMatch(/^oklch\(/);
  });

  it('applies a preset to all three durations', async () => {
    const deep = $sel('.s-chip[data-id="deep"]');
    deep.click();
    await flush();

    expect(api.calls.find((call) => call.name === 'state.set').args).toEqual([
      { durations: { focus: 50, short: 10, long: 30 } },
    ]);
    expect(deep.classList.contains('on')).toBe(true);
    expect(inputOf('dur.focus').value).toBe('50');
    expect($sel('.s-chip.on').dataset.id).toBe('deep');
  });

  it('applies a theme and repaints the accent', async () => {
    const mono = $sel('.s-theme[data-id="mono"]');
    mono.click();
    await flush();

    expect(api.calls.find((call) => call.name === 'state.set').args).toEqual([{ theme: 'mono' }]);
    expect(mono.classList.contains('on')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--acc')).toBe('oklch(0.842 0.000 0.0)');
  });

  it('steps, clamps and types duration values', async () => {
    plusOf('dur.focus').click();
    await flush();
    expect(inputOf('dur.focus').value).toBe('26');

    plusOf('dur.focus').dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
    await flush();
    expect(inputOf('dur.focus').value).toBe('31');

    minusOf('dur.focus').click();
    await flush();
    expect(inputOf('dur.focus').value).toBe('30');

    inputOf('dur.focus').value = '999';
    inputOf('dur.focus').dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(inputOf('dur.focus').value).toBe('180');

    inputOf('dur.focus').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
    );
    await flush();
    expect(inputOf('dur.focus').value).toBe('179');

    inputOf('dur.focus').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })
    );
    await flush();
    expect(inputOf('dur.focus').value).toBe('180');

    inputOf('dur.focus').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(document.activeElement).not.toBe(inputOf('dur.focus'));
  });

  it('keeps the round count inside its own range', async () => {
    plusOf('rounds').click();
    await flush();
    expect(inputOf('rounds').value).toBe('5');

    inputOf('rounds').value = '1';
    inputOf('rounds').dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(inputOf('rounds').value).toBe('2');

    minusOf('rounds').click();
    await flush();
    expect(inputOf('rounds').value).toBe('2');
  });

  it('toggles switches and routes compact size through the window API', async () => {
    switchByKey('autoBreak').click();
    switchByKey('mini').click();
    await flush();

    expect(api.calls.find((call) => call.name === 'state.set').args).toEqual([
      { autoBreak: false },
    ]);
    expect(api.calls.find((call) => call.name === 'win.mini').args).toEqual([true]);
    expect(switchByKey('autoBreak').getAttribute('aria-checked')).toBe('false');
    expect(switchByKey('mini').getAttribute('aria-checked')).toBe('true');
  });

  it('updates opacity and volume from the sliders', async () => {
    const opacity = rangeByKey('opacity');
    opacity.value = '80';
    opacity.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    expect(api.calls.find((call) => call.name === 'state.set').args).toEqual([{ opacity: 0.8 }]);
    expect($id('o-opacity').textContent).toBe('80%');
    expect(opacity.style.getPropertyValue('--p')).toMatch(/%$/);

    const volume = rangeByKey('volume');
    volume.value = '25';
    volume.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    expect(api.calls.filter((call) => call.name === 'state.set').at(-1).args).toEqual([
      { volume: 0.25 },
    ]);
    expect($id('o-volume').textContent).toBe('25%');
  });

  it('wires the action buttons', async () => {
    $id('test').click();
    $id('lock').click();
    $id('reset').click();
    $id('quit').click();
    await flush();

    expect(api.calls.find((call) => call.name === 'win.lock').args).toEqual([true]);
    expect(api.calls.some((call) => call.name === 'state.reset')).toBe(true);
    expect(api.calls.some((call) => call.name === 'app.quit')).toBe(true);
  });

  it('closes on the close button and on Escape', () => {
    $id('close').click();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(api.calls.filter((call) => call.name === 'win.close')).toHaveLength(2);
  });

  it('drags the header but not its buttons', () => {
    const Pointer = globalThis.PointerEvent || MouseEvent;
    const head = $id('head');

    $id('close').dispatchEvent(
      new Pointer('pointerdown', { button: 0, screenX: 0, screenY: 0, bubbles: true })
    );
    head.dispatchEvent(new Pointer('pointermove', { screenX: 10, screenY: 10, bubbles: true }));
    expect(api.calls.some((call) => call.name === 'win.move')).toBe(false);

    head.dispatchEvent(
      new Pointer('pointerdown', { button: 0, screenX: 100, screenY: 100, bubbles: true })
    );
    head.dispatchEvent(new Pointer('pointermove', { screenX: 140, screenY: 90, bubbles: true }));
    head.dispatchEvent(new Pointer('pointerup', { bubbles: true }));
    head.dispatchEvent(new Pointer('pointermove', { screenX: 200, screenY: 200, bubbles: true }));

    expect(api.calls.find((call) => call.name === 'win.move').args).toEqual([{ dx: 40, dy: -10 }]);
  });

  it('switches tabs from the buttons and from the main process', () => {
    const tutorialTab = $sel('[data-tab="tutorial"]');
    tutorialTab.click();

    expect(tutorialTab.getAttribute('aria-selected')).toBe('true');
    expect($id('pg-tutorial').hidden).toBe(false);
    expect($id('pg-settings').hidden).toBe(true);

    api.emitTab('settings');
    expect($id('pg-settings').hidden).toBe(false);
    expect($id('pg-tutorial').hidden).toBe(true);
  });

  it('applies settings broadcasts', async () => {
    api.emitSettings({ theme: 'mono', rounds: 2, locked: true, opacity: 0.2 });
    await flush();

    expect($sel('.s-theme.on').dataset.id).toBe('mono');
    expect(inputOf('rounds').value).toBe('2');
    expect($id('lock').textContent).toBe(STRINGS.lockOn);
    expect(rangeByKey('opacity').value).toBe('20');
  });

  it('runs the tutorial controls and stops cleanly', async () => {
    vi.useFakeTimers();
    $id('replay').click();
    vi.advanceTimersByTime(250);
    await flush();

    expect($id('pg-tutorial').hidden).toBe(false);
    const dots = $all('#tDots button');
    expect(dots).toHaveLength(STRINGS.tutorial.length);
    expect(dots[0].getAttribute('aria-label')).toBe(
      STRINGS.stepLabel(0, STRINGS.tutorial[0].title)
    );
    expect($id('tTitle').textContent).toBe(STRINGS.tutorial[0].title);

    dots[2].click();
    vi.advanceTimersByTime(250);
    await flush();
    expect(dots[2].classList.contains('on')).toBe(true);

    $id('tNext').click();
    vi.advanceTimersByTime(250);
    await flush();
    expect(dots[3].classList.contains('on')).toBe(true);

    $id('tPrev').click();
    vi.advanceTimersByTime(250);
    await flush();
    expect(dots[2].classList.contains('on')).toBe(true);

    const auto = $id('tAuto');
    auto.click();
    expect(auto.getAttribute('aria-pressed')).toBe('false');
    expect(auto.textContent).toBe(STRINGS.autoPlayOff);
    auto.click();
    expect(auto.getAttribute('aria-pressed')).toBe('true');
    expect(auto.textContent).toBe(STRINGS.autoPlayOn);

    settings.switchTab('settings');
    vi.advanceTimersByTime(1_000);
    await flush();
    expect($id('pg-settings').hidden).toBe(false);
    vi.useRealTimers();
  });
});
