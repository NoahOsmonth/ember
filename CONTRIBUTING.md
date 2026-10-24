# Contributing to Ember

Thanks for helping. This repository is small on purpose: one Electron app, one
test stack, one release target. Keep it that way.

## Prerequisites

- Node.js 22 or newer (`node --version`)
- npm 10 or newer (ships with Node 22)
- On Linux, building the Windows portable exe needs `wine` on `PATH`

## Set up

```sh
git clone <repository-url> ember
cd ember
npm ci
```

`npm ci` installs from `package-lock.json` and runs the `prepare` script, which
installs the pre-commit hook.

## Commands

Every command below is defined in `package.json`; run them from the repository
root.

| Command                 | What it does                                           |
| ----------------------- | ------------------------------------------------------ |
| `npm start`             | Launch the widget against the working tree.            |
| `npm run lint`          | ESLint over the whole repository.                      |
| `npm run typecheck`     | `tsc` over the JSDoc-annotated JavaScript (`checkJs`). |
| `npm test`              | Run the unit suite once.                               |
| `npm run test:watch`    | Re-run unit tests on change.                           |
| `npm run test:cov`      | Run unit tests with V8 coverage and thresholds.        |
| `npm run test:mutation` | Run Stryker over `src/core/timer.js` (70% floor).      |
| `npm run test:e2e`      | Run the Playwright launch tests against the real app.  |
| `npm run test:visual`   | Run the visual regression suite (Windows baselines).   |
| `npm run format`        | Prettier over the repository.                          |
| `npm run format:check`  | Verify formatting without writing.                     |
| `npm run dist`          | Build the Windows portable exe into `dist/`.           |
| `npm run prepare`       | Install the git hooks (runs automatically on install). |

A pre-commit hook runs ESLint and Prettier on staged JavaScript files. Fix the
reported problem and commit again; do not bypass the hook with
`--no-verify`.

## Repository rules

- `src/core` is pure: no Electron, no DOM, no ambient clock, no file access.
  See `src/core/README.md`.
- `src/core` is an ES module subtree; everything else is CommonJS. Do not add
  `"type": "module"` to the root `package.json`. See
  `docs/adr/0004-core-module-format.md`.
- The main process owns persisted state. Renderers ask; they never write.
- Refactors and behaviour changes land in separate commits, and the app starts
  at every commit.
- Decisions that constrain later work get an ADR in `docs/adr/` before the code
  that depends on them.

## Tests

- Unit tests live next to the modules they cover and run under Vitest with
  jsdom available. Property-based tests use fast-check.
- End-to-end tests live in `test/e2e` and launch the real Electron binary
  through the Playwright Electron driver.
- Tests must be deterministic: never sleep, never read the real clock, never
  depend on the network.
- A test run must never touch the developer's real profile. Launch the app with
  `EMBER_TEST=1` and `EMBER_USER_DATA` pointing at an absolute throwaway
  directory; the app refuses to start if the variable is missing or relative.
- Coverage thresholds (80% overall, 95% on `src/core`) are a floor. Raising them
  is welcome; lowering them is not.
- Mutation testing is scoped to the module a change adds. The current gate is
  `src/core/timer.js` at 70% (`npm run test:mutation`); widen `mutate` in
  `stryker.config.json` as more core modules gain focused tests.
- Do not commit `test.skip`, `.only` or disabled suites, except the documented
  Windows-only visual matrix.

### Visual baselines

The visual suite compares 20 screenshots: the compact widget at 100 %, 125 %
and 150 % scaling, in the idle, running and paused states, in the dusk and mono
palettes, plus the settings window in both palettes. Baselines are committed and
Windows-only; the suite is skipped on other platforms.

When a change intentionally moves something visual:

1. Run the suite on Windows with `npm run test:visual -- --update-snapshots`.
2. Inspect every changed image; do not update a baseline you have not looked at.
3. Commit the baselines in the same commit as the visual change and name the
   affected cases in the commit message.

A missing baseline fails the run instead of being written silently. The
comparison tolerance is the single `MAX_DIFF_PIXEL_RATIO` constant in
`test/visual/tolerance.js`.

## Pull requests

1. Run `npm run lint`, `npm run typecheck`, `npm test` and `npm run dist`
   before pushing.
2. Keep the CI job green; it runs the same commands on Windows.

## Commit messages

Short imperative subject lines, optionally prefixed by area:
`core:`, `main:`, `renderer:`, `test:`, `docs:`, `build:`, `chore:`. Explain the
why in the body when the change is not obvious.
