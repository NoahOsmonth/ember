import { describe, expect, it, vi } from 'vitest';
import security from '../../../src/main/security.js';

const { EXTERNAL_SCHEMES, WEB_PREFERENCES, hardenWindow, isAllowedExternal, openExternal } =
  security;

describe('web preferences', () => {
  it('states all four flags explicitly and freezes them', () => {
    expect(WEB_PREFERENCES).toEqual({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    });
    expect(Object.isFrozen(WEB_PREFERENCES)).toBe(true);
  });
});

describe('isAllowedExternal', () => {
  it('accepts only absolute https: and mailto: URLs', () => {
    expect([...EXTERNAL_SCHEMES]).toEqual(['https:', 'mailto:']);
    expect(isAllowedExternal('https://example.com/docs')).toBe(true);
    expect(isAllowedExternal('mailto:hello@example.com')).toBe(true);

    for (const value of [
      'http://example.com',
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'example.com',
      '',
      null,
      undefined,
      42,
    ]) {
      expect(isAllowedExternal(value)).toBe(false);
    }
  });
});

describe('openExternal', () => {
  it('never calls the shell for a rejected scheme', async () => {
    const shell = { openExternal: vi.fn(async () => {}) };
    await expect(openExternal('http://example.com', shell)).resolves.toBe(false);
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it('hands an allowed URL to the shell', async () => {
    const shell = { openExternal: vi.fn(async () => {}) };
    await expect(openExternal('https://example.com', shell)).resolves.toBe(true);
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com');
  });
});

describe('hardenWindow', () => {
  function fakeWindow() {
    const listeners = new Map();
    const webContents = {
      on(type, handler) {
        listeners.set(type, handler);
      },
      setWindowOpenHandler: vi.fn(),
    };
    return { webContents, listeners };
  }

  const file = 'C:/app/src/renderer/widget/index.html';
  const allowed = new URL(`file:///${file}`).href;

  it('denies every new window', () => {
    const window = fakeWindow();
    hardenWindow(window, { file });

    expect(window.webContents.setWindowOpenHandler).toHaveBeenCalledTimes(1);
    const handler = window.webContents.setWindowOpenHandler.mock.calls[0][0];
    expect(handler({ url: 'https://example.com' })).toEqual({ action: 'deny' });
  });

  it('allows a reload of the same document', () => {
    const window = fakeWindow();
    hardenWindow(window, { file });
    const navigate = window.listeners.get('will-navigate');
    const event = { preventDefault: vi.fn() };

    navigate(event, allowed);
    expect(event.preventDefault).not.toHaveBeenCalled();

    const query = { preventDefault: vi.fn() };
    navigate(query, `${allowed}?tab=tutorial`);
    expect(query.preventDefault).not.toHaveBeenCalled();
  });

  it('cancels navigation to another origin, another file or garbage', () => {
    const window = fakeWindow();
    hardenWindow(window, { file });
    const navigate = window.listeners.get('will-navigate');

    for (const url of [
      'https://example.com',
      'file:///C:/app/src/renderer/settings/index.html',
      'not a url',
    ]) {
      const event = { preventDefault: vi.fn() };
      navigate(event, url);
      expect(event.preventDefault).toHaveBeenCalled();
    }
  });
});
