const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.spec.js'],
    exclude: ['test/e2e/**', 'node_modules/**', 'dist/**'],
    // Temporary: removed once the first unit tests land (durable-settings-store 1.6).
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      // Only the pure core modules are unit-testable; the prototype renderer and
      // main-process files are exercised by the e2e/visual harness instead.
      include: ['src/core/**/*.js'],
      exclude: ['**/*.config.js', 'test/**'],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
        'src/core/**': {
          lines: 95,
          branches: 95,
          functions: 95,
          statements: 95,
        },
      },
    },
  },
});
