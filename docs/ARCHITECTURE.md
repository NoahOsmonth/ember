# Architecture

Ember is a single Electron application with one renderer window (the widget) and
an optional second window (settings). This document records where code lives,
how the pieces talk to each other, and the rules that keep it that way.

## Layout

```
src/
  main/index.js                 Electron main process: windows, IPC, shortcuts, wiring
  main/ipc.js                   channel registry: validation, envelopes, error logging
  main/channels.js              the channel contract: names, kinds, payload schemas
  main/clock.js                 the one main-process clock; tests move its offset
  main/timer-service.js         the single timer owner: tick, persist, broadcast
  main/test-support.js          test-only IPC channels, registered only in test mode
  main/store.js                 durable settings store: validation, atomic writes, recovery
  main/logger.js                rotating diagnostic log that never throws
  main/security.js              hardened webPreferences, navigation guards, openExternal allowlist
  main/power.js                 suspend/resume, clock-jump policy, display and unlock reassertion
  main/shortcuts.js             global shortcut ownership: per-binding status, rebind, reset
  main/windows/widget-window.js widget creation, bounds, main-process drag, placement persistence
  preload/index.js              explicit contextBridge surface exposed as window.ember
  renderer/
    widget/index.html           the always-on-top timer strip (markup + CSP only)
    widget/widget.js            ES module: paints snapshots, forwards every action as IPC
    widget/widget.css           widget and settings styling
    settings/index.html         settings + tutorial window (markup + CSP only)
    settings/settings.js        ES module: form state, presets, tutorial carousel
    shared/common.js            ES module facade over core: presets, defaults, chime, re-exports
    shared/dom.js               el(), on(), text(), setStyle() — the only DOM helpers
    shared/strings.js           every user-visible string, plus phase/status labels
    shared/scheduler.js         createScheduler(): 1 Hz ticks and on-demand rAF frames
  core/                         pure ES modules (timer, settings schema, ruler geometry, palettes)
    package.json                declares "type": "module" for this subtree only
    schema.js                   versioned settings document: defaults, limits, migrations, normalize()
    validate.js                 IPC payload shapes: string, number, boolean, enum, object, array, optional
    placement.js                pure work-area clamp, right dock, display pick, scale fit
    contrast.js                 WCAG contrast for the theme tokens and the glass base
    timer.js                    pure phase/status state machine driven by an injected clock
    ruler.js                    unitFor() and computeRuler(): bars and fill fractions from ms
    themes.js                   THEMES, themeNames(), resolveTheme(), barColor()
    README.md                   the purity rule for src/core
docs/
  adr/                          architecture decision records
  ARCHITECTURE.md               this file
electron-builder.yml            packaging configuration (Windows portable target)
vitest.config.js                unit-test runner and coverage thresholds
playwright.config.js            e2e and visual runner configuration
test/e2e/                       Playwright tests that launch the real Electron app
test/visual/                    fixture gallery and committed visual baselines
```

## Process model and data flow

1. `src/main/index.js` starts, brings up the settings store
   (`src/main/store.js`, schema from `src/core/schema.js`), constructs the
   timer service (`src/main/timer-service.js`), restores the saved timer,
   creates the widget through `src/main/windows/widget-window.js`, and
   registers global shortcuts.
2. `src/preload/index.js` runs with `contextIsolation: true` and exposes one
   named method per channel on `window.ember`, grouped by domain
   (`ember.state.get()`, `ember.win.mini()`, `ember.timer.start()`, …).
   Renderers never touch Node or Electron directly, and there is no generic
   pass-through.
3. The widget renderer subscribes to `timer:snapshot` and renders the last
   snapshot it received. It never computes authoritative remaining time from
   its own clock. Every user action is forwarded to the main process as an IPC
   message (`timer:*`, `state:set`, `win:mini`, `win:lock`, `win:dragStart`,
   `win:dragEnd`, `win:move`, `settings:open`, `menu:show`, `app:quit`).
   Invokes resolve to `{ ok: true, value }` or `{ ok: false, code }`; sends
   return nothing.
4. The main process is the single writer of persisted state. It merges the
   patch, hands the result to the store, and the store validates it against the
   schema before scheduling one coalesced write (250 ms) of
   `<userData>/ember.json`; the new public state is then broadcast to every
   window on the `settings` channel. The timer service writes its own snapshot
   through the same store on every structural change and at most every 5 s while
   running.
5. The settings window renders from the same broadcast, so both windows stay in
   sync without a shared store library.
6. Writes are atomic (temporary file, flush, rename) and a damaged file is
   renamed to `ember.json.bak-<timestamp>` before defaults take over; the
   `state:get` payload carries `settingsRecovered` so the UI can say so once.
   Diagnostics go to a rotating log under `<logs>/ember.log`, controlled by
   `EMBER_LOG` (see `docs/adr/0003-versioned-settings.md`).

## Timer state machine

