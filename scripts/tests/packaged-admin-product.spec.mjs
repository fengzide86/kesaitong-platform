/* global window, document, location, getComputedStyle, requestAnimationFrame, innerWidth, URL, fetch, sessionStorage */
import process from 'node:process'
import { Buffer } from 'node:buffer'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { _electron as electron } from 'playwright-core'
import { expect, test } from '@playwright/test'

const runtime = process.env.KST_REAL_E2E_DIR
const before = process.env.KST_ADMIN_BEFORE === '1'
const api = `http://localhost:${new URL(process.env.KST_REAL_E2E_BASE_URL).port}`
const credentials = JSON.parse(readFileSync(join(runtime, 'credentials.json'), 'utf8'))
const ids = JSON.parse(readFileSync(join(runtime, 'admin-flow-ids.json'), 'utf8'))
const executable = resolve(process.env.KST_PACKAGED_EXECUTABLE)
let sequence = 0
let lastStaffLoginAt = 0

async function launch(role) {
  // A failed test restarts the Playwright worker and its counter; never reopen
  // a previously authenticated acceptance profile in the replacement worker.
  const profile = join(runtime, `profile-${role}-w${test.info().workerIndex}-${++sequence}`)
  const env = { ...process.env, NODE_ENV: 'production', TOOLBOX_RUNTIME_DIR: profile, TOOLBOX_CONTROL_API_URL: api, TOOLBOX_USE_BUNDLED_BACKEND: 'false' }
  delete env.ELECTRON_RUN_AS_NODE
  const application = await electron.launch({ executablePath: executable, args: ['--disable-backgrounding-occluded-windows'], env, timeout: 30000 })
  const evidence = { role, errors: [], requests: [], screenshots: [] }
  await application.evaluate(({ app, BrowserWindow, session }, origin) => {
    if (!app.isPackaged) throw new Error('Acceptance requires a packaged Windows app')
    process.mainModule.require('electron-updater').autoUpdater.setFeedURL({ provider: 'generic', url: origin + '/updates/' })
    globalThis.__adminAcceptanceExternal = []
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      const local = ['localhost', '127.0.0.1'].includes(new URL(details.url).hostname)
      if (!local) globalThis.__adminAcceptanceExternal.push(new URL(details.url).origin)
      callback({ cancel: !local })
    })
    for (const win of BrowserWindow.getAllWindows()) { win.setPosition(-4000, -4000); win.webContents.setBackgroundThrottling(false); win.setContentSize(1440, 960); win.blur() }
  }, api)
  const page = await application.firstWindow()
  page.on('pageerror', error => evidence.errors.push(error.message))
  page.on('response', response => {
    const path = new URL(response.url()).pathname
    if (path.startsWith('/api/')) evidence.requests.push({ path, method: response.request().method(), status: response.status() })
  })
  await page.waitForFunction(() => !document.querySelector('.startup-loading') && Boolean(window.electronAPI?.runtime?.deviceId), undefined, { polling: 100 })
  if (role !== 'business' && role !== 'consumer') {
    // All acceptance profiles share one loopback IP. Preserve the production
    // 5/minute login limit; pace genuine UI logins instead of relaxing security.
    const waitMs = Math.max(0, 13_000 - (Date.now() - lastStaffLoginAt))
    if (waitMs) await delay(waitMs)
    evidence.staffLoginThrottleMs = waitMs
  }
  const authenticated = page.waitForResponse(response => response.request().method() === 'POST' && ['/api/auth/verify', '/api/staff/auth/login'].includes(new URL(response.url()).pathname))
  if (role === 'business' || role === 'consumer') {
    await page.getByLabel('授权码', { exact: true }).fill(credentials[role])
    await expect(page.getByLabel('授权码', { exact: true })).toHaveValue(credentials[role])
    await page.getByRole('button', { name: '登录并开始使用', exact: true }).click()
    await expect(page).toHaveURL(role === 'business' ? /business\/overview/ : /user\/tools/)
  } else {
    await page.goto('app://toolbox/#/admin/login')
    const key = role === 'admin' ? 'staff' : role === 'agent' ? 'agent_a' : role
    await page.getByLabel('后台账号', { exact: true }).fill(credentials[key + '_username'])
    await page.getByLabel('密码', { exact: true }).fill(credentials[key + '_password'])
    lastStaffLoginAt = Date.now()
    await page.getByRole('button', { name: '登录并进入工作台', exact: true }).click()
    await expect(page).toHaveURL(role === 'agent' ? /agent\/overview/ : /admin\/(?!login)/)
  }
  const login = await (await authenticated).json()
  return { application, page, evidence, apiToken: login.data?.token || login.token }
}
async function navigate(page, route) {
  await page.evaluate(value => { location.hash = value }, route)
  await expect.poll(() => new URL(page.url()).hash).toBe('#' + route)
  await settled(page)
}
async function settled(page) {
  await page.waitForFunction(() => ![...document.querySelectorAll('.el-loading-mask,.startup-loading')].some(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden'), undefined, { polling: 100 })
}
async function capture(session, name, width = 1440, zoom = 1, focus) {
  const { application, page, evidence } = session
  await application.evaluate(({ BrowserWindow }, options) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setContentSize(options.width, options.width === 1024 ? 820 : 1000)
    win.webContents.setZoomFactor(options.zoom)
    win.setPosition(-4000, -4000); win.showInactive(); win.webContents.invalidate()
  }, { width, zoom })
  await settled(page)
  if (focus) await focus.scrollIntoViewIfNeeded()
  await expect(page.locator('.toast-container .toast')).toHaveCount(0)
  const mask = await page.addStyleTag({ content: '.auth-code,.code-cell,.code-link,.license-code,.delivery-block code,.records-table code,.detail-value[style*="monospace"]{color:transparent!important;background:#e5e7eb!important}input[type="password"]{visibility:hidden!important}' })
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().iterations) && animation.playState === 'running').length)).toBe(0)
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))))
  const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth, width: innerWidth }))
  expect(layout.overflow).toBeLessThanOrEqual(1)
  const data = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64'))
  const file = `${name}-${width}${zoom === 1 ? '' : '-125pct'}.png`
  writeFileSync(join(runtime, 'screens', file), Buffer.from(data, 'base64'))
  await mask.evaluate(node => node.remove())
  evidence.screenshots.push({ file, route: new URL(page.url()).hash, ...layout })
}
async function close(session, name) {
  session.evidence.externalRequests = await session.application.evaluate(() => globalThis.__adminAcceptanceExternal)
  writeFileSync(join(runtime, name + '.json'), JSON.stringify(session.evidence, null, 2))
  await session.application.close()
  expect(session.evidence.errors).toEqual([])
  expect(session.evidence.externalRequests).toEqual([])
}

