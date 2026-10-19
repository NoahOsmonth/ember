const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.spec.js', 'test/**/*.test.js'],
    exclude: ['test/e2e/**', 'test/visual/**', 'node_modules/**', 'dist/**'],
    // A green run means something actually ran: no empty-suite escape hatch.
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      // The pure core modules plus the main-process modules that have no
      // Electron dependency; the renderer and the window wiring are covered by
      // the e2e/visual harness instead.
      include: [
        'src/core/**/*.js',
        'src/main/store.js',
        'src/main/logger.js',
        'src/main/clock.js',
        'src/main/ipc.js',
        'src/main/channels.js',
        'src/main/test-support.js',
        'src/main/timer-service.js',
      ],
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
