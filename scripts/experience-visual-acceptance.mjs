// Actual packaged desktop UI; fixtures, credentials and files stay local.
/* global fetch, AbortSignal, document, window, getComputedStyle, innerWidth, innerHeight */
import process from 'node:process'
import console from 'node:console'
import { Buffer } from 'node:buffer'
import { setTimeout } from 'node:timers'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { resolvePython } from './run-python.mjs'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const baseline = process.env.KST_VISUAL_BASELINE === '1'
const scope = process.env.KST_VISUAL_RECHECK || ''
assert.ok(['', 'pages', 'zoom', 'agent', 'business'].includes(scope), 'Unknown visual recheck scope')
const backendRepository = baseline ? resolve('D:/开发项目/kst-web-retirement') : repository
const evidence = process.env.KST_EXPERIENCE_EVIDENCE || 'D:/AmazonToolboxData/audits/kst-experience-fixes-20261011'
await mkdir(evidence, { recursive: true })
const root = await mkdtemp(join(evidence, 'visual-'))
await writeFile(join(root, '.kst-real-e2e-owned'), 'kst-real-e2e-v1')
const port = await new Promise(resolvePort => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const number = server.address().port
    server.close(() => resolvePort(number))
  })
})
const base = `http://127.0.0.1:${port}`
const desktopBase = `http://localhost:${port}`
const python = resolvePython()
const executable = resolve(process.env.KST_PACKAGED_EXECUTABLE || 'release/win-unpacked/课赛通 KST.exe')
const identity = 'visual-' + randomBytes(10).toString('hex')
const env = { ...process.env, PYTHON_DOTENV_DISABLED: '1', PYTHONUTF8: '1', APP_ENV: 'test', DB_TYPE: 'sqlite', DEBUG: 'true',
  DB_PATH: join(root, 'acceptance.sqlite3'), TOOLBOX_RUNTIME_DIR: root, TOOLBOX_RELEASE_ID: identity,
  EXPENSE_ATTACHMENT_DIR: join(root, 'attachments'), CHROMA_PERSIST_DIR: join(root, 'chroma'),
  JWT_SECRET_KEY: randomBytes(48).toString('hex'), REDIS_URL: '', REDIS_REQUIRED: 'false',
  QWEN_API_KEY: '', OPENAI_API_KEY: '', AI_SUPPORT_MODE: 'rules', TOOL_EXECUTION_MODE: baseline ? 'demo' : 'live',
  // One loopback address drives many pages; production's 60/min remains intact.
  RATE_LIMIT_PER_MINUTE: '6000',
  KST_REAL_E2E_DIR: root, KST_REAL_E2E_PORT: String(port), KST_REAL_E2E_BASE_URL: base,
  KST_EXPERIENCE_VISUAL_FIXTURES: '1', KST_REAL_E2E_UI_CATALOG: baseline ? '0' : '1', TOOLBOX_PYTHON: python }
const roles = { consumer: ['tools', 'logs', 'plans', 'devices', 'ai-chat'], business: ['overview', 'workspace', 'records', 'license'],
  agent: ['overview', 'customers', 'orders', 'licenses', 'requests', 'commission', 'account'],
  admin: ['dashboard', 'agency', 'authcodes', 'business-access', 'orders', 'profit', 'expenses', 'users', 'feedback', 'knowledge', 'ai-chat', 'announcements', 'settings', 'target-reviews', 'updates', 'freight-rates', 'staff-accounts'] }
