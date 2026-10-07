import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import type { UpdateSnapshot } from '../../src/shared/ipc/update-contract'

const packageVersion = (JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string }).version
const packageVersionParts = packageVersion.split('.').map(Number)
const previewVersion = `${packageVersionParts[0] || 1}.${packageVersionParts[1] || 0}.${(packageVersionParts[2] || 0) + 1}`
const outputRoot = join(process.cwd(), 'test-results', `visual-${packageVersion}`)
const contactSheetNames = [
  'contact-public.png',
  'contact-consumer.png',
  'contact-business.png',
  'contact-admin.png',
  'contact-windows.png',
] as const
const viewports = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
] as const

const batchTool = {
  id: 'tool_register',
  name: '自动广告脚本',
  description: '自动创建和管理广告活动',
  business_description: '批量演示广告创建与状态核验',
  supports_batch: true,
  supports_demo_batch: true,
  supports_live_batch: false,
  platform_key: 'amazon',
  availability: 'demo_only',
  demo_scenario_id: 'register-example',
  batch_input_schema: [{ key: 'account_label', label: '客户简称', type: 'text', required: true }],
}

const demoItemIds = Array.from({ length: 8 }, (_, index) => `visual-item-${index + 1}`)

const businessPlan = {
  id: 6,
  name: 'B端内部验证版',
  price: 0,
  duration_days: 30,
  status: 'active',
  features: '专业工作台、本地批量导入、多账号浏览器现场',
  product_type: 'business',
  entitlements: {
    batch_execution: true,
    multi_account_workspace: true,
    desktop_notification: true,
    max_batch_rows: 50,
    max_open_sessions: 6,
  },
}

const consumerPlan = {
  id: 1,
  name: '标准版',
  price: 299,
  duration_days: 30,
  status: 'active',
  features: '自动化工具',
  product_type: 'consumer',
  entitlements: {},
}

const businessUser = {
  role: 'user',
  product_type: 'business',
  business_workspace_enabled: true,
  plan_name: businessPlan.name,
  expires_at: '2026-08-16T00:00:00+08:00',
  seat_limit: 1,
  seat_used: 1,
  max_devices: 1,
  device_used: 1,
  entitlements: businessPlan.entitlements,
}

const consumerUser = {
  id: 1,
  user_id: 1,
  role: 'user',
  product_type: 'consumer',
  business_workspace_enabled: false,
  plan_name: consumerPlan.name,
  expires_at: '2026-08-16T00:00:00+08:00',
  seat_limit: 1,
  seat_used: 1,
  max_devices: 1,
  device_used: 1,
  entitlements: { desktop_notification: true },
}

interface ApiMockState {
  unmatchedRequests: string[]
}

const requiredPageScreenshotNames = [
  'public-user-login.png',
  'public-terms.png',
  'public-admin-login.png',
  'public-not-found.png',
  'admin-change-password.png',
  'consumer-tools.png',
  'consumer-logs.png',
  'consumer-plans.png',
  'consumer-devices.png',
  'consumer-ai-chat.png',
  'business-overview.png',
  'business-workspace.png',
  'business-records.png',
  'business-license.png',
  'admin-dashboard.png',
  'admin-authcodes.png',
  'admin-business-access.png',
  'admin-orders.png',
  'admin-profit.png',
  'admin-expenses.png',
  'admin-settings.png',
  'admin-users.png',
  'admin-feedback.png',
  'admin-knowledge.png',
  'admin-ai-chat.png',
  'admin-announcements.png',
  'admin-updates.png',
  'admin-freight-rates.png',
  'admin-staff-accounts.png',
] as const

const requiredStateScreenshotNames = [
  'consumer-tool-detail.png',
  'consumer-workspace-mock.png',
  'business-run-overview.png',
  'business-run-detail.png',
  'admin-expenses-drawer.png',
  'admin-expenses-renewals.png',
  'admin-updates-drawer.png',
] as const

