import { defineConfig } from '@playwright/test'
import process from 'node:process'
import { join } from 'node:path'
const runtime = process.env.KST_REAL_E2E_DIR
if (!runtime || !process.env.KST_REAL_E2E_BASE_URL?.startsWith('http://127.0.0.1:')) throw new Error('Run the isolated admin acceptance owner')
export default defineConfig({
  testDir: './scripts/tests', testMatch: 'packaged-admin-product.spec.mjs',
  workers: 1, retries: 0, fullyParallel: false, timeout: 120_000, expect: { timeout: 15_000 },
  outputDir: join(runtime, 'test-artifacts'),
  reporter: [['list'], ['json', { outputFile: join(runtime, 'results.json') }]],
})
