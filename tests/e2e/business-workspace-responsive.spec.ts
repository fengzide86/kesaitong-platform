import { resolve } from 'node:path'
import { expect, test, type Page, type Request } from '@playwright/test'
import { installControlledBatchBridge } from './helpers/controlled-batch-bridge'

const browserErrors = new WeakMap<Page, string[]>()
test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  browserErrors.set(page, errors)
  page.on('pageerror', error => errors.push(error.message))
})
test.afterEach(async ({ page }) => { expect(browserErrors.get(page)).toEqual([]) })

const businessUser = {
  user_id: 701, auth_code_id: 801, device_id: 'responsive-test-device',
  role: 'user', product_type: 'business', business_workspace_enabled: true,
  plan_name: '专业批量版', seat_limit: 5, seat_used: 1,
  entitlements: { batch_execution: true, multi_account_workspace: true, desktop_notification: true, max_batch_rows: 50, max_open_sessions: 6 },
}

const batchTool = {
  id: 'tool_logistics_standard', name: '物流模板验证工具', description: '自动完成重复业务操作',
  business_description: '顺序处理多个客户账号', supports_batch: true,
  target_url: 'https://sellercentral.amazon.com/',
  capability_key: 'logistics_standard', platform_key: 'amazon',
  availability: 'live_beta', release_status: 'available', script_status: 'script_ready', supports_live_batch: true,
  batch_input_schema: [{ key: 'account_label', label: '客户简称', type: 'text', required: true }],
}

async function mockControlPlane(page: Page, role: 'business' | 'consumer' | 'super_admin' = 'business'): Promise<void> {
  const user = role === 'business'
    ? businessUser
    : role === 'super_admin'
      ? { id: 'super-admin-1', staff_id: 'super-admin-1', username: 'acceptance_admin', display_name: '超级管理员', role, status: 'active', force_password_reset: false }
      : { role: 'user', product_type: 'consumer', business_workspace_enabled: false, plan_name: '普通版', entitlements: {} }
  await page.addInitScript(({ user, role }) => {
    const sessionRole = role === 'super_admin' ? 'super_admin' : 'user'
    sessionStorage.setItem('toolbox_auth', JSON.stringify({ token: 'visual-token', role: sessionRole }))
    sessionStorage.setItem('toolbox_token', 'visual-token')
    sessionStorage.setItem('toolbox_role', sessionRole)
    localStorage.setItem('toolbox_user', JSON.stringify(user))
  }, { user, role })
  await page.route('**/api/**', async route => {
    const url = route.request().url()
    let data: unknown = []
    if (url.includes('/api/business/bootstrap')) data = { ...businessUser, tools: [batchTool] }
    else if (url.includes('/api/business/batches')) data = route.request().method() === 'POST' ? { id: 'controlled-server-batch' } : []
    else if (url.includes('/api/auth/me') || url.includes('/api/staff/auth/me')) data = user
    else if (url.includes('/api/tools')) data = [{ ...batchTool, capability_tags: ['自动填报', '页面核验', '结果确认'] }]
    else if (url.includes('/api/admin/action-center')) data = {
      summary: { expiring_authorizations: 2, device_anomalies: 1, pending_tickets: 3, waiting_interventions: 1, stale_batches: 0, expense_renewals_due: 1 },
      expiring_authorizations: [{ id: 1, code_masked: 'BUSI***001', expires_at: new Date(Date.now() + 86400000).toISOString() }],
      device_anomalies: [], pending_tickets: [], stale_batches: [],
      waiting_interventions: [{ batch_id: 1, tool_name: '注册自动处理', account_label_masked: '客***甲', intervention_type: 'captcha', updated_at: new Date().toISOString() }],
      expense_renewals: [{ id: 1, name: '云服务续费', vendor: '云服务商', default_amount: 128, category_name: '服务器/云服务', next_due_on: new Date().toISOString().slice(0, 10), due_state: 'due' }],
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) })
  })
}

async function expectNoOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
}

