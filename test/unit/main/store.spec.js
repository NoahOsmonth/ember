import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import storeModule from '../../../src/main/store.js';
import * as schema from '../../../src/core/schema.js';

const { createStore } = storeModule;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createLogger = () => {
  const entries = [];
  const record = (level) => (message) => entries.push({ level, message });
  return {
    entries,
    error: record('error'),
    warn: record('warn'),
    info: record('info'),
    debug: record('debug'),
    warnings: () => entries.filter((entry) => entry.level === 'warn'),
  };
};

describe('createStore', () => {
  let directory;
  let file;
  let logger;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-store-'));
    file = path.join(directory, 'ember.json');
    logger = createLogger();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const open = (overrides = {}) =>
    createStore({ file, schema, logger, debounceMs: 10, ...overrides });

  const readDisk = () => JSON.parse(fs.readFileSync(file, 'utf8'));

  it('starts from the defaults when no file exists', () => {
    const store = open();
    expect(store.get()).toEqual(schema.normalize({}).value);
    expect(store.mode).toBe('file');
    expect(store.recovered).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
    expect(logger.warnings()).toEqual([]);
  });

  it('reads a valid document from disk', () => {
    fs.writeFileSync(file, JSON.stringify({ ...schema.normalize({}).value, theme: 'mono' }));
    const store = open();
    expect(store.get().theme).toBe('mono');
    expect(store.recovered).toBe(false);
  });

  it('validates every mutation before it reaches the disk', () => {
    const store = open();
    store.set({ opacity: 4, theme: 'neon', durations: { focus: 40 } });
    expect(store.get().opacity).toBe(1);
    expect(store.get().theme).toBe('dusk');
    expect(store.get().durations).toEqual({ focus: 40, short: 5, long: 15 });
    expect(store.flush()).toBe(true);
    expect(readDisk()).toMatchObject({ opacity: 1, theme: 'dusk' });
  });

  it('coalesces a burst of updates into a single write', async () => {
    const rename = vi.spyOn(fs, 'renameSync');
    const store = open({ debounceMs: 25 });
    for (let index = 0; index < 20; index += 1) {
      store.set({ volume: index / 20 });
    }
    expect(store.pending).toBe(true);
    expect(rename).not.toHaveBeenCalled();
    await sleep(60);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(readDisk().volume).toBe(0.95);
  });

  it('writes immediately on flush', () => {
    const store = open({ debounceMs: 10_000 });
    store.set({ theme: 'tide' });
    expect(store.flush()).toBe(true);
    expect(readDisk().theme).toBe('tide');
    expect(store.pending).toBe(false);
    expect(store.flush()).toBe(false);
  });

  it('leaves no temporary file behind and writes parseable JSON', () => {
    const store = open();
    store.set({ rounds: 8 });
    store.flush();
    const leftovers = fs.readdirSync(directory).filter((name) => name.includes('.tmp'));
    expect(leftovers).toEqual([]);
    expect(readDisk().rounds).toBe(8);
  });

  it('quarantines an unreadable file, warns once and starts from defaults', () => {
    fs.writeFileSync(file, '{ this is not json');
    const store = open();
    expect(store.get()).toEqual(schema.normalize({}).value);
    expect(store.recovered).toBe(true);
    expect(store.mode).toBe('file');
    const backups = fs.readdirSync(directory).filter((name) => name.includes('.bak-'));
    expect(backups).toHaveLength(1);
    expect(fs.readFileSync(path.join(directory, backups[0]), 'utf8')).toBe('{ this is not json');
    expect(logger.warnings()).toHaveLength(1);
    expect(readDisk()).toEqual(schema.normalize({}).value);
  });

  it('never overwrites an earlier backup', () => {
    fs.writeFileSync(file, 'broken one');
    open();
    fs.writeFileSync(file, 'broken two');
    open();
    expect(fs.readdirSync(directory).filter((name) => name.includes('.bak-'))).toHaveLength(2);
  });

  it('repairs invalid values and persists the repair', () => {
    fs.writeFileSync(
      file,
      JSON.stringify({ ...schema.normalize({}).value, opacity: 40, mystery: true })
    );
    const store = open();
    expect(store.get().opacity).toBe(1);
    expect(store.get()).not.toHaveProperty('mystery');
    expect(store.recovered).toBe(true);
    expect(logger.warnings()).toHaveLength(1);
    expect(readDisk().opacity).toBe(1);
  });

  it('retries a locked rename before giving up', () => {
    const real = fs.renameSync;
    let attempts = 0;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      attempts += 1;
      if (attempts <= 2) {
        const error = Object.assign(new Error('busy'), { code: 'EBUSY' });
        throw error;
      }
      return real(from, to);
    });
    const store = open();
    store.set({ theme: 'solar' });
    expect(store.flush()).toBe(true);
    expect(attempts).toBe(3);
    expect(store.mode).toBe('file');
    expect(readDisk().theme).toBe('solar');
  });

  it('degrades to memory mode when the file stays locked', () => {
    const error = Object.assign(new Error('locked'), { code: 'EPERM' });
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw error;
    });
    const store = open();
    store.set({ theme: 'solar' });
    expect(store.flush()).toBe(false);
    expect(store.mode).toBe('memory');
    expect(store.recovered).toBe(true);
    expect(store.get().theme).toBe('solar');
    expect(logger.warnings()).toHaveLength(1);
    store.set({ theme: 'tide' });
    expect(store.flush()).toBe(false);
    expect(logger.warnings()).toHaveLength(1);
  });

  it('degrades to memory mode when the directory is not writable', () => {
    const error = Object.assign(new Error('denied'), { code: 'EACCES' });
    const realOpen = fs.openSync;
    vi.spyOn(fs, 'openSync').mockImplementation((target, ...rest) => {
      if (String(target).includes('.tmp')) throw error;
      return realOpen(target, ...rest);
    });
    const store = open();
    store.set({ rounds: 3 });
    expect(store.flush()).toBe(false);
    expect(store.mode).toBe('memory');
    expect(store.recovered).toBe(true);
    expect(logger.warnings()).toHaveLength(1);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('leaves a document from a newer version untouched', () => {
    const future = { schemaVersion: schema.CURRENT_VERSION + 1, theme: 'mono', opacity: 0.5 };
    fs.writeFileSync(file, JSON.stringify(future));
    const store = open();
    expect(store.get()).toEqual(schema.normalize({}).value);
    expect(store.mode).toBe('memory');
    expect(store.recovered).toBe(true);
    expect(logger.warnings()).toHaveLength(1);
    store.set({ theme: 'tide' });
    store.flush();
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(future);
  });

  it('flushes pending work on close', () => {
    const store = open({ debounceMs: 10_000 });
    store.set({ theme: 'tide' });
    store.close();
    expect(readDisk().theme).toBe('tide');
    store.set({ theme: 'solar' });
    expect(store.flush()).toBe(false);
    expect(readDisk().theme).toBe('tide');
  });

  it('ignores a patch that is not an object', () => {
    const store = open();
    const before = store.get();
    expect(store.set(null)).toEqual({ value: before, issues: [] });
    expect(store.get()).toEqual(before);
  });
});
