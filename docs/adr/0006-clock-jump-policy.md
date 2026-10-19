# ADR 0006: Clock jumps are classified beyond 60 seconds

- **Status:** accepted
- **Date:** 2026-10-19

## Context

The timer stores each phase's end as a wall-clock instant (`endsAtWall`) and
derives the remaining time from it. That is what makes the countdown survive a
sleep, but it also means a wall-clock correction moves the timer: an NTP step,
a manual clock change or a timezone edit can make a phase end early or gain
time.

Some wall-clock movement is normal. Every operating system adjusts its clock by
milliseconds to seconds, and treating those corrections as jumps would log noise
and re-anchor the phase for no reason. The app therefore needs a threshold that
separates an ordinary correction from a step large enough to be visible to the
user.

## Decision

Compare wall-clock elapsed time with monotonic elapsed time at least once per
second and classify a divergence larger than **60 seconds** as a clock jump.
The threshold is the named constant `JUMP_THRESHOLD_MS` in
`src/main/power.js`.

- **Backwards jump** (`drift < 0`): the phase must not gain the jumped distance.
  Re-anchor `endsAtWall` so the remaining time measured just before the jump is
  preserved, and log the measured delta at warn level.
- **Forwards jump** (`drift > 0`): the time is treated as elapsed. Recompute
  from `endsAtWall` through the same reconcile path a resume uses, so at most
  one phase advances and the completion is reported once without a chime.
- **Small divergence** (`|drift| <= 60 s`): ignored. No log entry, no state
  change.

Sixty seconds is deliberately conservative: it is far above normal NTP
slew/step corrections and far below any correction a user would not notice in a
25-minute countdown.

## Consequences

- A backwards correction preserves the countdown exactly as the user saw it.
- A forwards correction behaves like waking up late: the phase completes, the
  app lands on the next phase paused, and the user is told once.
- Detection has a granularity of the sampling interval (one second), so a jump
  is attributed to the sample where it is observed rather than to the instant it
  happened. The reported delta is still the measured wall-minus-monotonic
  difference.
- Hosts that stop their monotonic counter across sleep fall back to the wall
  delta, which is the only signal available there.
- A correction between one and sixty seconds is absorbed as elapsed time in the
  normal direction. That is the same behaviour the countdown had before this
  policy and is small enough to stay invisible.
