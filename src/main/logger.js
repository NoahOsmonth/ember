'use strict';

/**
 * The diagnostic log.
 *
 * A fixed-size, rotating text log that never contains user settings values and
 * never throws: a logger that can break the app is worse than no logger.
 */

const fs = require('fs');
const path = require('path');

const LEVELS = Object.freeze({ error: 0, warn: 1, info: 2, debug: 3 });
const DEFAULT_LEVEL = 'info';
const DEFAULT_MAX_BYTES = 1_000_000;
const DEFAULT_MAX_FILES = 5;

/** Turn any string into a known level name; unknown or missing means info. */
function parseLevel(value) {
  if (typeof value !== 'string') return DEFAULT_LEVEL;
  const normalized = value.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEVELS, normalized) ? normalized : DEFAULT_LEVEL;
}

function errorCode(error) {
  return error && typeof error.code === 'string' ? error.code : 'UNKNOWN';
}

/**
 * @param {object} options
 * @param {string} [options.dir] directory that holds the log files; without it the logger is inert
 * @param {string} [options.level] one of error, warn, info, debug
 * @param {number} [options.maxBytes] rotate once the active file would exceed this
 * @param {number} [options.maxFiles] total files kept, including the active one
 */
function createLogger({
  dir,
  level,
  maxBytes = DEFAULT_MAX_BYTES,
  maxFiles = DEFAULT_MAX_FILES,
} = {}) {
  const active = dir ? path.join(dir, 'ember.log') : null;
  const resolvedLevel = parseLevel(level === undefined ? process.env.EMBER_LOG : level);
  const threshold = LEVELS[resolvedLevel];
  let broken = !active;

  const fileFor = (index) => (index === 0 ? active : `${active}.${index}`);

  function rotate() {
    try {
      fs.rmSync(fileFor(maxFiles - 1), { force: true });
      for (let index = maxFiles - 2; index >= 1; index -= 1) {
        const from = fileFor(index);
        if (fs.existsSync(from)) fs.renameSync(from, fileFor(index + 1));
      }
      if (fs.existsSync(active)) fs.renameSync(active, fileFor(1));
    } catch (error) {
      if (
        errorCode(error) === 'EACCES' ||
        errorCode(error) === 'EPERM' ||
        errorCode(error) === 'EROFS'
      ) {
        broken = true;
      }
    }
  }

  function sizeOf(target) {
    try {
      return fs.statSync(target).size;
    } catch {
      return 0;
    }
  }

  function write(name, message) {
    if (broken || LEVELS[name] > threshold) return;
    const line = `${new Date().toISOString()} ${name} ${String(message)}\n`;
    try {
      if (sizeOf(active) + Buffer.byteLength(line) > maxBytes) rotate();
      fs.appendFileSync(active, line, 'utf8');
    } catch (error) {
      const code = errorCode(error);
      if (code === 'ENOENT') {
        try {
          fs.mkdirSync(dir, { recursive: true });
          fs.appendFileSync(active, line, 'utf8');
          return;
        } catch {
          /* fall through to giving up */
        }
      }
      // A log that cannot be written is a silent condition, never a crash.
      broken = true;
    }
  }

  return {
    level: resolvedLevel,
    dir: dir || null,
    file: active,
    error: (message) => write('error', message),
    warn: (message) => write('warn', message),
    info: (message) => write('info', message),
    debug: (message) => write('debug', message),
    get broken() {
      return broken;
    },
  };
}

module.exports = { createLogger, parseLevel, LEVELS, DEFAULT_LEVEL };
