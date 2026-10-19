# Architecture

Ember is a single Electron application with one renderer window (the widget) and
an optional second window (settings). This document records where code lives,
how the pieces talk to each other, and the rules that keep it that way.

## Layout

```
src/
  main/index.js                 Electron main process: windows, IPC, shortcuts, state file
  preload/index.js              contextBridge surface exposed to renderers as window.ember
  renderer/
    widget/index.html           the always-on-top timer strip
    widget/widget.css           widget and settings styling
    settings/index.html         settings + tutorial window
    shared/common.js            presets, themes, defaults and colour helpers shared by both windows
  core/                         pure ES modules (timer, settings schema, ruler geometry)
    package.json                declares "type": "module" for this subtree only
    README.md                   the purity rule for src/core
docs/
  adr/                          architecture decision records
  ARCHITECTURE.md               this file
  DELIVERY-PLAN.md              wave-by-wave delivery plan
electron-builder.yml            packaging configuration (Windows portable target)
vitest.config.js                unit-test runner and coverage thresholds
playwright.config.js            end-to-end runner configuration
test/e2e/                       Playwright tests that launch the real Electron app
```

## Process model and data flow

1. `src/main/index.js` starts, loads persisted state from
   `<userData>/ember.json`, creates the widget window and registers global
   shortcuts.
2. `src/preload/index.js` runs with `contextIsolation: true` and exposes a small
   API object on `window.ember`. Renderers never touch Node or Electron directly.
3. The widget renderer calls `window.ember.getState()` once, then keeps its own
   timer running locally. Every user action is forwarded to the main process as
   an IPC message (`state:set`, `win:mini`, `win:lock`, `win:move`,
   `settings:open`, `menu:show`, `app:quit`).
4. The main process is the single writer of persisted state. It applies the
   patch, writes `<userData>/ember.json` on a 250 ms debounce, then broadcasts
   the new public state to every window on the `settings` channel.
5. The settings window renders from the same broadcast, so both windows stay in
   sync without a shared store library.

Later changes move the timer itself into the main process (ADR 0001) and swap
the hand-rolled state file for a versioned settings store (ADR 0003). The IPC
surface is the seam where that happens.

## Standing rules

- **`src/core` stays pure.** No Electron, no DOM, no ambient clock, no file or
  network access. Time and persistence are passed in. See `src/core/README.md`.
- **Module formats are fixed per subtree.** `src/core` is ESM; the Electron entry
  points and the renderer scripts stay CommonJS/classic scripts. See
  `docs/adr/0004-core-module-format.md`.
- **The main process owns persisted state.** Renderers request changes; they
  never write the state file.
- **No behaviour changes ride along with refactors.** Layout moves and tooling
  changes are separate commits that keep the app starting at every step.
- **Every automated test gets its own profile.** When `EMBER_TEST=1` the app
  reads `EMBER_USER_DATA` for its settings file and log directory and refuses to
  start without it; without `EMBER_TEST` the variable is ignored.
- **Coverage ratchets.** `vitest.config.js` enforces 80% lines/branches overall
  and 95% on `src/core`; thresholds are never lowered to make a change pass.