test('baseline and candidate native admin page comparison', async () => {
  const session = await launch('admin')
  try {
    for (const [name, route] of Object.entries({ dashboard: '/admin/dashboard', users: '/admin/users', authorizations: '/admin/authcodes', feedback: '/admin/feedback', orders: '/admin/orders', settings: '/admin/settings' })) {
      await navigate(session.page, route)
      await capture(session, name)
      await capture(session, name, 1024)
    }
    await navigate(session.page, '/admin/dashboard')
    await capture(session, 'dashboard', 1440, 1.25)
    await session.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1))
    await navigate(session.page, '/admin/feedback')
    await session.page.locator('.el-table__row').first().getByRole('button', { name: before ? '查看' : '查看与处理', exact: true }).click()
    await expect(session.page.getByRole('dialog')).toBeVisible()
    await capture(session, 'feedback-detail')
  } finally { await close(session, 'admin-visual') }
})

test('baseline and candidate native agent customer comparison', async () => {
  const session = await launch('agent')
  try {
    await navigate(session.page, '/agent/customers')
    await expect(session.page.locator('.el-table__row')).toHaveCount(2)
    await session.page.locator('.el-table__row').first().getByRole('button', { name: /编辑/ }).click()
    await expect(session.page.getByRole('dialog')).toBeVisible()
    await capture(session, 'agent-customer')
    await capture(session, 'agent-customer', 1024)
  } finally { await close(session, 'agent-visual') }
})