function cleanCurrentVisualOutput(): void {
  for (const { width, height } of viewports) {
    rmSync(join(outputRoot, `${width}x${height}`), { recursive: true, force: true })
  }
  for (const name of contactSheetNames) rmSync(join(outputRoot, name), { force: true })
  mkdirSync(outputRoot, { recursive: true })
}

test.describe.configure({ mode: 'serial' })
test.beforeAll(cleanCurrentVisualOutput)

const adminUser = {
  role: 'super_admin',
  username: 'visual-owner',
  display_name: '视觉验收管理员',
  status: 'active',
  force_password_reset: false,
}

const consumerTool = {
  id: 'tool_register',
  name: '亚马逊账号自动处理',
  description: '选择业务后，系统会打开亚马逊页面并自动完成处理。',
  category: 'automation',
  release_status: 'available',
  target_url: 'https://sellercentral.amazon.com/',
  available_plans: [1],
  capability_tags: ['自动填报', '页面核验', '结果确认'],
  availability: 'demo_only',
  demo_scenario_id: 'register-example',
  supports_demo_single: true,
  supports_live_single: false,
  supports_batch: false,
}

const platforms = [
  { key: 'amazon', name: '亚马逊', short_name: '亚马逊', status: 'available', sort_order: 1 },
  { key: 'aliexpress', name: '速卖通', short_name: '速卖通', status: 'available', sort_order: 2 },
]

function response(data: unknown): string {
  return JSON.stringify({ success: true, data })
}

