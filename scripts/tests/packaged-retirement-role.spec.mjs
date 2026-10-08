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
      await expect(page).toHaveURL(/#\/user\/login$/)
      await expect(page.getByLabel('授权码', { exact: true })).toBeVisible()

      if (role === 'consumer' || role === 'business') {
        await page.getByLabel('授权码', { exact: true }).fill(credentials[role])
        const [authenticated] = await Promise.all([
          page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/verify' && response.request().method() === 'POST'),
          page.getByRole('button', { name: '验证并登录' }).click({ force: true }),
        ])
        expect(authenticated.status()).toBe(200)
        await expect(page).toHaveURL(role === 'consumer' ? /#\/user\/tools$/ : /#\/business\/overview$/)
        if (role === 'consumer') {
          await navigate(page, '/user/plans')
          await expect(page.getByRole('region', { name: '当前授权摘要' })).toBeVisible()
          await expect(page.locator('.license-summary')).toContainText('5 台')
          evidence.screenshots.push(await capture(application, page, 'consumer-license'))
          await navigate(page, '/user/logs')
          await page.getByRole('tab', { name: '真实执行', exact: true }).click({ force: true })
          await expect(page.getByText('还没有真实执行记录', { exact: true })).toBeVisible()
          evidence.screenshots.push(await capture(application, page, 'consumer-records'))
        } else {
          await navigate(page, '/business/license')
          await expect(page.locator('.limits-grid')).toContainText('已授权')
          evidence.screenshots.push(await capture(application, page, 'business-license'))
          await navigate(page, '/business/records')
          await expect(page.getByText('还没有真实批次记录', { exact: true })).toBeVisible()
          evidence.screenshots.push(await capture(application, page, 'business-records'))
        }
      } else {
        await page.getByRole('link', { name: '管理员登录', exact: true }).click({ force: true })
        await expect(page).toHaveURL(/#\/admin\/login$/)
        await page.getByLabel('管理账号', { exact: true }).fill(credentials[role === 'admin' ? 'staff_username' : 'agent_a_username'])
        await page.getByLabel('管理员密码', { exact: true }).fill(credentials[role === 'admin' ? 'staff_password' : 'agent_a_password'])
        await page.getByRole('button', { name: '登录管理后台' }).click({ force: true })
        if (role === 'admin') {
          await expect(page).toHaveURL(/#\/admin\/dashboard$/)
          await expect(page.getByRole('region', { name: '待处理事项摘要' })).toBeVisible()
          await expect(page.getByRole('complementary', { name: '管理员导航' })).toBeVisible()
          evidence.screenshots.push(await capture(application, page, 'admin-dashboard'))
        } else {
          await expect(page).toHaveURL(/#\/agent\/overview$/)
          await expect(page.getByRole('navigation', { name: '代理导航' })).toBeVisible()
          await expect(page.locator('.metrics strong').first()).toHaveText('0')
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
      // Existing admin role has no customer announcement-feed permission. Keep this one
      // non-blocking response visible; every other HTTP failure still fails retirement QA.
      const isKnownAdminFeed = request => role === 'admin' && request.method === 'GET' && request.path === '/api/announcements/feed' && request.status === 403
      evidence.knownNonBlockingResponses = evidence.requests.filter(isKnownAdminFeed)
      expect(evidence.requests.filter(request => request.status >= 400 && !isKnownAdminFeed(request))).toEqual([])
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
