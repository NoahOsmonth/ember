/**
 * The IPC payload validator (capability: ipc-contract).
 *
 * Six shapes, no coercion, strict objects. Every `check` returns an issue list
 * instead of throwing, so the registry can turn a bad payload into a result
 * envelope. Pure module: no Electron, no DOM, no clock.
 */

/**
 * @typedef {{ path: string, code: string, detail: string }} ValidationIssue
 * @typedef {{ check: (value: unknown, path?: string) => ValidationIssue[], optional?: boolean }} Schema
 */

/**
 * @param {string} path
 * @param {string} code
 * @param {string} detail
 * @returns {ValidationIssue}
 */
function issue(path, code, detail) {
  return { path, code, detail };
}

/**
 * @param {string} base
 * @param {string|number} key
 */
function childPath(base, key) {
  if (typeof key === 'number') return `${base}[${key}]`;
  return base ? `${base}.${key}` : key;
}

/** @param {unknown} value */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export const v = {
  /**
   * @param {{ minLength?: number, maxLength?: number }} [options]
   * @returns {Schema}
   */
  string({ minLength = 0, maxLength } = {}) {
    return {
      check(value, path = '') {
        if (typeof value !== 'string') return [issue(path, 'type', 'expected a string')];
        const issues = [];
        if (value.length < minLength) {
          issues.push(issue(path, 'min-length', `expected at least ${minLength} characters`));
        }
        if (maxLength !== undefined && value.length > maxLength) {
          issues.push(issue(path, 'max-length', `expected at most ${maxLength} characters`));
        }
        return issues;
      },
    };
  },

  /**
   * @param {{ min?: number, max?: number, integer?: boolean }} [options]
   * @returns {Schema}
   */
  number({ min, max, integer = false } = {}) {
    return {
      check(value, path = '') {
        if (!isFiniteNumber(value)) return [issue(path, 'type', 'expected a finite number')];
        const issues = [];
        if (integer && !Number.isInteger(value)) {
          issues.push(issue(path, 'integer', 'expected an integer'));
        }
        if (min !== undefined && value < min) {
          issues.push(issue(path, 'min', `expected at least ${min}`));
        }
        if (max !== undefined && value > max) {
          issues.push(issue(path, 'max', `expected at most ${max}`));
        }
        return issues;
      },
    };
  },

  /** @returns {Schema} */
  boolean() {
    return {
      check(value, path = '') {
        if (typeof value !== 'boolean') return [issue(path, 'type', 'expected a boolean')];
        return [];
      },
    };
  },

  /**
   * @param {readonly unknown[]} values
   * @returns {Schema}
   */
  enum(values) {
    const allowed = [...values];
    return {
      check(value, path = '') {
        if (!allowed.includes(value)) {
          return [issue(path, 'enum', `expected one of ${allowed.map(String).join(', ')}`)];
        }
        return [];
      },
    };
  },

  /**
   * @param {Record<string, Schema>} fields
   * @param {{ strict?: boolean }} [options]
   * @returns {Schema}
   */
  object(fields, { strict = true } = {}) {
    return {
      check(value, path = '') {
        if (!isPlainObject(value)) return [issue(path, 'type', 'expected an object')];
        const issues = [];
        for (const [key, schema] of Object.entries(fields)) {
          const fieldPath = childPath(path, key);
          const fieldValue = value[key];
          if (fieldValue === undefined) {
            if (!schema.optional) issues.push(issue(fieldPath, 'required', 'expected a value'));
            continue;
          }
          issues.push(...schema.check(fieldValue, fieldPath));
        }
        if (strict) {
          for (const key of Object.keys(value)) {
            if (!Object.prototype.hasOwnProperty.call(fields, key)) {
              issues.push(issue(childPath(path, key), 'unknown-key', 'unknown key'));
            }
          }
        }
        return issues;
      },
    };
  },

  /**
   * @param {Schema} schema
   * @param {{ maxLength?: number }} [options]
   * @returns {Schema}
   */
  array(schema, { maxLength } = {}) {
    return {
      check(value, path = '') {
        if (!Array.isArray(value)) return [issue(path, 'type', 'expected an array')];
        const issues = [];
        if (maxLength !== undefined && value.length > maxLength) {
          issues.push(issue(path, 'max-length', `expected at most ${maxLength} items`));
        }
        value.forEach((item, index) => {
          issues.push(...schema.check(item, childPath(path, index)));
        });
        return issues;
      },
    };
  },

  /**
   * Allows `undefined` (a missing field) but not `null`: null is a value, and a
   * wrong value is an error, not a conversion.
   *
   * @param {Schema} schema
   * @returns {Schema}
   */
  optional(schema) {
    return {
      optional: true,
      check(value, path = '') {
        if (value === undefined) return [];
        return schema.check(value, path);
      },
    };
  },
};

export default v;
