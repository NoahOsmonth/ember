# ADR 0002: Monotonic elapsed time, wall-clock display

- **Status:** accepted
- **Date:** 2026-10-19

## Context

A pomodoro timer has to survive three things that a naive `setInterval` counter
does not: interval drift (callbacks arrive late, especially under load), system
clock changes (NTP corrections, timezone/DST edits, a user setting the clock)
and machine sleep. Accumulating `elapsed += 1000` per callback is wrong under
all three, and reading the wall clock alone makes the remaining time jump when
the clock is adjusted.

## Decision

Measure elapsed time monotonically and display it against the wall clock.

- Elapsed time is derived from a monotonic source (performance counters), never
  from the number of callbacks that happened to fire.
- The end of the current phase is stored as an absolute wall-clock instant so
  the UI can show the right remaining time after a resume, a clock adjustment
  or a renderer restart.
- On resume or after a suspend the timer recomputes the remaining time from both
  sources, clamps it into the phase bounds and emits a single corrected tick.
- The clock is injected, so tests use a fake clock and never sleep.

## Consequences

- Laptop sleep and clock changes no longer corrupt the countdown; the worst case
  is one corrected tick when the app wakes up.
- Timer tests are deterministic and fast.
- The app needs an explicit resume hook (power monitor / visibility) instead of
  relying on interval callbacks resuming on their own.
- Anything that needs "time remaining" must read the computed snapshot rather
  than doing its own arithmetic.