// The candidate-only business workflows below use the same real APIs and DB;
// before screenshots intentionally do not exercise capabilities absent before.
test('candidate object links and permission navigation', async () => {
  test.skip(before, 'New behavior does not exist in the retained prior package')
  const session = await launch('admin')
  try {
    await navigate(session.page, '/admin/dashboard')
    await session.page.locator('#expiring_authorizations .record-task').first().click()
    await expect(session.page).toHaveURL(new RegExp(`auth_code_id=${ids.auth_code_id}`))
    await expect(session.page.getByRole('dialog')).toContainText('本机验收客户')
    await session.page.getByRole('button', { name: '返回来源', exact: true }).click()
    await expect(session.page).toHaveURL(/admin\/dashboard$/)
    await session.page.locator('#pending_tickets .record-task').filter({ hasText: '本机验收 · 授权与设备求助' }).click()
    await expect(session.page).toHaveURL(new RegExp(`ticket_id=${ids.ticket_id}`))
    await expect(session.page.getByRole('dialog')).toContainText('本机验收 · 授权与设备求助')
    await capture(session, 'linked-ticket')
    await session.page.getByRole('dialog').getByRole('button', { name: '查看用户', exact: true }).click()
    await expect(session.page).toHaveURL(new RegExp(`user_id=${ids.user_id}`))
    await expect(session.page.getByRole('dialog')).toContainText('本机验收客户')
    await capture(session, 'linked-customer')
    await session.page.getByRole('dialog').getByRole('button', { name: '授权与设备', exact: true }).click()
    await expect(session.page).toHaveURL(new RegExp(`auth_code_id=${ids.auth_code_id}`))
    await expect(session.page.getByRole('dialog')).toBeVisible()
    await expect(session.page.getByRole('dialog')).toContainText('本机验收客户')
    await capture(session, 'linked-authorization')
    await capture(session, 'linked-authorization', 1024)
  } finally { await close(session, 'object-links') }
})

test('candidate customer help, staff reply and same-ticket readback', async () => {
  test.skip(before, 'New reply metadata is absent in the prior client')
  const customer = await launch('business')
  let admin
  try {
    await customer.page.getByRole('button', { name: '使用帮助', exact: true }).click()
    await customer.page.getByLabel('问题说明（请勿填写密码或客户资料）', { exact: true }).fill('本机产品验收：尚未开始批次，如何准备文件？')
    const posted = customer.page.waitForResponse(response => new URL(response.url()).pathname === '/api/feedback' && response.request().method() === 'POST')
    await customer.page.getByRole('button', { name: '提交给客服支持', exact: true }).click()
    const response = await posted
    expect(response.status()).toBe(200)
    const ticket = (await response.json()).data
    expect(ticket.id).toBeTruthy()
    await expect(customer.page.getByRole('dialog')).toContainText(`工单 #${ticket.id}`)
    admin = await launch('admin')
    await navigate(admin.page, `/admin/feedback?ticket_id=${ticket.id}`)
    const detail = admin.page.getByRole('dialog')
    await expect(detail).toContainText('本机产品验收')
    await detail.getByLabel('回复内容', { exact: true }).fill('已收到，请先选择已开放工具，再按工具字段说明准备自己的文件。此问题仍在跟进。')
    await detail.getByLabel('处理状态', { exact: true }).locator('xpath=ancestor::div[contains(@class,"el-select__wrapper")][1]').click()
    await admin.page.getByRole('option', { name: '处理中', exact: true }).click()
    const saved = admin.page.waitForResponse(response => new URL(response.url()).pathname === `/api/feedback/${ticket.id}` && response.request().method() === 'PUT')
    await detail.getByRole('button', { name: '保存处理结果', exact: true }).click()
    expect((await saved).status()).toBe(200)
    await expect(detail).toContainText('回复时间')
    await capture(admin, 'support-inline-reply')
    await capture(admin, 'support-inline-reply', 1024)
    await customer.page.getByRole('button', { name: '刷新回复', exact: true }).click()
    const reply = customer.page.locator('.help-copy article').filter({ hasText: `工单 #${ticket.id}` })
    await expect(reply).toContainText('此问题仍在跟进')
    await expect(reply).toContainText('处理中')
    await expect(reply).toContainText('最近回复')
    await expect(reply).not.toContainText('已解决')
    await capture(customer, 'customer-reply-readback', 1440, 1, reply)
    await capture(customer, 'customer-reply-readback', 1024, 1, reply)
    // Readback is independently checked through the real authenticated API.
    const readback = await fetch(`${api}/api/feedback/my`, { headers: { Authorization: `Bearer ${customer.apiToken}` } })
    expect(readback.status).toBe(200)
    const reread = (await readback.json()).data.find(item => item.id === ticket.id)
    expect(reread.status).toBe('processing')
    expect(reread.replied_at).toBeTruthy()
  } finally {
    if (admin) await close(admin, 'support-reply-admin')
    await close(customer, 'support-reply-customer')
  }
})

