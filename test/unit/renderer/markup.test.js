import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const PAGES = [
  'src/renderer/widget/index.html',
  'src/renderer/settings/index.html',
  'test/visual/fixture-gallery.html',
];

describe('renderer markup policy', () => {
  for (const page of PAGES) {
    it(`${page} declares a CSP and keeps scripts external`, () => {
      const html = read(page);
      expect(html).toMatch(/http-equiv="Content-Security-Policy"/);
      expect(html).toContain("default-src 'none'");
      expect(html).toContain("script-src 'self'");

      const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
      expect(scripts.length).toBeGreaterThan(0);
      for (const [, attributes, body] of scripts) {
        expect(attributes).toMatch(/\bsrc=/);
        expect(body.trim()).toBe('');
      }
      expect(html).not.toMatch(/\son[a-z]+=/i);
    });
  }

  it('the widget has no preview query hook', () => {
    const widget = read('src/renderer/widget/widget.js');
    expect(widget).not.toMatch(/[?&]demo/);
    expect(widget).not.toMatch(/URLSearchParams/);
  });

  it('the packaged build excludes the test tree', () => {
    const builder = read('electron-builder.yml');
    expect(builder).toMatch(/src\/renderer/);
    expect(builder).not.toMatch(/^\s*-\s*test\//m);
  });
});