const observations = [], failures = []
let backend, application, log = ''
const redact = text => String(text).replace(/E2E-[A-Z]-[a-f0-9]+/g, '[TEST-LICENSE]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT-REDACTED]')
async function run(command, args) {
  await new Promise((complete, reject) => {
    const child = spawn(command, args, { cwd: repository, env, windowsHide: true })
    child.stdout.on('data', data => { log += redact(data) }); child.stderr.on('data', data => { log += redact(data) })
    child.once('error', reject); child.once('close', code => code === 0 ? complete() : reject(new Error(`Local fixture step failed (${code})`)))
  })
}
async function capture(page, role, route, width, zoom = 1, options = {}) {
  const requests = [], errors = []
  const onResponse = response => { const url = new URL(response.url()); if (url.pathname.startsWith('/api/')) requests.push({ path: url.pathname, status: response.status() }) }
  const onError = error => errors.push(error.message)
  page.on('response', onResponse); page.on('pageerror', onError)
  // A hidden window may retain its previous compositor frame even though the DOM
  // and network are ready. Keep this isolated window awake while navigating.
  await application.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setPosition(-4000, -4000); win.showInactive() })
  const path = options.path || (route.startsWith('/') ? route : `/${role === 'consumer' ? 'user' : role}/${route}`)
  if (options.navigate !== false) await page.goto(`app://toolbox/#${path}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(250)
  await page.waitForFunction(() => ![...document.querySelectorAll('.el-loading-mask,.startup-loading')].some(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden'), null, { polling: 100 })
  const data = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth - innerWidth,
    clippedControls: [...document.querySelectorAll('.metrics>a,.journey ol>li,.header-tools')].filter(node => { const box = node.getBoundingClientRect(); return box.width > 0 && (box.right > innerWidth + 1 || box.left < -1) }).map(node => node.className || node.tagName),
    text: document.body.innerText, scrollAreas: [...document.querySelectorAll('*')].filter(node => node.scrollWidth > node.clientWidth + 2 && getComputedStyle(node).overflowX === 'auto').map(node => ({ class: node.className, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth })).slice(0, 8) }))
  if (!baseline) {
    // Electron's Windows non-client metrics add a small, stable correction at
    // some content sizes. Record the actual CSS width and reject only a real
    // breakpoint miss, rather than mistaking the frame metric for app overflow.
    assert.ok(Math.abs(data.width - width / zoom) <= 16, `Requested ${width}/${zoom}, actual CSS width ${data.width}`)
    assert.equal(new URL(page.url()).hash, `#${path}`, `${role}/${route} unexpectedly redirected`)
    assert.ok(data.overflow <= 1, `${role}/${route} overflow ${data.overflow}`)
    assert.deepEqual(data.clippedControls, [], `${role}/${route} controls outside viewport`)
    assert.deepEqual(errors, [])
    assert.deepEqual(requests.filter(row => row.status >= 500), [], `${role}/${route} backend errors`)
    if (['admin', 'agent'].includes(role)) assert.equal(requests.some(row => row.path === '/api/announcements/feed'), false, 'Staff must not request customer feed')
  }
  const filename = `windows-${width}${zoom > 1 ? '-125pct' : ''}-${role}-${route.replaceAll('/', '-').replace(/^-/, '')}.png`
  // CDP page.screenshot changes viewport compensation at non-100% Electron
  // zoom and can crop an otherwise correct native layout. Capture the actual
  // compositor; no screenshot post-processing or product CSS changes.
  const mask = await page.addStyleTag({ content: '.auth-code,.code-cell,.license-code,.delivery-block code,.records-table code{color:transparent!important;background:#e5e7eb!important}input[type="password"]{visibility:hidden!important}' })
  await application.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setPosition(-4000, -4000); win.showInactive(); win.webContents.invalidate() })
  await page.waitForFunction(() => document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().iterations) && animation.playState === 'running').length === 0)
  await page.evaluate(() => new Promise(resolvePaint => window.requestAnimationFrame(() => window.requestAnimationFrame(resolvePaint))))
  const native = await application.evaluate(async ({ BrowserWindow }) => { const png = await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); return { size: png.getSize(), data: png.toPNG().toString('base64') } })
  await writeFile(join(root, 'screens', filename), Buffer.from(native.data, 'base64'))
  await mask.evaluate(node => node.remove())
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
  observations.push({ role, route, path, requestedWidth: width, zoom, filename, nativeSize: native.size, requests, errors, ...JSON.parse(redact(JSON.stringify(data))) })
  page.off('response', onResponse); page.off('pageerror', onError)
}
try {
  console.log('VISUAL_ROOT=' + root)
  await writeFile(join(evidence, 'visual-location.json'), JSON.stringify({ root, base, repository, executable }, null, 2))
  await mkdir(join(root, 'web')); await mkdir(join(root, 'screens'))
  await run(python, [join(repository, 'scripts/real-e2e-fixture.py'), 'seed'])
  backend = spawn(python, [join(backendRepository, 'scripts/real-e2e-fixture.py'), 'serve'], { cwd: root, env, windowsHide: true })
  backend.stdout.on('data', data => { log += redact(data) }); backend.stderr.on('data', data => { log += redact(data) })
  let ready = false
  for (let attempt = 0; attempt < 100 && !ready; attempt++) {
    try { const response = await fetch(base + '/api/health/ready', { signal: AbortSignal.timeout(1000) }); const health = await response.json(); ready = response.ok && health.release_id === identity } catch { /* bounded local startup */ }
    if (!ready) await new Promise(resolveWait => setTimeout(resolveWait, 250))
  }
  assert.ok(ready, 'Distinct local backend must be ready')
  const credentials = JSON.parse(await readFile(join(root, 'credentials.json'), 'utf8'))
  for (const [role, routes] of Object.entries(roles)) {
    if (['agent', 'business'].includes(scope) && role !== scope) continue
    const profile = join(root, 'profile-' + role)
    const desktopEnv = { ...process.env, NODE_ENV: 'production', TOOLBOX_RUNTIME_DIR: profile, TOOLBOX_CONTROL_API_URL: desktopBase, TOOLBOX_USE_BUNDLED_BACKEND: 'false' }
    delete desktopEnv.ELECTRON_RUN_AS_NODE
    try {
      application = await electron.launch({ executablePath: executable, args: ['--disable-backgrounding-occluded-windows'], env: desktopEnv, timeout: 30000 })
      const runtime = await application.evaluate(({ app, BrowserWindow, session }, feed) => {
        process.mainModule.require('electron-updater').autoUpdater.setFeedURL({ provider: 'generic', url: feed });
        session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (request, callback) => callback({ cancel: !['localhost', '127.0.0.1'].includes(new URL(request.url).hostname) }))
        for (const window of BrowserWindow.getAllWindows()) { window.webContents.setBackgroundThrottling(false); window.setMinimumSize(0, 0); window.setContentSize(1440, 900); window.hide() }
        return { packaged: app.isPackaged, version: app.getVersion(), profile: app.getPath('userData') }
      }, desktopBase)
      assert.ok(runtime.packaged); assert.equal(resolve(runtime.profile), resolve(profile))
      const page = await application.firstWindow()
      page.setDefaultTimeout(20000)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.waitForFunction(() => !document.querySelector('.startup-loading') && Boolean(window.electronAPI?.runtime?.deviceId), null, { polling: 100 })
      if (role === 'consumer' && !baseline && ['', 'pages'].includes(scope)) {
        // Narrow captures exercise renderer breakpoints only, not a mobile app.
        await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setMinimumSize(0, 0))
        for (const width of [1440, 1280, 1024, 768, 390]) {
          await application.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, width < 900 ? 1024 : 900), width)
          await capture(page, role, '/user/login', width)
          await page.getByRole('link', { name: '使用帮助', exact: true }).click()
          await page.getByRole('button', { name: '我知道了', exact: true }).waitFor()
          await capture(page, role, 'login-help', width, 1, { path: '/user/login', navigate: false })
          await page.getByRole('button', { name: '我知道了', exact: true }).click()
          await page.getByRole('link', { name: '联系客服', exact: true }).click()
          await capture(page, role, 'login-contact', width, 1, { path: '/user/login', navigate: false })
          await page.keyboard.press('Escape')
          await capture(page, role, '/admin/login', width)
          await capture(page, role, '/user/terms', width)
          await capture(page, role, '/visual-unknown-route', width)
        }
        await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900))
        await page.goto('app://toolbox/#/user/login')
      }
      if (['consumer', 'business'].includes(role)) {
        await page.getByLabel('授权码', { exact: true }).fill(credentials[role]); await page.getByRole('button', { name: '登录并开始使用', exact: true }).click()
        await page.waitForURL(role === 'consumer' ? /user\/tools/ : /business\/overview/)
      } else {
        await page.goto('app://toolbox/#/admin/login'); await page.getByLabel('管理账号', { exact: true }).fill(credentials[role === 'agent' ? 'agent_a_username' : 'staff_username'])
        await page.getByLabel('管理员密码', { exact: true }).fill(credentials[role === 'agent' ? 'agent_a_password' : 'staff_password'])
        await page.getByRole('button', { name: '登录管理后台', exact: true }).click(); await page.waitForURL(role === 'agent' ? /agent\/overview/ : /admin\/(?!login)/)
      }
      const sampledRoutes = scope === 'agent' ? ['overview', 'licenses'] : baseline ? { consumer: ['tools', 'logs'], business: ['workspace'], agent: ['overview', 'licenses'], admin: ['dashboard', 'business-access'] }[role] : role === 'admin' ? [...routes, '/admin/change-password'] : routes
      for (const width of scope === 'zoom' ? [] : baseline ? [1440, 1024] : [1440, 1280, 1024]) {
        await application.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height: width === 1440 ? 900 : 768 })
        for (const route of sampledRoutes) await capture(page, role, route, width)
      }
      await application.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setContentSize(1440, 1000); window.webContents.setZoomFactor(1.25) })
      for (const route of baseline && !scope ? [] : sampledRoutes) await capture(page, role, route, 1440, 1.25)
      observations.push({ role, runtime })
      console.log('ROLE_VISUAL_PASS=' + role)
    } catch (error) {
      failures.push({ role, message: error.message }); console.error('ROLE_VISUAL_FAIL=' + role + ': ' + error.message)
    } finally { await application?.close().catch(() => application.process().kill()); application = undefined }
  }
  assert.deepEqual(failures, [])
  if (!baseline && !scope) {
    await run(process.execPath, [join(repository, 'node_modules/@playwright/test/cli.js'), 'test', '--config', 'playwright.packaged.config.mjs'])
    console.log('PACKAGED_JOURNEYS_PASS=true')
  } else {
    console.log('PACKAGED_JOURNEYS_NOT_RUN=visual-recheck-only')
  }
} catch (error) { failures.push({ stage: 'visual acceptance', message: error.message }); process.exitCode = 1 }
finally {
  await application?.close().catch(() => application.process().kill()); backend?.kill()
  if (backend && backend.exitCode === null) await new Promise(resolveWait => { backend.once('exit', resolveWait); setTimeout(resolveWait, 4000) })
  await writeFile(join(root, 'observations.json'), JSON.stringify({ repository, executable, scope, reducedMotion: 'reduce', packagedJourneysRequested: !baseline && !scope, observations, failures }, null, 2))
  await writeFile(join(root, 'process-redacted.log'), log)
  if (await readFile(join(root, '.kst-real-e2e-owned'), 'utf8') === 'kst-real-e2e-v1') await rm(join(root, 'credentials.json'), { force: true })
}
