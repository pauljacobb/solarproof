import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Skip starting a local server when BASE_URL points to a remote staging env
  ...(process.env.BASE_URL && !process.env.BASE_URL.includes('127.0.0.1')
    ? {}
    : {
        webServer: {
          command: 'pnpm exec next dev --hostname 127.0.0.1 --port 3000',
          port: 3000,
          reuseExistingServer: !process.env.CI,
          timeout: 120000,
        },
      }),
})
