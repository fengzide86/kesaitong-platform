import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { components } from '../../src/shared/api/openapi.generated'

type Offer = components['schemas']['OfferResponse']

// Explicitly synthetic data, never a live customer account or service request.
const admin = { role: 'super_admin', username: 'ux-fixture', display_name: '验收样例管理员', status: 'active', force_password_reset: false }
const consumer = { role: 'user', id: 1, user_id: 1, product_type: 'consumer', plan_name: '验收样例套餐', plan_code: 'competition-full', platform_scope: ['amazon'], max_devices: 1, expires_at: '2027-01-01T00:00:00Z' }
const profile = {
  profile: { schemaVersion: 1, id: 'ux-example', revision: 1, name: '样例学校实训平台', providerId: 'bjysoft', productKey: 'amazon', edition: 'v2', entryUrl: 'https://school.example/entry', allowedRoutes: [{ origin: 'https://school.example', pathPrefix: '/', role: 'entry' }], reviewStatus: 'pending', capabilities: [], adapterVersion: null, evidence: { edition: 'v2', pageFingerprint: null, markers: [], source: 'client-observed' } },
  signature: null, signingKeyId: null,
}
const sampleUser = { id: 91, name: '验收样例 · 林同学', phone: '13800000000', customer_name: '样例学校跨境电商课程项目组', project_id: '2026秋季实训', plan_name: '实训完整工具包', auth_code_id: 12, device_name: '课堂电脑-01', device_id: 'ux-fixture-long-device-identifier', total_seats: 1, extra_devices: 0, status: 'active', expires_at: '2026-12-20T00:00:00Z', created_at: '2026-10-01T00:00:00Z' }
const sampleCode = { id: 12, code: 'UX-FIXTURE-ONLY-NOT-A-LICENSE', customer_name: '验收样例 · 林同学', user_name: '林同学', project_id: '2026秋季实训', order_no: 'UX-ORDER-012', responsible: '样例负责人', status: 'active', devices: [], platform_scope: ['amazon'], max_devices: 1, seat_limit: 1, seat_used: 1, product_type: 'consumer', plan_name: '实训完整工具包', expires_at: '2026-12-20T00:00:00Z' }
const balances = { due: '80.00', held: '20.00', paid: '30.00', unpaid: '50.00' }
const summaries = { totals: balances, members: [{ id: 1, name: '样例成员', active: true, ledger_version: 1, ...balances }] }
const sampleOrder = { id: 101, order_no: 'UX-ORDER-101', plan_id: 1, amount: 199, channel: '微信转账（样例）', responsible: '样例负责人', status: 'pending', refund_amount: 0, customer_name: '样例 · 林同学', agency_id: null as number | null, auth_code_id: null as number | null, plan_name_snapshot: '比赛完整包', created_at: '2026-10-16T08:00:00Z' }
const samplePlan = { id: 1, name: '比赛完整包（样例）', price: 199, duration_days: 30, status: 'active', product_type: 'consumer', entitlements: {} }
const sampleEntry = { id: 1, order_id: 101 as number | null, member_id: 1 as number | null, item_code: 'business_tools' as string | null, bucket: 'due', kind: 'settlement', amount: '80.00', note: '样例已确认分成' }
const sampleLedgerPolicy = { id: 1, name: '样例分配规则', product_skus: ['competition-full'], version: 1, status: 'active', items: [{ code: 'business_tools', label: '业务工具开发', group: '技术开发与维护', ratio: '0.12', method: 'fixed' }] }
const sampleCommercialOrder = { id: 101, order_no: 'UX-ORDER-101', amount: '199.00', status: 'paid', refund_amount: '0.00', commercial: { sku: 'competition-full', definition: { name: '比赛完整包', price: '199.00', business_line: 'competition', term_type: 'project_end', description: '仅用于页面验收', allowed_capabilities: [], services: [], availability: 'consult' }, ends_at: '2026-12-20T00:00:00Z', project_id: '样例项目', site_origin: 'https://school.example' } }
const sampleAnnouncement = { id: 1, title: '样例 · 物流模板使用提醒', content: '先确认配送地区，再设置物流费用。', audience: 'consumer', category: 'system', severity: 'info', presentation: 'banner', status: 'published', revision: 2, priority: 0, created_at: '2026-10-16T08:00:00Z' }
const sampleTicket = { id: 81, user_id: 91, title: '样例 · 物流模板如何设置', content: '配送地区的运费需要怎么填写？', status: 'pending', created_at: '2026-10-16T08:00:00Z' }
const sampleOffer: Offer = { id: 1, sku: 'competition-full', version: 2, revision: 2, status: 'active', activated_at: '2026-10-16T08:00:00Z', definition: { name: '比赛完整包（样例）', price: '199.00', business_line: 'competition', term_type: 'project_end', description: '工具使用范围以审核结果为准', allowed_capabilities: ['template.create', 'ship_script'], services: [], availability: 'limited' } }
const commissionEntries = [
  { id: 1, agency_id: 1, order_id: 101, order_no: 'UX-AGENCY-101', kind: 'accrual', amount: 19.9, rate_snapshot: 0.1, order_amount_snapshot: 199, occurred_at: '2026-10-16T08:00:00Z', settlement_id: null },
  { id: 2, agency_id: 1, order_id: 102, order_no: 'UX-AGENCY-LONG-ORDER-102', kind: 'refund', amount: -6.9, rate_snapshot: 0.1, order_amount_snapshot: 69, occurred_at: '2026-10-16T08:00:00Z', settlement_id: null },
]
const output = join(process.cwd(), 'test-results', 'ux-preview-20261016')
mkdirSync(output, { recursive: true })

