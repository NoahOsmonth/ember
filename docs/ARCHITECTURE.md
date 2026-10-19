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
  main/test-support.js          test-only IPC channels, registered only in test mode
  main/store.js                 durable settings store: validation, atomic writes, recovery
  main/logger.js                rotating diagnostic log that never throws
  preload/index.js              explicit contextBridge surface exposed as window.ember
  renderer/
    widget/index.html           the always-on-top timer strip
    widget/widget.css           widget and settings styling
    settings/index.html         settings + tutorial window
    shared/common.js            ES module facade over core: presets, defaults, chime, re-exports
  core/                         pure ES modules (timer, settings schema, ruler geometry, palettes)
    package.json                declares "type": "module" for this subtree only
    schema.js                   versioned settings document: defaults, limits, migrations, normalize()
    validate.js                 IPC payload shapes: string, number, boolean, enum, object, array, optional
    timer.js                    pure phase/status state machine driven by an injected clock
    ruler.js                    unitFor() and computeRuler(): bars and fill fractions from ms
    themes.js                   THEMES, themeNames(), resolveTheme(), barColor()
    README.md                   the purity rule for src/core
docs/
  adr/                          architecture decision records
  ARCHITECTURE.md               this file
  DELIVERY-PLAN.md              wave-by-wave delivery plan
electron-builder.yml            packaging configuration (Windows portable target)
vitest.config.js                unit-test runner and coverage thresholds
playwright.config.js            e2e and visual runner configuration
test/e2e/                       Playwright tests that launch the real Electron app
test/visual/                    fixture gallery and committed visual baselines
```

## Process model and data flow

1. `src/main/index.js` starts, brings up the settings store
   (`src/main/store.js`, schema from `src/core/schema.js`), creates the widget
   window and registers global shortcuts.
2. `src/preload/index.js` runs with `contextIsolation: true` and exposes one
   named method per channel on `window.ember`, grouped by domain
   (`ember.state.get()`, `ember.win.mini()`, …). Renderers never touch Node or
   Electron directly, and there is no generic pass-through.
3. The widget renderer calls `ember.state.get()` once, then keeps its own timer
   running locally. Every user action is forwarded to the main process as an
   IPC message (`state:set`, `win:mini`, `win:lock`, `win:move`,
   `settings:open`, `menu:show`, `app:quit`). Invokes resolve to
   `{ ok: true, value }` or `{ ok: false, code }`; sends return nothing.
4. The main process is the single writer of persisted state. It merges the
   patch, hands the result to the store, and the store validates it against the
   schema before scheduling one coalesced write (250 ms) of
   `<userData>/ember.json`; the new public state is then broadcast to every
   window on the `settings` channel.
5. The settings window renders from the same broadcast, so both windows stay in
   sync without a shared store library.
6. Writes are atomic (temporary file, flush, rename) and a damaged file is
   renamed to `ember.json.bak-<timestamp>` before defaults take over; the
   `state:get` payload carries `settingsRecovered` so the UI can say so once.
   Diagnostics go to a rotating log under `<logs>/ember.log`, controlled by
   `EMBER_LOG` (see `docs/adr/0003-versioned-settings.md`).

Later changes move the timer itself into the main process (ADR 0001); the IPC
surface is the seam where that happens.

## Timer state machine

`src/core/timer.js` is the timer the rest of the app will adopt. It is pure and
host-driven: the host calls `tick(now)` and the machine derives the remaining
time from `endsAtWall`. It never schedules anything, so a suspended host wakes
to the correct value instead of a counter that stopped.

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

The widget still runs its inline timer until `timer-ownership-in-main` switches
it to this machine.

## IPC channels

Every channel is declared once in `src/main/channels.js` with a name, a kind, a
payload schema and a handler. The registry validates the payload before the
handler runs and returns an envelope instead of throwing.

| Channel         | Kind   | Payload                         | Result              |
| --------------- | ------ | ------------------------------- | ------------------- |
| `state:get`     | invoke | none                            | the public state    |
| `state:set`     | invoke | partial settings object, strict | the merged state    |
| `state:reset`   | invoke | none                            | the default state   |
| `win:move`      | send   | `{ dx, dy }` numbers            | none                |
| `win:mini`      | invoke | `{ mini }` boolean              | none                |
| `win:lock`      | invoke | `{ locked }` boolean            | none                |
| `win:close`     | send   | none                            | none                |
| `app:quit`      | send   | none                            | none                |
| `menu:show`     | send   | none                            | none                |
| `settings:open` | invoke | `{ tab? }`                      | none                |

Failure codes are `invalid-payload` (with `issues`), `handler-error`, and
`unknown-channel`. The preload maps Electron's unknown-handler rejection to the
last one, so a drifted surface resolves instead of rejecting.

## Standing rules

- **`src/core` stays pure.** No Electron, no DOM, no ambient clock, no file or
  network access. Time and persistence are passed in. See `src/core/README.md`.
- **Module formats are fixed per subtree.** `src/core` is ESM; the Electron entry
  points and the renderer scripts stay CommonJS/classic scripts. See
  `docs/adr/0004-core-module-format.md`.
- **The main process owns persisted state.** Renderers request changes; they
  never write the state file.
- **A channel must not assume its sender.** If a channel needs a window, it
  takes an explicit window identifier in its payload (for example
  `{ windowId, tab }`), so the same call has the same meaning from either
  renderer. The two window-scoped exceptions are `win:move` and `win:close`:
  their meaning is "act on the window that sent this", and they use
  `BrowserWindow.fromWebContents(event.sender)` deliberately.
- **No behaviour changes ride along with refactors.** Layout moves and tooling
  changes are separate commits that keep the app starting at every step.
- **Every automated test gets its own profile.** When `EMBER_TEST=1` the app
  reads `EMBER_USER_DATA` for its settings file and log directory and refuses to
  start without it; without `EMBER_TEST` the variable is ignored.
- **Coverage ratchets.** `vitest.config.js` enforces 80% lines/branches overall
  and 95% on `src/core`; thresholds are never lowered to make a change pass.
