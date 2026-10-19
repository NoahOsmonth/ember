import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import identity from '../../../src/main/identity.js';

const { APP_USER_MODEL_ID, applyAppUserModelId } = identity;

/** Read `build.appId` from the electron-builder config without a YAML dependency. */
function builderAppId() {
  const file = path.resolve(process.cwd(), 'electron-builder.yml');
  const match = /^appId:\s*(\S+)\s*$/m.exec(fs.readFileSync(file, 'utf8'));
  return match ? match[1] : null;
}

describe('application identity', () => {
  it('matches the appId the installer stamps onto the shortcut', () => {
    expect(builderAppId()).toBe(APP_USER_MODEL_ID);
  });

  it('applies the identity through the app object', () => {
    const app = { setAppUserModelId: vi.fn() };
    expect(applyAppUserModelId(app)).toBe(APP_USER_MODEL_ID);
    expect(app.setAppUserModelId).toHaveBeenCalledWith(APP_USER_MODEL_ID);
  });

  it('tolerates a missing app or an app without the method', () => {
    expect(applyAppUserModelId(null)).toBe(APP_USER_MODEL_ID);
    expect(() => applyAppUserModelId({})).not.toThrow();
  });
});