test('candidate consumer keeps tool entry and can transfer a question to its own ticket', async () => {
  test.skip(before, 'Candidate customer support acceptance only')
  const customer = await launch('consumer')
  try {
    await expect(customer.page).toHaveURL(/user\/tools/)
    await capture(customer, 'consumer-tools')
    await navigate(customer.page, '/user/ai-chat')
    await customer.page.getByLabel('描述你的问题', { exact: true }).fill('本机验收：授权设备如何解绑？需要人工帮助。')
    await customer.page.getByRole('button', { name: '发送', exact: true }).click()
    await customer.page.getByRole('button', { name: '转人工客服', exact: true }).click()
    await customer.page.getByRole('button', { name: '创建工单', exact: true }).click()
    await expect(customer.page.locator('.transferred-notice')).toContainText('已创建工单')
    await customer.page.getByRole('button', { name: '我的工单', exact: true }).first().click()
    const drawer = customer.page.getByRole('dialog', { name: '我的工单', exact: true })
    await expect(drawer.locator('.support-ticket')).toHaveCount(1)
    await expect(drawer).toContainText('工单 #')
    await expect(drawer).toContainText('待处理')
    await expect(drawer).toContainText('尚未回复')
    await capture(customer, 'consumer-support-ticket')
    await capture(customer, 'consumer-support-ticket', 1024)
  } finally { await close(customer, 'consumer-support') }
})

test('candidate authorization searches beyond 100 rows and restores server page', async () => {
  test.skip(before, 'Service pagination is new in the candidate')
  const admin = await launch('admin')
  try {
    await navigate(admin.page, '/admin/authcodes?page=6')
    await expect(admin.page.locator('.el-table__row').first()).toBeVisible()
    await expect(admin.page.getByText(/共 11\d 个授权/)).toBeVisible()
    const input = admin.page.getByPlaceholder('搜索全部授权码/设备...', { exact: true })
    const request = admin.page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth-codes' && new URL(response.url()).searchParams.get('keyword') === '本机分页验收设备-000')
    await input.fill('本机分页验收设备-000')
    await input.press('Enter')
    expect((await request).status()).toBe(200)
    await expect(admin.page.locator('.el-table__row')).toHaveCount(1)
    await expect(admin.page.getByText('共 1 个授权 · 本页 1 个', { exact: true })).toBeVisible()
    await capture(admin, 'authorization-server-search', 1024, 1, admin.page.getByText('共 1 个授权 · 本页 1 个', { exact: true }))
    await navigate(admin.page, '/admin/authcodes?page=6')
    await expect(input).toHaveValue('')
    await expect(admin.page.getByText(/共 11\d 个授权/)).toBeVisible()
    await capture(admin, 'authorization-page-six', 1440, 1, admin.page.locator('.el-pagination').first())
  } finally { await close(admin, 'authorization-pagination') }
})