`src/core/timer.js` is the timer. It is pure and host-driven: the host calls
`tick(now)` and the machine derives the remaining time from `endsAtWall`. It
never schedules anything, so a suspended host wakes to the correct value instead
of a counter that stopped. `src/main/timer-service.js` is its only owner: one
instance per run, a 500 ms tick while running, persistence through the settings
store, and a `timer:snapshot` push to every window.

- Phases: `focus`, `short`, `long`. Statuses: `idle`, `running`, `paused`,
  `done`. An illegal transition is a no-op, never a throw.
- Events: `phase-started`, `phase-complete`, `missed-while-away`. They are
  emitted synchronously after the state is consistent, so a listener reading
  `snapshot()` inside `phase-complete` sees the new phase.
- A completed focus increments the round counter; the configured count selects
  a long break; completing or skipping a long break resets the counter; a
  skipped focus credits nothing and emits no `phase-complete`.
- `applySettings()` stores the new settings and bumps `settingsRevision`, but a
  running or paused phase keeps its duration and end instant. The next phase
  reads the new durations (ADR 0005).
- `snapshot()` is JSON-safe. `restore(saved, now)` advances at most one phase,
  lands paused, and reports at most one `phase-complete` and one
  `missed-while-away` after a long sleep.

The service restores before the first window, queues a missed-phase notice for
the first `timer:subscribe`, and forwards `phase-complete` to the notification
hook. The widget only renders snapshots and sends commands; a reload re-reads
the snapshot from the service.

`src/main/power.js` owns every `powerMonitor` and display subscription. A resume
reconciles from `endsAtWall` through the same restore path, marks a crossed
phase `quiet` so no chime plays, and reports it once with the away duration. A
wall-versus-monotonic divergence beyond `JUMP_THRESHOLD_MS` (60 s) is a clock
jump: backwards re-anchors the end instant to preserve the remaining time,
forwards counts as elapsed (ADR 0006). Unlock and display changes re-apply the
always-on-top level and re-clamp the widget into a work area.

## Window placement

`src/main/windows/widget-window.js` owns the widget's geometry; the renderer
never computes a position. On `win:dragStart` the main process records the
offset between the cursor and the window corner once, then polls
`screen.getCursorScreenPoint()` every 16 ms and calls `setPosition` while
`win:dragEnd` has not arrived. Cursor and window bounds are both in DIPs, so a
150 % display needs no conversion, the drag keeps tracking outside the window,
and the offset cannot accumulate error. Unchanged positions are skipped.

`src/core/placement.js` holds the arithmetic: `clampToWorkArea`,
`dockRight`, `pickDisplay` and `nextScaleFactor`, all pure and property-tested.
Every move is clamped to the work area of the display it overlaps. The saved
`placement` record is `{ x, y, width, height, displayId, scaleFactor }`, written
after a drag (debounced 200 ms) and on quit. On restore the display is matched
by id; if it is gone, the widget starts centred on the primary display rather
than at a stale absolute coordinate. `display-added`, `display-removed`,
`display-metrics-changed` and resume all re-clamp. Toggling compact mode keeps
the right edge fixed, and `win:dock` moves the widget to the right edge.

The schema accepts the pre-placement root `{ x, y }` (and a nested `window`
object) and converts it to `placement` once; the old keys are not written again.

## Rendering fallbacks and accessibility

`render.background` is `auto` (the default), `transparent` or `solid`. The main
process resolves the effective value and publishes it as `solid` in the public
state. `EMBER_SOLID=1` forces it for support diagnosis; two
`child-process-gone` events of type `GPU` in one session do the same for the
rest of that session (the decision is not persisted, so a driver update restores
the intended look). The renderer toggles `html.solid`, which paints `#app`
opaque. `solidOverride` (`env` or `gpu`) lets the widget explain a GPU fallback
once and lets the settings window report the environment override.

The widget is operable without sight: every control carries an `aria-label`,
the digits are `role="timer"` with `aria-live="off"`, and one polite live region
announces each phase transition (never each tick). Controls use an inset
`:focus-visible` ring and the hidden control row becomes visible on
`#app:focus-within`, so tab order matches the visual order. `@media
(forced-colors: active)` maps the palette to Canvas/CanvasText/Highlight, and
`prefers-reduced-motion: reduce` removes the bar, fuse and breathing animations.
The digits use `font-variant-numeric: tabular-nums` over a stable font stack, so
the timer does not shift horizontally as seconds change.

`src/core/contrast.js` converts the theme's oklch tokens to sRGB, computes WCAG
relative luminance and exposes `contrastRatio` and `themeContrast`. The unit
test requires 4.5:1 for every focus-accent sample and the dimmest label against
the solid glass base; the settings window runs the same computation and shows a
warning if a theme ever drops below the floor.

## Renderer security and scheduling

Every window is created through `src/main/security.js`, which states all four
preferences explicitly: `sandbox: true`, `contextIsolation: true`,
`nodeIntegration: false`, `webviewTag: false`. The same module installs two
guards per window: `will-navigate` cancels anything except a reload of the same
`file:` path (query strings are allowed, so `?tab=tutorial` works), and
`setWindowOpenHandler` denies every `window.open`. `openExternal(url)` is the
only path to the OS browser and accepts only `https:` and `mailto:`.

