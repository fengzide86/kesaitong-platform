// Packaged desktop UI against an isolated local backend and controlled updater
// events. This is UI/state-machine acceptance, not a real installer execution.
/* global fetch, AbortSignal, document, window, getComputedStyle, innerWidth, innerHeight */
import process from 'node:process'
import console from 'node:console'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { mkdir, mkdtemp, readFile, writeFile, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as wait } from 'node:timers/promises'
import { _electron as electron } from 'playwright-core'
import { resolvePython } from './run-python.mjs'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const baseline = process.env.KST_UPDATE_BASELINE === '1'
const resume = process.env.KST_UPDATE_RESUME === 'consumer-recovery'
const restartLayout = process.env.KST_UPDATE_RESUME === 'restart-layout'
if ((resume || restartLayout) && baseline) throw new Error('Resume is only supported for the candidate acceptance')
const evidence = resolve('D:/AmazonToolboxData/audits/kst-update-20261012')
await mkdir(evidence, { recursive: true })
const root = await mkdtemp(join(evidence, baseline ? 'before-' : 'after-'))
await writeFile(join(root, '.kst-real-e2e-owned'), 'kst-real-e2e-v1')
await mkdir(join(root, 'screens'))
await mkdir(join(root, 'web'))
const fixtureInstaller = join(root, 'local-fixture.exe')
const fixtureBytes = Buffer.alloc(100000000)
fixtureBytes.write('KST isolated UI fixture. This is not an executable.\n')
await writeFile(fixtureInstaller, fixtureBytes)
const fixtureSha512 = createHash('sha512').update(fixtureBytes).digest('base64')
const executable = resolve(process.env.KST_PACKAGED_EXECUTABLE || 'release/win-unpacked/课赛通 KST.exe')
const port = await new Promise(done => {
  const server = createServer().listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => done(port)) })
})
const base = `http://127.0.0.1:${port}`, identity = `update-ui-${randomBytes(8).toString('hex')}`
const python = resolvePython()
const env = { ...process.env, PYTHON_DOTENV_DISABLED: '1', PYTHONUTF8: '1', APP_ENV: 'test', DB_TYPE: 'sqlite', DEBUG: 'true',
  DB_PATH: join(root, 'acceptance.sqlite3'), TOOLBOX_RUNTIME_DIR: root, TOOLBOX_RELEASE_ID: identity,
  EXPENSE_ATTACHMENT_DIR: join(root, 'attachments'), CHROMA_PERSIST_DIR: join(root, 'chroma'),
  JWT_SECRET_KEY: randomBytes(48).toString('hex'), REDIS_URL: '', REDIS_REQUIRED: 'false',
  QWEN_API_KEY: '', OPENAI_API_KEY: '', AI_SUPPORT_MODE: 'rules', TOOL_EXECUTION_MODE: 'live', RATE_LIMIT_PER_MINUTE: '6000',
  KST_REAL_E2E_DIR: root, KST_REAL_E2E_PORT: String(port), KST_REAL_E2E_BASE_URL: base, TOOLBOX_PYTHON: python }