async function prepareRole(page: Page, role: 'consumer' | 'business' | 'admin', withUpdate = false): Promise<ApiMockState> {
  const user = role === 'admin' ? adminUser : role === 'business' ? businessUser : consumerUser
  const mockState: ApiMockState = { unmatchedRequests: [] }
  await page.addInitScript(({ currentRole, currentUser, updateEnabled, appVersion, nextVersion, itemIds }) => {
    const storedRole = currentRole === 'admin' ? 'super_admin' : 'user'
    sessionStorage.setItem('toolbox_auth', JSON.stringify({ token: 'visual-token', role: storedRole }))
    sessionStorage.setItem('toolbox_token', 'visual-token')
    sessionStorage.setItem('toolbox_role', storedRole)
    localStorage.setItem('toolbox_user', JSON.stringify(currentUser))
    localStorage.setItem('toolbox_device_id', 'visual-device')
    localStorage.setItem('toolbox_device_name', '视觉验收设备')

    if (updateEnabled) {
      const snapshot: UpdateSnapshot = {
        supported: true,
        status: 'available',
        currentVersion: appVersion,
        availableVersion: nextVersion,
        releaseNotes: ['增强精密执行工作台', '提升模拟平台与费率包稳定性'],
        downloadBytes: 52_428_800,
        canRestart: false,
      }
      window.electronAPI = {
        ...(window.electronAPI || {}),
        updates: {
          getState: async () => snapshot,
          check: async () => snapshot,
          startDownload: async () => ({ ...snapshot, status: 'downloading', percent: 38 }),
          cancelDownload: async () => ({ ...snapshot, status: 'cancelled' }),
          install: async () => snapshot,
          defer: async () => snapshot,
          onState: () => () => {},
        },
      }
    }

    if (currentRole === 'business') {
      const idleBatchSnapshot = {
        status: 'idle',
        recordKind: 'live' as const,
        counts: {},
        items: [],
      }
      const importPreview = {
        importId: 'visual-brand-import',
        fileName: '课赛通批量演示.xlsx',
        validCount: itemIds.length,
        errorCount: 0,
        errors: [],
        rows: itemIds.map((itemId, index) => ({ itemId, preview: { account_label: `演示账号 ${index + 1}` } })),
      }
      window.electronAPI = {
        ...(window.electronAPI || {}),
        runtime: { deviceId: 'visual-device' },
        demoActivity: { setActive: async () => {} },
        batch: {
          onEvent: () => () => {},
          getSnapshot: async () => idleBatchSnapshot,
          storeDemoImport: async () => importPreview,
          loadSampleImport: async () => importPreview,
          saveSampleTemplate: async () => null,
          remapImportItems: async () => importPreview,
          selectImportFile: async () => null,
          parseImportFile: async () => importPreview,
          exportImportErrors: async () => null,
          create: async () => ({
            batchId: 'visual-local-batch',
            serverBatchId: 'visual-demo-batch',
            status: 'running',
            recordKind: 'demo',
            counts: { total: itemIds.length },
            items: itemIds.map((itemId, index) => ({
              itemId,
              accountLabelMasked: `演***${index + 1}`,
              status: 'pending',
              browserReady: false,
            })),
          }),
          start: async () => ({ runId: 'visual-run' }),
          failItem: async () => idleBatchSnapshot,
          cancel: async () => ({ ...idleBatchSnapshot, status: 'cancelled' }),
          selectItem: async itemId => ({ itemId, snapshot: idleBatchSnapshot }),
          completeUserAction: async () => idleBatchSnapshot,
          restartItem: async () => idleBatchSnapshot,
          registerBrowser: async () => ({ id: 1, url: 'about:blank' }),
          unregisterBrowser: async () => ({ released: true }),
        },
      }
    }
  }, { currentRole: role, currentUser: user, updateEnabled: withUpdate, appVersion: packageVersion, nextVersion: previewVersion, itemIds: demoItemIds })

  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    const path = url.pathname
    let data: unknown

    const method = route.request().method()
    if ((path === '/api/health/live' || path === '/api/health/ready') && method === 'GET') {
      data = { status: 'ok', version: packageVersion }
    } else if (path === '/api/auth/me' && method === 'GET') data = user
    else if (path === '/api/business/bootstrap' && method === 'GET') data = { ...businessUser, tools: [batchTool] }
    else if (path === '/api/business/tools' && method === 'GET') data = [batchTool]
    else if (path === '/api/business/batches' && method === 'GET') data = []
    else if (path === '/api/plans/admin') data = [consumerPlan, businessPlan]
    else if (path === '/api/plans') data = [consumerPlan]
    else if (path === '/api/auth-codes') {
      data = [{
        id: 7,
        code: 'BUSI-****-7X9Q',
        plan_id: 6,
        plan_name: businessPlan.name,
        product_type: 'business',
        entitlements: businessPlan.entitlements,
        status: 'active',
        max_devices: 1,
        seat_limit: 1,
        seat_used: 0,
        device_used: 0,
        devices: [],
        expires_at: '2026-08-16T00:00:00+08:00',
        created_at: '2026-07-17T00:00:00+08:00',
      }]
    } else if (path === '/api/settings') {
      data = [{ key: 'business_workspace_enabled', value: 'true' }, { key: 'wechat_id', value: 'KST-Support' }]
    } else if (path === '/api/settings/public') {
      data = [{ key: 'wechat_id', value: 'KST-Support' }]
    } else if (path === '/api/tools/platforms' && method === 'GET') {
      data = platforms
    } else if (path === '/api/tools/categories' && method === 'GET') {
      data = []
    } else if (path === '/api/tools' && method === 'GET') {
      data = role === 'consumer' ? [consumerTool] : [batchTool]
    } else if (path === '/api/devices/my') {
      data = []
    } else if (path === '/api/ai-chat/session' && method === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ session_id: 'visual-session', status: 'active', welcome_message: '你好，我是课赛通工具助手。' }),
      })
      return
    } else if (path === '/api/ai-chat/history') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [], total: 0, page: 1, page_size: 20 }) })
      return
    } else if (path === '/api/ai-chat/admin/config') {
      data = { welcome_message: '你好，我是课赛通工具助手。', suggested_questions: '[]', transfer_keywords: '[]', max_unmatched: 2 }
    } else if (path === '/api/ai-chat/admin/sessions') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [], total: 0, page: 1, page_size: 20 }) })
      return
    } else if (path === '/api/ai-chat/admin/stats') {
      data = {}
    } else if (path === '/api/orders' || path === '/api/users' || path === '/api/feedback' || path === '/api/staff/accounts') {
      data = []
    } else if (path === '/api/profit/summary') {
      data = {}
    } else if (path === '/api/profit/policy') {
      data = { version: 1, ratios: { tech: 0.3, market: 0.25, product: 0.15, service: 0.15, coordination: 0.1, record: 0.05 } }
    } else if (path === '/api/expenses/summary') {
      data = { month: '2026-08', total: 1280, previous_total: 960, change_percent: 33.3, count: 5, upcoming_renewals: 2, overdue_renewals: 0, trend: [{ month: '2026-03', total: 720 }, { month: '2026-04', total: 860 }, { month: '2026-05', total: 780 }, { month: '2026-06', total: 1120 }, { month: '2026-07', total: 960 }, { month: '2026-08', total: 1280 }], categories: [{ category_id: 1, category_name: '工具会员', total: 780, percentage: 60.9 }, { category_id: 2, category_name: '服务器/云服务', total: 500, percentage: 39.1 }] }
    } else if (path === '/api/expenses/categories') {
      data = [{ id: 1, code: 'tool_membership', name: '工具会员', status: 'active', sort_order: 10, is_system: true }, { id: 2, code: 'cloud_service', name: '服务器/云服务', status: 'active', sort_order: 20, is_system: true }]
    } else if (path === '/api/expenses' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [], total: 0, page: 1, page_size: 20, total_pages: 0 }) })
      return
    } else if (path === '/api/expenses/renewals' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [], total: 0, page: 1, page_size: 20, total_pages: 0 }) })
      return
    } else if (path === '/api/knowledge') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [], total: 0, page: 1, page_size: 20 }) })
      return
    } else if (path === '/api/knowledge/categories') {
      data = []
    } else if (path === '/api/knowledge/stats') {
      data = {}
    } else if (path === '/api/updates/releases' && method === 'GET') {
      data = []
    } else if (path === '/api/demo/runs' && method === 'GET') {
      data = []
    } else if (path === '/api/demo/runs' && method === 'POST') {
      data = {
        id: 'visual-demo-run',
        tool_id: consumerTool.id,
        tool_name_snapshot: consumerTool.name,
        status: 'created',
        total_step_count: 6,
      }
    } else if (/^\/api\/demo\/runs\/[^/]+$/.test(path) && method === 'PATCH') {
      data = { id: path.split('/').at(-1), status: 'running' }
    } else if (/^\/api\/demo\/runs\/[^/]+\/(?:finish|cancel)$/.test(path) && method === 'POST') {
      data = { id: path.split('/').at(-2), status: path.endsWith('/finish') ? 'completed' : 'cancelled' }
    } else if (path === '/api/executions' && method === 'GET') {
      data = []
    } else if (path === '/api/demo/batches' && method === 'GET') {
      data = []
    } else if (path === '/api/demo/batches' && method === 'POST') {
      data = { id: 'visual-demo-batch', tool_id: batchTool.id, row_count: demoItemIds.length, status: 'created', items: demoItemIds.map(item_ref => ({ item_ref, status: 'queued', event_seq: 0 })) }
    } else if (/^\/api\/demo\/batches\/[^/]+$/.test(path) && method === 'PATCH') {
      data = { id: path.split('/').at(-1), status: 'running' }
    } else if (/^\/api\/demo\/batches\/[^/]+\/items\/[^/]+$/.test(path) && method === 'PUT') {
      data = { item_ref: path.split('/').at(-1), status: 'playing' }
    } else if (/^\/api\/demo\/batches\/[^/]+\/finish$/.test(path) && method === 'POST') {
      data = { id: path.split('/').at(-2), status: 'completed' }
    } else if (path === '/api/freight-rate-packs') {
      data = []
    } else if ((path === '/api/announcements' || path === '/api/announcements/active' || path === '/api/announcements/feed') && method === 'GET') {
      data = []
    } else if (path === '/api/admin/action-center') {
      data = {
        summary: {
          expiring_authorizations: 1,
          device_anomalies: 0,
          pending_tickets: 0,
          waiting_interventions: 0,
          stale_batches: 0,
        },
        expiring_authorizations: [],
        device_anomalies: [],
        pending_tickets: [],
        waiting_interventions: [],
        stale_batches: [],
      }
    } else {
      const requestLabel = `${method} ${path}${url.search}`
      mockState.unmatchedRequests.push(requestLabel)
      await route.fulfill({
        status: 501,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: `Unmocked API request: ${requestLabel}` }),
      })
      return
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: response(data) })
  })
  return mockState
}