for (const role of ['operator', 'support']) {
  test(`candidate ${role} sees only permitted navigation and real API blocks settings`, async () => {
    test.skip(before, 'Candidate navigation acceptance only')
    const session = await launch(role)
    try {
      const nav = session.page.getByRole('navigation', { name: '管理工作区', exact: true })
      await expect(nav.getByRole('link', { name: '客户与授权', exact: true })).toBeVisible()
      await expect(nav.getByRole('link', { name: '售后支持', exact: true })).toBeVisible()
      if (role === 'support') await expect(nav.getByRole('link', { name: '经营财务', exact: true })).toHaveCount(0)
      else await expect(nav.getByRole('link', { name: '经营财务', exact: true })).toBeVisible()
      await nav.getByRole('link', { name: '产品与系统', exact: true }).click()
      await expect(session.page.getByRole('link', { name: '后台账号', exact: true })).toHaveCount(0)
      await expect(session.page.getByRole('link', { name: '套餐与设置', exact: true })).toHaveCount(0)
      const denied = await fetch(api + '/api/staff/accounts', { headers: { Authorization: `Bearer ${session.apiToken}` } })
      expect(denied.status).toBe(403)
      await capture(session, role + '-permissions')
      await capture(session, role + '-permissions', 1024)
    } finally { await close(session, role + '-permissions') }
  })
}

