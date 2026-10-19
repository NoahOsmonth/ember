# ADR 0004: Core modules are ES modules

- **Status:** accepted
- **Date:** 2026-10-19

## Context

The prototype is a single CommonJS package. `main.js` and `preload.js` are
loaded by Electron as CommonJS, and the renderer scripts are classic browser
scripts. New pure logic (timer state machine, settings schema, ruler geometry)
needs unit tests, and Vitest is ESM-native.

Switching the whole package to `"type": "module"` would force `main.js` and
`preload.js` to become ESM. Electron can load ESM entry points, but the preload
script cannot be ESM while it runs with `sandbox: true`, which is the sandboxing
model we want once the timer moves into the main process.

## Decision

`src/core` is an ES module subtree, marked by its own
`src/core/package.json` containing `{"type": "module"}`. Everything outside
`src/core` keeps the package default of CommonJS.

## Consequences

- Node, Vitest and the TypeScript checker all read the nested `package.json`, so
  `src/core` files are parsed as ESM without extra configuration.
- `src/core` modules can use `import`/`export` and are loaded by the main and
  renderer processes through normal `import()` or bundling later.
- The purity rule in `src/core/README.md` keeps this subtree host-agnostic.
- `package.json` at the repository root must never gain `"type": "module"`
  without revisiting this decision.
