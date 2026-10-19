# Ember core

Pure logic for the timer, the settings schema and the ruler geometry lives here.

## Purity rule

Modules under `src/core` may only depend on their own files and the JavaScript
language itself. They must not:

- import `electron` or any other runtime host,
- touch `window`, `document` or any DOM API,
- read the ambient clock (`Date.now()`, `new Date()`, `performance.now()`),
- read or write files, the network or environment variables,
- import anything from `src/main`, `src/preload` or `src/renderer`.

Time and persistence are passed in by the caller. That keeps every module here
testable with plain Vitest and deterministic under property-based tests.

## Module format

This directory is an ES module boundary: `src/core/package.json` declares
`"type": "module"`. The Electron entry points stay CommonJS so they can run with
`sandbox: true` later. See `docs/adr/0004-core-module-format.md`.