for (const width of [1440, 1024]) {
  for (const motion of ['no-preference', 'reduce'] as const) {
    test.describe(`${width} workflow motion ${motion}`, () => {
      test('locates tasks and opens immediately usable forms', async ({ browser, baseURL }) => {
        const context = await browser.newContext({
          baseURL,
          viewport: { width, height: 900 },
          reducedMotion: motion,
          ...(motion === 'no-preference' ? { recordVideo: { dir: join(output, 'motion-recordings'), size: { width, height: 900 } } } : {}),
        })
        const page = await context.newPage()
        try {
        const unknown = await fixture(page, 'admin', { plans: [samplePlan], orders: [sampleOrder] })
        const errors: string[] = []
        page.on('pageerror', error => errors.push(error.message))
        await page.goto('/#/admin/dashboard', { waitUntil: 'networkidle' })
        const target = page.locator('#expiring_authorizations')
        await page.locator('.summary-card').filter({ hasText: '即将到期授权' }).click()
        const targetAnimations = await target.evaluate(element => element.getAnimations().map(animation => ({
          state: animation.playState,
          duration: animation.effect?.getTiming().duration,
        })))
        if (motion === 'reduce') expect(targetAnimations).toEqual([])
        else expect(targetAnimations).toContainEqual({ state: 'running', duration: 600 })
        await expect(target).toContainText('样例授权')
        // Keep normal motion running in the recording; no screenshot animation suppression.
        await page.waitForTimeout(800)
        await page.screenshot({ path: join(output, `${width}-workflow-locate-${motion}.png`), animations: 'allow' })
        await page.goto('/#/admin/orders', { waitUntil: 'networkidle' })
        await page.getByRole('button', { name: '登记新订单', exact: true }).click()
        const form = page.locator('#order-create')
        const state = await form.evaluate(element => ({
          focused: element.contains(document.activeElement) && document.activeElement?.tagName === 'INPUT',
          animation: getComputedStyle(element).animationName,
          duration: getComputedStyle(element).animationDuration,
        }))
        expect(state.focused).toBe(true)
        expect(state.animation).toBe(motion === 'reduce' ? 'none' : 'kst-workflow-reveal')
        if (motion === 'no-preference') expect(state.duration).toBe('0.23s')
        await form.getByPlaceholder('负责人', { exact: true }).fill('验收样例负责人')
        await expect(form.getByRole('button', { name: '创建订单', exact: true })).toBeEnabled()
        await expect(form.getByPlaceholder('负责人', { exact: true })).toHaveValue('验收样例负责人')
        await page.waitForTimeout(750)
        await page.screenshot({ path: join(output, `${width}-workflow-form-${motion}.png`), animations: 'allow' })
        await form.getByRole('button', { name: '收起', exact: true }).click()
        await expect(form).toHaveCount(0)
        await page.waitForTimeout(400)
        await page.getByRole('button', { name: '登记新订单', exact: true }).click()
        await expect(form).toBeVisible()
        if (motion === 'reduce') expect(await form.evaluate(element => element.getAnimations().length)).toBe(0)
        await page.waitForTimeout(800)
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
        expect(errors).toEqual([])
        expect(unknown).toEqual([])
        } finally {
          const video = page.video()
          await context.close()
          if (video) await video.saveAs(join(output, `${width}-workflow-motion.webm`))
        }
      })
    })
  }
}

// Deliberately fictional proportions: private business configuration never
// enters source control or the renderer acceptance fixtures.
const privatePolicyTemplate = {
  name: '页面验收用虚构分配方案', product_skus: ['synthetic-tool'],
  items: Array.from({ length: 19 }, (_, index) => ({
    code: `fixture.item-${index + 1}`, label: `样例分配子项 ${index + 1}`,
    group: index < 10 ? '样例工作组甲' : '样例工作组乙',
    ratio: index === 18 ? '0.82' : '0.01', method: 'fixed',
    service_code: index === 18 ? 'fixture-service' : null,
    purchased_service_codes: index === 18 ? ['appointment'] : [],
  })),
}
test('order create shortcut does not steal focus again during search', async ({ page }) => {
  const unknown = await fixture(page, 'admin', { plans: [samplePlan], orders: [sampleOrder] })
  await page.goto('/#/admin/orders?action=create', { waitUntil: 'networkidle' })
  const form = page.locator('#order-create')
  await expect(form).toBeVisible()
  expect(await form.evaluate(element => element.contains(document.activeElement))).toBe(true)
  const search = page.getByRole('textbox', { name: '搜索订单', exact: true })
  await search.fill('不存在的样例客户')
  await expect(page.getByText('没有找到匹配的订单', { exact: true })).toBeVisible()
  await expect(search).toBeFocused()
  await search.fill('林同学')
  await expect(page.locator('.orders-list-card')).toContainText('UX-ORDER-101')
  await expect(search).toBeFocused()
  await form.getByRole('button', { name: '收起', exact: true }).click()
  await expect(form).toHaveCount(0)
  await page.getByRole('button', { name: '登记新订单', exact: true }).click()
  await expect(form).toBeVisible()
  expect(await form.evaluate(element => element.contains(document.activeElement))).toBe(true)
  expect(unknown).toEqual([])
})

function loadPrivatePolicyTemplate() {
  return privatePolicyTemplate
}

