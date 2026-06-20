const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 20000,
  retries: 0,
  reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }], ['line']],
  use: {
    baseURL: 'http://localhost:3001',
    headless: true,
    screenshot: 'on',
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: 'node server.js',
    port: 3001,
    env: { PORT: '3001' },
    reuseExistingServer: false,
    timeout: 10000,
  },
});