test('candidate agent customer to order, actual confirmation and license delivery readback', async () => {
  test.skip(before, 'Candidate relation navigation only')
  const agent = await launch('agent')
  let admin
  try {
    await navigate(agent.page, '/agent/customers')
    const customerRow = agent.page.locator('.el-table__row').first()
    const customerName = (await customerRow.locator('td').first().innerText()).trim()
    await customerRow.getByRole('button', { name: /编辑/ }).click()
    await expect(agent.page.getByRole('region', { name: '客户关联业务' })).toBeVisible()
    await agent.page.getByTestId('customer-create-order').click()
    await expect(agent.page).toHaveURL(/agent\/orders.*customer_id=.*create=1/)
    const form = agent.page.getByRole('dialog').filter({ has: agent.page.getByRole('button', { name: '提交待确认订单', exact: true }) })
    await expect(form).toContainText(customerName)
    await form.getByLabel('选择套餐', { exact: true }).locator('xpath=ancestor::div[contains(@class,"el-select__wrapper")][1]').click()
    await agent.page.getByRole('option', { name: /Y199/ }).first().click()
    await capture(agent, 'agent-preselected-order')
    const created = agent.page.waitForResponse(response => new URL(response.url()).pathname === '/api/agency/orders' && response.request().method() === 'POST')
    await form.getByRole('button', { name: '提交待确认订单', exact: true }).click()
    const createdResponse = await created
    expect(createdResponse.status()).toBe(201)
    const order = (await createdResponse.json()).data
    expect(order.status).toBe('pending')
    expect(order.auth_code).toBeFalsy()
    admin = await launch('admin')
    await navigate(admin.page, `/admin/agency?section=orders&record_id=${order.id}`)
    let detail = admin.page.getByRole('dialog', { name: '记录详情', exact: true })
    await expect(detail).toContainText(order.order_no)
    await detail.getByRole('button', { name: '确认已收款', exact: true }).click()
    await admin.page.getByRole('button', { name: '已核实，确认收款', exact: true }).click()
    await expect(detail.getByRole('button', { name: '发放授权', exact: true })).toBeVisible()
    await detail.getByRole('button', { name: '发放授权', exact: true }).click()
    await expect(detail.getByRole('button', { name: '复制授权码', exact: true })).toBeVisible()
    await capture(admin, 'agency-delivery-complete')
    await detail.getByRole('button', { name: '核对关联授权', exact: true }).click()
    await expect(admin.page).toHaveURL(/section=licenses.*record_id=/)
    await expect(admin.page.getByRole('dialog')).toContainText('授权')
    const readback = await fetch(`${api}/api/agency/orders/${order.id}`, { headers: { Authorization: `Bearer ${agent.apiToken}` } })
    expect(readback.status).toBe(200)
    const delivered = (await readback.json()).data
    expect(delivered.status).toBe('paid')
    expect(delivered.auth_code?.id).toBeTruthy()
    expect(delivered.customer_id).toBe(order.customer_id)
    await navigate(agent.page, `/agent/orders?record_id=${order.id}`)
    await expect(agent.page.getByRole('button', { name: '复制授权码', exact: true })).toBeVisible()
    await capture(agent, 'agent-delivery-readback')
    // The general bookkeeping page reads verified links but never guesses identities.
    await navigate(admin.page, `/admin/orders?record_id=${order.id}`)
    detail = admin.page.getByRole('dialog', { name: '订单详情', exact: true })
    await expect(detail).toContainText('代理客户订单')
    await detail.getByRole('button', { name: '核对关联授权', exact: true }).click()
    await expect(admin.page).toHaveURL(new RegExp(`admin/authcodes\\?auth_code_id=${delivered.auth_code.id}`))
    await expect(admin.page.getByRole('dialog')).toBeVisible()
    await capture(admin, 'order-authorization-readback')
    await navigate(admin.page, `/admin/orders?record_id=${order.id}`)
    await expect(admin.page.getByRole('dialog')).toBeVisible()
    await navigate(admin.page, '/admin/orders')
    await expect(admin.page.getByRole('dialog')).toBeHidden()
    await navigate(admin.page, `/admin/agency?section=orders&record_id=${order.id}`)
    await admin.page.getByRole('button', { name: '登记线下退款', exact: true }).click()
    await admin.page.getByPlaceholder('填写至少 2 个字的原因', { exact: true }).fill('仅本机虚构验收退款')
    await admin.page.getByRole('button', { name: '已核实，登记退款', exact: true }).click()
    await expect(admin.page.getByRole('dialog', { name: '记录详情', exact: true })).toContainText('系统不会自动停权')
    await capture(admin, 'refund-license-separation')
    const refundReadback = await fetch(`${api}/api/agency/orders/${order.id}`, { headers: { Authorization: `Bearer ${agent.apiToken}` } })
    const refunded = (await refundReadback.json()).data
    expect(refunded.status).toBe('refunded')
    expect(refunded.auth_code.id).toBe(delivered.auth_code.id)
    expect(refunded.auth_code.status).toBe(delivered.auth_code.status)
    await expect(admin.page.getByRole('button', { name: '复制授权码', exact: true })).toBeHidden()
  } finally {
    if (admin) await close(admin, 'agency-admin-closure')
    await close(agent, 'agency-customer-closure')
  }
})

