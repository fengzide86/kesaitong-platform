/* global location, document, window, requestAnimationFrame, innerWidth, innerHeight */
import process from 'node:process'
import { Buffer } from 'node:buffer'
import { URL } from 'node:url'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'
import { expect, test } from '@playwright/test'

const runtime = process.env.KST_REAL_E2E_DIR
const fixtureOrigin = new URL(process.env.KST_REAL_E2E_BASE_URL)
// The production renderer's CSP explicitly permits localhost test APIs.
const api = `http://localhost:${fixtureOrigin.port}`
const credentials = JSON.parse(readFileSync(join(runtime, 'credentials.json'), 'utf8'))
const metadata = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
const executable = resolve(process.env.KST_PACKAGED_EXECUTABLE || 'release/win-unpacked/课赛通 KST.exe')
if (!existsSync(executable)) throw new Error('Build and audit the production packaged executable first')

async function navigate(page, route) {
  await page.evaluate(value => { location.hash = value }, route)
  await expect(page).toHaveURL(new RegExp(`#${route.replaceAll('/', '\\/')}$`))
}

async function capture(application, page, name) {
  await expect(page.locator('.startup-loading')).toHaveCount(0)
  await expect(page.locator('.web-update-notice')).toHaveCount(0)
  // Hidden Windows windows can retain a stale compositor frame even when the DOM is ready.
  // Paint off screen without focus, then use native capture (no viewport-resize protocol).
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.removeListener('show', globalThis.__kstRetirementHideWindow)
    window.setPosition(-4000, -4000)
    window.showInactive()
    window.webContents.invalidate()
  })
  try {
    // Native screenshots must show the settled UI, not a card/drawer enter
    // transition. Ignore perpetual spinners; never disable product animations.
    await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation =>
      Number.isFinite(animation.effect?.getComputedTiming().iterations) && animation.playState === 'running'
    ).length)).toBe(0)
    await page.evaluate(() => new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))))
    const png = await application.evaluate(async ({ BrowserWindow }) => {
      const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
      return image.toPNG().toString('base64')
    })
    const filename = `packaged-${name}.png`
    writeFileSync(join(runtime, filename), Buffer.from(png, 'base64'))
    return { filename, route: new URL(page.url()).hash }
  } finally {
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
  }
}