async function fixture(page: Page, role: 'admin' | 'consumer', options: { reviews?: typeof profile[]; users?: typeof sampleUser[]; codes?: typeof sampleCode[]; orders?: typeof sampleOrder[]; plans?: typeof samplePlan[]; ledgerSummary?: typeof summaries; ledgerEntries?: typeof sampleEntry[]; ledgerPolicies?: typeof sampleLedgerPolicy[]; commercialOrders?: typeof sampleCommercialOrder[]; announcements?: typeof sampleAnnouncement[]; offers?: Offer[]; agency?: boolean; tickets?: typeof sampleTicket[]; scenarios?: boolean } = {}) {
  const unknown: string[] = []
  const user = role === 'admin' ? admin : consumer
  await page.addInitScript(({ user }) => {
    sessionStorage.setItem('toolbox_auth', JSON.stringify({ token: 'fixture-token', role: user.role }))
    sessionStorage.setItem('toolbox_token', 'fixture-token')
    sessionStorage.setItem('toolbox_role', user.role)
    localStorage.setItem('toolbox_user', JSON.stringify(user))
    localStorage.setItem('toolbox_device_id', 'ux-fixture-device')
    if (user.role === 'user') {
      Object.assign(window, { electronAPI: {
        runtime: { deviceId: 'ux-fixture-device' },
        targets: { listReceipts: async () => [], open: async () => { throw new Error('Visual fixture: real platform opening is disabled') } },
      } })
    }
  }, { user })
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort()
    if (!url.pathname.startsWith('/api/')) return route.continue()
    let data: unknown
    const path = url.pathname
    if (path === '/api/auth/me') data = user
    else if (path.startsWith('/api/health/')) data = { status: 'ok' }
    else if (path === '/api/tools/platforms') data = [{ key: 'amazon', name: '亚马逊实训', status: 'available' }]
    else if (path === '/api/tools') data = [{ id: 'ux-freight', name: '物流模板（样例）', description: '检查配送范围与物流费用', capability_key: 'template.create', platform_key: 'amazon', availability: 'live', status: 'active', release_status: 'available', requires_target_profile: true, target_capability: 'template.create.v1', runner_api_version: 2, supports_live_single: true }]
    else if (path === '/api/tools/categories') data = []
    else if (path === '/api/settings/public') data = []
    else if (path === '/api/announcements/feed') data = []
    else if (path === '/api/announcements') data = options.announcements ?? []
    else if (path === '/api/tool-releases/target-profiles') data = options.reviews ?? [profile]
    else if (path === '/api/tools/target-profiles') data = []
    else if (path === '/api/scenarios/me') data = { schemaVersion: 1, principal: { kind: 'customer', id: 'ux-fixture' }, revision: 'ux', status: 'unassigned', mode: 'training', entryUrl: null, allowedOrigins: [], maxScenes: 1, checkedAt: '2026-10-16T00:00:00Z', expiresAt: null, refreshAfterSeconds: 30 }
    else if (path === '/api/users') {
      const keyword = url.searchParams.get('keyword') || ''
      data = (options.users ?? []).filter(item => [item.name, item.phone, item.device_name].some(text => text.includes(keyword)))
    }
    else if (path === `/api/users/${sampleUser.id}`) {
      const selected = options.users?.find(item => item.id === sampleUser.id)
      if (route.request().method() === 'PUT' && selected) Object.assign(selected, route.request().postDataJSON())
      data = selected ?? sampleUser
    }
    else if (path === '/api/auth-codes') data = options.codes ?? []
    else if (path === `/api/auth-codes/${sampleCode.id}`) data = sampleCode
    else if (path === '/api/feedback') {
      const keyword = url.searchParams.get('keyword') || ''
      const status = url.searchParams.get('status') || ''
      data = (options.tickets ?? []).filter(ticket => (!status || ticket.status === status) && (!keyword || String(ticket.id) === keyword || `${ticket.title} ${ticket.content}`.includes(keyword)))
    }
    else if (path === '/api/admin/action-center') data = {
      summary: { expiring_authorizations: 1, device_anomalies: 0, pending_tickets: 1, waiting_interventions: 0, stale_batches: 0, expense_renewals_due: 0 },
      expiring_authorizations: [{ id: 1, code_masked: '样例授权 ****', expires_at: '2026-10-20' }],
      pending_tickets: [{ id: 1, title: '样例客户：物流模板如何使用？', priority: 'normal', created_at: '2026-10-16T00:00:00Z' }],
      agency_delivery_tasks: [], device_anomalies: [], waiting_interventions: [], stale_batches: [], expense_renewals: [],
    }
    else if (path === '/api/orders') {
      const keyword = (url.searchParams.get('keyword') || '').toLowerCase()
      const status = url.searchParams.get('status')
      data = (options.orders ?? []).filter(item => (!status || item.status === status) && [item.order_no, item.customer_name, item.responsible].some(text => text.toLowerCase().includes(keyword)))
    }
    else if (/^\/api\/orders\/\d+$/.test(path)) data = options.orders?.find(item => path.endsWith(`/${item.id}`))
    else if (path === '/api/plans/admin') data = options.plans ?? []
    else if (path === '/api/team-ledger/summary') data = options.ledgerSummary ?? summaries
    else if (path === '/api/team-ledger/members') data = (options.ledgerSummary ?? summaries).members
    else if (path === '/api/team-ledger/entries') data = options.ledgerEntries ?? []
    else if (path === '/api/team-ledger/policies') data = options.ledgerPolicies ?? []
    else if (path === '/api/team-ledger/policy-template') data = loadPrivatePolicyTemplate()
    else if (path.startsWith('/api/team-ledger/')) data = []
    else if (path === '/api/profit/summary') data = {}
    else if (path === '/api/profit/policy') data = { version: 1, ratios: { tech: 0, market: 0, product: 0, service: 0, coordination: 0, record: 1 } }
    else if (path === '/api/profit' || path === '/api/profit/page') data = []
    else if (path === '/api/commercial/orders') data = options.commercialOrders ?? []
    else if (path === '/api/commercial/offers') data = options.offers ?? []
    else if (path === '/api/commercial/tool-options') data = [{ capability: 'template.create', name: '物流模板', selectable: true }]
    else if (options.agency && path === '/api/agency/agencies') data = [{ id: 1, name: '样例代理 · 星海学校团队', status: 'active', created_at: '2026-10-01T00:00:00Z' }]
    else if (options.agency && path.endsWith('/commission-policy')) data = { agency_id: 1, rate: 0.1 }
    else if (options.agency && path.endsWith('/commission-summary')) data = { pending_amount: 13, settled_amount: 0, accrued_amount: 19.9, refunded_amount: -6.9 }
    else if (options.agency && path.endsWith('/commissions')) data = url.searchParams.get('settled') === 'true' ? [] : commissionEntries
    else if (options.agency && path.endsWith('/commission-settlements')) data = [{ id: 1, agency_id: 1, month: '2026-09', amount: 32, count: 2, confirmed_at: '2026-10-01T00:00:00Z', note: '样例线下结算已核对' }]
    else if (options.agency && path.endsWith('/commission-settlement-preview')) data = { agency_id: 1, month: url.searchParams.get('month'), amount: 13, count: 2, revision: 'a'.repeat(64), existing_settlement: null }
    else if (path.startsWith('/api/commercial/')) data = path === '/api/commercial/catalog' ? { schema_version: 1, catalog_version: 'ux-empty-fixture', items: [] } : []
    else if (options.scenarios && path === '/api/scenarios/assignments') data = [{ subject_type: 'user', subject_id: sampleUser.id, revision: 2, mode: 'competition', entry_url: 'https://www.idtrade.cn/User/Contest', allowed_origins: ['https://www.idtrade.cn'], status: 'active', expires_at: '2026-12-20T00:00:00Z' }]
    else if (options.scenarios && path === '/api/scenarios/staff/permissions') data = [{ staff_id: 7, revision: 1, enabled: true, max_scenes: 6, allowed_origins: ['https://www.idtrade.cn'], allowed_capabilities: [], expires_at: '2026-12-20T00:00:00Z' }]
    else if (options.scenarios && path === '/api/staff/accounts') data = [{ id: 7, username: 'fixture-operator', display_name: '样例 · 运营同事', role: 'operator', status: 'active' }, { id: 8, username: 'fixture-agent', display_name: '样例 · 代理', role: 'agent', status: 'active' }]
    else if (['/api/scenarios/assignments', '/api/scenarios/staff/permissions', '/api/scenarios/projects'].includes(path)) data = []
    else if (['/api/users', '/api/auth-codes', '/api/feedback', '/api/orders', '/api/plans/admin', '/api/plans', '/api/announcements', '/api/settings', '/api/staff/accounts'].includes(path)) data = []
    else {
      unknown.push(`${route.request().method()} ${path}`)
      return route.fulfill({ status: 501, json: { success: false, message: `Fixture missing: ${path}` } })
    }
    return route.fulfill({ status: 200, json: { success: true, data, total: Array.isArray(data) ? data.length : 0, page: 1, page_size: 20, total_pages: 1 } })
  })
  return unknown
}

