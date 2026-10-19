'use strict';

/**
 * Measure the renderer's idle CPU cost over a paused window.
 *
 * The widget is started, paused, and left alone for the measurement window.
 * Electron reports each process's CPU since the previous `getAppMetrics()`
 * call, so one call before the wait and one after yields the average over
 * exactly that window.
 *
 * Usage:
 *   node scripts/measure-idle-cpu.js [--window=60000] [--baseline=0.2]
 *
 * The recorded value lives in `test/fixtures/idle-cpu-baseline.json`. A result
 * more than one percentage point above the baseline fails the check, which is
 * the budget the release checklist states.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('@playwright/test');

const ROOT = path.join(__dirname, '..');
const BASELINE_FILE = path.join(ROOT, 'test/fixtures/idle-cpu-baseline.json');
const TOLERANCE = 1;

function argument(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((value) => value.startsWith(prefix));
  if (!found) return fallback;
  const parsed = Number(found.slice(prefix.length));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBaseline() {
  try {
    const document = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
    return Number.isFinite(document.rendererPercent) ? document.rendererPercent : null;
  } catch {
    return null;
  }
}

async function main() {
  const windowMs = Math.max(1_000, argument('window', 60_000));
  const baseline = argument('baseline', readBaseline());
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-idle-cpu-'));
  const env = { ...process.env, EMBER_TEST: '1', EMBER_USER_DATA: profile };
  const extra = (process.env.EMBER_E2E_ELECTRON_ARGS || '').split(/\s+/).filter(Boolean);

  const app = await electron.launch({ args: ['.', ...extra], env, cwd: ROOT });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => {
      const digits = globalThis.document.querySelector('#digits');
      return !!digits && /^\d{2}:\d{2}$/.test((digits.textContent || '').trim());
    });

    // The first run opens the tutorial, which animates. It may arrive a beat
    // after the widget, so close extras over a few rounds until only the
    // widget's renderer remains.
    for (let round = 0; round < 6; round += 1) {
      const remaining = await app.evaluate(({ BrowserWindow }) => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.webContents.getURL().includes('/widget/')) win.close();
        }
        return BrowserWindow.getAllWindows().length;
      });
      if (remaining === 1 && round >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    await page.evaluate(() => /** @type {any} */ (globalThis).ember.timer.start());
    await page.waitForTimeout(400);
    await page.evaluate(() => /** @type {any} */ (globalThis).ember.timer.pause());
    await page.waitForTimeout(600);

    const status = await page.evaluate(() => /** @type {any} */ (globalThis).ember.timer.get());
    if (!status.ok || status.value.status !== 'paused') {
      throw new Error(`expected a paused timer, got ${JSON.stringify(status)}`);
    }

    // Reset the per-process sampling window, then measure across the wait.
    await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics());
    const startedAt = Date.now();
    await new Promise((resolve) => setTimeout(resolve, windowMs));
    const metrics = await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics());
    const elapsedMs = Date.now() - startedAt;

    // `getAppMetrics()` reports renderer processes as "Tab" on every platform;
    // "Renderer" appears in the older Chromium-shaped listings some docs show.
    const renderers = metrics.filter((entry) => {
      const type = String(entry.type);
      return type === 'Tab' || type === 'Renderer';
    });
    const rendererPercent = renderers.reduce(
      (sum, entry) =>
        sum + (entry.cpu && entry.cpu.percentCPUUsage ? entry.cpu.percentCPUUsage : 0),
      0
    );
    const appPercent = metrics.reduce(
      (sum, entry) =>
        sum + (entry.cpu && entry.cpu.percentCPUUsage ? entry.cpu.percentCPUUsage : 0),
      0
    );

    const report = {
      windowMs: elapsedMs,
      rendererPercent: Number(rendererPercent.toFixed(2)),
      appPercent: Number(appPercent.toFixed(2)),
      rendererProcesses: renderers.length,
      baselinePercent: baseline,
    };
    process.stdout.write(`${JSON.stringify(report)}\n`);

    if (Number.isFinite(baseline) && rendererPercent > baseline + TOLERANCE) {
      process.stderr.write(
        `idle CPU regression: ${rendererPercent.toFixed(2)}% exceeds ` +
          `${baseline}% baseline by more than ${TOLERANCE} point\n`
      );
      process.exitCode = 1;
    }
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
