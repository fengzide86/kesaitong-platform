/* global fetch, AbortSignal */
import process from 'node:process'
import console from 'node:console'
import { setTimeout, clearTimeout } from 'node:timers'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { randomBytes } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { resolvePython } from './run-python.mjs'
import { finalizeRealE2eEvidence } from './real-e2e-evidence.mjs'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtimeParent = resolve(process.env.KST_REAL_E2E_ROOT
  || (process.platform === 'win32' ? 'D:/AmazonToolboxData/real-e2e' : join(tmpdir(), 'kst-real-e2e')))
await mkdir(runtimeParent, { recursive: true })
const runtime = await mkdtemp(join(runtimeParent, 'run-'))
const releaseIdentity = `real-e2e-${randomBytes(12).toString('hex')}`
await writeFile(join(runtime, '.kst-real-e2e-owned'), 'kst-real-e2e-v1')
const python = resolvePython()
const port = await new Promise((resolvePort, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    server.close(() => resolvePort(address.port))
  })
})
const env = {
  ...process.env,
  PYTHON_DOTENV_DISABLED: '1',
  PYTHONUTF8: '1',
  APP_ENV: 'test', DB_TYPE: 'sqlite', DEBUG: 'true',
  DB_PATH: join(runtime, 'acceptance.sqlite3'),
  TOOLBOX_RUNTIME_DIR: runtime,
  TOOLBOX_RELEASE_ID: releaseIdentity,
  EXPENSE_ATTACHMENT_DIR: join(runtime, 'attachments'),
  CHROMA_PERSIST_DIR: join(runtime, 'chroma'),
  JWT_SECRET_KEY: randomBytes(48).toString('hex'),
  REDIS_URL: '', QWEN_API_KEY: '', OPENAI_API_KEY: '',
  // Opt-in UI QA can display a disabled synthetic live catalog. The fixture
  // owner is still restricted to its own loopback SQLite test environment.
  TOOL_EXECUTION_MODE: process.env.KST_REAL_E2E_UI_CATALOG === '1' ? 'live' : 'demo', AI_SUPPORT_MODE: 'rules',
  VITE_SENTRY_DSN: '', VITE_SENTRY_ENABLED: 'false',
  VITE_CONTROL_API_BASE: `http://127.0.0.1:${port}`, VITE_API_BASE: `http://127.0.0.1:${port}`,
  VITE_DEV_API_TARGET: `http://127.0.0.1:${port}`,
  TOOLBOX_BUILD_TARGET: 'web',
  KST_REAL_E2E_DIR: runtime, KST_REAL_E2E_PORT: String(port),
  KST_REAL_E2E_BASE_URL: `http://127.0.0.1:${port}`,
  TOOLBOX_PYTHON: python,
}
const log = createWriteStream(join(runtime, 'process.log'))
let backend
let backendError
let interrupted = false
const stop = () => { interrupted = true; backend?.kill() }
process.once('SIGINT', stop)
process.once('SIGTERM', stop)

function run(command, args, label, options = {}) {
  console.log(`[real-e2e] ${label}`)
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: repository, env, windowsHide: true, ...options })
    child.stdout?.on('data', chunk => { log.write(chunk); if (label === 'Browser journeys') process.stdout.write(chunk) })
    child.stderr?.on('data', chunk => { log.write(chunk); if (label === 'Browser journeys') process.stderr.write(chunk) })
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolveRun() : reject(new Error(`${label} failed (${code}); see ${join(runtime, 'process.log')}`)))
  })
}

try {
  console.log(`[real-e2e] Isolated evidence: ${runtime}`)
  await run(process.execPath, [join(repository, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', join(runtime, 'web'), '--emptyOutDir'], 'Build isolated Web artifact')
  await run(python, [join(repository, 'scripts/real-e2e-fixture.py'), 'seed'], 'Create isolated database and random test authorizations')
  backend = spawn(python, [join(repository, 'scripts/real-e2e-fixture.py'), 'serve'], { cwd: runtime, env, windowsHide: true })
  backend.once('error', error => { backendError = error })
  backend.stdout.pipe(log, { end: false })
  backend.stderr.pipe(log, { end: false })
  const deadline = Date.now() + 45_000
  let ready = false
  while (!ready && Date.now() < deadline && !interrupted) {
    if (backendError) throw backendError
    if (backend.exitCode !== null) throw new Error('Isolated backend exited during startup')
    try {
      const response = await fetch(`${env.KST_REAL_E2E_BASE_URL}/api/health/ready`, { signal: AbortSignal.timeout(1500) })
      const health = await response.json()
      ready = response.ok && health.release_id === releaseIdentity && health.checks?.database?.type === 'sqlite'
    } catch { /* Startup is bounded; no production fallback. */ }
    if (!ready) await new Promise(resolveWait => setTimeout(resolveWait, 200))
  }
  if (!ready || interrupted) throw new Error('Isolated backend did not become ready')
  await run(process.execPath, [join(repository, 'node_modules/@playwright/test/cli.js'), 'test', '--config', 'playwright.real.config.ts', ...process.argv.slice(2)], 'Browser journeys')
  console.log(`[real-e2e] Passed. Traces, screenshots and a sanitized database snapshot: ${runtime}`)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  backend?.kill()
  if (backend && backend.exitCode === null) await new Promise(resolveExit => {
    const timer = setTimeout(resolveExit, 5000)
    backend.once('exit', () => { clearTimeout(timer); resolveExit() })
  })
  // Only remove generated credential material; keep the database and reports
  // for inspection. Never recursively delete a path supplied by a caller.
  const cleanupErrors = await finalizeRealE2eEvidence(runtime, {
    closeLog: () => new Promise((resolveClose, rejectClose) => {
      log.once('error', rejectClose)
      log.end(resolveClose)
    }),
    secrets: [env.JWT_SECRET_KEY],
  })
  if (cleanupErrors.length) {
    console.error(`[real-e2e] Secondary evidence/cleanup failure: ${cleanupErrors.join(', ')}; prior test outcome remains unchanged`)
    process.exitCode = 1
  }
}
