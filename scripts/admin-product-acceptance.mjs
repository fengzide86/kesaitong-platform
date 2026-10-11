// Isolated real-backend + packaged Electron acceptance; never uses deployment config.
import process from 'node:process'
import console from 'node:console'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes, createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { resolvePython } from './run-python.mjs'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const before = process.argv.includes('--before')
const evidence = process.env.KST_ADMIN_EVIDENCE || 'D:/AmazonToolboxData/audits/kst-admin-product-20261011'
await mkdir(evidence, { recursive: true })
const root = await mkdtemp(join(evidence, before ? 'before-' : 'after-'))
await writeFile(join(root, '.kst-real-e2e-owned'), 'kst-real-e2e-v1')
await mkdir(join(root, 'web'))
await mkdir(join(root, 'screens'))
const port = await new Promise(resolvePort => {
  const listener = createServer().listen(0, '127.0.0.1', () => {
    const selected = listener.address().port
    listener.close(() => resolvePort(selected))
  })
})
const python = resolvePython()
const executable = resolve(process.env.KST_PACKAGED_EXECUTABLE || (before ? 'release' : 'release-admin-ux') + '/win-unpacked/课赛通 KST.exe')
const identity = 'admin-product-' + randomBytes(10).toString('hex')
const env = { ...process.env, PYTHON_DOTENV_DISABLED: '1', PYTHONUTF8: '1', APP_ENV: 'test', DB_TYPE: 'sqlite', DEBUG: 'true',
  DB_PATH: join(root, 'acceptance.sqlite3'), TOOLBOX_RUNTIME_DIR: root, TOOLBOX_RELEASE_ID: identity,
  EXPENSE_ATTACHMENT_DIR: join(root, 'attachments'), CHROMA_PERSIST_DIR: join(root, 'chroma'),
  JWT_SECRET_KEY: randomBytes(48).toString('hex'), REDIS_URL: '', REDIS_REQUIRED: 'false',
  QWEN_API_KEY: '', OPENAI_API_KEY: '', AI_SUPPORT_MODE: 'rules', TOOL_EXECUTION_MODE: 'live',
  KST_REAL_E2E_DIR: root, KST_REAL_E2E_PORT: String(port), KST_REAL_E2E_BASE_URL: `http://127.0.0.1:${port}`,
  KST_ADMIN_FLOW_FIXTURES: '1', KST_EXPERIENCE_VISUAL_FIXTURES: '1', KST_REAL_E2E_UI_CATALOG: '1',
  KST_ADMIN_PAGINATION_FIXTURES: before ? '0' : '1',
  KST_PACKAGED_EXECUTABLE: executable, KST_ADMIN_BEFORE: before ? '1' : '0', TOOLBOX_PYTHON: python }
const secrets = [env.JWT_SECRET_KEY]
let backend, log = '', outcome = 'failed'
const redact = value => secrets.reduce((result, secret) => result.replaceAll(secret, '[LOCAL-SECRET]'), String(value))
async function run(command, args) {
  await new Promise((complete, reject) => {
    const child = spawn(command, args, { cwd: repository, env, windowsHide: true })
    child.stdout.on('data', data => { log += redact(data) })
    child.stderr.on('data', data => { log += redact(data) })
    child.once('error', reject)
    child.once('close', code => code === 0 ? complete() : reject(new Error(`Local acceptance step exited ${code}`)))
  })
}
try {
  console.log('ADMIN_ACCEPTANCE_ROOT=' + root)
  const executableSha256 = createHash('sha256').update(await readFile(executable)).digest('hex')
  await writeFile(join(evidence, before ? 'before-location.json' : 'after-location.json'), JSON.stringify({ root, executable, executableSha256 }, null, 2))
  await run(python, [join(repository, 'scripts/real-e2e-fixture.py'), 'seed'])
  const credentials = JSON.parse(await readFile(join(root, 'credentials.json'), 'utf8'))
  secrets.push(...Object.entries(credentials).filter(([key, value]) => typeof value === 'string' && (key.includes('password') || /^(consumer|business)/.test(key))).map(([, value]) => value))
  backend = spawn(python, [join(repository, 'scripts/real-e2e-fixture.py'), 'serve'], { cwd: root, env, windowsHide: true })
  backend.stdout.on('data', data => { log += redact(data) })
  backend.stderr.on('data', data => { log += redact(data) })
  let ready = false
  for (let attempt = 0; attempt < 100 && !ready; attempt++) {
    try {
      const response = await fetch(env.KST_REAL_E2E_BASE_URL + '/api/health/ready', { signal: AbortSignal.timeout(1000) })
      ready = response.ok && (await response.json()).release_id === identity
    } catch { /* wait only for this owned local backend */ }
    if (!ready) await delay(250)
  }
  assert.ok(ready, 'Owned loopback backend must report the exact release identity')
  const forwarded = process.argv.slice(2).filter(arg => arg !== '--before')
  await run(process.execPath, [join(repository, 'node_modules/@playwright/test/cli.js'), 'test', '--config', 'playwright.admin-product.config.mjs', ...forwarded])
  await run(python, [join(repository, 'scripts/real-e2e-fixture.py'), 'snapshot'])
  outcome = 'passed'
} catch (error) { log += redact(error.stack); process.exitCode = 1 }
finally {
  backend?.kill()
  if (backend && backend.exitCode === null) await Promise.race([new Promise(done => backend.once('exit', done)), delay(4000)])
  await writeFile(join(root, 'process-redacted.log'), redact(log))
  const report = join(root, 'results.json')
  try { await writeFile(report, redact(await readFile(report, 'utf8'))) } catch { /* fixture failure may precede report */ }
  await writeFile(join(root, 'run-summary.json'), JSON.stringify({ outcome, before, repository, executable, origin: env.KST_REAL_E2E_BASE_URL, localOnly: true }, null, 2))
  if (await readFile(join(root, '.kst-real-e2e-owned'), 'utf8') === 'kst-real-e2e-v1') await rm(join(root, 'credentials.json'), { force: true })
  console.log('ADMIN_ACCEPTANCE_RESULT=' + outcome)
}
