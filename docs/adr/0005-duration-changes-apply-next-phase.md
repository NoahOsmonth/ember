# ADR 0005: Duration changes apply at the next phase

- **Status:** accepted
- **Date:** 2026-10-19

## Context

The settings window can change the focus, short-break and long-break durations
while a phase is running. Applying a new duration to the phase the user is
watching would move the end instant under them: a 25-minute focus changed to 50
minutes halfway through would either jump backwards or silently add 25 minutes.
Neither is acceptable for a timer whose promise is that the remaining time is
correct.

## Decision

A duration change never alters the phase that is already running or paused.

- The timer keeps the current phase's `durationMs` and `endsAtWall` as its own
  state, separate from the settings document.
- `applySettings()` stores the new settings and bumps `settingsRevision`. While
  the status is `running` or `paused`, it leaves the current duration, end
  instant and remaining time untouched.
- The new durations are read when the next phase is selected, so the phase after
  the current one uses them.
- While the status is `idle` (and while a phase is selected but not started,
  `done`), nothing is being watched, so the new duration applies immediately.
- The snapshot carries `durationMs` and `settingsRevision`, so a restored timer
  keeps the duration it started with even if the settings file changed.

## Consequences

- The countdown never jumps because of a settings edit.
- A user who changes the focus duration during a focus sees the change on the
  next focus, not the current one. The settings UI can show that explicitly.
- The timer has one extra piece of state (`durationMs`) and one revision field;
  both are part of the persisted snapshot contract.
- A future "apply now" control would need an explicit reset or restart, not a
  settings write.
