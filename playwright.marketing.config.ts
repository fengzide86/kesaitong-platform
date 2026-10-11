import { defineConfig } from '@playwright/test'

const port = 4200
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim() || undefined
// The desktop runtime may provide Node without an npm shim on PATH. Calling
// Vite through the current Node executable keeps the marketing smoke test
// independent from a globally installed npm command.
// Release acceptance must preview the exact frozen artifact, not a stale local build.
const artifactDirectory = process.env.TOOLBOX_MARKETING_DIR?.trim()
const artifactOption = artifactDirectory ? ` --outDir "${artifactDirectory}"` : ''
const preview = `"${process.execPath}" node_modules/vite/bin/vite.js preview --config vite.marketing.config.ts --host 127.0.0.1 --port ${port} --strictPort${artifactOption}`
const command = process.env.PLAYWRIGHT_MARKETING_PREBUILT === '1' || process.env.PLAYWRIGHT_PREBUILT === '1'
  ? preview : `node scripts/build-marketing.mjs && node scripts/audit-marketing-build.mjs && ${preview}`

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['marketing-site.spec.ts', 'marketing-experience.spec.ts'],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  outputDir: 'test-results/marketing',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: 'chromium', headless: true,
    launchOptions: executablePath ? { executablePath } : undefined,
    serviceWorkers: 'block',
    trace: 'retain-on-failure', screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command, url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false, timeout: 120_000,
  },
})