for (const width of [1440, 1024]) {
  for (const role of ['admin', 'consumer'] as const) {
    test(`${width} ${role} original horizontal brand remains enlarged and aligned`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      const unknown = await fixture(page, role)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto(role === 'admin' ? '/#/admin/dashboard' : '/#/user/tools', { waitUntil: 'networkidle' })
      if (width === 1024) await page.getByRole('button', { name: '打开导航菜单', exact: true }).click()
      const zone = page.locator(`.studio-${role === 'admin' ? 'admin' : 'user'}-sidebar .sidebar-brand-zone`)
      const logo = zone.locator('.kst-lockup-logo')
      const subtitle = zone.locator('.kst-lockup-subtitle')
      await expect(logo).toBeVisible()
      await expect(logo).toHaveAttribute('src', /kst-logo-horizontal/)
      const [zoneBox, logoBox, subtitleBox] = await Promise.all([zone.boundingBox(), logo.boundingBox(), subtitle.boundingBox()])
      expect(logoBox!.width).toBeGreaterThan(90)
      expect(await subtitle.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThan(10)
      expect(Math.abs(logoBox!.y + logoBox!.height / 2 - subtitleBox!.y - subtitleBox!.height / 2)).toBeLessThanOrEqual(1)
      expect(subtitleBox!.x).toBeGreaterThanOrEqual(logoBox!.x + logoBox!.width)
      expect(subtitleBox!.x + subtitleBox!.width).toBeLessThanOrEqual(zoneBox!.x + zoneBox!.width)
      await zone.screenshot({ path: join(output, `${width}-${role}-original-brand.png`) })
      expect(unknown).toEqual([])
    })
  }

  test(`${width} feedback search is explicit and distinguishes no matches`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const unknown = await fixture(page, 'admin', { tickets: [sampleTicket, { ...sampleTicket, id: 82, title: '样例 · 账号登录问题', content: '忘记平台的登录地址', status: 'resolved' }] })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/#/admin/feedback', { waitUntil: 'networkidle' })
    await expect(page.locator('.table-card .el-table__body tbody tr')).toHaveCount(2)
    await page.getByPlaceholder('搜索标题、内容或工单号', { exact: true }).fill('配送地区')
    await page.getByRole('button', { name: '查询', exact: true }).click()
    await expect(page.locator('.table-card .el-table__body tbody tr')).toHaveCount(1)
    await expect(page.locator('.table-card')).toContainText('物流模板如何设置')
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: join(output, `${width}-feedback-search.png`), fullPage: true })
    await page.getByPlaceholder('搜索标题、内容或工单号', { exact: true }).fill('不存在的工单')
    await page.getByRole('button', { name: '查询', exact: true }).click()
    await expect(page.locator('.table-card')).toContainText('没有找到符合当前条件的工单')
    await page.getByRole('button', { name: '清除搜索', exact: true }).click()
    await expect(page.locator('.table-card .el-table__body tbody tr')).toHaveCount(2)
    expect(unknown).toEqual([])
  })

  test(`${width} scenarios require identified users and staff before saving`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const unknown = await fixture(page, 'admin', { scenarios: true, users: [sampleUser], codes: [sampleCode] })
    const writes: string[] = []
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET') writes.push(request.url()) })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/#/admin/scenarios', { waitUntil: 'networkidle' })
    await expect(page.locator('.scenarios-page')).toContainText('样例 · 运营同事')
    await expect(page.getByRole('form', { name: '使用范围编辑' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '不适用', exact: true })).toBeDisabled()
    await page.screenshot({ path: join(output, `${width}-scenarios-overview.png`), fullPage: true })
    await page.getByRole('button', { name: '新增使用范围', exact: true }).click()
    await expect(page.getByRole('button', { name: '确认并保存范围', exact: true })).toBeDisabled()
    await page.getByRole('list', { name: '可选择的使用对象' }).getByRole('button', { name: '选择', exact: true }).click()
    await expect(page.locator('.identity-confirmed').first()).toContainText(sampleUser.name)
    await expect(page.locator('.identity-confirmed').first()).toContainText('影响这位用户的全部设备')
    // Selecting an already assigned user must preserve the actual policy,
    // rather than silently replacing it with a new training assignment.
    await expect(page.getByRole('combobox', { name: /^使用方式/ })).toHaveValue('competition')
    await expect(page.getByLabel('平台入口', { exact: true })).toHaveValue('https://www.idtrade.cn/User/Contest')
    await page.getByRole('form', { name: '使用范围编辑' }).screenshot({ path: join(output, `${width}-scenarios-user-form.png`) })
    await page.locator('.editor-section').first().screenshot({ path: join(output, `${width}-scenarios-user-identity.png`) })
    await page.getByRole('button', { name: '设置权限', exact: true }).click()
    const staffEditor = page.locator('.editor-section').last()
    await expect(staffEditor).toContainText('样例 · 运营同事')
    await expect(staffEditor.getByRole('spinbutton', { name: '最多同时打开账号' })).toHaveValue('6')
    await staffEditor.screenshot({ path: join(output, `${width}-scenarios-staff-identity.png`) })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    expect(writes).toEqual([])
    expect(unknown).toEqual([])
  })

  test(`${width} system settings distinguishes legacy configuration`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const unknown = await fixture(page, 'admin', { plans: [samplePlan] })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/#/admin/settings', { waitUntil: 'networkidle' })
    await expect(page.getByRole('navigation', { name: '当前业务入口' })).toBeVisible()
    await expect(page.getByText('旧版套餐（兼容）', { exact: true })).toBeVisible()
    await expect(page.getByText('旧版分润规则', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '管理新套餐与服务 →', exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: join(output, `${width}-settings-legacy-boundaries.png`), fullPage: true })
    expect(unknown).toEqual([])
  })

  test(`${width} private policy template remains a preview before import`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const unknown = await fixture(page, 'admin')
    const writes: string[] = []
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET') writes.push(request.url()) })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/#/admin/team-ledger', { waitUntil: 'networkidle' })
    const rules = page.getByTestId('ledger-rule-settings')
    await expect(rules).not.toHaveAttribute('open')
    await rules.locator(':scope > summary').click()
    await rules.getByRole('button', { name: '载入新版分成方案', exact: true }).click()
    await expect(rules).toContainText('样例分配子项 1')
    await expect(rules).toContainText('对应已购服务次数')
    await expect(rules.locator('.table-wrap').first().locator('tbody tr')).toHaveCount(19)
    await expect(rules.getByRole('button', { name: '导入为草稿', exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    await rules.screenshot({ path: join(output, `${width}-private-policy-preview.png`) })
    await rules.locator('.table-wrap').first().evaluate(element => { element.scrollTop = element.scrollHeight })
    await rules.locator('.table-wrap').first().screenshot({ path: join(output, `${width}-private-policy-delivery.png`) })
    expect(writes).toEqual([])
    expect(unknown).toEqual([])
  })

  test(`${width} catalog management separates active drafts and historical offers`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const unknown = await fixture(page, 'admin', { offers: [sampleOffer,
      { ...sampleOffer, id: 2, sku: 'competition-guided', status: 'draft', definition: { ...sampleOffer.definition, name: '比赛工具与指导包（样例）', price: '599.00', services: [{ code: 'appointment', count: 3, minutes_per_unit: 30 }] } },
      { ...sampleOffer, id: 3, version: 1, status: 'retired' },
    ] })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/#/admin/commercial', { waitUntil: 'networkidle' })
    const catalog = page.locator('#commercial-catalog')
    await expect(catalog.locator('.catalog-table tbody tr')).toHaveCount(1)
    await expect(catalog).toContainText('¥199.00')
    await expect(page.locator('.single-tool-panel')).not.toHaveAttribute('open')
    await page.screenshot({ path: join(output, `${width}-commercial-active.png`), fullPage: true })
    await catalog.getByRole('button', { name: '待核对草稿', exact: false }).click()
    await expect(catalog).toContainText('¥599.00')
    await catalog.getByText('查看包含内容', { exact: true }).click()
    await expect(catalog).toContainText('预约答疑 3 次，每次 30 分钟')
    await expect(catalog.getByRole('button', { name: '确认启用', exact: true })).toBeEnabled()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: join(output, `${width}-commercial-draft.png`), fullPage: true })
    expect(unknown).toEqual([])
  })

  test(`${width} agency commission shows auditable records before settings`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const unknown = await fixture(page, 'admin', { agency: true })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/#/admin/agency?section=commission', { waitUntil: 'networkidle' })
    const panel = page.locator('.commission-panel')
    await expect(panel.locator('.ledger-card .el-table__body tbody tr')).toHaveCount(2)
    await expect(panel).toContainText('UX-AGENCY-101')
    await expect(panel.getByTestId('commission-history')).not.toHaveAttribute('open')
    await expect(panel.getByTestId('commission-rate-settings')).not.toHaveAttribute('open')
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: join(output, `${width}-agency-commission-records.png`), fullPage: true })
    await panel.getByTestId('commission-history').locator('summary').click()
    await expect(panel.getByTestId('commission-history')).toContainText('2026-09')
    await panel.getByRole('button', { name: '预览结算', exact: true }).click()
    await expect(panel).toContainText('2 条待结算记录')
    await page.screenshot({ path: join(output, `${width}-agency-commission-preview.png`), fullPage: true })
    expect(unknown).toEqual([])
  })

  test(`${width} announcement management search and spacing`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const unknown = await fixture(page, 'admin', { announcements: [sampleAnnouncement, { ...sampleAnnouncement, id: 2, title: '样例 · 关于周六平台维护的安排与使用说明'.repeat(3), content: '维护期间请先保存任务。', audience: 'business', status: 'draft' }] })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/#/admin/announcements', { waitUntil: 'networkidle' })
    const surface = page.locator('.announcement-table')
    await expect(surface.locator('.data-toolbar-v6__summary')).toHaveText('共 2 条公告')
    await expect(surface.locator('.el-table__body tbody tr')).toHaveCount(2)
    const box = (await surface.boundingBox())!
    const input = (await page.getByRole('textbox', { name: '搜索公告' }).boundingBox())!
    expect(input.x - box.x).toBeGreaterThanOrEqual(19)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: join(output, `${width}-announcements-search.png`), fullPage: true })
    await page.getByRole('textbox', { name: '搜索公告' }).fill('不存在的公告')
    await expect(surface).toContainText('没有匹配的公告')
    await expect(surface).not.toContainText('还没有公告')
    await surface.getByRole('button', { name: '清除筛选', exact: true }).click()
    await expect(surface.locator('.el-table__body tbody tr')).toHaveCount(2)
    expect(unknown).toEqual([])
  })

  test(`${width} orders daily flow prioritizes search and payment visibility`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const records = [
      { ...sampleOrder },
      { ...sampleOrder, id: 102, order_no: 'UX-ORDER-102', customer_name: '样例 · 周同学', status: 'paid', amount: 69, plan_name_snapshot: '实训完整工具包' },
      { ...sampleOrder, id: 103, order_no: 'UX-ORDER-103', customer_name: '很长的样例客户名称'.repeat(8), status: 'refunded' },
    ]
    const unknown = await fixture(page, 'admin', { orders: records, plans: [samplePlan] })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/#/admin/orders', { waitUntil: 'networkidle' })
    const list = page.locator('.orders-list-card')
    await expect(list.locator('.el-table__body tbody tr')).toHaveCount(3)
    await expect(page.locator('#order-create')).toHaveCount(0)
    await expect(page.locator('.plan-overview-card')).not.toHaveAttribute('open')
    expect((await list.boundingBox())!.y).toBeLessThan(550)
    expect((await page.locator('.plan-overview-card').boundingBox())!.y).toBeGreaterThan((await list.boundingBox())!.y)
    await expect(list.locator('.order-amount').first()).toBeVisible()
    await expect(list.getByRole('button', { name: '标记已收款', exact: true })).toBeVisible()
    await expect.poll(() => list.locator('.el-table__body-wrapper .el-scrollbar__wrap').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: join(output, `${width}-orders-daily-flow.png`), fullPage: true })
    const search = page.getByRole('textbox', { name: '搜索订单', exact: true })
    await search.fill('周同学')
    await expect(list.locator('.el-table__body tbody tr')).toHaveCount(1)
    await expect(list.locator('.order-amount')).toHaveText('¥69')
    await search.fill('')
    await expect(list.locator('.el-table__body tbody tr')).toHaveCount(3)
    await list.getByRole('button', { name: '详情', exact: true }).first().click()
    const drawer = page.locator('.admin-detail-drawer')
    await expect(drawer).toContainText('UX-ORDER-101')
    await expect(drawer).toContainText('199')
    await drawer.getByRole('button', { name: '关闭', exact: true }).click()
    await page.getByRole('button', { name: '登记新订单', exact: true }).click()
    await expect(page.locator('#order-create')).toBeVisible()
    await page.screenshot({ path: join(output, `${width}-orders-create-expanded.png`), fullPage: true })
    await page.locator('#order-create').getByRole('button', { name: '收起', exact: true }).click()
    await expect(page.locator('#order-create')).toHaveCount(0)
    expect(unknown).toEqual([])
  })

  test(`${width} member ledger daily flow keeps totals independent from filters`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const ledgerSummary = { totals: { due: '120.00', held: '20.00', paid: '70.00', unpaid: '50.00' }, members: [
      { ...summaries.members[0]!, name: '样例成员 · 林同学' },
      { ...summaries.members[0]!, id: 2, name: '样例成员 · 周同学', due: '40.00', held: '0.00', paid: '40.00', unpaid: '0.00' },
    ] }
    const ledgerEntries = [
      { ...sampleEntry },
      { ...sampleEntry, id: 2, bucket: 'held', amount: '20.00', note: '样例服务尚待履行，暂留' },
      { ...sampleEntry, id: 3, bucket: 'paid', kind: 'payment', item_code: null, order_id: null, amount: '30.00', note: '样例线下付款凭据已登记' },
      { ...sampleEntry, id: 4, order_id: 102, member_id: 2, amount: '40.00' },
      { ...sampleEntry, id: 5, order_id: null, member_id: 2, bucket: 'paid', kind: 'payment', item_code: null, amount: '40.00', note: '样例线下付款凭据已登记' },
    ]
    const unknown = await fixture(page, 'admin', { ledgerSummary, ledgerEntries, ledgerPolicies: [sampleLedgerPolicy], commercialOrders: [sampleCommercialOrder, { ...sampleCommercialOrder, id: 102, order_no: 'UX-ORDER-102' }] })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/#/admin/team-ledger', { waitUntil: 'networkidle' })
    const overview = page.getByTestId('ledger-overview')
    await expect(overview).toContainText('¥120.00')
    await expect(page.getByTestId('member-balance-row')).toHaveCount(2)
    await expect(page.getByTestId('ledger-entry-row')).toHaveCount(5)
    await expect(page.locator('.ledger-entries-table')).toContainText('业务工具开发')
    await expect(page.locator('.ledger-entries-table')).toContainText('线下付款')
    await expect(page.locator('.ledger-entries-table')).not.toContainText('business_tools')
    for (const id of ['ledger-settlement-settings', 'ledger-adjustment-settings', 'ledger-rule-settings']) await expect(page.getByTestId(id)).not.toHaveAttribute('open')
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: join(output, `${width}-ledger-daily-flow.png`), fullPage: true })
    await page.getByRole('searchbox', { name: '查找成员', exact: true }).fill('林同学')
    await expect(page.getByTestId('member-balance-row')).toHaveCount(1)
    await expect(overview).toContainText('¥120.00')
    await page.getByRole('searchbox', { name: '查找订单', exact: true }).fill('UX-ORDER-101')
    await page.getByRole('combobox', { name: '记录状态', exact: true }).selectOption('held')
    await expect(page.getByTestId('ledger-entry-row')).toHaveCount(1)
    await expect(page.getByTestId('ledger-entry-row')).toContainText('20.00')
    await expect(overview).toContainText('¥120.00')
    await page.getByRole('button', { name: '清除明细筛选', exact: true }).click()
    await expect(page.getByTestId('ledger-entry-row')).toHaveCount(5)
    await page.getByRole('button', { name: '登记线下付款', exact: true }).first().click()
    await expect(page.locator('.ledger-payment')).toBeVisible()
    await expect(page.locator('.ledger-payment')).toContainText('不发起银行转账')
    await page.screenshot({ path: join(output, `${width}-ledger-payment-expanded.png`), fullPage: true })
    await page.locator('.ledger-payment').getByRole('button', { name: '取消', exact: true }).click()
    await expect(page.locator('.ledger-payment')).toHaveCount(0)
    expect(unknown).toEqual([])
  })

  test(`${width} review workspace has one decision area and bounded request list`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const reviews = Array.from({ length: 20 }, (_, index) => ({ ...profile, profile: { ...profile.profile, id: `layout-${index}`, name: '很长的学校与课程平台申请名称'.repeat(5), entryUrl: `https://school.example/${'course-entry/'.repeat(30)}?token=not-for-display` } }))
    const unknown = await fixture(page, 'admin', { reviews })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/#/admin/target-reviews', { waitUntil: 'networkidle' })
    await expect(page.locator('.review-guide, .target-review > summary')).toHaveCount(0)
    await expect(page.getByTestId('review-list-count')).toHaveText('20 项待审核 · 共 20 项')
    const list = page.locator('.review-list')
    await expect(list.getByRole('button')).toHaveCount(20)
    const form = page.locator('.review-form')
    await expect(form.getByRole('button', { name: '验证通过', exact: true })).toBeVisible()
    await expect(form.locator('.verification-details')).not.toHaveAttribute('open')
    const listBox = (await list.boundingBox())!
    const formBox = (await form.boundingBox())!
    expect(Math.abs(listBox.y - formBox.y)).toBeLessThanOrEqual(1)
    expect(listBox.height).toBeLessThanOrEqual(600)
    expect(await list.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    const contained = await form.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return [...element.querySelectorAll('.review-request-heading, .review-status, .review-entry, .review-entry-url, .review-actions-primary, .target-open')].every(child => {
        const box = child.getBoundingClientRect()
        return box.left >= bounds.left - 1 && box.right <= bounds.right + 1
      })
    })
    expect(contained).toBe(true)
    await expect(form.locator('.review-entry-url')).not.toContainText('not-for-display')
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: join(output, `${width}-review-long-requests.png`), fullPage: true })
    expect(unknown).toEqual([])
  })

  test(`${width} users with records and editable detail stay readable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const records = [
      { ...sampleUser },
      { ...sampleUser, id: 92, name: '样例长姓名'.repeat(10), customer_name: '样例长学校名称'.repeat(12), project_id: '样例长项目名称'.repeat(12), device_name: '样例长电脑名称'.repeat(12), status: 'expired' },
    ]
    const unknown = await fixture(page, 'admin', { users: records })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/#/admin/users', { waitUntil: 'networkidle' })
    await expect(page.locator('.el-table__body tbody tr')).toHaveCount(2)
    const headers = page.locator('.el-table__header th')
    await expect(headers).toHaveText(['用户 / 联系方式', '客户 / 项目', '授权状态 / 到期', '使用电脑', '操作'])
    await expect(page.locator('.el-table__body')).toContainText('2026秋季实训')
    await expect(page.locator('.el-table__body')).toContainText('已到期')
    const actionButtons = page.locator('.user-row-actions').first().getByRole('button')
    const firstButton = (await actionButtons.nth(0).boundingBox())!
    const nextButton = (await actionButtons.nth(1).boundingBox())!
    expect(Math.abs(firstButton.y - nextButton.y)).toBeLessThanOrEqual(1)
    await expect.poll(() => page.locator('.el-table__body-wrapper .el-scrollbar__wrap').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: join(output, `${width}-admin-users-with-records.png`), fullPage: true })

    await page.getByRole('button', { name: '编辑', exact: true }).first().click()
    const drawer = page.locator('.admin-detail-drawer')
    await expect(drawer).toBeVisible()
    await expect(drawer).toContainText('2026秋季实训')
    await drawer.getByLabel('用户名', { exact: true }).fill('验收样例 · 更新姓名')
    const fieldPositions = await drawer.locator('.user-field-grid label').evaluateAll(elements => elements.map(element => {
      const label = element.getBoundingClientRect()
      const control = element.querySelector('.el-input, .el-input-number')!.getBoundingClientRect()
      return { x: label.x, y: label.y, inputX: control.x, inputY: control.y, inputHeight: control.height, inputWidth: control.width }
    }))
    expect(fieldPositions).toHaveLength(4)
    for (const [left, right] of [[fieldPositions[0]!, fieldPositions[1]!], [fieldPositions[2]!, fieldPositions[3]!]] as const) {
      expect(Math.abs(left.y - right.y)).toBeLessThanOrEqual(1)
      expect(Math.abs(left.inputY - right.inputY)).toBeLessThanOrEqual(1)
      expect(Math.abs(left.inputWidth - right.inputWidth)).toBeLessThanOrEqual(1)
      expect(Math.abs(left.inputHeight - 40)).toBeLessThanOrEqual(1)
    }
    expect(Math.abs(fieldPositions[0]!.x - fieldPositions[2]!.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(fieldPositions[1]!.x - fieldPositions[3]!.x)).toBeLessThanOrEqual(1)
    await expect(drawer.locator('.user-technical-details')).not.toHaveAttribute('open')
    const formBounds = await drawer.locator('.user-detail-list').evaluate(element => {
      const outer = element.getBoundingClientRect()
      return [...element.querySelectorAll('input, .el-input-number, strong')].every(child => {
        const box = child.getBoundingClientRect()
        return box.left >= outer.left - 1 && box.right <= outer.right + 1
      })
    })
    expect(formBounds).toBe(true)
    await page.screenshot({ path: join(output, `${width}-admin-user-edit.png`), fullPage: true })
    await drawer.screenshot({ path: join(output, `${width}-user-edit-detail.png`) })
    await drawer.getByRole('button', { name: '保存', exact: true }).click()
    await expect(drawer).toContainText('验收样例 · 更新姓名')
    await expect(drawer.getByRole('button', { name: '保存', exact: true })).toHaveCount(0)
    await drawer.getByRole('button', { name: '关闭', exact: true }).click()
    await page.getByRole('textbox', { name: '搜索用户名、手机号或电脑' }).fill('没有这个用户')
    await expect(page.locator('.el-table__empty-block')).toContainText('没有找到匹配的用户')
    await page.getByRole('button', { name: '清除搜索', exact: true }).click()
    await expect(page.locator('.el-table__body tbody tr')).toHaveCount(2)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    expect(unknown).toEqual([])
  })

  test(`${width} authorization rows keep customer identity and secondary actions visible`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const unknown = await fixture(page, 'admin', { codes: [sampleCode, { ...sampleCode, id: 13, customer_name: '很长的样例客户名称'.repeat(15), project_id: '很长的实训项目名称'.repeat(15), responsible: '样例负责人'.repeat(10) }] })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/#/admin/authcodes', { waitUntil: 'networkidle' })
    const identity = page.getByTestId('auth-code-identity-12')
    await expect(identity).toContainText(sampleCode.customer_name)
    await expect(identity.locator('.code-link')).toContainText(sampleCode.code)
    const context = page.getByTestId('auth-code-context-12')
    await expect(context).toContainText(sampleCode.project_id)
    await expect(context).toContainText(sampleCode.responsible)
    await page.getByTestId('auth-code-actions-12').getByRole('button', { name: '更多' }).click()
    await expect(page.getByRole('menuitem', { name: '冻结', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: '延期', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.screenshot({ path: join(output, `${width}-admin-authcodes-with-records.png`), fullPage: true })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    expect(unknown).toEqual([])
  })
}

for (const width of [1440, 1024]) {
  test(`${width} /admin/dashboard review card stays aligned with 1, 2, 20 and 100 requests`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const options = { reviews: [profile] }
    const unknown = await fixture(page, 'admin', options)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/#/admin/dashboard', { waitUntil: 'networkidle' })
    const card = page.locator('#target_review')
    const neighbour = page.locator('#expense_renewals')
    await expect(card).toBeVisible()
    const baseline = await card.boundingBox()
    expect(baseline).not.toBeNull()
    const fontSize = (selector: string) => page.locator(selector).evaluate(element => getComputedStyle(element).fontSize)
    for (const count of [1, 2, 20, 100]) {
      options.reviews = Array.from({ length: count }, (_, index) => ({
        ...profile,
        profile: {
          ...profile.profile,
          id: `ux-long-${index}`,
          name: '跨境电商实训与技能竞赛平台入口名称很长的验收样例'.repeat(4),
          entryUrl: `https://school.example/${'long-course-path/'.repeat(20)}${index}?token=do-not-display`,
        },
      }))
      await page.getByRole('button', { name: '刷新', exact: true }).click()
      await expect(card.locator('.review-task')).toHaveCount(1)
      await expect(card.locator('.review-task')).toHaveAttribute('href', /profile_id=ux-long-0/)
      if (count > 1) await expect(card.locator('.review-more-hint')).toHaveText(`另有 ${count - 1} 条待审核`)
      else await expect(card.locator('.review-more-hint')).toHaveCount(0)

      const box = (await card.boundingBox())!
      const beside = (await neighbour.boundingBox())!
      expect(Math.abs(box.width - beside.width)).toBeLessThanOrEqual(1)
      expect(Math.abs(box.height - beside.height)).toBeLessThanOrEqual(1)
      expect(Math.abs(box.height - baseline!.height)).toBeLessThanOrEqual(1)
      const cardHeader = (await card.locator('header').boundingBox())!
      const otherHeader = (await neighbour.locator('header').boundingBox())!
      expect(Math.abs(cardHeader.height - otherHeader.height)).toBeLessThanOrEqual(1)
      for (const [actual, reference] of [
        ['#target_review h3', '#expense_renewals header h3'],
        ['#target_review .target-review-link', '#expense_renewals header a'],
        ['#target_review .review-task-action', '#expense_renewals header a'],
        ['#target_review .review-task-copy strong', '#expiring_authorizations .record-task-text'],
        ['#target_review .review-task-copy small', '#expiring_authorizations .record-task-text'],
        ['#target_review .review-task-status', '#expiring_authorizations .record-task-text'],
      ]) {
        expect(await fontSize(actual!)).toBe(await fontSize(reference!))
      }
      const geometry = await card.evaluate(element => {
        const bounds = element.getBoundingClientRect()
        const outside = [...element.querySelectorAll('*')].filter(child => {
          const rect = child.getBoundingClientRect()
          return rect.width > 0 && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || rect.bottom > bounds.bottom + 1)
        }).map(child => child.className)
        const text = element.querySelector('.review-task-copy strong') as HTMLElement
        const url = element.querySelector('.review-task-copy small') as HTMLElement
        return { outside, textOverflow: text.scrollWidth > text.clientWidth, urlOverflow: url.scrollWidth > url.clientWidth, title: url.title }
      })
      expect(geometry.outside).toEqual([])
      expect(geometry.textOverflow).toBe(true)
      expect(geometry.urlOverflow).toBe(true)
      expect(geometry.title).not.toContain('do-not-display')
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    }
    await page.screenshot({ path: join(output, `${width}-admin-dashboard-many-reviews.png`), fullPage: true })
    await card.screenshot({ path: join(output, `${width}-review-card-many.png`) })
    await card.locator('.target-review-link').click()
    await expect(page).toHaveURL(/#\/admin\/target-reviews$/)
    expect(unknown).toEqual([])
  })
}

