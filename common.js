/* Shared by the widget, the settings window and the tutorial. */
window.EmberCommon = (() => {
  const PRESETS = {
    classic:  { name: 'Classic',  focus: 25, short: 5,  long: 15 },
    deep:     { name: 'Deep',     focus: 50, short: 10, long: 30 },
    sprint:   { name: 'Sprint',   focus: 15, short: 3,  long: 10 },
    marathon: { name: 'Marathon', focus: 90, short: 20, long: 30 },
  };

  // focus bars travel from h0 to h1 (oklch hue), lightness L0 to L1
  const THEMES = {
    dusk:  { name: 'Dusk',  h0: 255, h1: 385, L0: .79, L1: .75, C0: .16, C1: .19 },
    tide:  { name: 'Tide',  h0: 245, h1: 170, L0: .78, L1: .86, C0: .14, C1: .14 },
    solar: { name: 'Solar', h0: 95,  h1: 25,  L0: .88, L1: .74, C0: .15, C1: .19 },
    mono:  { name: 'Mono',  h0: 0,   h1: 0,   L0: .6,  L1: .98, C0: 0,   C1: 0 },
  };

  const DEFAULTS = {
    durations: { focus: 25, short: 5, long: 15 },
    rounds: 4, autoBreak: true, autoFocus: false,
    sound: true, volume: 0.6, notify: true,
    theme: 'dusk', opacity: 0.62, mini: false, onTop: true,
  };

  function barColor(theme, phase, i, n) {
    const t = n > 1 ? i / (n - 1) : 0;
    const k = THEMES[theme] || THEMES.dusk;
    if (phase === 'focus') {
      const L = k.L0 + (k.L1 - k.L0) * t, C = k.C0 + (k.C1 - k.C0) * t, h = k.h0 + (k.h1 - k.h0) * t;
      return `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${h.toFixed(1)})`;
    }
    if (theme === 'mono') return 'oklch(.9 0 0)';
    return phase === 'short'
      ? `oklch(.86 .115 ${172 + 40 * t})`
      : `oklch(.84 .12 ${205 + 35 * t})`;
  }

  let ac;
  function chime(was, volume = 0.6) {
    try {
      ac = ac || new AudioContext();
      const t = ac.currentTime, peak = Math.max(.01, .3 * volume);
      (was === 'focus' ? [523.25, 659.25, 783.99] : [783.99, 587.33]).forEach((f, i) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + i * .16);
        g.gain.exponentialRampToValueAtTime(peak, t + i * .16 + .03);
        g.gain.exponentialRampToValueAtTime(.0001, t + i * .16 + 1.3);
        o.connect(g).connect(ac.destination);
        o.start(t + i * .16); o.stop(t + i * .16 + 1.4);
      });
    } catch {}
  }

  const unitFor = min => Math.max(1, Math.ceil(min / 30));

  return { PRESETS, THEMES, DEFAULTS, barColor, chime, unitFor };
})();
