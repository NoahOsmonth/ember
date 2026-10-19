const js = require('@eslint/js');
const globals = require('globals');

/**
 * Flat ESLint configuration.
 *
 * The prototype's Electron entry points are CommonJS, the renderer scripts are
 * browser scripts, and everything under `src/core` is an ES module (see
 * docs/adr/0004-core-module-format.md). Each group therefore declares its own
 * language options instead of one loose global soup.
 */
module.exports = [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'out/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      '.dsh/**',
      '.hormachuelos/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['src/main/**/*.js', 'src/preload/**/*.js', '*.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['test/**/*.js', 'playwright.config.js'],
    languageOptions: { sourceType: 'module', globals: { ...globals.node } },
  },
  {
    files: ['src/renderer/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['src/core/**/*.js'],
    languageOptions: { sourceType: 'module' },
  },
];