Each HTML page carries the same CSP as a meta tag:
`default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:`. There are no inline scripts and no `on*` attributes; the
pages load their ES module with `<script type="module">`.

Painting is driven by `src/renderer/shared/scheduler.js`:

- a 1 Hz tick updates the digits, and only while the status is `running`;
- a requestAnimationFrame loop repaints bars and the fuse only while a value
  actually differs from the last painted one;
- both loops stop on `paused`, `idle` and `done`, so a paused window is
  effectively static. `scripts/measure-idle-cpu.js` measures that floor and
  compares it with `test/fixtures/idle-cpu-baseline.json` (one percentage point
  of tolerance).

## IPC channels

Every channel is declared once in `src/main/channels.js` with a name, a kind, a
payload schema and a handler. The registry validates the payload before the
handler runs and returns an envelope instead of throwing.

| Channel           | Kind   | Payload                         | Result                 |
| ----------------- | ------ | ------------------------------- | ---------------------- |
| `state:get`       | invoke | none                            | the public state       |
| `state:set`       | invoke | partial settings object, strict | the merged state       |
| `state:reset`     | invoke | none                            | the default state      |
| `win:dragStart`   | send   | `{ x, y }` numbers              | none                   |
| `win:dragEnd`     | send   | none                            | none                   |
| `win:dock`        | invoke | none                            | the clamped bounds     |
| `win:setScale`    | invoke | `{ scaleFactor }` number        | `{ scaleFactor }`      |
| `win:move`        | send   | `{ dx, dy }` numbers            | none                   |
| `win:mini`        | invoke | `{ mini }` boolean              | none                   |
| `win:lock`        | invoke | `{ locked }` boolean            | none                   |
| `win:close`       | send   | none                            | none                   |
| `app:quit`        | send   | none                            | none                   |
| `menu:show`       | send   | none                            | none                   |
| `settings:open`   | invoke | `{ tab? }`                      | none                   |
| `timer:get`       | invoke | none                            | the snapshot           |
| `timer:start`     | invoke | none                            | the snapshot           |
| `timer:pause`     | invoke | none                            | the snapshot           |
| `timer:toggle`    | invoke | none                            | the snapshot           |
| `timer:skip`      | invoke | none                            | the snapshot           |
| `timer:reset`     | invoke | none                            | the snapshot           |
| `timer:subscribe` | invoke | none                            | `{ snapshot, notice }` |
| `shortcuts:get`   | invoke | none                            | `{ safeMode, bindings }` |
| `shortcuts:rebind` | invoke | `{ id, accelerator }`          | the rebind result      |
| `shortcuts:reset` | invoke | none                            | the rebind result      |
| `shortcuts:check` | invoke | none                            | `{ safeMode, bindings }` |

`timer:snapshot` and `timer:phase-complete` are push channels from main to every
window; they are not request channels and have no registry entry.

Global shortcuts are owned by `src/main/shortcuts.js`. Every registration
result is recorded: a combination another application owns is reported as
`unavailable` instead of being dropped, and a stored duplicate is reported as
`conflict`. A rebind registers the candidate while the old binding is still
held, then releases the old one and persists; a rejection leaves the old
binding active. `reset` restores the defaults, and safe mode registers nothing.

Failure codes are `invalid-payload` (with `issues`), `handler-error`, and
`unknown-channel`. The preload maps Electron's unknown-handler rejection to the
last one, so a drifted surface resolves instead of rejecting.

## Standing rules

- **`src/core` stays pure.** No Electron, no DOM, no ambient clock, no file or
  network access. Time and persistence are passed in. See `src/core/README.md`.
- **Module formats are fixed per subtree.** `src/core` and the renderer modules
  are ESM; the Electron entry points (`src/main`, `src/preload`) stay CommonJS.
  The root package has no `"type": "module"`. See
  `docs/adr/0004-core-module-format.md`.
- **The main process owns persisted state.** Renderers request changes; they
  never write the state file.
- **Exactly one timer exists per run.** It lives in the main process
  (`src/main/timer-service.js`); renderers are views over its snapshots and must
  not construct a second state machine.
- **A channel must not assume its sender.** If a channel needs a window, it
  takes an explicit window identifier in its payload (for example
  `{ windowId, tab }`), so the same call has the same meaning from either
  renderer. The window-scoped exceptions are `win:move`, `win:close`,
  `win:dragStart` and `win:dragEnd`: their meaning is "act on the window that
  sent this", and they use `BrowserWindow.fromWebContents(event.sender)`
  deliberately. `win:dock` is widget-scoped by definition.
- **No behaviour changes ride along with refactors.** Layout moves and tooling
  changes are separate commits that keep the app starting at every step.
- **Every automated test gets its own profile.** When `EMBER_TEST=1` the app
  reads `EMBER_USER_DATA` for its settings file and log directory and refuses to
  start without it; without `EMBER_TEST` the variable is ignored.
- **Coverage ratchets.** `vitest.config.js` enforces 80% lines/branches overall
  and 95% on `src/core`; thresholds are never lowered to make a change pass.
