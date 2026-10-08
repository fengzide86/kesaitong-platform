import { defineConfig } from '@playwright/test'
import { join } from 'node:path'

const runtime = process.env.KST_REAL_E2E_DIR
const baseURL = process.env.KST_REAL_E2E_BASE_URL
if (!runtime || !baseURL || new URL(baseURL).hostname !== '127.0.0.1') {
  throw new Error('Launch via run-real-e2e.mjs with an isolated loopback API fixture')
}

export default defineConfig({
  testDir: './scripts/tests',
  testMatch: 'packaged-retirement-role.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: join(runtime, 'packaged-artifacts'),
  reporter: [['list'], ['json', { outputFile: join(runtime, 'packaged-results.json') }]],
})
