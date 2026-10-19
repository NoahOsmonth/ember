# ADR 0001: The timer is owned by the main process

- **Status:** accepted
- **Date:** 2026-10-19

## Context

The prototype keeps the countdown in the widget renderer: `setInterval` decrements
a number and the renderer decides when a phase ends. That breaks down as soon as
the window is not the user's focus. Chromium throttles timers in hidden and
backgrounded renderers, the widget is deliberately hidden for long stretches
(`Ctrl+Alt+P`), and a settings window or a locked click-through state must not
change when the break ends. The main process is also the only place that can
raise a native notification, update the tray and react to global shortcuts.

## Decision

The main process owns the timer state machine and the phase transitions. The
renderer is a view: it sends commands (start, pause, skip, reset, set durations)
and renders the state it is given. The state machine itself lives in
`src/core` as pure functions so it can be unit-tested without Electron.

## Consequences

- Timer state is authoritative in one place, independent of window visibility,
  renderer reloads and which window has focus.
- The IPC surface grows a timer contract (commands in, snapshots/ticks out).
  It is versioned and documented alongside the existing state channels.
- Notifications, tray status and the progress indicator can read the timer
  directly instead of asking a renderer.
- The renderer may show a slightly stale tick between IPC messages; it must
  never compute a phase transition on its own.
- Tests drive the state machine with an injected clock instead of waiting on
  real timers.