function visualDirectory(width: number, height: number): string {
  const directory = join(outputRoot, `${width}x${height}`)
  mkdirSync(directory, { recursive: true })
  return directory
}

async function gotoHashRoute(page: Page, routePath: string): Promise<void> {
  const expectedHash = `#${routePath}`
  await page.goto(`/${expectedHash}`, { waitUntil: 'networkidle' })
  await expect.poll(() => new URL(page.url()).hash, { message: `Expected route ${expectedHash}` }).toBe(expectedHash)
}

async function assertCaptureReady(page: Page, routePath: string, mockState?: ApiMockState): Promise<void> {
  await expect.poll(() => new URL(page.url()).hash, { message: `Capture was redirected away from #${routePath}` }).toBe(`#${routePath}`)
  expect(mockState?.unmatchedRequests ?? [], 'All API requests used by a visual baseline must be explicitly mocked').toEqual([])
}

async function assertShellHeaderLayout(page: Page): Promise<void> {
  if (!await page.locator('.studio-header').count()) return
  const collisions = await page.locator('.studio-header').evaluate(header => {
    const box = (selector: string): DOMRect | null => {
      const element = header.querySelector(selector)
      if (!element || getComputedStyle(element).display === 'none') return null
      const rectangle = element.getBoundingClientRect()
      return rectangle.width && rectangle.height ? rectangle : null
    }
    const issues: string[] = []
    const leading = box('.header-leading')
    const tools = box('.header-tools')
    if (leading && tools && leading.right > tools.left + 1) issues.push('title overlaps header tools')
    const actions = box('.shell-page-actions')
    const platform = box('.platform-switcher')
    const trailing = box('.header-right')
    if (actions && platform && actions.right > platform.left + 1) issues.push('page actions overlap platform switcher')
    if (actions && trailing && actions.right > trailing.left + 1) issues.push('page actions overlap account controls')
    if (platform && trailing && platform.right > trailing.left + 1) issues.push('platform switcher overlaps account controls')
    if (actions) {
      for (const control of header.querySelectorAll('.shell-page-actions button, .shell-page-actions a')) {
        const rectangle = control.getBoundingClientRect()
        if (rectangle.width && (rectangle.left < actions.left - 1 || rectangle.right > actions.right + 1)) {
          issues.push('page action overflows its allocated width')
        }
      }
    }
    return issues
  })
  expect(collisions, 'Shell title, page actions and account controls must not overlap').toEqual([])
}

