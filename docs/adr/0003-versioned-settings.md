# ADR 0003: Settings are versioned and migrated

- **Status:** accepted
- **Date:** 2026-10-19

## Context

The prototype writes a flat JSON object to `<userData>/ember.json` and merges it
over the defaults on load. The next changes add, rename and retype settings
(quiet hours, placement, shortcut bindings, timer snapshot). A user who upgrades
still has the old file, and a file written by a newer build must not be silently
downgraded. Plain `JSON.parse` plus a spread also loses data on a half-written
file.

## Decision

Settings are a versioned document with an explicit migration chain.

- The file carries a schema version; version 1 is the first durable shape.
- Loading applies ordered migrations from the file's version to the current one;
  each migration is a pure function tested in `src/core`.
- A file from a newer version is never overwritten: the app keeps it, reports
  the mismatch and runs on defaults until the user acts.
- Writes are atomic (write a temporary file, then rename) and debounced.
- Unreadable or corrupt files are backed up before defaults replace them.

## Consequences

- Upgrades never lose user settings and never silently drop unknown data.
- Every settings change ships with a migration and a test, not just a new
  default.
- The store is a module with an injected file system and clock, which keeps it
  unit-testable and out of the renderer.
- Downgrading the app leaves the newer file intact instead of rewriting it.