test('hardening native message center reads 10000 characters and keeps narrow zoom keyboard focus', async () => {
  test.skip(before, 'Hardening behavior is not present in the retained baseline')
  const admin = await launch('admin')
  let customer
  try {
    // Real isolated backend create/feed/read receipt, never a production notice.
    const content = ('本机隔离验收：长公告必须可完整阅读，并支持键盘操作。\n'.repeat(500)).slice(0, 9996) + '验收结尾'
    expect(content.length).toBe(10000)
    const created = await fetch(`${api}/api/announcements`, {
      method: 'POST', headers: { Authorization: `Bearer ${admin.apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '本机验收 · 一万字公告', content, audience: 'consumer', category: 'system',
        type: 'info', severity: 'info', presentation: 'banner', status: 'published', priority: 100 }),
    })
    expect(created.ok).toBe(true)
    const announcement = (await created.json()).data
    customer = await launch('consumer')
    const { page } = customer
    const trigger = page.getByRole('button', { name: /^消息中心，/ })
    await trigger.click()
    const drawer = page.getByRole('dialog', { name: '消息中心', exact: true })
    const article = drawer.locator('article').filter({ has: page.getByRole('heading', { name: '本机验收 · 一万字公告', exact: true }) })
    await expect(article).toBeVisible()
    await capture(customer, 'hardening-message-collapsed', 1024, 1.25)
    const receipt = page.waitForResponse(response => new URL(response.url()).pathname === `/api/announcements/${announcement.id}/read` && response.request().method() === 'POST')
    await article.getByRole('button', { name: '阅读全文', exact: true }).click()
    expect((await receipt).ok()).toBe(true)
    const body = article.locator(`#announcement-body-${announcement.id}`)
    await expect(body).toHaveText(content)
    await expect(article.getByRole('button', { name: '收起正文', exact: true })).toHaveAttribute('aria-expanded', 'true')
    expect(await body.evaluate(node => getComputedStyle(node).overflow)).toBe('visible')
    await drawer.evaluate(node => { node.scrollTop = 0 })
    await capture(customer, 'hardening-message-expanded', 1024, 1.25)
    await capture(customer, 'hardening-message-narrow', 900, 1.25)
    expect(await drawer.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true)
    const controls = drawer.locator('button:not([disabled]),a[href],input:not([disabled]),[tabindex]:not([tabindex="-1"])')
    await controls.last().focus()
    await page.keyboard.press('Tab')
    await expect(controls.first()).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(controls.last()).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
    await expect(trigger).toBeFocused()
    const readback = await fetch(`${api}/api/announcements/feed`, { headers: { Authorization: `Bearer ${customer.apiToken}` } })
    expect(readback.ok).toBe(true)
    expect((await readback.json()).data.find(item => item.id === announcement.id).is_read).toBe(true)
    customer.evidence.hardening = { contentLength: 10000, evidence: 'real isolated backend and packaged UI', keyboard: ['Tab wrap', 'Shift+Tab wrap', 'Escape restores trigger'], zoom: 1.25 }
  } finally {
    if (customer) await close(customer, 'hardening-message-center')
    await close(admin, 'hardening-notice-admin')
  }
})

test('hardening native admin read failures stay unknown and recover without false zero states', async () => {
  test.skip(before, 'Hardening behavior is not present in the retained baseline')
  const session = await launch('admin')
  const { page } = session
  const faultPaths = new Set(['/api/settings', '/api/plans/admin', '/api/auth-codes', '/api/tools', '/api/admin/action-center'])
  let failed = true
  const pattern = /\/api\/(?:settings|plans\/admin|auth-codes|tools|admin\/action-center)(?:\?|$)/
  await page.route(pattern, route => failed && faultPaths.has(new URL(route.request().url()).pathname)
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, message: '本机验收注入：只读接口暂时不可用' }) })
    : route.continue())
  try {
    // Reload clears the in-memory GET cache, without clearing credentials or
    // browser data, to exercise a genuinely unknown initial state.
    await navigate(page, '/admin/business-access')
    await page.reload()
    await expect(page.locator('.business-access-page .partial-error')).toBeVisible()
    await expect(page.locator('.hero-copy h2')).toHaveText('开放状态待确认')
    await expect(page.locator('.readiness-grid strong')).toHaveText(['待确认', '待确认', '待确认'])
    await expect(page.getByRole('switch')).toBeDisabled()
    await expect(page.getByRole('button', { name: '生成测试授权', exact: true })).toBeDisabled()
    await capture(session, 'hardening-business-unknown', 1024, 1.25)
    failed = false
    await page.locator('.partial-error').getByRole('button', { name: '重新加载', exact: true }).click()
    await expect(page.locator('.partial-error')).toBeHidden()
    await expect(page.locator('.hero-copy h2')).not.toHaveText('开放状态待确认')
    await capture(session, 'hardening-business-recovered', 1024, 1.25)
    failed = true
    await navigate(page, '/admin/dashboard')
    await expect(page.locator('.async-notice.is-error')).toBeVisible()
    await expect(page.locator('.summary-grid')).toHaveCount(0)
    await capture(session, 'hardening-dashboard-unavailable', 1024, 1.25)
    failed = false
    await page.locator('.async-notice').getByRole('button', { name: '重新加载', exact: true }).click()
    await expect(page.locator('.summary-grid')).toBeVisible()
    await expect(page.locator('.async-notice')).toHaveCount(0)
    session.evidence.hardening = { evidence: 'real packaged UI; explicit local 503 response injection; recovery reads real isolated backend', failedPaths: [...faultPaths], unknownNotZero: true }
  } finally {
    await page.unroute(pattern)
    await close(session, 'hardening-admin-unknown')
  }
})

