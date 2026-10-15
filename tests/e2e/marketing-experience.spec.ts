import { expect, test, type Page } from '@playwright/test'
import type { State } from '../../src/marketing/demo/v2/model'

const storageKey = 'kst-public-simulation:v2'
const tasks = ['product', 'template', 'advertising', 'fba', 'shipping'] as const
type Task = typeof tasks[number]
const audits = new WeakMap<Page, { errors: string[]; requests: string[] }>()
const saved = (page: Page): Promise<State | null> => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null') as State | null, storageKey)

test.beforeEach(async ({ page }) => {
  const audit = { errors: [] as string[], requests: [] as string[] }
  audits.set(page, audit)
  page.on('pageerror', error => audit.errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') audit.errors.push(message.text()) })
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (/^https?:$/.test(url.protocol) && (url.hostname !== '127.0.0.1' || /\/api\//.test(url.pathname))) {
      audit.requests.push(url.href)
      await route.abort()
    } else await route.continue()
  })
})
test.afterEach(async ({ page }) => {
  expect(audits.get(page)?.errors).toEqual([])
  expect(audits.get(page)?.requests).toEqual([])
})

async function openTask(page: Page, task: Task) {
  await page.goto('/tools#experience')
  await page.locator(`[data-experience-task="${task}"]`).click()
  await expect(page.getByTestId('marketing-experience-dialog')).toBeVisible()
  await expect(page.getByTestId('simulation')).toBeVisible()
  await expect(page.getByLabel('选择一键任务', { exact: true })).toHaveValue(task)
  await expect(page.getByTestId('run-status')).toHaveText('就绪')
  await expect(page).toHaveURL(/\/tools#experience$/)
}

async function choosePace(page: Page, pace: 'flow' | 'guided') {
  const settings = page.locator('.kst-demo-settings')
  if ((await settings.getAttribute('open')) === null) await settings.locator('summary').click()
  await page.getByLabel('演示速度', { exact: true }).selectOption(pace)
}

for (const width of [1440, 1280, 768, 390]) {
  test(`tools experience is contained and does not auto-run at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    for (const task of tasks) {
      await openTask(page, task)
      const frame = await page.getByTestId('experience-frame').boundingBox()
      const controls = await page.locator('.kst-demo-panel').boundingBox()
      expect(frame).not.toBeNull()
      expect(controls!.y).toBeGreaterThanOrEqual(frame!.y)
      expect(controls!.x + controls!.width).toBeLessThanOrEqual(width + 1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      expect(await saved(page)).toBeNull()
      if (task === 'product') await page.screenshot({ path: info.outputPath(`experience-${width}.png`) })
      await page.getByTestId('experience-close').click()
      await expect(page.getByTestId('marketing-experience-dialog')).toHaveCount(0)
      await expect(page.locator(`[data-experience-task="${task}"]`)).toBeFocused()
    }
    await expect(page.locator('[data-task-id]')).toHaveCount(8)
    await expect(page.getByTestId('marketing-wechat-contact').getByRole('textbox', { name: '公开微信号' })).toHaveValue('Moweiiong')
    await expect(page).toHaveURL(/\/tools#experience$/)
  })
}

for (const width of [1440, 390]) {
  test(`online experience is discoverable from navigation and the tools first screen at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/')
    const navigation = page.getByTestId('navigation-experience')
    await expect(navigation).toBeVisible()
    await expect(navigation).toBeInViewport({ ratio: 1 })
    await navigation.click()
    await expect(page).toHaveURL(/\/tools#experience$/)
    await page.goto('/tools')
    const start = page.getByTestId('experience-start')
    await expect(start).toBeVisible()
    await expect(start).toBeInViewport({ ratio: 1 })
    await expect(page.locator('.experience-task-action')).toHaveCount(5)
    await page.screenshot({ path: info.outputPath(`experience-entry-${width}.png`) })
    await start.click()
    await expect(page.getByTestId('marketing-experience-dialog')).toBeVisible()
    await expect(page.getByTestId('simulation')).toBeVisible()
    await expect(page.getByTestId('run-status')).toHaveText('就绪')
    await page.getByTestId('experience-close').click()
    await expect(start).toBeFocused()
    await expect(page).toHaveURL(/\/tools$/)
  })
}

for (const width of [1440, 390]) for (const task of tasks) {
  test(`embedded ${task} keeps changes inside the current disposable session at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    await openTask(page, task)
    const originalProductCount = task === 'product' ? await page.locator('[data-parent]').count() : 0
    const backgroundScroll = await page.evaluate(() => window.scrollY)
    await choosePace(page, 'flow')
    await page.locator('[data-action="run"]').click()
    await expect(page.getByTestId('demo-outcome')).toBeVisible({ timeout: 35_000 })
    await expect(page.getByTestId('run-status').filter({ visible: true }).first()).toHaveText('已完成，保存状态核对通过')
    expect(await saved(page)).toBeNull()
    if (task === 'product') await expect(page.getByTestId('demo-outcome')).toContainText('在售 · 2 个子 SKU')
    if (task === 'template') await expect(page.getByTestId('demo-outcome')).toContainText('已保存 · 2 条配送规则')
    if (task === 'advertising') await expect(page.getByTestId('demo-outcome')).toContainText('已安排 · 自动投放')
    if (task === 'fba') await expect(page.getByTestId('demo-outcome')).toContainText('亚马逊配送')
    if (task === 'shipping') await expect(page.getByTestId('demo-outcome')).toContainText('已出库 · 已确认发货')
    await page.locator('[data-action="view-demo-result"]').click()
    await expect(page).toHaveURL(/\/tools#experience$/)
    expect(await page.evaluate(() => window.scrollY)).toBe(backgroundScroll)
    if (task === 'product') {
      await expect(page.getByTestId('product-publish-result')).toBeVisible()
      await expect(page.getByTestId('product-publish-result')).toContainText('商品已发布到本机样例库存')
      await expect(page.getByTestId('product-publish-result')).toBeInViewport()
      await expect(page.locator('[data-parent]')).toHaveCount(1)
      await expect(page.locator('.v2-variant-row')).toHaveCount(2)
    }
    await page.screenshot({ path: info.outputPath(`${task}-${width}-result.png`) })
    await page.getByTestId('experience-close').click()
    await expect(page.getByTestId('simulation')).toHaveCount(0)
    const raw = await page.evaluate(key => localStorage.getItem(key), storageKey)
    expect(raw).toBeNull()
    await page.locator(`[data-experience-task="${task}"]`).click()
    await expect(page.getByTestId('simulation')).toBeVisible()
    expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull()
    await expect(page.getByTestId('run-status')).toHaveText('就绪')
    if (task === 'product') {
      await expect(page.getByTestId('product-publish-result')).toHaveCount(0)
      await expect(page.locator('[data-parent]')).toHaveCount(originalProductCount)
    }
    await page.getByTestId('experience-close').click()
  })
}

test('closing an active demo cancels pending work and restores the tools page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await openTask(page, 'product')
  await choosePace(page, 'guided')
  await page.locator('[data-action="run"]').click()
  await expect(page.locator('.v2-demo-target')).toHaveCount(1)
  const before = await page.evaluate(key => localStorage.getItem(key), storageKey)
  expect(before).toBeNull()
  await page.getByTestId('experience-close').click()
  await expect(page.getByTestId('simulation')).toHaveCount(0)
  await page.waitForTimeout(2400)
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull()
  await page.locator('[data-experience-task="template"]').click()
  await expect(page.getByLabel('选择一键任务', { exact: true })).toHaveValue('template')
  await expect(page.getByTestId('run-status')).toHaveText('就绪')
  await page.getByTestId('experience-close').click()
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
})

for (const width of [1440, 390]) {
  test(`failed demo opens its reason instead of hiding it above the form at ${width}px`, async ({ page }, info) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width, height: 900 })
    await openTask(page, 'product')
    await page.locator('[data-action="run"]').click()
    await expect(page.locator('[name="parentSku"].v2-demo-target')).toHaveCount(1, { timeout: 30_000 })
    await page.getByRole('button', { name: '暂停', exact: true }).click()
    // An actual editable field is changed while paused; a timer must not turn
    // this invalid form into a fake successful publish.
    await page.locator('[name="title"]').fill('')
    await page.locator('[data-action="open-demo-controller"]').click()
    await page.getByLabel('演示速度', { exact: true }).selectOption('flow')
    await page.getByRole('button', { name: '继续', exact: true }).click()
    const reason = page.getByTestId('demo-failure-reason')
    await expect(reason).toContainText('请检查标记的字段', { timeout: 15_000 })
    await expect(reason).toBeInViewport({ ratio: 1 })
    await expect(page.getByTestId('demo-outcome')).toHaveCount(0)
    await expect(page.locator('[data-action="run"]')).toBeInViewport({ ratio: 1 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.screenshot({ path: info.outputPath(`failure-reason-${width}.png`) })
  })
}

for (const width of [1440, 1280, 768, 390]) {
  test(`product save controls follow the active form panel at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    await openTask(page, 'product')
    await page.getByRole('button', { name: '收起工具控制', exact: true }).click()
    await page.locator('[data-edit]').first().click()
    const editor = page.getByTestId('v2-product-editor')
    const footer = editor.locator('.v2-editor-footer')
    for (const tab of ['important', 'variants', 'offer', 'compliance', 'images', 'description', 'keywords', 'details']) {
      await editor.locator(`[data-action="tab-${tab}"]`).click()
      const panel = editor.locator('.v2-editor-panel:visible')
      const content = await panel.boundingBox()
      const actions = await footer.boundingBox()
      expect(actions!.y).toBeGreaterThanOrEqual(content!.y + content!.height - 1)
      const save = footer.locator('[data-action="save-product-complete"]')
      await footer.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }))
      await expect(save).toBeInViewport({ ratio: 1 })
      expect(await save.evaluate(element => {
        const bounds = element.getBoundingClientRect()
        const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
        return hit === element || element.contains(hit)
      })).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    }
    await page.screenshot({ path: info.outputPath(`product-save-${width}.png`) })
    await footer.locator('[data-action="save-product-complete"]').click()
    await expect(editor).toHaveCount(0)
    await expect(page.locator('[data-parent]').first()).toBeVisible()
    expect(await saved(page)).toBeNull()
    await page.getByTestId('experience-close').click()
  })
}

