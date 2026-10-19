import { describe, expect, it, vi } from 'vitest';
import shortcutsModule from '../../../src/main/shortcuts.js';

const { CODES, DEFAULT_BINDINGS, createShortcuts } = shortcutsModule;

const DEFAULT_ACCELERATORS = Object.fromEntries(
  DEFAULT_BINDINGS.map((binding) => [binding.id, binding.accelerator])
);

function fakeGlobalShortcut(taken = []) {
  const held = new Map(taken.map((accelerator) => [accelerator, null]));
  return {
    held,
    register(accelerator, handler) {
      if (held.has(accelerator)) return false;
      held.set(accelerator, handler);
      return true;
    },
    unregister(accelerator) {
      held.delete(accelerator);
    },
    fire(accelerator) {
      const handler = held.get(accelerator);
      if (handler) handler();
    },
  };
}

function fakeStore(shortcuts = {}) {
  /** @type {{ shortcuts: Record<string, string> }} */
  let document = { shortcuts: { ...DEFAULT_ACCELERATORS, ...shortcuts } };
  return {
    get: () => document,
    set(patch, value) {
      if (typeof patch === 'string') patch = { [patch]: value };
      document = { ...document, ...patch };
      return { value: document, issues: [] };
    },
    read: () => document,
  };
}

async function setup({ shortcuts = {}, taken = [], safeMode = false } = {}) {
  const store = fakeStore(shortcuts);
  const globalShortcut = fakeGlobalShortcut(taken);
  const onAction = vi.fn();
  const logger = { warn: vi.fn(), info: vi.fn() };
  const shortcutsApi = await createShortcuts({
    store,
    logger,
    onAction,
    safeMode,
    globalShortcut,
  });
  return { store, globalShortcut, onAction, logger, shortcuts: shortcutsApi };
}

const statusOf = (status, id) => status.bindings.find((binding) => binding.id === id);

describe('shortcut registration', () => {
  it('registers every default and reports it as active', async () => {
    const { globalShortcut, shortcuts, onAction } = await setup();
    const status = shortcuts.registerAll();

    expect(status.bindings.map((binding) => binding.status)).toEqual([
      'active',
      'active',
      'active',
    ]);
    expect([...globalShortcut.held.keys()].sort()).toEqual(
      Object.values(DEFAULT_ACCELERATORS).sort()
    );

    globalShortcut.fire('Control+Alt+P');
    expect(onAction).toHaveBeenCalledWith('showHide');
  });

  it('records a combination another app owns instead of ignoring it', async () => {
    const { shortcuts, logger } = await setup({ taken: ['Control+Alt+P'] });
    const status = shortcuts.registerAll();

    expect(statusOf(status, 'showHide')).toMatchObject({
      status: 'unavailable',
      accelerator: 'Control+Alt+P',
    });
    expect(statusOf(status, 'toggle').status).toBe('active');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('taken by another app'));
  });

  it('marks unparsable and reserved stored values', async () => {
    const { shortcuts } = await setup({
      shortcuts: { showHide: 'Banana', lock: 'Alt+Tab' },
    });
    const status = shortcuts.registerAll();

    expect(statusOf(status, 'showHide').status).toBe('invalid');
    expect(statusOf(status, 'lock').status).toBe('reserved');
    expect(statusOf(status, 'toggle').status).toBe('active');
  });

  it('marks a duplicate inside the stored document as a conflict', async () => {
    const { shortcuts } = await setup({ shortcuts: { toggle: 'Control+Alt+P' } });
    const status = shortcuts.registerAll();

    expect(statusOf(status, 'showHide').status).toBe('active');
    expect(statusOf(status, 'toggle')).toMatchObject({
      status: 'conflict',
      message: 'already used by Show or hide',
    });
  });

  it('registers nothing in safe mode and says why', async () => {
    const { globalShortcut, shortcuts } = await setup({ safeMode: true });
    const status = shortcuts.registerAll();

    expect(globalShortcut.held.size).toBe(0);
    expect(status.safeMode).toBe(true);
    expect(status.bindings.every((binding) => binding.status === 'disabled')).toBe(true);
  });

  it('releases every binding on unregisterAll and dispose', async () => {
    const { globalShortcut, shortcuts } = await setup();
    shortcuts.registerAll();
    expect(globalShortcut.held.size).toBe(3);

    shortcuts.unregisterAll();
    expect(globalShortcut.held.size).toBe(0);

    shortcuts.registerAll();
    shortcuts.dispose();
    shortcuts.dispose();
    expect(globalShortcut.held.size).toBe(0);
  });
});