test('hardening native sessions do not share local cookies after changing verified KST owner', async () => {
  test.skip(before, 'Old package uses the shared persistent partition')
  const session = await launch('consumer')
  try {
    const { page, application } = session
    const first = await page.evaluate(() => window.electronAPI.automation.prepareBrowser('amazon'))
    const guestId = await page.evaluate(partition => new Promise((complete, reject) => {
      const guest = document.createElement('webview')
      guest.setAttribute('partition', partition)
      guest.setAttribute('src', 'about:blank')
      guest.addEventListener('dom-ready', async () => {
        try { const id = guest.getWebContentsId(); await window.electronAPI.automation.registerBrowser(id); complete(id) }
        catch (error) { reject(error) }
      }, { once: true })
      document.body.append(guest)
    }), first.partition)
    await application.evaluate(async ({ session: native }, partition) => {
      await native.fromPartition(partition).cookies.set({ url: 'http://127.0.0.1/', name: 'kst-isolated-acceptance', value: 'owner-a-fixture' })
    }, first.partition)
    const deviceId = await page.evaluate(() => window.electronAPI.runtime.deviceId)
    const login = await fetch(`${api}/api/auth/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: credentials.business, device_id: deviceId, device_name: '本机分区隔离验收' }) })
    expect(login.ok).toBe(true)
    const envelope = await login.json()
    const token = envelope.data?.token || envelope.token
    expect(typeof token).toBe('string')
    // Simulate a token replacement that bypasses the UI logout hook: the main
    // process still must detect the verified owner change itself.
    await page.evaluate(value => sessionStorage.setItem('toolbox_token', value), token)
    const second = await page.evaluate(() => window.electronAPI.automation.prepareBrowser('amazon'))
    expect(second.partition).not.toBe(first.partition)
    const nativeEvidence = await application.evaluate(async ({ session: native, webContents }, value) => ({
      oldGuestGone: !webContents.fromId(value.guestId) || webContents.fromId(value.guestId).isDestroyed(),
      previousCookiePreserved: (await native.fromPartition(value.first).cookies.get({ name: 'kst-isolated-acceptance' })).length === 1,
      nextOwnerCookieCount: (await native.fromPartition(value.second).cookies.get({ name: 'kst-isolated-acceptance' })).length,
    }), { guestId, first: first.partition, second: second.partition })
    expect(nativeEvidence).toEqual({ oldGuestGone: true, previousCookiePreserved: true, nextOwnerCookieCount: 0 })
    const late = await page.evaluate(async id => {
      try { await window.electronAPI.automation.registerBrowser(id); return 'accepted' } catch { return 'rejected' }
    }, guestId)
    expect(late).toBe('rejected')
    session.evidence.hardening = { evidence: 'packaged main IPC, real isolated auth backend, native Electron Cookie jars; loopback fixture only', ...nativeEvidence, staleRegistration: late }
  } finally { await close(session, 'hardening-native-owner-isolation') }
})