for (const width of [1440, 1280, 768, 390]) {
  test(`switching demo tasks shows only the selected task history at ${width}px`, async ({ page }, info) => {
    test.setTimeout(75_000)
    await page.setViewportSize({ width, height: 900 })
    await openTask(page, 'product')
    const task = page.getByLabel('选择一键任务', { exact: true })
    const run = page.locator('[data-action="run"]')
    const originalTaskBounds = (await task.boundingBox())!
    const originalRunBounds = (await run.boundingBox())!
    const expectStableControls = async () => {
      const bounds = (await task.boundingBox())!
      const runBounds = (await run.boundingBox())!
      expect(Math.abs(bounds.y - originalTaskBounds.y)).toBeLessThan(1)
      // The accepted desktop panel is compact: its footer follows its content
      // height, while the task selector remains anchored. Mobile keeps a fixed
      // sheet height. Both modes must keep the primary action visible/clickable.
      if (width <= 600) expect(Math.abs(runBounds.y - originalRunBounds.y)).toBeLessThan(1)
      const panelBounds = (await page.locator('.kst-demo-panel').boundingBox())!
      expect(runBounds.y).toBeGreaterThan(bounds.y + bounds.height)
      expect(runBounds.y + runBounds.height).toBeLessThanOrEqual(panelBounds.y + panelBounds.height)
      expect(await run.evaluate((element, point) => element.contains(document.elementFromPoint(point.x, point.y)), {
        x: runBounds.x + runBounds.width / 2,
        y: runBounds.y + runBounds.height / 2,
      })).toBe(true)
      // The mouse's previous click point must remain over the task selector.
      expect(await task.evaluate((element, point) => element === document.elementFromPoint(point.x, point.y), {
        x: originalTaskBounds.x + originalTaskBounds.width / 2,
        y: originalTaskBounds.y + originalTaskBounds.height / 2,
      })).toBe(true)
    }
    await expect(run).toHaveText('开始演示')
    await choosePace(page, 'flow')
    await run.click()
    await expect(page.getByTestId('demo-outcome')).toBeVisible({ timeout: 35_000 })
    await expect(run).toHaveText('再演示一次')
    await expectStableControls()
    const beforeBodyScroll = (await run.boundingBox())!
    await page.locator('.kst-demo-body').evaluate(element => { element.scrollTop = element.scrollHeight })
    await expectStableControls()
    expect(Math.abs((await run.boundingBox())!.y - beforeBodyScroll.y)).toBeLessThan(1)
    await task.focus()
    for (const nextTask of ['shipping', 'fba', 'advertising']) {
      await task.selectOption(nextTask)
      await expectStableControls()
      await expect(task).toBeFocused()
      expect(await page.locator('.kst-demo-body').evaluate(element => element.scrollTop)).toBe(0)
      await expect(run).toHaveText('开始演示')
      await task.selectOption('product')
      await expectStableControls()
    }
    await task.selectOption('template')
    await expectStableControls()
    await expect(run).toHaveText('开始演示')
    await expect(page.getByTestId('run-status')).toHaveText('就绪')
    await expect(page.getByTestId('demo-outcome')).toHaveCount(0)
    await expect(page.locator('.kst-demo-result-trace')).toHaveCount(0)
    await page.screenshot({ path: info.outputPath(`new-template-${width}.png`) })
    await task.selectOption('product')
    await expect(run).toHaveText('再演示一次')
    await expect(page.getByTestId('demo-outcome')).toContainText('在售 · 2 个子 SKU')
    await page.locator('[data-action="next-demo-task"]').click()
    await expectStableControls()
    await expect(run).toHaveText('开始演示')
    await expect(page.getByTestId('demo-outcome')).toHaveCount(0)
    await task.selectOption('template')
    await run.click()
    await expect(page.getByTestId('demo-outcome')).toContainText('已保存 · 2 条配送规则', { timeout: 35_000 })
    await expectStableControls()
    await expect(run).toHaveText('再演示一次')
    await task.selectOption('advertising')
    await expect(run).toHaveText('开始演示')
    await expect(page.getByTestId('run-status')).toHaveText('就绪')
    await expect(page.getByTestId('demo-outcome')).toHaveCount(0)
    await page.getByTestId('experience-close').click()
    await page.locator('[data-experience-task="product"]').click()
    await expect(run).toHaveText('开始演示')
    expect(await saved(page)).toBeNull()
  })
}