for (const role of ['consumer', 'business', 'admin', 'agent']) {
  test(`packaged Windows ${role} signs in and reads its own screens after Web retirement`, async () => {
    const environment = {
      ...process.env,
      NODE_ENV: 'production',
      TOOLBOX_RUNTIME_DIR: join(runtime, `packaged-${role}-profile`),
      TOOLBOX_CONTROL_API_URL: api,
      TOOLBOX_USE_BUNDLED_BACKEND: 'false',
    }
    delete environment.ELECTRON_RUN_AS_NODE
    const application = await electron.launch({ executablePath: executable, args: ['--disable-backgrounding-occluded-windows'], env: environment, timeout: 30_000 })
    let page
    const evidence = { role, status: 'running', requests: [], rendererErrors: [], screenshots: [] }
    try {
      const packaged = await application.evaluate(({ app, BrowserWindow, session }, feed) => {
        const updater = process.mainModule.require('electron-updater').autoUpdater
        updater.setFeedURL({ provider: 'generic', url: `${feed}/updates/` })
        updater.autoDownload = false
        // Interception exists only in this smoke process; no runtime hook is shipped.
        globalThis.__kstRetirementBlockedOrigins = []
        session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
          const url = new URL(details.url)
          const local = ['localhost', '127.0.0.1'].includes(url.hostname)
          if (!local) globalThis.__kstRetirementBlockedOrigins.push(url.origin)
          callback({ cancel: !local })
        })
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.setBackgroundThrottling(false)
          window.setContentSize(1440, 1000)
          window.hide()
          globalThis.__kstRetirementHideWindow = () => window.hide()
          window.on('show', globalThis.__kstRetirementHideWindow)
        }
        return { packaged: app.isPackaged, version: app.getVersion(), userData: app.getPath('userData') }
      }, api)
      expect(packaged).toEqual({ packaged: true, version: metadata.version, userData: environment.TOOLBOX_RUNTIME_DIR })
      evidence.packaged = packaged
      page = await application.firstWindow()
      // Electron may create its first window after the initial main-process setup.
      // Do not let a hidden/occluded frame pause Playwright's startup readiness poll.
      await application.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]
        window.webContents.setBackgroundThrottling(false)
        window.setContentSize(1440, 1000)
      })
      page.on('pageerror', error => evidence.rendererErrors.push(error.message))
      page.on('response', response => {
        const url = new URL(response.url())
        if (url.pathname.startsWith('/api/')) evidence.requests.push({ method: response.request().method(), path: url.pathname, status: response.status() })
      })
      await page.waitForFunction(() => !document.querySelector('.startup-loading') && Boolean(window.electronAPI?.runtime?.deviceId), undefined, { polling: 100 })
      expect(page.url()).toMatch(/^app:\/\/toolbox\/index\.html/)
      expect(await page.evaluate(() => window.electronAPI.runtime.controlApiBase)).toBe(api)
      expect(await page.evaluate(() => ['select', 'validate', 'clear'].every(method => typeof window.electronAPI.files?.[method] === 'function'))).toBe(true)
      expect(await page.evaluate(() => ['list', 'review', 'prepare', 'export'].every(method => typeof window.electronAPI.recovery?.[method] === 'function'))).toBe(true)
      await expect(page).toHaveURL(/#\/user\/login$/)
      await expect(page.getByLabel('授权码', { exact: true })).toBeVisible()

      if (role === 'consumer' || role === 'business') {
        await page.getByLabel('授权码', { exact: true }).fill(credentials[role])
        const [authenticated] = await Promise.all([
          page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/verify' && response.request().method() === 'POST'),
          page.getByRole('button', { name: '登录并开始使用' }).click({ force: true }),
        ])
        expect(authenticated.status()).toBe(200)
        await expect(page).toHaveURL(role === 'consumer' ? /#\/user\/tools$/ : /#\/business\/overview$/)
        if (role === 'consumer') {
          expect(await page.evaluate(() => window.electronAPI.recovery.list())).toEqual([])
          const fixtureFile = join(runtime, '商品 资料.txt')
          writeFileSync(fixtureFile, 'Isolated local-file bridge fixture; not customer contents')
          // Stub only the OS choice in this isolated process. The packaged
          // trusted IPC, local readability/selection ownership remain real.
          await application.evaluate(({ dialog }, selected) => {
            globalThis.__kstOriginalOpenDialog = dialog.showOpenDialog
            dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] })
          }, fixtureFile)
          const chosen = await page.evaluate(() => window.electronAPI.files.select({ label: '本地验收资料' }))
          expect(chosen.fileName).toBe('商品 资料.txt')
          expect((await page.evaluate(filePath => window.electronAPI.files.validate({ paths: [filePath] }), fixtureFile)).valid).toBe(true)
          await application.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }) })
          expect(await page.evaluate(() => window.electronAPI.files.select({ label: '取消选择' }))).toBeNull()
          expect((await page.evaluate(filePath => window.electronAPI.files.validate({ paths: [filePath] }), fixtureFile)).valid).toBe(true)
          await application.evaluate(({ dialog }, selected) => {
            process.mainModule.require('node:fs').unlinkSync(selected)
            dialog.showOpenDialog = globalThis.__kstOriginalOpenDialog
          }, fixtureFile)
          expect((await page.evaluate(filePath => window.electronAPI.files.validate({ paths: [filePath] }), fixtureFile)).valid).toBe(false)
          evidence.fileBridge = ['Chinese and spaces', 'cancel retained choice', 'deleted file rejected', 'no control-plane file upload']
          await navigate(page, '/user/plans')
          await expect(page.getByRole('region', { name: '当前授权摘要' })).toBeVisible()
          await expect(page.locator('.license-summary')).toContainText('5 台')
          evidence.screenshots.push(await capture(application, page, 'consumer-license'))
          await navigate(page, '/user/logs')
          await expect(page.getByRole('tab', { name: '历史演示', exact: true })).toHaveCount(0)
          await expect(page.getByText('还没有真实执行记录', { exact: true })).toBeVisible()
          evidence.screenshots.push(await capture(application, page, 'consumer-records'))
        } else {
          expect(await page.evaluate(() => window.electronAPI.recovery.list())).toEqual([])
          await navigate(page, '/business/license')
          await expect(page.locator('.limits-grid')).toContainText('已授权')
          evidence.screenshots.push(await capture(application, page, 'business-license'))
          await navigate(page, '/business/records')
          await expect(page.getByText('还没有真实批次记录', { exact: true })).toBeVisible()
          evidence.screenshots.push(await capture(application, page, 'business-records'))
        }
      } else {
        await page.getByRole('link', { name: '管理端登录', exact: true }).click({ force: true })
        await expect(page).toHaveURL(/#\/admin\/login$/)
        await page.getByLabel('后台账号', { exact: true }).fill(credentials[role === 'admin' ? 'staff_username' : 'agent_a_username'])
        await page.getByLabel('密码', { exact: true }).fill(credentials[role === 'admin' ? 'staff_password' : 'agent_a_password'])
        await page.getByRole('button', { name: '登录并进入工作台' }).click({ force: true })
        if (role === 'admin') {
          await expect(page).toHaveURL(/#\/admin\/dashboard$/)
          await expect(page.getByRole('region', { name: '待处理事项摘要' })).toBeVisible()
          await expect(page.getByRole('complementary', { name: '管理员导航' })).toBeVisible()
          evidence.screenshots.push(await capture(application, page, 'admin-dashboard'))
          // The dashboard entry is the intended short path into the new
          // platform-entry review page. Exercise the actual link and the
          // default-open, read-only review state instead of only asserting
          // that the dashboard rendered.
          await page.getByRole('link', { name: '打开审核页', exact: true }).click({ force: true })
          await expect(page).toHaveURL(/#\/admin\/target-reviews$/)
          await expect(page.getByRole('heading', { name: '平台入口审核', exact: true })).toBeVisible()
          await expect(page.getByText('尚无接入申请。用户在 Windows 工具箱检测新入口后可提交。', { exact: true })).toBeVisible()
          evidence.screenshots.push(await capture(application, page, 'admin-target-reviews'))
        } else {
          await expect(page).toHaveURL(/#\/agent\/overview$/)
          await expect(page.getByRole('navigation', { name: '代理导航' })).toBeVisible()
          await expect(page.locator('.metrics strong').first()).toHaveText(process.env.KST_EXPERIENCE_VISUAL_FIXTURES === '1' ? '2' : '0')
          evidence.screenshots.push(await capture(application, page, 'agent-overview'))
          await navigate(page, '/agent/licenses')
          await expect(page.locator('.records-heading')).toContainText('授权')
          await expect.poll(() => evidence.requests.some(request => request.path === '/api/agency/licenses' && request.status === 200)).toBe(true)
          evidence.screenshots.push(await capture(application, page, 'agent-licenses'))
        }
      }
      expect(evidence.rendererErrors).toEqual([])
      evidence.blockedOrigins = await application.evaluate(() => globalThis.__kstRetirementBlockedOrigins)
      expect(evidence.blockedOrigins).toEqual([])
      const requiredPaths = {
        consumer: ['/api/auth/verify', '/api/plans', '/api/executions'],
        business: ['/api/auth/verify', '/api/auth/check', '/api/business/bootstrap', '/api/business/batches'],
        admin: ['/api/staff/auth/login', '/api/admin/action-center'],
        agent: ['/api/staff/auth/login', '/api/agency/summary', '/api/agency/licenses'],
      }[role]
      for (const path of requiredPaths) {
        await expect.poll(() => evidence.requests.some(request => request.path === path && request.status === 200), { message: `${role}: ${path} must return 200` }).toBe(true)
      }
      // Staff has no customer-device identity. The shell must not request that
      // feed, rather than treating its 403 as acceptable network noise.
      if (role === 'admin' || role === 'agent') {
        expect(evidence.requests.filter(request => request.path === '/api/announcements/feed')).toEqual([])
      }
      expect(evidence.requests.filter(request => request.status >= 400)).toEqual([])
      evidence.status = 'passed'
    } catch (error) {
      evidence.status = 'failed'
      evidence.error = error instanceof Error ? error.message : String(error)
      if (page) await capture(application, page, `${role}-failure`).catch(() => {})
      throw error
    } finally {
      await application.close().catch(() => application.process().kill())
      writeFileSync(join(runtime, `packaged-${role}-evidence.json`), JSON.stringify(evidence, null, 2))
    }
  })
}