let backend, application, log = ''
const rows = [], failures = []
const redact = value => String(value).replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT]').replace(/E2E-[A-Z]-[a-f0-9]+/g, '[LOCAL-LICENSE]')
async function seed() {
  await new Promise((done, reject) => {
    const child = spawn(python, [join(repository, 'scripts/real-e2e-fixture.py'), 'seed'], { cwd: repository, env, windowsHide: true })
    child.stdout.on('data', data => { log += redact(data) }); child.stderr.on('data', data => { log += redact(data) })
    child.once('error', reject); child.once('close', code => code === 0 ? done() : reject(new Error('Local seed failed')))
  })
}
async function capture(page, name, width = 1280, zoom = 1, height = 900) {
  await application.evaluate(({ BrowserWindow }, { width, zoom, height }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setPosition(-4000, -4000); win.setContentSize(width, height); win.webContents.setZoomFactor(zoom); win.showInactive(); win.webContents.invalidate()
  }, { width, zoom, height })
  await page.waitForTimeout(400)
  await page.evaluate(() => new Promise(done => window.requestAnimationFrame(() => window.requestAnimationFrame(done))))
  const layout = await page.evaluate(() => ({ viewportWidth: innerWidth, viewportHeight: innerHeight, overflow: document.documentElement.scrollWidth - innerWidth,
    restartDialog: (() => {
      const dialog = document.querySelector('dialog.restart-dialog[open]')
      if (!dialog) return null
      const box = dialog.getBoundingClientRect()
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom,
        centerErrorX: Math.abs(box.left + box.width / 2 - innerWidth / 2),
        centerErrorY: Math.abs(box.top + box.height / 2 - innerHeight / 2),
        hasFocus: dialog.contains(document.activeElement) }
    })(),
    text: document.querySelector('.update-drawer')?.textContent?.trim() || document.body.innerText.slice(0, 1000),
    outOfBounds: [...document.querySelectorAll('.update-drawer button,.update-drawer [role="button"],.el-drawer button,dialog[open] button')].filter(node => {
      const box = node.getBoundingClientRect(); return box.width > 0 && (box.left < -1 || box.right > innerWidth + 1)
    }).map(node => node.textContent?.trim()) }))
  assert.ok(layout.overflow <= 1, `${name}: page horizontal overflow`)
  assert.deepEqual(layout.outOfBounds, [], `${name}: clipped buttons`)
  if (restartLayout && name.includes('-ready')) assert.ok(layout.restartDialog, `${name}: restart dialog must be visible`)
  if (layout.restartDialog) {
    const dialog = layout.restartDialog
    assert.ok(dialog.centerErrorX <= 2 && dialog.centerErrorY <= 2, `${name}: restart dialog must be centered`)
    assert.ok(dialog.left >= 19 && dialog.top >= 19 && dialog.right <= layout.viewportWidth - 19 && dialog.bottom <= layout.viewportHeight - 19, `${name}: restart dialog must retain viewport gutters`)
    assert.equal(dialog.hasFocus, true, `${name}: native modal must own keyboard focus`)
  }
  const png = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64'))
  const filename = `${name}-${width}-${zoom}.png`
  await writeFile(join(root, 'screens', filename), Buffer.from(png, 'base64'))
  rows.push({ name, width, height, zoom, filename, ...layout })
}
try {
  console.log('UPDATE_VISUAL_ROOT=' + root)
  await seed()
  backend = spawn(python, [join(repository, 'scripts/real-e2e-fixture.py'), 'serve'], { cwd: root, env, windowsHide: true })
  backend.stdout.on('data', data => { log += redact(data) }); backend.stderr.on('data', data => { log += redact(data) })
  let ready = false
  for (let i = 0; i < 100 && !ready; i++) {
    try { const response = await fetch(base + '/api/health/ready', { signal: AbortSignal.timeout(1000) }); ready = response.ok && (await response.json()).release_id === identity } catch { /* bounded loopback readiness */ }
    if (!ready) await wait(250)
  }
  assert.ok(ready, 'Owned local backend is required')
  const credentials = JSON.parse(await readFile(join(root, 'credentials.json'), 'utf8'))
  for (const role of ['consumer', 'business', 'admin']) {
    const profile = join(root, 'profile-' + role)
    const desktopEnv = { ...process.env, NODE_ENV: 'production', TOOLBOX_RUNTIME_DIR: profile, TOOLBOX_CONTROL_API_URL: `http://localhost:${port}`, TOOLBOX_USE_BUNDLED_BACKEND: 'false' }
    delete desktopEnv.ELECTRON_RUN_AS_NODE
    application = await electron.launch({ executablePath: executable, args: ['--disable-backgrounding-occluded-windows'], env: desktopEnv })
    await application.evaluate(({ app, BrowserWindow, session }, { base, fixtureInstaller, fixtureSha512, size }) => {
      const updater = process.mainModule.require('electron-updater').autoUpdater
      updater.setFeedURL({ provider: 'generic', url: base })
      const info = { version: '1.8.99', releaseDate: '2026-10-12T00:00:00Z', releaseNotes: '改进取消重试和安装失败恢复\n显示真实速度，任务运行时不会强制重启', files: [{ url: 'local-fixture.exe', size, sha512: fixtureSha512 }] }
      updater.checkForUpdates = async () => { updater.emit('checking-for-update'); updater.emit('update-available', info); return { updateInfo: info } }
      updater.downloadUpdate = token => new Promise((done, reject) => {
        globalThis.__kstFixtureFinish = () => { updater.emit('update-downloaded', info); done([fixtureInstaller]) }
        token.onCancel(() => { setTimeout(() => { updater.emit('error', Object.assign(new Error('cancelled'), { code: 'ERR_CANCELLED' })); reject(new Error('cancelled')) }, 250) })
      })
      updater.quitAndInstall = () => { updater.emit('error', Object.assign(new Error('Local installation launch fixture'), { code: 'EACCES' })) }
      globalThis.__kstFixtureUpdater = updater
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (request, callback) => callback({ cancel: !['localhost', '127.0.0.1'].includes(new URL(request.url).hostname) }))
      for (const win of BrowserWindow.getAllWindows()) { win.setPosition(-4000, -4000); win.setContentSize(1280, 900); win.webContents.setBackgroundThrottling(false); win.showInactive() }
      if (!app.isPackaged) throw new Error('Must use real packaged renderer')
    }, { base, fixtureInstaller, fixtureSha512, size: fixtureBytes.length })
    const page = await application.firstWindow()
    await page.waitForFunction(() => !document.querySelector('.startup-loading') && Boolean(window.electronAPI?.runtime?.deviceId))
    if (role === 'admin') {
      await page.goto('app://toolbox/#/admin/login')
      await page.getByLabel('管理账号', { exact: true }).fill(credentials.staff_username)
      await page.getByLabel('管理员密码', { exact: true }).fill(credentials.staff_password)
      await page.getByRole('button', { name: '登录管理后台', exact: true }).click()
      await page.waitForURL(/admin\/(?!login)/)
    } else {
      await page.getByLabel('授权码', { exact: true }).fill(credentials[role])
      await page.getByRole('button', { name: '登录并开始使用', exact: true }).click()
      await page.waitForURL(role === 'consumer' ? /user\/tools/ : /business\/overview/)
    }
    await page.evaluate(() => window.electronAPI.updates.check())
    if (role === 'admin' && !restartLayout) {
      // Controlled release-list/error fixtures; never stage or publish files to
      // the actual service. Authentication above still used the owned backend.
      await page.route('**/api/updates/releases', route => route.fulfill({ json: [
        { version: '1.8.15', status: 'published', is_latest: true, published_at: '2026-10-11T13:00:00+08:00', files: [{ name: 'KST Setup 1.8.15.exe', size: 110599411, sha512: 'fixture' }] },
        { version: '1.8.14', status: 'published', is_latest: false, published_at: '2026-10-09T13:00:00+08:00', files: [{ name: 'KST Setup 1.8.14.exe', size: 105000000, sha512: 'fixture' }] },
      ] }))
      await page.route('**/api/updates/releases/stage', route => route.fulfill({ status: 500, json: { detail: '隔离验收：上传结果未确认' } }))
      await page.goto('app://toolbox/#/admin/updates')
      await page.waitForLoadState('networkidle')
      await capture(page, 'admin-release-list')
      if (!baseline) {
        await page.getByRole('button', { name: '暂存新版本', exact: true }).click()
        await page.locator('.el-drawer input[type="file"]').setInputFiles([
          { name: 'latest.yml', mimeType: 'text/yaml', buffer: Buffer.from('version: 1.8.98\n') },
          { name: 'KST Setup 1.8.98.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('Not an executable. Local UI fixture only.') },
          { name: 'KST Setup 1.8.98.exe.blockmap', mimeType: 'application/octet-stream', buffer: Buffer.from('Local UI fixture only.') },
        ])
        await capture(page, 'admin-upload-selection')
        await page.getByRole('button', { name: '上传并校验', exact: true }).click()
        await page.getByRole('button', { name: '重新核对版本状态', exact: true }).waitFor()
        await capture(page, 'admin-upload-uncertain')
        await capture(page, 'admin-upload-uncertain-narrow', 768)
        await page.getByRole('button', { name: '关闭', exact: true }).click()
      }
    }
    if (role === 'business' && !baseline) await page.goto('app://toolbox/#/business/workspace')
    await page.locator('.update-status-entry').click()
    await page.locator('.update-drawer').waitFor()
    if (!restartLayout && (!resume || role !== 'consumer')) await capture(page, `${role}-available`)
    await page.getByRole('button', { name: '下载更新', exact: true }).click()
    await page.getByRole('button', { name: '取消下载', exact: true }).waitFor()
    await application.evaluate(() => globalThis.__kstFixtureUpdater.emit('download-progress', { percent: 40.1, transferred: 40100000, total: 100000000, bytesPerSecond: 450000, delta: 100000 }))
    if (!restartLayout && (!resume || role !== 'consumer')) for (const width of role === 'consumer' ? [1280, 1024, 768] : [1280]) await capture(page, `${role}-downloading`, width)
    if (!baseline && !restartLayout && role === 'consumer') {
      if (!resume) {
        await capture(page, 'consumer-downloading-zoom', 1280, 1.25)
        await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1))
        await page.getByText('暂未收到新的下载数据。', { exact: false }).waitFor({ timeout: 40000 })
        await capture(page, 'consumer-stalled')
      }
      await page.getByRole('button', { name: '取消下载', exact: true }).click()
      await page.locator('.el-message-box').getByRole('button', { name: '取消下载', exact: true }).click()
      await page.locator('.update-drawer').getByRole('button', { name: '重新下载', exact: true }).waitFor()
      await capture(page, 'consumer-cancelled')
      await page.locator('.update-drawer').getByRole('button', { name: '重新下载', exact: true }).click()
      await page.getByRole('button', { name: '取消下载', exact: true }).waitFor()
    }
    await application.evaluate(() => globalThis.__kstFixtureFinish())
    await page.getByRole('button', { name: '退出时安装', exact: true }).last().waitFor()
    await capture(page, `${role}-ready`)
    if (restartLayout && role === 'consumer') {
      await capture(page, 'consumer-ready', 1024)
      await capture(page, 'consumer-ready', 768)
      await capture(page, 'consumer-ready-zoom', 1280, 1.25)
      await capture(page, 'consumer-ready-short-zoom', 768, 1.25, 520)
    }
    await page.getByRole('button', { name: '退出时安装', exact: true }).last().click()
    if (!baseline) await page.locator('.restart-dialog').waitFor({ state: 'hidden' })
    await capture(page, `${role}-deferred`)
    if (!baseline && role === 'consumer') {
      await page.getByRole('button', { name: '立即重启', exact: true }).click()
      await page.locator('.state-notice.is-danger').waitFor()
      await capture(page, 'consumer-install-failed')
    }
    // Exit only this owned fixture process, bypassing installation-on-quit.
    // No Windows installer is executed by this test.
    await application.evaluate(({ app }) => app.exit(0)).catch(() => {})
    application = undefined
  }
} catch (error) { failures.push(error.stack || error.message); process.exitCode = 1 }
finally {
  if (application) {
    await application.evaluate(() => { const updater = process.mainModule.require('electron-updater').autoUpdater; updater.autoInstallOnAppQuit = false; updater.quitAndInstall = () => {} }).catch(() => {})
    await application.close().catch(() => application.process().kill())
  }
  backend?.kill()
  await unlink(join(root, 'credentials.json')).catch(() => {})
  await writeFile(join(root, 'result.json'), JSON.stringify({ baseline, resume, restartLayout, executable, scope: 'local packaged UI with controlled updater; no installer executed', rows, failures }, null, 2))
  await writeFile(join(root, 'process.log'), log)
  console.log(JSON.stringify({ root, captures: rows.length, failures }))
}
