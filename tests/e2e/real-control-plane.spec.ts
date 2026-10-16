import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const runtime = process.env.KST_REAL_E2E_DIR!
const credentials = JSON.parse(readFileSync(join(runtime, 'credentials.json'), 'utf8')) as {
  consumer: string; business: string; business_cancel: string; staff_username: string; staff_password: string
  agent_a_username: string; agent_a_password: string; agent_b_username: string; agent_b_password: string
  agency_a_id: number; agency_b_id: number
}

interface DatabaseSnapshot {
  runs: Array<{ status: string; completed_step_count: number; total_step_count: number }>
  batches: Array<{ id: string; status: string; row_count: number; queued_count: number; playing_count: number; played_count: number; skipped_count: number; error_count: number }>
  items: Array<{ batch_id: string; status: string; simulated_outcome: string | null }>
  expenses: Array<{ title: string; amount: number; status: string; renewal_id: number | null }>
  occurrences: Array<{ status: string; expense_id: number | null }>
  attachments: Array<{ original_name: string; size_bytes: number }>
  authorizations: Array<{ status: string }>
  live_run_count: number; live_batch_count: number; device_count: number
}

function database(): DatabaseSnapshot {
  return JSON.parse(execFileSync(process.env.TOOLBOX_PYTHON!, [resolve('scripts/real-e2e-fixture.py'), 'snapshot'], {
    encoding: 'utf8', windowsHide: true,
  })) as DatabaseSnapshot
}