for (const width of [1440, 1024]) {
  for (const [role, path, heading] of [
    ['consumer', '/user/tools', '你想先完成哪件事'],
    ['admin', '/admin/dashboard', '行动中心'],
    ['admin', '/admin/users', '用户管理'],
    ['admin', '/admin/target-reviews', '平台入口'],
    ['admin', '/admin/team-ledger', '成员结算台账'],
    ['admin', '/admin/commercial', '商品'],
    ['admin', '/admin/scenarios', '使用范围'],
    ['admin', '/admin/local-runtime', '账号工作区'],
    ['admin', '/admin/profit', '分润管理'],
  ] as const) {
    test(`${width} ${path} layout (synthetic fixtures)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      const unknown = await fixture(page, role)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(`/#${path}`, { waitUntil: 'networkidle' })
      await expect(page).toHaveURL(new RegExp(`#${path}$`))
      await expect(page.locator('body')).toContainText(heading)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      if (path === '/user/tools') {
        // The toolbox starts with a clear request-first summary.  Expand the
        // flow before asserting the URL field so the acceptance check mirrors
        // what a user does instead of treating a collapsed panel as missing.
        const workspace = page.locator('[data-testid="target-workspace"]')
        await expect(workspace).toContainText('先申请平台接入')
        await workspace.locator('.target-toggle').click()
        const input = page.locator('[data-testid="target-entry-url"]')
        // Before team approval the primary action is an application, not a
        // login/open action.  That distinction is the key acceptance point of
        // the request-first toolbox flow.
        const button = page.locator('[data-testid="target-apply"]')
        await expect(input).toBeVisible()
        const fieldBox = await input.boundingBox()
        const buttonBox = await button.boundingBox()
        expect(fieldBox).not.toBeNull()
        expect(buttonBox).not.toBeNull()
        expect(Math.abs(fieldBox!.y - buttonBox!.y)).toBeLessThanOrEqual(2)
      }
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
      await page.screenshot({ path: join(output, `${width}-${path.slice(1).replaceAll('/', '-')}.png`), fullPage: true })
      expect(errors).toEqual([])
      expect(unknown).toEqual([])
    })
  }
}