describe('rebind', () => {
  it('registers the candidate, releases the old one and persists', async () => {
    const { globalShortcut, shortcuts, store } = await setup();
    shortcuts.registerAll();

    const result = shortcuts.rebind('showHide', 'Control+Alt+J');

    expect(result).toMatchObject({ ok: true, code: CODES.ok });
    expect(result.binding).toMatchObject({ accelerator: 'Control+Alt+J', status: 'active' });
    expect(globalShortcut.held.has('Control+Alt+J')).toBe(true);
    expect(globalShortcut.held.has('Control+Alt+P')).toBe(false);
    expect(store.read().shortcuts.showHide).toBe('Control+Alt+J');
  });

  it('canonicalizes the stored spelling', async () => {
    const { shortcuts, store } = await setup();
    shortcuts.registerAll();

    expect(shortcuts.rebind('toggle', 'ctrl+shift+space')).toMatchObject({ ok: true });
    expect(store.read().shortcuts.toggle).toBe('Control+Shift+Space');
  });

  it('rejects a duplicate without changing anything', async () => {
    const { globalShortcut, shortcuts, store } = await setup();
    shortcuts.registerAll();

    const result = shortcuts.rebind('showHide', 'Control+Alt+L');

    expect(result).toMatchObject({
      ok: false,
      code: CODES.conflict,
      conflictWith: 'lock',
    });
    expect(store.read().shortcuts.showHide).toBe('Control+Alt+P');
    expect(globalShortcut.held.has('Control+Alt+P')).toBe(true);
  });

  it('rejects reserved and unparsable candidates', async () => {
    const { shortcuts, store } = await setup();
    shortcuts.registerAll();

    expect(shortcuts.rebind('showHide', 'Control+Alt+Delete')).toMatchObject({
      ok: false,
      code: CODES.reserved,
    });
    expect(shortcuts.rebind('showHide', 'nonsense')).toMatchObject({
      ok: false,
      code: CODES.invalid,
    });
    expect(shortcuts.rebind('missing', 'Control+Alt+J')).toMatchObject({
      ok: false,
      code: CODES.invalid,
    });
    expect(store.read().shortcuts.showHide).toBe('Control+Alt+P');
  });

  it('keeps the old binding when the new one is taken', async () => {
    const { globalShortcut, shortcuts, store } = await setup({ taken: ['Control+Alt+J'] });
    shortcuts.registerAll();

    const result = shortcuts.rebind('showHide', 'Control+Alt+J');

    expect(result).toMatchObject({ ok: false, code: CODES.unavailable });
    expect(globalShortcut.held.has('Control+Alt+P')).toBe(true);
    expect(store.read().shortcuts.showHide).toBe('Control+Alt+P');
  });

  it('retries an inactive binding when the candidate is its own value', async () => {
    const { globalShortcut, shortcuts } = await setup({ taken: ['Control+Alt+P'] });
    shortcuts.registerAll();
    expect(statusOf(shortcuts.getStatus(), 'showHide').status).toBe('unavailable');

    globalShortcut.held.delete('Control+Alt+P');
    expect(shortcuts.rebind('showHide', 'Control+Alt+P')).toMatchObject({ ok: true });
    expect(globalShortcut.held.has('Control+Alt+P')).toBe(true);
  });

  it('refuses every change in safe mode', async () => {
    const { globalShortcut, shortcuts } = await setup({ safeMode: true });
    shortcuts.registerAll();

    expect(shortcuts.rebind('showHide', 'Control+Alt+J')).toMatchObject({
      ok: false,
      code: CODES.unavailable,
    });
    expect(shortcuts.reset()).toMatchObject({ ok: false, code: CODES.unavailable });
    expect(globalShortcut.held.size).toBe(0);
  });
});

describe('reset', () => {
  it('restores and registers the three defaults', async () => {
    const { globalShortcut, shortcuts, store } = await setup();
    shortcuts.registerAll();
    shortcuts.rebind('showHide', 'Control+Alt+J');

    const result = shortcuts.reset();

    expect(result.ok).toBe(true);
    expect(store.read().shortcuts).toEqual(DEFAULT_ACCELERATORS);
    expect(globalShortcut.held.has('Control+Alt+P')).toBe(true);
    expect(globalShortcut.held.has('Control+Alt+J')).toBe(false);
  });
});
