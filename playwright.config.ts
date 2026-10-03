import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 300_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    channel: 'chromium',
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      args: [
        // Lets the tester page record its own tab without a manual picker.
        '--auto-accept-this-tab-capture',
        '--auto-select-tab-capture-source-by-title=Invitation',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--enable-features=GetDisplayMediaSet',
      ],
    },
  },
});