async function capture(page: Page, width: number, height: number, name: string, routePath: string, mockState?: ApiMockState): Promise<void> {
  await assertCaptureReady(page, routePath, mockState)
  await expect(page.locator('main').first()).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(250)
  await assertCaptureReady(page, routePath, mockState)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  // At the collapsed-sidebar breakpoint the header must recover the full
  // viewport width; merely having no document overflow misses a clipped title.
  if (width <= 1024 && await page.locator('.studio-header').count()) {
    const headerWidth = await page.locator('.studio-header').evaluate(element => element.getBoundingClientRect().width)
    expect(headerWidth).toBeGreaterThanOrEqual(width - 1)
  }
  const clippedShellPixels = await page.locator('.studio-header, main').evaluateAll(elements =>
    elements.reduce((maximum, element) => {
      if (getComputedStyle(element).display === 'none') return maximum
      return Math.max(maximum, element.getBoundingClientRect().right - window.innerWidth)
    }, 0),
  )
  expect(clippedShellPixels).toBeLessThanOrEqual(1)
  await assertShellHeaderLayout(page)

  const undersizedControls = await page.locator('button:visible, input:visible, [role="menuitem"]:visible').evaluateAll(elements =>
    elements.filter(element => Number.parseFloat(getComputedStyle(element).fontSize) < 14).length,
  )
  expect(undersizedControls).toBe(0)

  // Route focus remains part of the product's keyboard-accessibility behavior.
  // Remove it only from the static visual baseline so the contact sheet does
  // not record a browser-specific focus ring around the whole page.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())

  await page.screenshot({ path: join(visualDirectory(width, height), `${name}.png`), animations: 'disabled' })
}