for (const width of [1365, 1024, 768]) {
  test(`B端四个路由在 ${width}px 无页面级横向溢出`, async ({ page }) => {
    await mockControlPlane(page, 'business')
    await page.setViewportSize({ width, height: 768 })
    for (const path of ['overview', 'workspace', 'records', 'license']) {
      await page.goto(`/#/business/${path}`, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('.business-layout')).toBeVisible()
      await expectNoOverflow(page)
    }
  })
}

test('C端即使工具配置支持批量，也不出现批量入口', async ({ page }) => {
  await mockControlPlane(page, 'consumer')
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto('/#/user/tools', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.toolbox-page')).toBeVisible()
  await expect(page.getByText('批量工作台')).toHaveCount(0)
  await expect(page.getByText('成功率')).toHaveCount(0)
  await expectNoOverflow(page)
})

test('网页保留真实目录和桌面要求，但不会展示内部演示或启动批次', async ({ page }) => {
  await mockControlPlane(page, 'business')
  const writes: Request[] = []
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET') writes.push(request)
  })
  await page.goto('/#/business/workspace', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: new RegExp(batchTool.name) }).click()
  await expect(page.getByText('真实批量执行需要 KST 桌面端', { exact: true })).toBeVisible()
  await expect(page.getByTestId('business-file-upload')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /一键载入演示数据|开始批量演示|开始批量执行/ })).toHaveCount(0)
  expect(writes).toEqual([])
})

test('桌面桥接 fixture 导入客户资料后准备页可滚动到真实执行按钮', async ({ page }) => {
  await mockControlPlane(page, 'business')
  await installControlledBatchBridge(page, Array.from({ length: 8 }, (_, index) => `客户***${index + 1}`))
  await page.setViewportSize({ width: 1365, height: 720 })
  await page.goto('/#/business/workspace', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: new RegExp(batchTool.name) }).click()
  await expect(page.getByRole('button', { name: /一键载入演示数据|开始批量演示/ })).toHaveCount(0)
  await page.getByTestId('business-file-upload').click()

  const workspace = page.getByTestId('business-workspace-page')
  const startButton = page.getByRole('button', { name: '开始批量执行' })
  await expect(startButton).toBeEnabled()
  await expect.poll(() => workspace.evaluate(element => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }))).toMatchObject({ overflowY: 'auto' })
  await startButton.scrollIntoViewIfNeeded()
  await expect(startButton).toBeInViewport()
})