test('packaged local recovery survives restart and manual review stays separate from Runner success', async () => {
  const environment = { ...process.env, NODE_ENV: 'production', TOOLBOX_RUNTIME_DIR: join(runtime, 'packaged-recovery-profile'), TOOLBOX_CONTROL_API_URL: api, TOOLBOX_USE_BUNDLED_BACKEND: 'false' }
  delete environment.ELECTRON_RUN_AS_NODE
  let application
  let page
  const evidence = { status: 'running', fixture: 'synthetic local ledger only; no Runner or real platform submission', screenshots: [], rendererErrors: [] }
  async function open() {
    application = await electron.launch({ executablePath: executable, args: ['--disable-backgrounding-occluded-windows'], env: environment, timeout: 30_000 })
    await application.evaluate(({ session }, feed) => {
      const updater = process.mainModule.require('electron-updater').autoUpdater
      updater.setFeedURL({ provider: 'generic', url: `${feed}/updates/` }); updater.autoDownload = false
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => callback({ cancel: !['localhost', '127.0.0.1'].includes(new URL(details.url).hostname) }))
    }, api)
    page = await application.firstWindow()
    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.webContents.setBackgroundThrottling(false); window.setContentSize(1440, 1000); window.hide()
      globalThis.__kstRetirementHideWindow = () => window.hide(); window.on('show', globalThis.__kstRetirementHideWindow)
    })
    page.on('pageerror', error => evidence.rendererErrors.push(error.message))
    await page.waitForFunction(() => !document.querySelector('.startup-loading') && Boolean(window.electronAPI?.runtime?.deviceId), undefined, { polling: 100 })
    await expect(page).toHaveURL(/#\/user\/(login|tools)$/)
    // Reusing this isolated profile also tests native authorization restoration.
    // A restored session is not supposed to display the login form again.
    if (new URL(page.url()).hash === '#/user/login') {
      await page.getByLabel('授权码', { exact: true }).fill(credentials.consumer)
        await page.getByRole('button', { name: '登录并开始使用' }).click({ force: true })
    }
    await expect(page).toHaveURL(/#\/user\/tools$/)
  }
  try {
    await open()
    await application.evaluate(async ({ app, BrowserWindow, net }, origin) => {
      const path = process.mainModule.require('node:path')
      const { RecoveryStore, recoveryOwnerHash } = process.mainModule.require(path.join(app.getAppPath(), 'dist-electron/electron/automation/recovery-store.cjs'))
      const token = await BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('sessionStorage.getItem("toolbox_token")')
      const response = await net.fetch(`${origin}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      const user = (await response.json()).data
      if (!response.ok || user.role !== 'user') throw new Error('Isolated fixture owner not verified')
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
      const owner = recoveryOwnerHash([origin, user.user_id, claims.auth_code_id || null, claims.device_id || user.device_id || null])
      const store = new RecoveryStore(path.join(app.getPath('userData'), 'recovery-metadata'))
      const tool = { id: 'isolated-ui-fixture', launchGrant: { toolVersion: '1.0.0' } }
      const unknown = store.begin(owner, tool, { fixture: 'unknown' }, { batchId: 'isolated-ui-batch', itemId: 'row2', originalRow: 2 })
      store.mutation(owner, unknown.id)
      store.observe(owner, unknown.id, { type: 'run.failed', error: { code: 'TIMEOUT' } })
      const safe = store.begin(owner, tool, { fixture: 'safe' }, { batchId: 'isolated-ui-batch', itemId: 'row3', originalRow: 3 })
      store.observe(owner, safe.id, { type: 'run.failed', error: { code: 'BROWSER_NOT_FOUND' } })
    }, api)
    await application.close()
    await open()
    await navigate(page, '/user/logs')
    await expect(page.getByTestId('recovery-panel')).toContainText('原表第 2 行 · 结果待核对')
    await expect(page.getByTestId('recovery-panel')).toContainText('原表第 3 行 · 确定未提交')
    const records = await page.evaluate(() => window.electronAPI.recovery.list())
    expect(records.find(row => row.originalRow === 2)).toMatchObject({ classification: 'needs_review', executionStatus: 'failed', retryAllowed: false })
    evidence.screenshots.push(await capture(application, page, 'recovery-review-needed'))
    await page.locator('.recovery-row').filter({ hasText: '原表第 2 行' }).getByRole('button', { name: '记录核对结论' }).click({ force: true })
    await expect(page.getByRole('button', { name: '确认未完成', exact: true })).toBeDisabled()
    await page.getByText('我已在平台查看同一业务对象的当前状态', { exact: true }).click({ force: true })
    evidence.screenshots.push(await capture(application, page, 'recovery-conclusion-dialog'))
    await page.getByRole('button', { name: '确认未完成', exact: true }).click({ force: true })
    await expect(page.getByTestId('recovery-panel')).toContainText('原表第 2 行 · 人工核对未完成')
    expect((await page.evaluate(() => window.electronAPI.recovery.list())).find(row => row.originalRow === 2)).toMatchObject({ classification: 'manual_not_completed', executionStatus: 'failed', retryAllowed: true })
    evidence.screenshots.push(await capture(application, page, 'recovery-manual-not-completed'))
    expect(evidence.rendererErrors).toEqual([])
    evidence.status = 'passed'
  } finally {
    await application?.close().catch(() => application.process().kill())
    writeFileSync(join(runtime, 'packaged-recovery-evidence.json'), JSON.stringify(evidence, null, 2))
  }
})

test('packaged UI preserves brand and searchable tool directory at supported window widths', async () => {
  test.skip(process.env.KST_REAL_E2E_UI_CATALOG !== '1', 'Requires opt-in isolated display-only catalog')
  const environment = { ...process.env, NODE_ENV: 'production', TOOLBOX_RUNTIME_DIR: join(runtime, 'packaged-ui-profile'), TOOLBOX_CONTROL_API_URL: api, TOOLBOX_USE_BUNDLED_BACKEND: 'false' }
  delete environment.ELECTRON_RUN_AS_NODE
  const application = await electron.launch({ executablePath: executable, args: ['--disable-backgrounding-occluded-windows'], env: environment, timeout: 30_000 })
  const evidence = { status: 'running', fixture: 'isolated disabled catalog; no tool or Runner execution', widths: [], screenshots: [], rendererErrors: [] }
  let page
  try {
    const packaged = await application.evaluate(({ app, session }, feed) => {
      const updater = process.mainModule.require('electron-updater').autoUpdater
      updater.setFeedURL({ provider: 'generic', url: `${feed}/updates/` }); updater.autoDownload = false
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => callback({ cancel: !['localhost', '127.0.0.1'].includes(new URL(details.url).hostname) }))
      return { packaged: app.isPackaged, version: app.getVersion(), userData: app.getPath('userData') }
    }, api)
    expect(packaged).toEqual({ packaged: true, version: metadata.version, userData: environment.TOOLBOX_RUNTIME_DIR })
    evidence.packaged = packaged
    page = await application.firstWindow()
    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.webContents.setBackgroundThrottling(false); window.setContentSize(1440, 900); window.hide()
      globalThis.__kstRetirementHideWindow = () => window.hide(); window.on('show', globalThis.__kstRetirementHideWindow)
    })
    page.on('pageerror', error => evidence.rendererErrors.push(error.message))
    await page.waitForFunction(() => !document.querySelector('.startup-loading') && Boolean(window.electronAPI?.runtime?.deviceId), undefined, { polling: 100 })
    expect(page.url()).toMatch(/^app:\/\/toolbox\/index\.html/)
    expect(await page.evaluate(() => window.electronAPI.runtime.controlApiBase)).toBe(api)
    await page.getByLabel('授权码', { exact: true }).fill(credentials.consumer)
      await page.getByRole('button', { name: '登录并开始使用' }).click({ force: true })
    await expect(page).toHaveURL(/#\/user\/tools$/)
    await expect(page.locator('.skeleton-card')).toHaveCount(0)
    await expect.poll(() => page.locator('.tool-card').count()).toBeGreaterThan(0)
    const initialCount = await page.locator('.tool-card').count()
    const search = page.getByRole('searchbox', { name: '搜索任务或工具' })
    const usable = page.getByRole('checkbox', { name: '当前可用' })
    for (const width of [1440, 1280, 1024, 900]) {
      const nativeLayout = await application.evaluate(({ BrowserWindow }, size) => {
        const window = BrowserWindow.getAllWindows()[0]
        window.removeListener('show', globalThis.__kstRetirementHideWindow)
        window.setPosition(-4000, -4000); window.showInactive()
        // Windows can apply different non-client/DPI compensation off screen.
        // Verify the actual native content width, not a guessed frame inset.
        window.setBounds({ x: -4000, y: -4000, width: size, height: 960 }); window.webContents.invalidate()
        return { requestedWindowWidth: size, contentWidth: window.getContentBounds().width }
      }, width)
      await page.waitForFunction(size => Math.abs(window.innerWidth - size) <= 2, nativeLayout.contentWidth, { polling: 100 })
      await expect(search).toBeVisible()
      await expect(usable).toBeVisible()
      await expect(page.getByTestId('platform-switcher')).toBeVisible()
      expect(await page.locator('[data-testid="kst-brand-lockup"]:visible, [data-testid="kst-brand-mark"]:visible').count()).toBeGreaterThan(0)
      const layout = await page.evaluate(() => {
        const header = document.querySelector('.header-inner')
        const leading = header.querySelector('.header-leading').getBoundingClientRect()
        const tools = header.querySelector('.header-tools').getBoundingClientRect()
        const directory = document.querySelector('.directory-filters')
        return { width: innerWidth, pageOverflow: document.documentElement.scrollWidth - innerWidth, directoryOverflow: directory.scrollWidth - directory.clientWidth, headerOverlap: leading.right - tools.left }
      })
      expect(layout.pageOverflow).toBeLessThanOrEqual(1)
      expect(layout.directoryOverflow).toBeLessThanOrEqual(1)
      expect(layout.headerOverlap).toBeLessThanOrEqual(1)
      evidence.widths.push({ ...layout, ...nativeLayout })
      evidence.screenshots.push(await capture(application, page, `ui-tools-${width}`))
    }
    await search.fill('KST不存在的工具zzzz')
    await expect(page.getByText('没有符合条件的工具', { exact: true })).toBeVisible()
    await expect(page.locator('.tool-card')).toHaveCount(0)
    evidence.screenshots.push(await capture(application, page, 'ui-search-empty'))
    await search.fill('')
    await expect(page.locator('.tool-card')).toHaveCount(initialCount)
    const firstName = await page.locator('.tool-card .tool-copy > strong').first().innerText()
    await search.fill(firstName)
    await expect(page.locator('.tool-card').first()).toContainText(firstName)
    await expect(page.locator('.tool-card')).toHaveCount(1)
    evidence.screenshots.push(await capture(application, page, 'ui-search-match'))
    await search.fill('')
    await usable.check({ force: true })
    await expect(page.locator('.tool-card')).toHaveCount(0)
    await usable.uncheck({ force: true })
    await expect(page.locator('.tool-card')).toHaveCount(initialCount)
    await page.locator('[data-task-id="product"]').click({ force: true })
    await expect(page.locator('[data-task-id="product"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.tool-card')).toHaveCount(1)
    await page.getByRole('button', { name: '全部任务', exact: true }).click({ force: true })
    await expect(page.locator('.tool-card')).toHaveCount(initialCount)
    const detailCards = page.locator('.tool-card:has(.learn-more)')
    expect(await detailCards.count()).toBeGreaterThan(0)
    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.showInactive(); window.webContents.invalidate()
    })
    await detailCards.first().click()
    await expect(page.locator('.el-drawer:visible')).toBeVisible()
    await expect(page.locator('.el-drawer:visible .drawer-primary')).toBeDisabled()
    // A visible drawer can still be midway through its enter transform. Check
    // the final painted layout rather than treating the transition as clipping.
    await expect.poll(async () => {
      const box = await page.locator('.el-drawer:visible').boundingBox()
      return box ? box.x + box.width - (await page.evaluate(() => innerWidth)) : Number.POSITIVE_INFINITY
    }).toBeLessThanOrEqual(1)
    const drawer = await page.locator('.el-drawer:visible').boundingBox()
    expect(drawer.x).toBeGreaterThanOrEqual(0)
    expect(drawer.x + drawer.width).toBeLessThanOrEqual((await page.evaluate(() => innerWidth)) + 1)
    evidence.screenshots.push(await capture(application, page, 'ui-tool-details'))
    await page.locator('.el-drawer:visible .el-drawer__close-btn').click({ force: true })
    await expect(page.locator('.el-drawer:visible')).toHaveCount(0)
    expect(evidence.rendererErrors).toEqual([])
    evidence.search = ['unknown query shows empty state', 'clear restores directory', 'name query filters', 'usable filter restores', 'task filter restores', 'details drawer fits']
    evidence.status = 'passed'
  } catch (error) {
    evidence.status = 'failed'; evidence.error = error.message
    evidence.nativeWindow = await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      return { content: window.getContentBounds(), bounds: window.getBounds(), zoom: window.webContents.getZoomFactor() }
    }).catch(() => null)
    evidence.viewport = page ? await page.evaluate(() => ({ width: innerWidth, height: innerHeight })).catch(() => null) : null
    if (page) await capture(application, page, 'ui-recheck-failure').catch(() => {})
    throw error
  } finally {
    await application.close().catch(() => application.process().kill())
    writeFileSync(join(runtime, 'packaged-ui-evidence.json'), JSON.stringify(evidence, null, 2))
  }
})