test('escape dismisses inner controls before closing the experience; no public demo route exists', async ({ page }) => {
  await openTask(page, 'product')
  await page.getByLabel('选择一键任务', { exact: true }).focus()
  await page.keyboard.press('Escape')
  await expect(page.locator('.kst-demo-panel')).toHaveCount(0)
  await expect(page.getByTestId('marketing-experience-dialog')).toBeVisible()
  await page.getByTestId('experience-close').focus()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('marketing-experience-dialog')).toHaveCount(0)
  await page.goto('/demo')
  await expect(page.getByRole('heading', { name: '这个页面暂时找不到了', exact: true })).toBeVisible()
})

test('manual template input remains usable inside the mobile feature and resets on reopen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await openTask(page, 'template')
  await page.getByRole('button', { name: '收起工具控制', exact: true }).click()
  await page.locator('[data-action="template-create"]').click()
  await page.locator('[name="templateName"]').fill('手动练习配送规则')
  await page.locator('[data-action="template-save"]').click()
  await expect(page.getByTestId('template-detail-name')).toHaveText('手动练习配送规则')
  expect(await saved(page)).toBeNull()
  await page.getByTestId('experience-close').click()
  await page.locator('[data-experience-task="template"]').click()
  await expect(page.getByTestId('simulation')).not.toContainText('手动练习配送规则')
  await expect(page.getByTestId('run-status')).toHaveText('就绪')
})