test('隔离桌面桥接中的真实生产 Worker 匹配非首张工作表，八行脱敏且原文不上传', async ({ page }) => {
  await mockControlPlane(page, 'business')
  const tool = {
    ...batchTool,
    id: 'tool_logistics_standard', name: '物流模板验证工具',
    capability_key: 'logistics_standard', platform_key: 'amazon',
    availability: 'live_beta',
  }
  await page.route('**/api/business/bootstrap', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, data: { ...businessUser, tools: [tool] } }),
  }))
  const apiRequests: Request[] = []
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request)
  })
  await installControlledBatchBridge(page, [], true)

  await page.setViewportSize({ width: 1365, height: 900 })
  await page.goto('/#/business/workspace', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: new RegExp(tool.name) }).click()
  const workerStarted = page.waitForEvent('worker')
  const chooserOpened = page.waitForEvent('filechooser')
  await page.getByTestId('business-file-upload').click()
  await (await chooserOpened).setFiles(resolve('resources/templates/B端批量自动化测试数据.xlsx'))
  expect((await workerStarted).url()).toContain('spreadsheet.worker-')

  const expectedLabels = Array.from({ length: 8 }, (_, index) => `模板***${String(index + 1).padStart(2, '0')}`)
  await expect(page.locator('.selected-import')).toContainText('已匹配工作表：物流模板 · 模板 1.0.0')
  await expect(page.locator('.import-result')).toHaveText('8 行通过字段检查')
  await expect(page.locator('.preview-list > div:not(.more-row) > span')).toHaveText(expectedLabels.slice(0, 6))
  await expect(page.locator('.preview-list .more-row')).toHaveText('还有 2 行未展开')
  const replies = await page.evaluate(() => (window as typeof window & { __spreadsheetWorkerReplies: unknown[] }).__spreadsheetWorkerReplies)
  expect(replies).toHaveLength(1)
  expect(replies[0]).toMatchObject({
    ok: true,
    result: {
      fileName: 'B端批量自动化测试数据.xlsx', worksheetName: '物流模板', templateVersion: '1.0.0',
      validCount: 8, errorCount: 0,
      rows: expectedLabels.map(account_label => ({ preview: { account_label } })),
    },
  })

  await page.getByRole('button', { name: '开始批量执行' }).click()
  const runConsole = page.getByTestId('business-run-console')
  await expect(runConsole.locator('tbody tr')).toHaveCount(8)
  await expect(runConsole.locator('.account-cell strong')).toHaveText(expectedLabels)
  await expect(runConsole.locator('.sync-state')).toHaveText('状态已同步')
  const createRequest = apiRequests.find(request => new URL(request.url()).pathname === '/api/business/batches' && request.method() === 'POST')
  expect(createRequest?.postDataJSON()).toEqual({
    client_batch_id: expect.stringMatching(/^batch_/), tool_id: tool.id, tool_name: tool.name, total_count: 8,
  })
  const transferred = apiRequests.map(request => `${request.url()}\n${request.postData() || ''}`).join('\n')
  const rendered = await page.locator('body').innerText()
  for (let index = 1; index <= 8; index += 1) {
    const customerLabel = `模板演示-${String(index).padStart(2, '0')}`
    expect(transferred).not.toContain(customerLabel)
    expect(transferred).not.toContain(`赛训物流模板 ${index}`)
    expect(rendered).not.toContain(customerLabel)
  }
  expect(apiRequests.filter(request => new URL(request.url()).pathname === '/api/business/batches' && request.method() === 'POST')).toHaveLength(1)
  expect(apiRequests.some(request => new URL(request.url()).pathname.startsWith('/api/demo/') && request.method() !== 'GET')).toBe(false)
})

test('隔离桌面桥接的真实批次总览可滚动、筛选并关闭详情', async ({ page }, testInfo) => {
  await mockControlPlane(page, 'business')
  await installControlledBatchBridge(page, Array.from({ length: 8 }, (_, index) => `客户***${index + 1}`))

  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/#/business/workspace', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: new RegExp(batchTool.name) }).click()
  await page.getByTestId('business-file-upload').click()
  await page.getByRole('button', { name: '开始批量执行' }).click()

  const console = page.getByTestId('business-run-console')
  await expect(console).toBeVisible()
  await expect(console.getByText('账号执行总览')).toBeVisible()
  await expect(console.locator('tbody tr')).toHaveCount(8)
  await expect(console.getByRole('button', { name: '结束批次' })).toBeInViewport()
  await expectNoOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('run-console-1280x720.png') })

  await console.locator('tbody tr').first().click()
  await expect(page.getByRole('dialog', { name: '账号执行详情' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('run-console-detail-1280x720.png') })
  await page.keyboard.press('Escape')
  await expect(page.locator('.detail-layer')).not.toHaveClass(/open/)

  await console.getByRole('button', { name: /运行中/ }).click()
  await expect(console.locator('tbody tr')).toHaveCount(8)
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1600, height: 900 }]) {
    await page.setViewportSize(viewport)
    await expect(console.getByRole('button', { name: '结束批次' })).toBeInViewport()
    await expectNoOverflow(page)
    await page.screenshot({ path: testInfo.outputPath(`run-console-${viewport.width}x${viewport.height}.png`) })
  }
})

test('管理员行动中心在 1024 和 768 下保持完整卡片矩阵', async ({ page }) => {
  await mockControlPlane(page, 'super_admin')
  for (const width of [1024, 768]) {
    await page.setViewportSize({ width, height: 768 })
    await page.goto('/#/admin/dashboard', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.summary-card')).toHaveCount(5)
    await expect(page.getByText('工具成功率')).toHaveCount(0)
    await expectNoOverflow(page)
  }
})