async function captureStandalone(page: Page, width: number, height: number, name: string, selector: string, routePath: string): Promise<void> {
  await assertCaptureReady(page, routePath)
  await expect(page.locator(selector).first()).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(150)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  await page.screenshot({ path: join(visualDirectory(width, height), `${name}.png`), animations: 'disabled' })
}

function pngDataUrl(path: string): string {
  return `data:image/png;base64,${readFileSync(path).toString('base64')}`
}

async function buildContactSheet(page: Page, title: string, files: string[], outputName: string, iconMode = false): Promise<void> {
  expect(files.length, `${title} 联系表应至少包含一张验收图`).toBeGreaterThan(0)
  const cards = files.map(file => {
    const label = file.split(/[\\/]/).at(-1)?.replace(/\.png$/i, '') || file
    return `<figure><img src="${pngDataUrl(file)}" alt=""><figcaption>${label}</figcaption></figure>`
  }).join('')
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;padding:32px;background:#eef2f7;color:#101828;font-family:"Segoe UI","Microsoft YaHei",sans-serif}
    header{display:flex;align-items:end;justify-content:space-between;margin-bottom:22px}h1{margin:0;font-size:30px;letter-spacing:-.03em}p{margin:0;color:#667085;font-size:14px}
    main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}figure{margin:0;padding:10px;border:1px solid #d8dee9;border-radius:16px;background:#fff;box-shadow:0 10px 24px rgba(16,24,40,.07)}
    img{display:block;width:100%;aspect-ratio:16/10;object-fit:${iconMode ? 'contain' : 'cover'};object-position:top;padding:${iconMode ? '34px' : '0'};border:1px solid #eaecf0;border-radius:10px;background:${iconMode ? '#101828' : '#f8fafc'}}figcaption{padding:10px 3px 2px;font-size:13px;font-weight:700}
  </style></head><body><header><h1>${title}</h1><p>v${packageVersion} · 1440×900 主基线</p></header><main>${cards}</main></body></html>`)
  await page.screenshot({ path: join(outputRoot, outputName), fullPage: true, animations: 'disabled' })
}

for (const { width, height } of viewports) {
  test(`${packageVersion} ${width}x${height} KST brand visual capture`, async ({ browser }) => {
    test.setTimeout(width === 1440 ? 300_000 : 180_000)
    const captureAllRoutes = width === 1440

    const loginPage = await browser.newPage({ viewport: { width, height } })
    await gotoHashRoute(loginPage, '/user/login')
    await captureStandalone(loginPage, width, height, 'public-user-login', '.login-page', '/user/login')
    await loginPage.close()

    const publicPage = await browser.newPage({ viewport: { width, height } })
    await publicPage.route('**/api/settings/public**', route => route.fulfill({ status: 200, contentType: 'application/json', body: response([{ key: 'wechat_id', value: 'KST-Support' }]) }))
    if (captureAllRoutes) {
      await gotoHashRoute(publicPage, '/user/terms')
      await capture(publicPage, width, height, 'public-terms', '/user/terms')
    }
    await gotoHashRoute(publicPage, '/admin/login')
    await captureStandalone(publicPage, width, height, 'public-admin-login', '.login-container', '/admin/login')
    if (captureAllRoutes) {
      await gotoHashRoute(publicPage, '/missing-brand-route')
      await capture(publicPage, width, height, 'public-not-found', '/missing-brand-route')
    }
    await publicPage.close()

    const consumerPage = await browser.newPage({ viewport: { width, height } })
    const consumerMock = await prepareRole(consumerPage, 'consumer', true)
    const consumerRoutes = captureAllRoutes
      ? ['tools', 'logs', 'plans', 'devices', 'ai-chat'] as const
      : ['tools'] as const
    for (const route of consumerRoutes) {
      const routePath = `/user/${route}`
      await gotoHashRoute(consumerPage, routePath)
      await expect(consumerPage.getByTestId('user-layout')).toBeVisible()
      await capture(consumerPage, width, height, `consumer-${route}`, routePath, consumerMock)
      if (route === 'tools') {
        await consumerPage.getByTestId(`tool-card-${consumerTool.name}`).click()
        await expect(consumerPage.locator('.tool-detail-drawer')).toBeVisible()
        await capture(consumerPage, width, height, 'consumer-tool-detail', routePath, consumerMock)
        await consumerPage.locator('.drawer-primary').click()
        await expect(consumerPage.getByTestId('tool-workspace')).toBeVisible()
        await capture(consumerPage, width, height, 'consumer-workspace-mock', routePath, consumerMock)
        await consumerPage.getByRole('button', { name: '返回工具箱' }).click()
        await expect(consumerPage.getByText('退出交互演示？')).toBeVisible()
        await consumerPage.getByRole('button', { name: '退出演示', exact: true }).click()
        await expect(consumerPage.locator('.toolbox-page')).toBeVisible()
      }
    }
    await consumerPage.close()

    const businessPage = await browser.newPage({ viewport: { width, height } })
    const businessMock = await prepareRole(businessPage, 'business')
    const businessRoutes = captureAllRoutes
      ? ['overview', 'workspace', 'records', 'license'] as const
      : ['workspace'] as const
    for (const route of businessRoutes) {
      const routePath = `/business/${route}`
      await gotoHashRoute(businessPage, routePath)
      await expect(businessPage.locator('.business-layout')).toBeVisible()
      await capture(businessPage, width, height, `business-${route}`, routePath, businessMock)
    }
    await gotoHashRoute(businessPage, '/business/workspace')
    await businessPage.getByRole('button', { name: batchTool.name }).click()
    await businessPage.getByRole('button', { name: /一键载入演示数据/ }).click()
    await businessPage.getByRole('button', { name: '开始批量演示' }).click()
    const runConsole = businessPage.getByTestId('business-run-console')
    await expect(runConsole).toBeVisible()
    await expect(runConsole.locator('tbody tr')).toHaveCount(8)
    await capture(businessPage, width, height, 'business-run-overview', '/business/workspace', businessMock)
    await runConsole.locator('tbody tr').first().click()
    await expect(businessPage.getByRole('dialog', { name: '账号执行详情' })).toBeVisible()
    await capture(businessPage, width, height, 'business-run-detail', '/business/workspace', businessMock)
    await businessPage.keyboard.press('Escape')
    await expect(businessPage.locator('.detail-layer')).not.toHaveClass(/open/)
    await businessPage.close()

    const adminPage = await browser.newPage({ viewport: { width, height } })
    const adminMock = await prepareRole(adminPage, 'admin')
    const adminRoutes = captureAllRoutes
      ? ['dashboard', 'authcodes?product=business', 'business-access', 'orders', 'profit', 'expenses', 'settings', 'users', 'feedback', 'knowledge', 'ai-chat', 'announcements', 'updates', 'freight-rates', 'staff-accounts'] as const
      : ['dashboard', 'expenses'] as const
    for (const route of adminRoutes) {
      const routePath = `/admin/${route}`
      await gotoHashRoute(adminPage, routePath)
      await expect(adminPage.locator('.studio-admin-sidebar')).toBeVisible()
      await capture(adminPage, width, height, `admin-${route.split('?')[0]}`, routePath, adminMock)
      if (route === 'expenses') {
        await adminPage.getByRole('button', { name: '记一笔支出' }).click()
        await expect(adminPage.locator('.el-drawer')).toBeVisible()
        await capture(adminPage, width, height, 'admin-expenses-drawer', routePath, adminMock)
        await adminPage.keyboard.press('Escape')
        await expect(adminPage.locator('.el-drawer')).toBeHidden()
        await adminPage.getByRole('tab', { name: /续费项目/ }).click()
        await capture(adminPage, width, height, 'admin-expenses-renewals', routePath, adminMock)
      } else if (route === 'updates') {
        await adminPage.getByRole('button', { name: '暂存新版本' }).click()
        await expect(adminPage.locator('.el-drawer')).toBeVisible()
        await capture(adminPage, width, height, 'admin-updates-drawer', routePath, adminMock)
        await adminPage.keyboard.press('Escape')
      }
    }
    if (captureAllRoutes) {
      await gotoHashRoute(adminPage, '/admin/change-password')
      await capture(adminPage, width, height, 'admin-change-password', '/admin/change-password', adminMock)
    }
    await adminPage.close()
  })
}

test(`${packageVersion} KST grouped contact sheets`, async ({ page }) => {
  test.setTimeout(180_000)
  const baselineDirectory = visualDirectory(1440, 900)
  const screenshotNames = readdirSync(baselineDirectory).filter(file => file.endsWith('.png')).sort()
  expect(requiredPageScreenshotNames).toHaveLength(29)
  expect(
    screenshotNames,
    '1440×900 baseline must contain exactly the 29 route pages and 7 approved state captures; stale PNGs are forbidden',
  ).toEqual([...requiredPageScreenshotNames, ...requiredStateScreenshotNames].sort())
  const screenshots = screenshotNames.map(file => join(baselineDirectory, file))
  const byPrefix = (prefixes: string[]) => screenshots.filter(file => prefixes.some(prefix => file.split(/[\\/]/).at(-1)?.startsWith(prefix)))

  await buildContactSheet(page, '课赛通 KST · Public', byPrefix(['public-', 'admin-change-password']), 'contact-public.png')
  await buildContactSheet(page, '课赛通 KST · C 端', byPrefix(['consumer-']), 'contact-consumer.png')
  await buildContactSheet(page, '课赛通 KST · B 端', byPrefix(['business-']), 'contact-business.png')
  await buildContactSheet(page, '课赛通 KST · 运营后台', byPrefix(['admin-']).filter(file => !file.endsWith('admin-change-password.png')), 'contact-admin.png')

  const windowsAssets = [
    join(outputRoot, 'windows-electron-window.png'),
    join(outputRoot, 'windows-installer-welcome.png'),
    join(outputRoot, 'windows-local-sandbox.png'),
    ...[16, 20, 24, 32, 48, 64, 128, 256, 512].map(size => join(process.cwd(), 'public', 'icons', `kst-app-icon-${size}.png`)),
    join(process.cwd(), 'build', 'icon-512.png'),
  ].filter(existsSync)
  await buildContactSheet(page, '课赛通 KST · Windows 与多尺寸图标', windowsAssets, 'contact-windows.png', true)
})
