import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import loggerModule from '../../../src/main/logger.js';

const { createLogger, parseLevel } = loggerModule;

describe('parseLevel', () => {
  it('accepts the four known levels, case-insensitively', () => {
    for (const level of ['error', 'warn', 'info', 'debug', 'WARN', ' Debug ']) {
      expect(parseLevel(level)).toBe(level.trim().toLowerCase());
    }
  });

  it('falls back to info for anything else', () => {
    for (const level of ['verbose', 'trace', '', null, undefined, 3, {}]) {
      expect(parseLevel(level)).toBe('info');
    }
  });
});

describe('createLogger', () => {
  let directory;
  let logFile;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-log-'));
    logFile = path.join(directory, 'ember.log');
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const lines = (file = logFile) =>
    fs.existsSync(file)
      ? fs
          .readFileSync(file, 'utf8')
          .split('\n')
          .filter((line) => line.length > 0)
      : [];

  it('writes timestamped lines with a level', () => {
    const logger = createLogger({ dir: directory });
    logger.info('timer started');
    logger.error('boom');
    const written = lines();
    expect(written).toHaveLength(2);
    expect(written[0]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z info timer started$/);
    expect(written[1]).toMatch(/ error boom$/);
  });

  it('drops messages below the configured level', () => {
    const logger = createLogger({ dir: directory, level: 'warn' });
    logger.debug('invisible');
    logger.info('invisible too');
    logger.warn('visible');
    expect(logger.level).toBe('warn');
    expect(lines().map((line) => line.split(' ')[1])).toEqual(['warn']);
  });

  it('honours EMBER_LOG when no level is passed', () => {
    const previous = process.env.EMBER_LOG;
    process.env.EMBER_LOG = 'debug';
    try {
      expect(createLogger({ dir: directory }).level).toBe('debug');
      process.env.EMBER_LOG = 'shout';
      expect(createLogger({ dir: directory }).level).toBe('info');
      delete process.env.EMBER_LOG;
      expect(createLogger({ dir: directory }).level).toBe('info');
    } finally {
      if (previous === undefined) delete process.env.EMBER_LOG;
      else process.env.EMBER_LOG = previous;
    }
  });

  it('rotates by size and keeps at most maxFiles files', () => {
    const logger = createLogger({ dir: directory, maxBytes: 200, maxFiles: 3 });
    for (let index = 0; index < 40; index += 1) {
      logger.info(`line number ${index} with some padding text`);
    }
    const files = fs.readdirSync(directory).sort();
    expect(files).toEqual(['ember.log', 'ember.log.1', 'ember.log.2']);
    for (const name of files) {
      expect(fs.statSync(path.join(directory, name)).size).toBeLessThanOrEqual(400);
    }
    const newest = lines()[lines().length - 1];
    expect(newest).toMatch(/line number 39/);
  });

  it('creates the directory on first write', () => {
    const nested = path.join(directory, 'logs', 'deep');
    const logger = createLogger({ dir: nested });
    logger.info('hello');
    expect(fs.readFileSync(path.join(nested, 'ember.log'), 'utf8')).toMatch(/hello/);
  });

  it('never throws when the directory cannot be written', () => {
    const logger = createLogger({ dir: path.join(directory, 'ember.json', 'logs') });
    fs.writeFileSync(path.join(directory, 'ember.json'), 'not a directory');
    expect(() => logger.error('still fine')).not.toThrow();
    expect(() => logger.info('still fine')).not.toThrow();
  });

  it('is inert without a directory', () => {
    const logger = createLogger({});
    expect(() => logger.info('nowhere to go')).not.toThrow();
    expect(logger.broken).toBe(true);
  });
});
