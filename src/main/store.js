'use strict';

/**
 * The durable settings store.
 *
 * One writer, one document. Every mutation is validated by the injected schema
 * before it can reach the disk, writes are atomic (temp file, fsync, rename),
 * and failures degrade to an in-memory mode instead of taking the app down.
 */

const fs = require('fs');
const path = require('path');

/**
 * @typedef {{ path: string, code: string, detail: string }} SchemaIssue
 */

const RETRY_DELAYS = [20, 20, 20];
const RETRYABLE_RENAME = new Set(['EBUSY', 'EPERM', 'EACCES']);

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function backupName(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${file}.bak-${stamp}`;
}

function uniquePath(candidate) {
  let target = candidate;
  let counter = 1;
  while (fs.existsSync(target)) {
    target = `${candidate}-${counter}`;
    counter += 1;
  }
  return target;
}

function errorCode(error) {
  return error && typeof error.code === 'string' ? error.code : 'UNKNOWN';
}

/**
 * @param {object} options
 * @param {string} options.file absolute path of the settings document
 * @param {{ normalize: (raw: unknown) => { value: any, issues: Array<SchemaIssue> } }} options.schema
 *   the injected core schema module
 * @param {{ warn: Function, info: Function, error: Function }} [options.logger]
 * @param {number} [options.debounceMs]
 */
function createStore({ file, schema, logger = null, debounceMs = 250 }) {
  let mode = 'file';
  let recovered = false;
  let document = schema.normalize({}).value;
  let timer = null;
  let pendingWrite = false;
  let closed = false;
  let warned = false;

  const log = (level, message) => {
    if (logger && typeof logger[level] === 'function') logger[level](message);
  };

  const degrade = (reason) => {
    if (mode !== 'file') return;
    mode = 'memory';
    recovered = true;
    if (!warned) {
      warned = true;
      log('warn', `settings are in memory only: ${reason}`);
    }
  };

  function writeDocument(text) {
    const directory = path.dirname(file);
    const temp = `${file}.${process.pid}.tmp`;
    let fd;
    try {
      fd = fs.openSync(temp, 'w');
      fs.writeFileSync(fd, text, 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
    } catch (error) {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          /* the descriptor is already unusable */
        }
      }
      try {
        fs.unlinkSync(temp);
      } catch {
        /* nothing to clean up */
      }
      degrade(`cannot write the settings file (${errorCode(error)})`);
      return false;
    }

    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt += 1) {
      try {
        fs.renameSync(temp, file);
        fsyncDirectory(directory);
        return true;
      } catch (error) {
        const retryable = RETRYABLE_RENAME.has(errorCode(error));
        if (!retryable || attempt === RETRY_DELAYS.length) {
          try {
            fs.unlinkSync(temp);
          } catch {
            /* nothing to clean up */
          }
          degrade(`cannot replace the settings file (${errorCode(error)})`);
          return false;
        }
        sleepSync(RETRY_DELAYS[attempt]);
      }
    }
    return false;
  }

  function fsyncDirectory(directory) {
    let fd;
    try {
      fd = fs.openSync(directory, 'r');
      fs.fsyncSync(fd);
    } catch {
      /* best effort: Windows and some filesystems refuse to sync a directory */
    } finally {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          /* ignore */
        }
      }
    }
  }

  function scheduleWrite() {
    pendingWrite = true;
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, debounceMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function flush() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (!pendingWrite) return false;
    pendingWrite = false;
    if (mode !== 'file' || closed) return false;
    return writeDocument(`${JSON.stringify(document, null, 2)}\n`);
  }

  function read() {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return;
      if (
        errorCode(error) === 'EACCES' ||
        errorCode(error) === 'EPERM' ||
        errorCode(error) === 'EISDIR'
      ) {
        degrade(`cannot read the settings file (${errorCode(error)})`);
        return;
      }
      log('warn', `cannot read the settings file (${errorCode(error)}); using defaults`);
      recovered = true;
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      quarantine();
      return;
    }

    const result = schema.normalize(parsed);
    const newer = result.issues.find((entry) => entry.code === 'newer-version');
    if (newer) {
      // Downgrading the document would silently destroy settings this build
      // does not understand, so the file is preserved and writes stop.
      recovered = true;
      mode = 'memory';
      log('warn', `${newer.detail}; the file is left untouched and changes are not saved`);
      return;
    }
    document = result.value;
    if (result.issues.length > 0) {
      recovered = true;
      const summary = result.issues
        .map((entry) => `${entry.path || '(root)'}: ${entry.code}`)
        .join(', ');
      log('warn', `repaired invalid settings: ${summary}`);
      pendingWrite = true;
      flush();
    }
  }

  function quarantine() {
    const target = uniquePath(backupName(file));
    try {
      fs.renameSync(file, target);
      recovered = true;
      log('warn', `the settings file was unreadable and was moved to ${path.basename(target)}`);
    } catch (error) {
      recovered = true;
      log('warn', `the settings file was unreadable and could not be moved (${errorCode(error)})`);
    }
    document = schema.normalize({}).value;
    pendingWrite = true;
    flush();
  }

  read();

  return {
    get() {
      return document;
    },
    /**
     * Merge a patch into the document, validating the result.
     * @returns {{ value: any, issues: Array<SchemaIssue> }}
     */
    set(patch) {
      if (!patch || typeof patch !== 'object') return { value: document, issues: [] };
      const merged = { ...document, ...patch };
      if (patch.durations && typeof patch.durations === 'object') {
        merged.durations = { ...document.durations, ...patch.durations };
      }
      const result = schema.normalize(merged);
      document = result.value;
      if (result.issues.length > 0) {
        const summary = result.issues
          .map((entry) => `${entry.path || '(root)'}: ${entry.code}`)
          .join(', ');
        log('debug', `rejected settings values: ${summary}`);
      }
      scheduleWrite();
      return result;
    },
    flush,
    close() {
      flush();
      closed = true;
    },
    get mode() {
      return mode;
    },
    get recovered() {
      return recovered;
    },
    get pending() {
      return pendingWrite;
    },
  };
}

module.exports = { createStore };
