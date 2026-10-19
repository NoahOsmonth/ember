import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as timerModule from '../../../src/core/timer.js';

const source = fs.readFileSync(path.resolve(process.cwd(), 'src/core/timer.js'), 'utf8');

describe('timer module purity', () => {
  it('imports nothing outside src/core', () => {
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\s*\(/);
  });

  it('never reads the system clock or schedules work', () => {
    expect(source).not.toMatch(/\bDate\b/);
    expect(source).not.toMatch(/\bsetTimeout\b/);
    expect(source).not.toMatch(/\bsetInterval\b/);
    expect(source).not.toMatch(/\bperformance\b/);
  });

  it('touches no platform global and writes no output', () => {
    expect(source).not.toMatch(/\bdocument\b/);
    expect(source).not.toMatch(/\bwindow\b/);
    expect(source).not.toMatch(/\bconsole\b/);
    expect(source).not.toMatch(/\bfs\b/);
    expect(source).not.toMatch(/\belectron\b/i);
  });

  it('exports only the factory and the closed sets', () => {
    expect(Object.keys(timerModule).sort()).toEqual(['PHASES', 'STATUSES', 'createTimer']);
    expect(timerModule.PHASES).toEqual(['focus', 'short', 'long']);
    expect(timerModule.STATUSES).toEqual(['idle', 'running', 'paused', 'done']);
  });
});