async function authorize(page: Page, identity: 'consumer' | 'business' | 'business_cancel'): Promise<void> {
  await page.goto('/#/user/login')
  await page.getByLabel('授权码', { exact: true }).fill(credentials[identity])
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/verify' && r.request().method() === 'POST')
  await page.getByRole('button', { name: '登录并开始使用' }).click()
  expect((await response).status()).toBe(200)
  await expect(page).toHaveURL(identity === 'consumer' ? /#\/user\/tools/ : /#\/business\/overview/)
}

async function api(page: Page, path: string): Promise<unknown> {
  const token = await page.evaluate(() => sessionStorage.getItem('toolbox_token'))
  expect(token).toBeTruthy()
  const response = await page.request.get(path, { headers: { Authorization: `Bearer ${token}` } })
  expect(response.ok(), `${path} should be served by the real backend`).toBe(true)
  return response.json()
}

interface DemoBatch {
  id: string; status: string; record_kind: 'demo'; row_count: number; event_seq: number
  items: Array<{ item_ref: string; status: string; event_seq: number; simulated_outcome: string | null }>
}

const acceptedDemoPayloads = new WeakMap<Page, string[]>()

async function demoMutation<T>(page: Page, path: string, method: 'POST' | 'PATCH' | 'PUT', data: Record<string, unknown>, status = 200, idempotencyKey?: string): Promise<T> {
  // This is test-owned historical data in the fixture's SQLite database,
  // authenticated by the real UI login. It does not launch a product tool.
  expect(path).toMatch(/^\/api\/demo\//)
  const token = await page.evaluate(() => sessionStorage.getItem('toolbox_token'))
  expect(token).toBeTruthy()
  const response = await page.request.fetch(path, {
    method, data,
    headers: { Authorization: `Bearer ${token}`, ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
  })
  expect(response.status(), `${method} ${path} should use the real isolated API`).toBe(status)
  if (response.ok()) {
    const payloads = acceptedDemoPayloads.get(page) || []
    payloads.push(JSON.stringify(data))
    acceptedDemoPayloads.set(page, payloads)
  }
  return response.json() as Promise<T>
}

function expectMetadataOnly(page: Page, value: unknown): void {
  const serialized = `${JSON.stringify(value)}\n${(acceptedDemoPayloads.get(page) || []).join('\n')}`
  expect(serialized).not.toMatch(/模板演示账号|password|cookie|@example|account_label|import_rows/)
  for (const secret of Object.values(credentials).filter((value): value is string => typeof value === 'string')) {
    expect(serialized).not.toContain(secret)
  }
  expect(database().live_run_count).toBe(0)
  expect(database().live_batch_count).toBe(0)
}

async function expectNoPublicDemo(page: Page, scope: 'consumer' | 'business'): Promise<void> {
  if (scope === 'consumer') {
    await expect(page.getByTestId('tools-page')).toBeVisible()
    const tools = await api(page, '/api/tools') as Array<{ name: string; availability: string }>
    const demos = tools.filter(tool => tool.availability === 'demo_only')
    expect(demos.length).toBeGreaterThan(0)
    for (const tool of demos) await expect(page.getByTestId(`tool-card-${tool.name}`)).toHaveCount(0)
    await expect(page.getByRole('button', { name: /开始.*演示|重新.*演示/ })).toHaveCount(0)
    return
  }
  await expect(page.locator('.business-overview')).toBeVisible()
  await page.getByRole('complementary', { name: '专业批量工作台导航' })
    .getByRole('link', { name: '批量工作台', exact: true }).click()
  await expect(page).toHaveURL(/#\/business\/workspace/)
  await expect(page.getByTestId('business-workspace-page')).toBeVisible()
  await expect(page.getByRole('heading', { name: '当前还没有开放的批量工具' })).toBeVisible()
  await expect(page.getByRole('button', { name: '开始批量演示', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /自动上广告脚本/ })).toHaveCount(0)
  await expect(page.getByTestId('business-file-upload')).toHaveCount(0)
}

async function createHistoryBatch(page: Page, key: string): Promise<DemoBatch> {
  const data = { tool_id: 'tool_ad_script', tool_name: '自动上广告脚本', platform_key: 'amazon', scenario_id: 'ad_script_walkthrough_v1', row_count: 8 }
  const batch = await demoMutation<DemoBatch>(page, '/api/demo/batches', 'POST', data, 201, key)
  expect(batch).toMatchObject({ status: 'created', record_kind: 'demo', row_count: 8 })
  expect(batch.items).toHaveLength(8)
  const repeated = await demoMutation<DemoBatch>(page, '/api/demo/batches', 'POST', data, 201, key)
  expect(repeated.id).toBe(batch.id)
  expect(repeated.items.map(item => item.item_ref)).toEqual(batch.items.map(item => item.item_ref))
  return demoMutation<DemoBatch>(page, `/api/demo/batches/${batch.id}`, 'PATCH', { event_seq: 1, status: 'running' })
}

async function finishHistoryBatch(page: Page, batch: DemoBatch): Promise<DemoBatch> {
  for (const [index, item] of batch.items.entries()) {
    await demoMutation(page, `/api/demo/batches/${batch.id}/items/${item.item_ref}`, 'PUT', { event_seq: 1, status: 'playing' })
    const outcome = (['completed_example', 'attention_example', 'failure_example'] as const)[index % 3]!
    await demoMutation(page, `/api/demo/batches/${batch.id}/items/${item.item_ref}`, 'PUT', {
      event_seq: 2, status: outcome === 'failure_example' ? 'error' : 'played', simulated_outcome: outcome,
    })
  }
  return demoMutation<DemoBatch>(page, `/api/demo/batches/${batch.id}/finish`, 'POST', { event_seq: 2 })
}

async function openDemoHistory(page: Page): Promise<void> {
  await page.goto('/#/business/records')
  await expect(page.getByText('还没有真实批次记录', { exact: true })).toBeVisible()
  await expect(page.locator('.records-list article')).toHaveCount(0)
  await expect(page.getByRole('tab', { name: '历史演示', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /再次演示|开始演示/ })).toHaveCount(0)
}

const browserErrors = new WeakMap<Page, string[]>()
test.beforeEach(async ({ page }) => {
  // Observe errors; deliberately no page.route, fake electronAPI, auth storage
  // injection or mocked responses. Credentials go through the actual forms.
  const errors: string[] = []
  browserErrors.set(page, errors)
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    const url = new URL(request.url())
    if (['http:', 'https:'].includes(url.protocol) && url.hostname !== '127.0.0.1') errors.push(`Unexpected external request: ${url.origin}`)
  })
})
test.afterEach(async ({ page }) => { expect(browserErrors.get(page)).toEqual([]) })

test.afterAll(() => {
  const snapshot = database()
  writeFileSync(join(runtime, 'database-evidence.json'), JSON.stringify(snapshot, null, 2))
})

test('新框架商品与成员分配使用真实隔离后端，默认不激活、不自动分配', async ({ page }) => {
  await page.goto('/#/admin/login')
  await page.getByLabel('后台账号', { exact: true }).fill(credentials.staff_username)
  await page.getByLabel('密码', { exact: true }).fill(credentials.staff_password)
  await page.getByRole('button', { name: '登录并进入工作台' }).click()
  await expect(page).toHaveURL(/#\/admin\/dashboard/)
  await page.goto('/#/admin/commercial')
  await expect(page.getByRole('heading', { name: '管理可售套餐与服务' })).toBeVisible()
  await expect(page.getByText('尚无新商品。可先导入草稿，旧套餐不受影响。')).toBeVisible()
  await page.getByRole('button', { name: '导入标准商品草稿' }).click()
  await expect(page.getByText('标准商品已保存为草稿，尚未启用')).toBeVisible()
  const basic = page.locator('tr').filter({ hasText: 'competition-basic' })
  await expect(basic).toContainText('草稿')
  await basic.getByRole('button', { name: '确认启用' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click()
  // Activating switches the catalog filter to “已启用”; the row itself now
  // shows the package details and actions without repeating the status label.
  await expect(page.getByRole('group', { name: '按套餐状态查看' }).getByRole('button', { name: /已启用/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('tr').filter({ hasText: 'competition-basic' })).toBeVisible()
  const offers = await api(page, '/api/commercial/offers') as { data: Array<{ id: number; sku: string }> }
  const offerId = offers.data.find(item => item.sku === 'competition-basic')!.id
  await page.getByRole('combobox', { name: /^已启用商品/ }).selectOption(String(offerId))
  await page.getByLabel('项目编号', { exact: true }).fill('isolated-framework-project')
  await page.getByLabel('适用平台网址').fill('https://www.idtrade.cn')
  await page.getByLabel('结束时间（本机时区）', { exact: true }).fill('2027-01-01T17:00')
  await page.getByRole('button', { name: '建立待收款订单' }).click()
  await expect(page.getByRole('button', { name: '确认收款', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '确认收款', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByRole('button', { name: '确认收款', exact: true })).toHaveCount(0)
  const orders = await api(page, '/api/commercial/orders') as { data: Array<{ id: number; status: string }> }
  expect(orders.data).toHaveLength(1)
  expect(orders.data[0]!.status).toBe('paid')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.screenshot({ path: join(runtime, 'framework-commercial.png'), fullPage: true })
  await page.goto('/#/admin/team-ledger')
  await expect(page.getByRole('heading', { name: '成员结算台账' })).toBeVisible()
  await page.getByTestId('ledger-settlement-settings').locator('summary').click()
  await page.getByRole('combobox', { name: /^新商品已收款订单/ }).selectOption(String(orders.data[0]!.id))
  await expect(page.getByLabel('本次分配金额（手工填写）', { exact: true })).toHaveValue('')
  const entriesBefore = await api(page, '/api/team-ledger/entries') as { data: unknown[] }
  expect(entriesBefore.data).toEqual([])
  await page.getByLabel('本次分配金额（手工填写）', { exact: true }).fill('20.00')
  await page.getByLabel('结算期', { exact: true }).first().fill('2026-10')
  await page.getByLabel('金额说明', { exact: true }).fill('隔离环境人工确认分配')
  await page.getByRole('button', { name: '保存分配金额' }).click()
  await expect(page.getByText('分配金额已保存，尚未记入成员收入')).toBeVisible()
  const entriesAfter = await api(page, '/api/team-ledger/entries') as { data: unknown[] }
  expect(entriesAfter.data).toEqual([])
  await page.screenshot({ path: join(runtime, 'framework-ledger.png'), fullPage: true })
  await page.goto('/#/admin/scenarios')
  await expect(page.getByRole('heading', { name: '使用范围与账号权限' })).toBeVisible()
  await page.getByRole('button', { name: '新增使用范围', exact: true }).click()
  await page.getByRole('combobox', { name: '使用方式', exact: true }).selectOption('competition')
  await expect(page.getByLabel('平台入口', { exact: true })).toHaveValue('https://www.idtrade.cn/User/Contest')
  await page.screenshot({ path: join(runtime, 'framework-scenarios.png'), fullPage: true })
  await page.goto('/#/admin/local-runtime')
  await expect(page.getByRole('heading', { name: '账号工作区' })).toBeVisible()
  await expect(page.getByText('请在课赛通桌面客户端打开本机工作台，浏览器预览不能创建账号现场。')).toBeVisible()
  await page.screenshot({ path: join(runtime, 'framework-local-runtime-web-boundary.png'), fullPage: true })
})

test('C 端真实授权激活、历史演示 API 留档与普通入口隐藏，不越权进入 B 端', async ({ page }) => {
  await authorize(page, 'consumer')
  expect(database().authorizations.filter(row => row.status === 'active')).toHaveLength(1)
  expect(database().device_count).toBe(1)
  const token = await page.evaluate(() => sessionStorage.getItem('toolbox_token'))
  const forbidden = await page.request.get('/api/business/bootstrap', { headers: { Authorization: `Bearer ${token}` } })
  expect(forbidden.status()).toBe(403)
  const forbiddenBatch = await page.request.post('/api/demo/batches', {
    headers: { Authorization: `Bearer ${token}` },
    data: { tool_id: 'tool_ad_script', tool_name: '自动上广告脚本', platform_key: 'amazon', scenario_id: 'ad_script_walkthrough_v1', row_count: 1 },
  })
  expect(forbiddenBatch.status()).toBe(403)
  expect((await page.request.get('/api/demo/batches', { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(403)
  expect(database().batches).toHaveLength(0)
  await expectNoPublicDemo(page, 'consumer')
  // The fixture retains internal demo APIs for historical records. Neither
  // this setup nor the customer UI is evidence of a business Live execution.
  const data = { tool_id: 'tool_logistics_standard', tool_name: '物流模板标准版', platform_key: 'amazon', scenario_id: 'logistics_standard_walkthrough_v1', total_step_count: 3 }
  const created = await demoMutation<{ id: string; record_kind: string }>(page, '/api/demo/runs', 'POST', data, 201, 'consumer-historical-run')
  expect(created.record_kind).toBe('demo')
  const repeated = await demoMutation<{ id: string }>(page, '/api/demo/runs', 'POST', data, 201, 'consumer-historical-run')
  expect(repeated.id).toBe(created.id)
  await demoMutation(page, `/api/demo/runs/${created.id}`, 'PATCH', { event_seq: 1, status: 'running', completed_step_count: 1 })
  const finished = await demoMutation(page, `/api/demo/runs/${created.id}/finish`, 'POST', { event_seq: 2, completed_step_count: 3, simulated_outcome: 'completed_example' })
  expectMetadataOnly(page, finished)
  expect(database().runs.filter(row => row.status === 'completed')).toHaveLength(1)
  const run = database().runs[0]!
  expect(run.completed_step_count).toBe(run.total_step_count)
  await page.reload()
  await expectNoPublicDemo(page, 'consumer')
  const runs = await api(page, '/api/demo/runs') as { data: Array<{ id: string; status: string }> }
  expect(runs.data).toHaveLength(1)
  expect(runs.data[0]).toMatchObject({ id: created.id, status: 'completed' })
  await page.screenshot({ path: join(runtime, 'consumer-demo-hidden.png'), fullPage: true })
})

test('B 端兼容 API 保留八项历史演示，客户记录不展示或导出旧演示', async ({ page }) => {
  await authorize(page, 'business')
  await expectNoPublicDemo(page, 'business')
  const history = await finishHistoryBatch(page, await createHistoryBatch(page, 'business-completed-history'))
  const batchId = history.id
  expect(history.status).toBe('completed')
  const batch = database().batches.find(row => row.id === batchId)!
  expect(batch.row_count).toBe(8)
  expect(batch.queued_count + batch.playing_count).toBe(0)
  expect(batch.played_count + batch.error_count + batch.skipped_count).toBe(8)
  const items = database().items.filter(row => row.batch_id === batchId)
  expect(items).toHaveLength(8)
  expect(new Set(items.map(row => row.simulated_outcome))).toEqual(new Set(['completed_example', 'attention_example', 'failure_example']))
  expect(items.every(row => ['played', 'error', 'skipped'].includes(row.status))).toBe(true)
  expectMetadataOnly(page, history)
  await page.goto('/#/business/overview')
  await expect(page.locator('.business-overview')).toBeVisible()
  await expect(page.locator('.attention-card')).toHaveCount(0)
  await expect(page.locator('.batch-count')).toHaveCount(0)
  await expect(page.getByText('还没有真实批次记录', { exact: true })).toBeVisible()
  await page.goto('/#/business/license')
  await expect(page.locator('.limits-grid')).toContainText('已授权')
  await expect(page.locator('.limits-grid')).toContainText('1 / 5 台设备')
  await page.getByRole('button', { name: '刷新授权', exact: true }).click()
  await expect(page.locator('.limits-grid')).toContainText('1 / 5 台设备')
  await openDemoHistory(page)
  await expect(page.getByRole('button', { name: '导出脱敏结果', exact: true })).toHaveCount(0)
  await page.screenshot({ path: join(runtime, 'business-demo-history-hidden.png'), fullPage: true })
  await page.reload()
  // Old compatibility data remains stored but never becomes customer results.
  await expect(page.getByText('还没有真实批次记录', { exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: '历史演示', exact: true })).toHaveCount(0)
  const persisted = await api(page, `/api/demo/batches/${batchId}`) as { status: string; items: unknown[] }
  expect(persisted.status).toBe('completed')
  expect(persisted.items).toHaveLength(8)
})

test('B 端历史取消终态与新记录独立，事件重传不重建批次且跨授权不可读', async ({ page, context }) => {
  await authorize(page, 'business_cancel')
  await expectNoPublicDemo(page, 'business')
  const previous = database().batches.find(row => row.status === 'completed')!
  expect(previous).toBeTruthy()
  const token = await page.evaluate(() => sessionStorage.getItem('toolbox_token'))
  expect((await page.request.get(`/api/demo/batches/${previous.id}`, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(404)
  const first = await createHistoryBatch(page, 'business-cancelled-history')
  await demoMutation(page, `/api/demo/batches/${first.id}/items/${first.items[0]!.item_ref}`, 'PUT', { event_seq: 1, status: 'playing' })
  const before = database().batches.length
  const cancelledHistory = await demoMutation<DemoBatch>(page, `/api/demo/batches/${first.id}`, 'PATCH', { event_seq: 2, status: 'cancelled' })
  const repeated = await demoMutation<DemoBatch>(page, `/api/demo/batches/${first.id}`, 'PATCH', { event_seq: 2, status: 'cancelled' })
  expect(repeated).toEqual(cancelledHistory)
  expect(database().batches).toHaveLength(before)
  const cancelled = database().batches.find(row => row.id === first.id)!
  expect(cancelled.queued_count + cancelled.playing_count).toBe(0)
  expect(cancelled.skipped_count).toBeGreaterThan(0)
  await page.reload()
  await expect(page.getByTestId('business-workspace-page')).toBeVisible()
  await expect(page.getByRole('button', { name: '开始批量演示', exact: true })).toHaveCount(0)
  const second = await finishHistoryBatch(page, await createHistoryBatch(page, 'business-new-history'))
  expect(second.id).not.toBe(first.id)
  expectMetadataOnly(page, second)
  await openDemoHistory(page)
  const own = await api(page, '/api/demo/batches') as { data: Array<{ id: string }>; total: number }
  expect(own.total).toBe(2)
  expect(new Set(own.data.map(row => row.id))).toEqual(new Set([first.id, second.id]))
  const other = await context.newPage()
  try {
    await authorize(other, 'business')
    const otherToken = await other.evaluate(() => sessionStorage.getItem('toolbox_token'))
    expect(otherToken).not.toBe(token)
    expect((await other.request.get(`/api/demo/batches/${first.id}`, { headers: { Authorization: `Bearer ${otherToken}` } })).status()).toBe(404)
    expect((await api(other, '/api/demo/batches') as { total: number }).total).toBe(1)
    expect((await api(page, '/api/demo/batches') as { total: number }).total).toBe(2)
  } finally {
    await other.close()
  }
})

test('B 端离线历史读取不伪称自动恢复，联网重读保留取消终态且不重跑', async ({ page, context }) => {
  await authorize(page, 'business_cancel')
  await expectNoPublicDemo(page, 'business')
  await openDemoHistory(page)
  const before = database()
  await context.setOffline(true)
  try {
    await page.getByRole('button', { name: '刷新', exact: true }).click()
    await expect(page.getByRole('button', { name: '重新加载', exact: true })).toBeVisible()
    await expect(page.locator('.records-page')).not.toContainText('自动恢复')
    expect(database().batches).toEqual(before.batches)
    expect(database().items).toEqual(before.items)
    // Destroy the app while offline, then load the same persisted history.
    // This is a read retry, not queued cancellation replay or Runner recovery.
    await page.goto('about:blank')
  } finally {
    await context.setOffline(false)
  }
  await openDemoHistory(page)
  expect(database().batches).toEqual(before.batches)
  expect(database().items).toEqual(before.items)
  expectMetadataOnly(page, await api(page, '/api/demo/batches'))
})

test('后台真实登录、支出记账、创建续费及确认入账，汇总与数据库一致', async ({ page }) => {
  await page.goto('/#/admin/login')
  await page.getByLabel('后台账号', { exact: true }).fill(credentials.staff_username)
  await page.getByLabel('密码', { exact: true }).fill(credentials.staff_password)
  await page.getByRole('button', { name: '登录并进入工作台' }).click()
  await expect(page).not.toHaveURL(/admin\/login/)
  await page.goto('/#/admin/expenses')
  await expect(page.getByRole('heading', { name: '公账支出' })).toBeVisible()
  await page.getByRole('button', { name: '记一笔支出' }).click()
  let drawer = page.locator('.el-drawer').last()
  await expect(drawer.locator('.el-select').first()).toContainText('开发')
  await drawer.locator('.el-input-number input').fill('320.50')
  await drawer.getByPlaceholder('例如：7 月阿里云服务器').fill('隔离验收云服务')
  const receipt = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1cAAAAASUVORK5CYII=', 'base64')
  await drawer.locator('input[type="file"]').setInputFiles({ name: 'isolated-receipt.png', mimeType: 'image/png', buffer: receipt })
  const expenseSaved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/expenses' && response.request().method() === 'POST')
  await drawer.getByRole('button', { name: '确认入账' }).click()
  expect((await expenseSaved).ok()).toBe(true)
  await expect(page.getByText('隔离验收云服务', { exact: true })).toBeVisible()
  await expect(page.getByText('¥320.50', { exact: true }).first()).toBeVisible()
  expect(database().attachments).toEqual([{ original_name: 'isolated-receipt.png', size_bytes: receipt.length }])
  await page.getByText('隔离验收云服务', { exact: true }).click()
  drawer = page.locator('.el-drawer').last()
  await expect(drawer.getByText('isolated-receipt.png')).toBeVisible()
  const downloaded = page.waitForEvent('download')
  await drawer.getByRole('button', { name: '下载', exact: true }).click()
  const download = await downloaded
  expect(download.suggestedFilename()).toBe('isolated-receipt.png')
  const savedReceipt = join(runtime, 'downloaded-receipt.png')
  await download.saveAs(savedReceipt)
  expect(readFileSync(savedReceipt).equals(receipt)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(drawer).not.toBeVisible()
  await page.getByRole('tab', { name: /续费项目/ }).click()
  await page.getByRole('button', { name: '新建续费项目' }).click()
  drawer = page.locator('.el-drawer').last()
  await expect(drawer.locator('.el-select').first()).toContainText('工具会员')
  await drawer.getByPlaceholder('例如：Figma Professional').fill('隔离验收工具会员')
  await drawer.locator('.el-input-number input').first().fill('99.00')
  await drawer.getByRole('button', { name: '创建项目' }).click()
  await expect(page.getByText('隔离验收工具会员', { exact: true }).first()).toBeVisible()
  expect(database().expenses).toHaveLength(1)
  await page.getByRole('button', { name: '确认续费' }).first().click()
  drawer = page.locator('.el-drawer').last()
  await drawer.locator('.el-input-number input').fill('118.00')
  await drawer.getByRole('button', { name: '确认续费并入账' }).click()
  await expect(page.getByText('¥438.50', { exact: true }).first()).toBeVisible()
  expect(database().expenses).toHaveLength(2)
  expect(database().expenses.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(438.5)
  expect(database().occurrences).toHaveLength(1)
  expect(database().occurrences[0]?.status).toBe('paid')
  await page.reload()
  await expect(page.getByText('¥438.50', { exact: true }).first()).toBeVisible()
  await page.screenshot({ path: join(runtime, 'admin-expenses-persisted.png'), fullPage: true })
})

test('代理真实交付闭环：建档、提交订单、负责人收款发放、售后回复及跨代理隔离', async ({ page, context }) => {
  test.setTimeout(150_000)
  const customerName = '隔离代理 A 交付客户'
  const supportContent = '隔离验收：客户已取得授权，请协助说明首次安装步骤。'
  const supportReply = '已提供首次安装指引，客户可使用授权在本机登录。'
  const loginStaff = async (target: Page, username: string, password: string, destination: RegExp): Promise<void> => {
    await target.goto('/#/admin/login')
    await target.getByLabel('后台账号', { exact: true }).fill(username)
    await target.getByLabel('密码', { exact: true }).fill(password)
    const login = target.waitForResponse(response => new URL(response.url()).pathname === '/api/staff/auth/login' && response.request().method() === 'POST')
    await target.getByRole('button', { name: '登录并进入工作台' }).click()
    expect((await login).ok()).toBe(true)
    await expect(target).toHaveURL(destination)
  }
  await loginStaff(page, credentials.agent_a_username, credentials.agent_a_password, /#\/agent\/overview/)
  await page.getByRole('navigation', { name: '代理导航' }).getByRole('link', { name: '我的客户', exact: true }).click()
  await page.getByRole('button', { name: '登记客户', exact: true }).click()
  let drawer = page.locator('.el-drawer:visible').last()
  await drawer.getByPlaceholder('用于识别和交付的名称').fill(customerName)
  await drawer.getByPlaceholder('微信、手机号或邮箱').fill('isolated-customer@example.invalid')
  const createdCustomer = page.waitForResponse(response => new URL(response.url()).pathname === '/api/agency/customers' && response.request().method() === 'POST')
  await drawer.getByRole('button', { name: '保存提交' }).click()
  const customerResponse = await createdCustomer
  expect(customerResponse.status()).toBe(201)
  const customer = (await customerResponse.json() as { data: { id: number; agency_id: number } }).data
  expect(customer.agency_id).toBe(credentials.agency_a_id)
  await expect(page.locator('.el-table__body').getByText(customerName, { exact: true })).toBeVisible()

  await page.getByRole('navigation', { name: '代理导航' }).getByRole('link', { name: '我的订单', exact: true }).click()
  await page.getByRole('button', { name: '提交订单', exact: true }).click()
  drawer = page.locator('.el-drawer:visible').last()
  await drawer.locator('.el-select').nth(0).click()
  await page.getByRole('option', { name: customerName, exact: true }).click()
  await drawer.locator('.el-select').nth(1).click()
  await page.getByRole('option', { name: /Y199/ }).click()
  const createdOrder = page.waitForResponse(response => new URL(response.url()).pathname === '/api/agency/orders' && response.request().method() === 'POST')
  await drawer.getByRole('button', { name: '提交待确认订单' }).click()
  const orderResponse = await createdOrder
  expect(orderResponse.status()).toBe(201)
  const order = (await orderResponse.json() as { data: { id: number; order_no: string; status: string; auth_code: null } }).data
  expect(order.status).toBe('pending')
  expect(order.auth_code).toBeNull()
  const ownOrder = page.locator('.el-table__row').filter({ hasText: order.order_no })
  await expect(ownOrder).toContainText('待确认收款')
  await ownOrder.getByRole('button', { name: '查看详情' }).click()
  await expect(page.getByRole('button', { name: '确认已收款', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')

  // New tabs share the same origin but not the token/profile session.
  const owner = await context.newPage()
  const outsider = await context.newPage()
  try {
    await loginStaff(owner, credentials.staff_username, credentials.staff_password, /#\/admin\/(?!login)/)
    await owner.goto('/#/admin/agency')
    await owner.getByRole('navigation', { name: '代理管理分区' }).getByRole('button', { name: '订单交付' }).click()
    await owner.locator('.el-table__row').filter({ hasText: order.order_no }).getByRole('button', { name: '查看详情' }).click()
    let ownerDrawer = owner.locator('.el-drawer:visible').last()
    await ownerDrawer.getByRole('button', { name: '确认已收款', exact: true }).click()
    const paidResponse = owner.waitForResponse(response => new URL(response.url()).pathname === `/api/agency/orders/${order.id}/mark-paid`)
    await owner.getByRole('button', { name: '已核实，确认收款' }).click()
    expect((await paidResponse).ok()).toBe(true)
    const deliveryResponse = owner.waitForResponse(response => new URL(response.url()).pathname === `/api/agency/orders/${order.id}/deliver`)
    await ownerDrawer.getByRole('button', { name: '发放授权', exact: true }).click()
    const delivered = await deliveryResponse
    expect(delivered.ok()).toBe(true)
    const license = (await delivered.json() as { data: { auth_code: { id: number; code: string } } }).data.auth_code
    expect(license.code.length).toBeGreaterThan(8)
    await expect(ownerDrawer).toContainText('授权已生成')
    await owner.keyboard.press('Escape')

    await page.reload()
    await expect(page).toHaveURL(/#\/agent\/orders/)
    await expect(page.locator('.agent-main > header')).toContainText('隔离代理 A')
    await expect(page.locator('.el-table__row').filter({ hasText: order.order_no })).toContainText('已交付')
    await page.locator('.el-table__row').filter({ hasText: order.order_no }).getByRole('button', { name: '查看详情' }).click()
    drawer = page.locator('.el-drawer:visible').last()
    await expect(drawer.locator('.delivery-block code')).toHaveText(license.code)
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.bringToFront()
    await drawer.getByRole('button', { name: '复制授权码' }).click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(license.code)
    for (const width of [1440, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(drawer.getByRole('button', { name: '复制授权码' })).toBeInViewport()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      await page.screenshot({ path: join(runtime, `agent-delivery-${width}.png`), fullPage: true })
    }
    await page.keyboard.press('Escape')
    await expect(drawer).not.toBeVisible()
    await page.getByRole('navigation', { name: '代理导航' }).getByRole('link', { name: '售后支持', exact: true }).click()
    await page.getByRole('button', { name: '提交售后申请', exact: true }).click()
    drawer = page.locator('.el-drawer:visible').last()
    await drawer.locator('.el-select').nth(0).click()
    await page.getByRole('option', { name: customerName, exact: true }).click()
    await drawer.locator('.el-select').nth(2).click()
    await page.getByRole('option', { name: new RegExp(order.order_no) }).click()
    await drawer.getByPlaceholder('描述问题、期望的处理和必要的背景；不要填写客户密码或授权凭据。').fill(supportContent)
    const createdSupport = page.waitForResponse(response => new URL(response.url()).pathname === '/api/agency/requests' && response.request().method() === 'POST')
    await drawer.getByRole('button', { name: '保存提交' }).click()
    const supportResponse = await createdSupport
    expect(supportResponse.status()).toBe(201)
    const support = (await supportResponse.json() as { data: { id: number; order_id: number } }).data
    expect(support.order_id).toBe(order.id)
    await expect(page.locator('.el-table__row').filter({ hasText: supportContent })).toContainText('待处理')

    await owner.getByRole('navigation', { name: '管理工作区' }).getByRole('link', { name: '售后支持', exact: true }).click()
    await owner.getByRole('navigation', { name: '售后支持页面' }).getByRole('link', { name: '代理售后', exact: true }).click()
    await expect(owner).toHaveURL(/#\/admin\/agency\?section=requests/)
    await owner.locator('.el-table__row').filter({ hasText: supportContent }).getByRole('button', { name: '查看详情' }).click()
    ownerDrawer = owner.locator('.el-drawer:visible').last()
    await ownerDrawer.getByPlaceholder('说明实际处理情况，不把未完成的退款或延期描述为已完成。').fill(supportReply)
    const replied = owner.waitForResponse(response => new URL(response.url()).pathname === `/api/agency/requests/${support.id}` && response.request().method() === 'PATCH')
    await ownerDrawer.getByRole('button', { name: '保存回复' }).click()
    expect((await replied).ok()).toBe(true)
    await page.getByRole('button', { name: '刷新', exact: true }).click()
    const ownSupport = page.locator('.el-table__row').filter({ hasText: supportContent })
    await expect(ownSupport).toContainText('已回复处理')
    await ownSupport.getByRole('button', { name: '查看详情' }).click()
    await expect(page.locator('.el-drawer:visible').last()).toContainText(supportReply)

    await loginStaff(outsider, credentials.agent_b_username, credentials.agent_b_password, /#\/agent\/overview/)
    await outsider.getByRole('navigation', { name: '代理导航' }).getByRole('link', { name: '我的客户', exact: true }).click()
    await expect(outsider.locator('.pagination')).toContainText('共 0 条')
    await expect(outsider.locator('.agent-main')).not.toContainText(customerName)
    const headers = { Authorization: `Bearer ${await outsider.evaluate(() => sessionStorage.getItem('toolbox_token'))}` }
    for (const target of ['customers', 'orders', 'licenses', 'requests']) {
      const response = await outsider.request.get(`/api/agency/${target}`, { headers })
      expect(response.ok()).toBe(true)
      expect(await response.json()).toMatchObject({ data: [], total: 0 })
    }
    for (const target of [`customers/${customer.id}`, `orders/${order.id}`, `licenses/${license.id}`, `requests/${support.id}`]) {
      expect((await outsider.request.get(`/api/agency/${target}`, { headers })).status()).toBe(404)
    }
    expect((await outsider.request.get(`/api/agency/customers?agency_id=${credentials.agency_a_id}`, { headers })).status()).toBe(403)
    expect((await outsider.request.get('/api/expenses', { headers })).status()).toBe(403)
    expect((await outsider.request.post(`/api/agency/orders/${order.id}/mark-paid`, { headers })).status()).toBe(403)
    const exportResponse = await outsider.request.get('/api/agency/orders/export', { headers })
    expect(exportResponse.ok()).toBe(true)
    const exported = await exportResponse.text()
    expect(exported).not.toContain(customerName)
    expect(exported).not.toContain(order.order_no)
    expect(exported).not.toContain(license.code)
    // The owner and Agent A remain independently authenticated after Agent B signs in.
    await page.reload()
    await expect(page.locator('.agent-main > header')).toContainText('隔离代理 A')
    expect(await api(page, '/api/agency/summary')).toMatchObject({ data: { customers: 1, orders: 1, delivered_orders: 1, open_requests: 0 } })
  } finally {
    await owner.close()
    await outsider.close()
  }
})

test('新版套餐真实目录内容对齐并沿用平台视觉，仅展示已启用商品并完成桌面截图', async ({ page, browser }) => {
  test.setTimeout(120_000)
  // Opt-in display fixture only. No approved target profile, launch grant or
  // Runner is created; synthetic selectable metadata is not site acceptance.
  test.skip(process.env.KST_REAL_E2E_UI_CATALOG !== '1', '需要隔离 UI 目录夹具，不改变真实工具开放状态')
  await page.goto('/#/admin/login')
  await page.getByLabel('后台账号', { exact: true }).fill(credentials.staff_username)
  await page.getByLabel('密码', { exact: true }).fill(credentials.staff_password)
  await page.getByRole('button', { name: '登录并进入工作台' }).click()
  await expect(page).toHaveURL(/#\/admin\/dashboard/)
  const token = await page.evaluate(() => sessionStorage.getItem('toolbox_token'))
  const tools = await api(page, '/api/tools') as Record<string, unknown>[]
  const configured = await page.request.put('/api/tools', {
    headers: { Authorization: `Bearer ${token}` }, data: [...tools, {
      id: 'isolated_template_price_fixture', name: '物流模板（隔离目录验收）', module: '物流模块', category: 'operation',
      platform_key: 'amazon', capability_key: 'logistics_standard', availability: 'live_beta', script_status: 'script_ready',
      release_status: 'beta', status: 'online', supports_live_single: true, supports_live_batch: false, supports_batch: false,
      requires_target_profile: true, target_capability: 'template.create.v1', runner_api_version: 2,
      target_url: `${process.env.KST_REAL_E2E_BASE_URL}/isolated-no-approved-target`,
      description: '仅用于隔离报价目录验收；没有已审核入口，不执行真实平台操作。',
    }],
  })
  expect(configured.ok()).toBe(true)
  await page.goto('/#/admin/commercial')
  await page.getByRole('button', { name: '导入标准商品草稿' }).click()
  await expect(page.getByText('标准商品已保存为草稿，尚未启用')).toBeVisible()
  const offers = await api(page, '/api/commercial/offers') as { data: Array<{ id: number; sku: string; status: string }> }
  for (const offer of offers.data.filter(offer => offer.status === 'draft' && offer.sku !== 'single-tool-39')) {
    const row = page.locator('tr').filter({ has: page.getByText(offer.sku, { exact: true }) })
    await row.getByRole('button', { name: '确认启用', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click()
    await expect(row).toContainText('已启用')
  }
  await page.getByRole('combobox', { name: '已审核工具', exact: true }).selectOption('template.create')
  await page.getByRole('button', { name: '保存为草稿', exact: true }).click()
  await expect(page.getByText('单工具已存为草稿')).toBeVisible()
  const single = page.locator('tr').filter({ has: page.getByText('single-template-create', { exact: true }) })
  await single.getByRole('button', { name: '确认启用', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click()
  await expect(single).toContainText('已启用')
  const inactiveTemplate = page.locator('tr').filter({ has: page.getByText('single-tool-39', { exact: true }) })
  await expect(inactiveTemplate).toContainText('草稿')

  const customerContext = await browser.newContext({ baseURL: process.env.KST_REAL_E2E_BASE_URL, viewport: { width: 1440, height: 900 } })
  const customer = await customerContext.newPage()
  const errors: string[] = []
  customer.on('pageerror', error => errors.push(error.message))
  customer.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  customer.on('request', request => {
    const url = new URL(request.url())
    if (['http:', 'https:'].includes(url.protocol) && url.hostname !== '127.0.0.1') errors.push(`Unexpected external request: ${url.origin}`)
  })
  try {
    await authorize(customer, 'consumer')
    await customer.goto('/#/user/plans')
    await expect(customer.getByRole('heading', { name: '套餐与授权', exact: true })).toBeVisible()
    const catalog = await api(customer, '/api/commercial/catalog') as { data: { items: Array<{ sku: string }> } }
    expect(catalog.data.items).toHaveLength(11)
    expect(catalog.data.items.some(item => item.sku === 'single-tool-39')).toBe(false)
    await expect(customer.locator('.pricing-free')).toContainText('三项全部赠送')
    await expect(customer.locator('.pricing-free .pricing-price strong')).toHaveText('0')
    await expect(customer.locator('.pricing-cards article')).toHaveCount(3)
    await expect(customer.locator('.is-recommended')).toHaveCount(1)
    await expect(customer.locator('.is-recommended')).toHaveAttribute('data-plan', 'competition-full')
    await expect(customer.locator('.is-recommended .pricing-price strong')).toHaveText('199')
    await expect(customer.locator('.pricing-single-tool .pricing-single-price strong')).toHaveText('39')
    await expect(customer.locator('.pricing-single-tool .pricing-button-primary')).toHaveCount(0)
    await expect(customer.locator('.pricing-service-list li')).toHaveCount(5)
    await expect(customer.locator('.pricing-included-note')).toContainText('无需重复购买')
    await expect(customer.locator('.license-summary')).toBeVisible()
    // Content is shared with marketing; visual treatment must use the platform's
    // surface, radius and type tokens rather than a separate landing-page hero.
    const platformAppearance = await customer.evaluate(() => {
      const root = getComputedStyle(document.documentElement)
      const trial = getComputedStyle(document.querySelector('.pricing-free')!)
      const license = getComputedStyle(document.querySelector('.license-summary')!)
      const prices = [...document.querySelectorAll('.pricing-price strong')].map(element => getComputedStyle(element).fontSize)
      return {
        surfaceMatches: trial.backgroundColor === license.backgroundColor,
        radiusMatches: trial.borderRadius === root.getPropertyValue('--radius-lg').trim(),
        pricesMatch: prices.every(size => size === root.getPropertyValue('--type-stat-large').trim()),
      }
    })
    expect(platformAppearance).toEqual({ surfaceMatches: true, radiusMatches: true, pricesMatch: true })
    for (const width of [1440, 1024]) {
      await customer.setViewportSize({ width, height: 1000 })
      // Resizing across the sidebar breakpoint starts its natural exit motion.
      // Wait for its final geometry so a passing width check cannot hide overlap.
      if (width <= 1024) {
        await expect.poll(() => customer.locator('.studio-user-sidebar').evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0)
      }
      await expect.poll(() => customer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await expect.poll(() => customer.locator('.commercial-pricing').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      await customer.screenshot({ path: join(runtime, `commercial-pricing-${width}.png`), fullPage: true })
    }
    await customer.getByRole('tab', { name: '课程实训', exact: true }).click()
    await expect(customer.locator('#platform-pricing-panel-training .pricing-price strong')).toHaveText('69')
    await expect(customer.locator('#platform-pricing-panel-competition')).toBeHidden()
    await customer.screenshot({ path: join(runtime, 'commercial-pricing-training-1024.png'), fullPage: true })
    await customer.locator('[data-plan="service-appointment"]').getByRole('button', { name: '咨询预约答疑', exact: true }).click()
    await expect(customer.getByRole('dialog')).toContainText('已有套餐包含额度')
    await expect(customer.getByRole('dialog').getByRole('button', { name: '提交购买咨询', exact: true })).toBeVisible()
    expect(errors).toEqual([])
    expect(database().live_run_count).toBe(0)
    expect(database().live_batch_count).toBe(0)
  } finally {
    await customerContext.close()
  }
})
