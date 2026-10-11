import { defineConfig } from '@playwright/test'
import process from 'node:process'
import { join } from 'node:path'
import { URL } from 'node:url'

const runtime = process.env.KST_REAL_E2E_DIR
const baseURL = process.env.KST_REAL_E2E_BASE_URL
if (!runtime || !baseURL || new URL(baseURL).hostname !== '127.0.0.1') {
  throw new Error('Packaged acceptance requires the owned loopback fixture harness')
}

export default defineConfig({
  testDir: './scripts/tests',
  testMatch: 'packaged-retirement-role.spec.mjs',
  workers: 1, retries: 0, fullyParallel: false, timeout: 120_000,
  expect: { timeout: 15_000 },
  outputDir: join(runtime, 'packaged-artifacts'),
  reporter: [['list'], ['json', { outputFile: join(runtime, 'packaged-results.json') }]],
})