test('mobile guided FBA pause keeps the active field and submit above the dock', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await openTask(page, 'fba')
  const backgroundScroll = await page.evaluate(() => window.scrollY)
  await choosePace(page, 'guided')
  await page.locator('[data-action="run"]').click()
  const battery = page.locator('[name="fbaBattery"].v2-demo-target')
  await expect(battery).toHaveCount(1, { timeout: 25_000 })
  await page.locator('.v2-run-dock').getByRole('button', { name: '暂停', exact: true }).click()
  const submit = page.locator('[data-action="fba-hazard-save"]')
  for (const control of [battery, submit]) await expect.poll(() => control.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const at = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return at === element || element.contains(at)
  })).toBe(true)
  expect(await page.evaluate(() => window.scrollY)).toBe(backgroundScroll)
  await page.screenshot({ path: info.outputPath('fba-390-paused.png') })
  await page.locator('.v2-run-dock').getByRole('button', { name: '展开课赛通工具控制', exact: true }).click()
  await page.locator('.kst-demo-panel').getByRole('button', { name: '停止', exact: true }).click()
  expect(await saved(page)).toBeNull()
  await page.getByTestId('experience-close').click()
})

test('mobile browser zoom stays enabled and experience remains dismissible after magnification', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await openTask(page, 'product')
  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content')
  expect(viewport).not.toMatch(/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\D|$)/i)
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.5 })
  expect(await page.evaluate(() => visualViewport!.scale)).toBeGreaterThan(1)
  await expect.poll(() => page.getByTestId('experience-close').evaluate(element => {
    const rect = element.getBoundingClientRect(), viewport = visualViewport!
    return rect.left >= viewport.offsetLeft && rect.right <= viewport.offsetLeft + viewport.width + 1
      && rect.top >= viewport.offsetTop && rect.bottom <= viewport.offsetTop + viewport.height
  })).toBe(true)
  await page.screenshot({ path: info.outputPath('experience-390-zoom150.png') })
  await page.getByTestId('experience-close').click()
  await expect(page.getByTestId('simulation')).toHaveCount(0)
  await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })
  await session.detach()
})
