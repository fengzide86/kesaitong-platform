import { defineConfig } from '@playwright/test'

// Dedicated renderer acceptance: all business responses are local fixtures.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'admin-ux-acceptance.spec.ts',
  timeout: 60_000,
  workers: 2,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4346',
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    screenshot: 'only-on-failure',
  },
  outputDir: 'test-results/ux-acceptance',
  reporter: [['list']],
})
