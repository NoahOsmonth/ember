'use strict';

/**
 * Fail the build before packaging when a required image is missing.
 *
 * A missing tray icon is invisible at runtime, so the check is explicit rather
 * than a warning: `npm run dist` runs this first.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ASSETS = ['build/icon.ico', 'build/trayTemplate.png'];

const missing = [];
for (const asset of ASSETS) {
  const file = path.join(ROOT, asset);
  try {
    if (fs.statSync(file).size === 0) missing.push(`${asset} (empty)`);
  } catch {
    missing.push(asset);
  }
}

if (missing.length > 0) {
  console.error(`missing build assets: ${missing.join(', ')}`);
  console.error('run `npm run icons` to generate them');
  process.exit(1);
}

console.log(`build assets present: ${ASSETS.join(', ')}`);
