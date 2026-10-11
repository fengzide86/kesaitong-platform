import { expect, test, type Page } from '@playwright/test'

for (const width of [1440, 390]) {
  test(`award certificates remain clear, private and keyboard accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const colors: string[] = []
    for (const route of ['/', '/competition']) {
      await page.goto(route)
      const award = page.locator('.case-competition')
      await award.scrollIntoViewIfNeeded()
      await expect(award).toContainText('2025')
      await expect(award).toContainText('第六届全国数字贸易技能大赛')
      await expect(award).not.toContainText('第九届')
      await expect(award).not.toContainText('团队专业能力')
      const styles = await award.evaluate(node => ({
        awardColor: getComputedStyle(node.querySelector('.case-award strong')!).color,
        awardSize: parseFloat(getComputedStyle(node.querySelector('.case-award strong')!).fontSize),
        baselineSize: parseFloat(getComputedStyle(node.querySelector('.case-before strong')!).fontSize),
      }))
      colors.push(styles.awardColor)
      expect(styles.awardSize).toBeGreaterThan(styles.baselineSize)
      const trigger = page.getByTestId('award-open-certificate')
      await expect(trigger.locator('img')).toHaveAttribute('src', /competition-award-2025-thumb/)
      await trigger.click()
      const dialog = page.getByTestId('certificate-viewer')
      await expect(dialog).toBeVisible()
      const photo = dialog.locator('img')
      await expect(photo).toHaveAttribute('src', /competition-award-2025-redacted/)
      await expect(photo).toHaveJSProperty('complete', true)
      expect(await photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThanOrEqual(1400)
      const beforeWidth = (await photo.boundingBox())!.width
      await page.getByTestId('certificate-zoom-in').click()
      await expect.poll(async () => (await photo.boundingBox())!.width).toBeGreaterThan(beforeWidth)
      const close = page.getByTestId('certificate-close')
      await expect(close).toBeInViewport()
      const closeBox = (await close.boundingBox())!
      expect(closeBox.width).toBeGreaterThanOrEqual(44)
      expect(closeBox.height).toBeGreaterThanOrEqual(44)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      await page.getByTestId('certificate-fit').click()
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(trigger).toBeFocused()
      expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden')
      const qualification = page.getByTestId('qualification-open-certificate')
      if (route === '/') {
        await expect(qualification).toHaveCount(0)
      } else {
        await qualification.click()
        await expect(dialog).toBeVisible()
        await expect(dialog).toContainText('跨境电子商务师（中级）职业能力证书')
        await expect(dialog.locator('img')).toHaveAttribute('src', /team-qualification-redacted/)
        await page.getByTestId('certificate-close').click()
        await expect(dialog).toHaveCount(0)
        await expect(qualification).toBeFocused()
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    }
    expect(colors[0]).toBe(colors[1])
  })
}

test('award entrance plays once and respects reduced motion', async ({ page }) => {
  await page.goto('/competition')
  const award = page.locator('.case-competition')
  await award.scrollIntoViewIfNeeded()
  await expect(award).toHaveClass(/award-entered/)
  const motion = await award.evaluate(el => ({ name: getComputedStyle(el).animationName, duration: getComputedStyle(el).animationDuration, iterations: getComputedStyle(el).animationIterationCount }))
  expect(motion.name).not.toBe('none')
  expect(parseFloat(motion.duration)).toBeGreaterThanOrEqual(0.45)
  expect(parseFloat(motion.duration)).toBeLessThanOrEqual(0.6)
  expect(motion.iterations).toBe('1')
  await page.waitForTimeout(650)
  await page.evaluate(() => window.scrollTo(0, 0))
  await award.scrollIntoViewIfNeeded()
  await expect(award).toHaveClass(/award-entered/)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  await award.scrollIntoViewIfNeeded()
  expect(await award.evaluate(el => getComputedStyle(el).animationName)).toBe('none')
  await expect(page.getByTestId('award-open-certificate')).toBeVisible()
})

type Observation = { api: string[], errors: string[], consoleErrors: string[] }
const observations = new WeakMap<Page, Observation>()
const viewports = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
]

test.beforeEach(async ({ page }) => {
  const observed: Observation = { api: [], errors: [], consoleErrors: [] }
  observations.set(page, observed)
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/')) observed.api.push(request.url())
  })
  page.on('pageerror', error => observed.errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') observed.consoleErrors.push(message.text()) })
  // Never contact a production or external download host during acceptance.
  await page.route('https://**', route => route.abort())
})

test.afterEach(async ({ page }) => {
  const observed = observations.get(page)
  expect(observed?.api).toEqual([])
  expect(observed?.errors).toEqual([])
  expect(observed?.consoleErrors).toEqual([])
})

for (const viewport of viewports) {
  test(`all public routes fit without horizontal overflow at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    for (const route of ['/', '/competition', '/course', '/tools', '/terms', '/not-a-page']) {
      await page.goto(route)
      await page.reload()
      await expect(page.locator('body')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
    }
  })
}

test('homepage primary CTA reaches scenes and its two cards open the scenario routes', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: /下载 Windows 桌面端/ })).toHaveCount(0)
  const sceneChooser = page.getByRole('link', { name: '看看适合我的场景', exact: true })
  await expect(sceneChooser).toBeVisible()
  await expect(page.getByTestId('marketing-hero').locator('a')).toHaveCount(1)
  await expect(page.getByTestId('marketing-hero')).toContainText('跨境电商比赛与亚马逊仿真实训工具')
  await expect(page.getByTestId('marketing-hero')).toContainText('照着要求做，隐性得分点还是会漏')
  await expect(page.getByTestId('marketing-hero')).toContainText('哪些配置有用，还在反复试')
  await expect(page.getByTestId('marketing-hero')).not.toContainText('痛点示意')
  expect(await page.locator('#scenes').evaluate(node => !!(node.compareDocumentPosition(document.querySelector('#impact')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true)
  await sceneChooser.click()
  await expect(page.locator('#scenes')).toBeInViewport()
  await expect(page.getByTestId('landing-task-map').locator('[data-task-id]')).toHaveCount(8)
  await expect(page.getByTestId('landing-task-map')).not.toContainText('前置条件')
  await expect(page.locator('a[href="/competition"]').first()).toBeVisible()
  await expect(page.locator('a[href="/course"]').first()).toBeVisible()
  await page.locator('a[href="/competition"]').first().click()
  await expect(page).toHaveURL(/\/competition$/)
  await expect(page.locator('.pain-heading h2')).toContainText('哪些操作，值得你多花时间')
  await expect(page.locator('.comparison-body')).toHaveAttribute('data-active-pain', 'company')
  await expect(page.locator('.pain-selector button').first()).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.desktop-comparison .after-panel')).toContainText('后续辅助方式')
  await expect(page.locator('.desktop-comparison .after-panel')).toContainText('这一项暂未开放')
  await page.goto('/')
  await page.locator('a[href="/course"]').first().click()
  await expect(page).toHaveURL(/\/course$/)
  await expect(page.locator('.pain-heading h2')).toContainText('哪些重复操作，占掉了练习时间')
  await expect(page.locator('.comparison-body')).toHaveAttribute('data-active-pain', 'company')
  await expect(page.locator('.pain-selector button').first()).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.desktop-comparison .after-panel')).toContainText('后续辅助方式')
  await expect(page.locator('.desktop-comparison .after-panel')).toContainText('这一项暂未开放')
})

test('mobile task descriptions, usage conditions and footer stay readable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const fontSize = async (selector: string) => page.locator(selector).first().evaluate(node => Number.parseFloat(getComputedStyle(node).fontSize))
  await page.goto('/')
  expect(await fontSize('.landing-task-card small')).toBeGreaterThanOrEqual(15)
  expect(await fontSize('.landing-task-card em')).toBeGreaterThanOrEqual(15)
  expect(await fontSize('.landing-task-card-action')).toBeGreaterThanOrEqual(14)
  expect(await fontSize('.landing-footer .kst-lockup-subtitle')).toBeGreaterThanOrEqual(13)
  expect(await fontSize('.metric-source')).toBeGreaterThanOrEqual(14)
  expect(await fontSize('.case-note')).toBeGreaterThanOrEqual(14)
  await page.goto('/tools')
  expect(await fontSize('.tool-status')).toBeGreaterThanOrEqual(14)
  expect(await fontSize('.tool-details summary')).toBeGreaterThanOrEqual(15)
  await page.locator('.tool-details summary').first().click()
  await expect(page.locator('.tool-details p').first()).toBeVisible()
  expect(await fontSize('.tool-details p')).toBeGreaterThanOrEqual(15)
  for (const route of ['/competition', '/course']) {
    await page.goto(route)
    expect(await fontSize('.compact-panel .availability-label')).toBeGreaterThanOrEqual(14)
    expect(await fontSize('.human-note p')).toBeGreaterThanOrEqual(15)
  }
})

test('an already-loaded homepage can open tools through every entry without later JS or CSS requests', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('marketing-hero')).toBeVisible()
  await expect(page.getByTestId('landing-task-map').locator('[data-task-id]')).toHaveCount(8)
  // Set this only in the first document: a full-page navigation cannot recreate it.
  await page.evaluate(() => Reflect.set(window, '__marketingLoadedDocument', 'homepage-loaded-once'))
  const lateAssetRequests: string[] = []
  await page.route(/\/assets\/.*\.(?:js|css)(?:\?.*)?$/, route => {
    lateAssetRequests.push(route.request().url())
    return route.abort()
  })
  const expectSameDocument = async () => {
    expect(await page.evaluate(() => Reflect.get(window, '__marketingLoadedDocument'))).toBe('homepage-loaded-once')
    expect(lateAssetRequests).toEqual([])
  }
  const returnToLoadedHomepage = async () => {
    // Use the app's RouterLink, never goto/reload, so this exercises an open tab.
    await page.getByRole('link', { name: '返回课赛通首页', exact: true }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByTestId('marketing-hero')).toBeVisible()
    await expectSameDocument()
  }

  await page.getByTestId('marketing-score-support').getByRole('link', { name: '看看哪些任务支持一键处理', exact: true }).click()
  await expect(page).toHaveURL(/\/tools$/)
  await expect(page.getByTestId('marketing-tools-overview')).toBeVisible()
  await expectSameDocument()
  await returnToLoadedHomepage()

  const taskIds = ['company', 'sourcing', 'product', 'shipping', 'marketing', 'fba', 'orders', 'pricing']
  for (const id of taskIds) {
    await page.getByTestId('landing-task-map').locator(`[data-task-id="${id}"]`).click()
    await expect(page).toHaveURL(new RegExp(`/tools#tool-${id}$`))
    await expect(page.locator(`#tool-${id}`)).toBeInViewport()
    await expectSameDocument()
    await returnToLoadedHomepage()
  }

  await page.locator('.landing-final').getByRole('link', { name: '看工具介绍', exact: true }).click()
  await expect(page).toHaveURL(/\/tools$/)
  await expect(page.getByTestId('marketing-tools-overview')).toBeVisible()
  await expectSameDocument()
  await returnToLoadedHomepage()
})

test('scenario navigation keeps before/after content distinct and interactive', async ({ page }) => {
  await page.goto('/competition')
  const comparison = page.locator('[data-testid="scenario-comparison"]')
  await expect(comparison).toBeVisible()
  await expect(comparison.locator('.comparison-body')).toHaveAttribute('data-active-pain', 'company')
  await expect(comparison.locator('.pain-selector button').first()).toHaveAttribute('data-testid', 'pain-company')
  await expect(comparison.locator('.pain-selector button').first()).toHaveAttribute('aria-pressed', 'true')
  await comparison.getByTestId('pain-products').click()
  await expect(comparison.locator('.comparison-body')).toHaveAttribute('data-active-pain', 'products')
  await expect(comparison.locator('.desktop-comparison .after-panel')).toContainText('课赛通辅助后')
  await comparison.getByTestId('pain-rates').click()
  await expect(comparison.locator('.comparison-body')).toHaveAttribute('data-active-pain', 'rates')
  await expect(comparison.locator('.desktop-comparison .before-panel h4')).toContainText('对着规则表')
  await page.getByRole('link', { name: '课程实训', exact: true }).click()
  await expect(page).toHaveURL(/\/course$/)
  const courseComparison = page.locator('[data-testid="scenario-comparison"]')
  await expect(courseComparison).toContainText('课程实训')
  await expect(courseComparison.locator('.comparison-body')).toHaveAttribute('data-active-pain', 'company')
  await expect(courseComparison.locator('.pain-selector button').first()).toHaveAttribute('aria-pressed', 'true')
  await expect(courseComparison.locator('.desktop-comparison .after-panel')).toContainText('后续辅助方式')
  await courseComparison.getByTestId('pain-products').click()
  await expect(courseComparison.locator('.comparison-body')).toHaveAttribute('data-active-pain', 'products')
  await expect(courseComparison.locator('.desktop-comparison .after-panel')).toContainText('课赛通辅助后')
  await courseComparison.getByTestId('pain-settings').click()
  await expect(courseComparison.locator('.comparison-body')).toHaveAttribute('data-active-pain', 'settings')
  await page.getByRole('link', { name: '工具介绍', exact: true }).click()
  await expect(page).toHaveURL(/\/tools$/)
})

test('tools page exposes an application contact, capability boundaries and mocked download', async ({ page, request }) => {
  const metadata = await (await request.get('/marketing-version.json')).json() as { downloadUrl: string }
  await page.goto('/tools')
  await expect(page.getByTestId('marketing-tools-overview')).toContainText('先试一遍怎么操作')
  await expect(page.getByTestId('marketing-tools-overview')).toContainText('先确认可用范围和授权，再下载使用')
  await expect(page.getByTestId('marketing-tools-overview').locator('[data-task-id]')).toHaveCount(8)
  await expect(page.getByTestId('marketing-tools-overview').locator('[role="tablist"]')).toHaveCount(0)
  await expect(page.locator('.team-note')).toContainText('带队或多人使用')
  await expect(page.getByTestId('marketing-tools-overview')).not.toContainText('前置条件')
  await expect(page.locator('#start')).toBeVisible()
  await expect(page.locator('#start').getByText('申请使用', { exact: true })).toBeVisible()
  await expect(page.locator('#marketing-wechat-account')).toHaveValue('Moweiiong')
  await expect(page.locator('#start')).toContainText('先确认可用范围和授权，再下载使用')
  const downloadActions = page.getByRole('button', { name: /下载 Windows 桌面端/ })
  await expect(downloadActions).toHaveCount(2)
  const download = downloadActions.first()
  await expect(download).toBeVisible()
  await page.route(metadata.downloadUrl, route => route.fulfill({
    status: 200,
    contentType: 'application/octet-stream',
    headers: { 'Content-Disposition': 'attachment; filename="kst-test-only.exe"' },
    body: 'ISOLATED MARKETING DOWNLOAD TEST — NOT AN EXECUTABLE',
  }))
  const downloadPromise = page.waitForEvent('download')
  await download.click()
  const result = await downloadPromise
  expect(result.url()).toBe(metadata.downloadUrl)
})

for (const outcome of ['success', 'denied'] as const) {
  test(`application contact handles clipboard ${outcome} without losing the WeChat account`, async ({ page }) => {
    await page.addInitScript(result => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (value: string) => {
          if (result === 'denied') throw new DOMException('Clipboard denied', 'NotAllowedError')
          Object.defineProperty(window, '__marketingCopiedWechat', { configurable: true, value })
        } },
      })
    }, outcome)
    if (outcome === 'denied') await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/tools#start')
    const contact = page.getByTestId('marketing-wechat-contact')
    const account = contact.getByRole('textbox', { name: '公开微信号' })
    await expect(account).toHaveValue('Moweiiong')
    await expect(account).toHaveAttribute('readonly', '')
    await contact.getByRole('button', { name: '复制微信号' }).click()
    if (outcome === 'success') {
      await expect(contact.getByRole('status')).toContainText('微信号已复制')
      expect(await page.evaluate(() => Reflect.get(window, '__marketingCopiedWechat'))).toBe('Moweiiong')
    } else {
      await expect(contact.getByRole('status')).toContainText('请选择上方微信号手动复制')
      await expect(contact.getByRole('status')).not.toContainText('微信号已复制')
      await account.click()
      expect(await account.evaluate((input: HTMLInputElement) => ({ start: input.selectionStart, end: input.selectionEnd }))).toEqual({ start: 0, end: 'Moweiiong'.length })
    }
    await expect(contact.getByRole('button', { name: '复制微信号' })).toBeEnabled()
    await expect(account).toHaveValue('Moweiiong')
  })
}

test('FAQ, terms and true not-found remain available without application routes', async ({ page }) => {
  await page.goto('/')
  await page.getByText('下载后是不是所有功能都能直接运行？', { exact: true }).click()
  await expect(page.locator('.faq-answer').filter({ hasText: '授权、版本和开放范围' })).toBeVisible()
  await page.goto('/terms')
  await expect(page.getByRole('heading', { name: '服务条款', exact: true })).toBeVisible()
  await page.goto('/user/login')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('这个页面暂时找不到了')
  await expect(page.locator('a[href^="/user/"], a[href^="/admin"], a[href^="/business"]')).toHaveCount(0)
})

test('reduced motion keeps marketing content visible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.getByTestId('marketing-hero')).toBeVisible()
  const animationNames = await page.locator('.landing-hero-copy > *, .landing-pain-stage').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).animationName))
  expect(animationNames.every(name => name === 'none')).toBe(true)
  const comparison = page.getByTestId('metric-comparison')
  await comparison.scrollIntoViewIfNeeded()
  await expect(comparison.getByTestId('metric-result')).toHaveCount(3)
  const barAnimations = await comparison.locator('.metric-bar-row em').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).animationName))
  expect(barAnimations.every(name => name === 'none')).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
})

test('comparison bars enter slowly in sequence while complete numbers stay readable', async ({ page }) => {
  await page.goto('/')
  const grid = page.locator('.metric-grid').first()
  await grid.scrollIntoViewIfNeeded()
  await expect(grid.locator('.metric-card.metric-bars-animate')).toHaveCount(3)
  const bars = await grid.locator('.metric-bar-row em').evaluateAll(nodes => nodes.map(node => {
    const style = getComputedStyle(node)
    return { duration: style.animationDuration, delay: style.animationDelay }
  }))
  expect(bars.map(bar => bar.duration)).toEqual(Array(6).fill('1.4s'))
  expect(bars.map(bar => bar.delay)).toEqual(['0s', '0.18s', '0s', '0.18s', '0s', '0.18s'])
  await expect(grid.getByTestId('before-number').first()).toHaveText('21分钟')
  await expect(grid.getByTestId('after-number').first()).toHaveText('2分钟')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  expect(await page.locator('.metric-bar-row em').first().evaluate(node => getComputedStyle(node).animationName)).toBe('none')
  await expect(page.getByTestId('before-number').first()).toHaveText('21分钟')
})

test('scenario images are unique, local, loaded and legible at desktop and mobile sizes', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    for (const path of ['/competition', '/course']) {
      await page.goto(path)
      const identity = page.getByTestId('scenario-identity')
      await expect(identity).toHaveCount(1)
      await expect(identity).toBeVisible()
      await expect(identity.locator('img')).toHaveJSProperty('complete', true)
      expect(await identity.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
      if (path === '/competition') {
        const media = (await identity.locator('.scenario-identity-media').boundingBox())!
        expect(media.width).toBeGreaterThanOrEqual(120)
        expect(media.width).toBeLessThanOrEqual(144)
        const dimensions = await identity.locator('img').evaluate((img: HTMLImageElement) => ({ width: img.naturalWidth, height: img.naturalHeight, displayWidth: img.getBoundingClientRect().width, displayHeight: img.getBoundingClientRect().height }))
        expect(dimensions.width).toBe(960)
        expect(dimensions.height).toBe(704)
        expect(dimensions.width / dimensions.displayWidth).toBeGreaterThan(3)
        expect(dimensions.displayWidth / dimensions.displayHeight).toBeCloseTo(960 / 704, 2)
        await expect(identity.locator('a')).toHaveAttribute('href', 'https://www.idtrade.cn/User/Contest')
      }
      const sizes = await page.locator('.scenario-identity-copy small, .row-copy small, .row-label, .pain-selector small').evaluateAll(nodes => nodes.map(node => parseFloat(getComputedStyle(node).fontSize)))
      expect(sizes.every(size => size >= 13)).toBe(true)
      const reportedComparison = page.getByTestId('metric-comparison')
      await expect(reportedComparison).toHaveCount(1)
      await expect(reportedComparison).toContainText('用户提供')
      await expect(reportedComparison).not.toContainText('已实测')
      await expect(reportedComparison).not.toContainText('平均用时')
    }
  }
})

test('all three reported time comparisons are visible together on desktop and mobile', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    for (const route of ['/', '/competition', '/course']) {
      await page.goto(route)
      const comparison = page.getByTestId('metric-comparison')
      const results = comparison.getByTestId('metric-result')
      await expect(results).toHaveCount(3)
      await expect(comparison.getByRole('tablist')).toHaveCount(0)
      const cases = [['21分钟', '2分钟', '19'], ['33分钟', '2分钟', '31'], ['15分钟', '3分钟', '12']]
      for (const [index, values] of cases.entries()) {
        const result = results.nth(index)
        await expect(result).toBeVisible()
        await expect(result.getByTestId('before-number')).toHaveText(values[0]!)
        await expect(result.getByTestId('after-number')).toHaveText(values[1]!)
        await expect(result.getByTestId('delta-number')).toHaveText(values[2]!)
      }
      await expect(comparison.locator('.metric-source')).toHaveCount(1)
      await expect(comparison.locator('.metric-source')).toContainText('用户提供案例')
      await expect(comparison).not.toContainText(/已实测|平均用时|平均节省|平均提高/)
    }
  }
})

test('reported outcomes retain honest scope and scoring support appears only on the homepage', async ({ page }) => {
  for (const route of ['/', '/competition', '/course']) {
    await page.goto(route)
    const comparison = page.getByTestId('metric-comparison')
    await expect(comparison).toBeVisible()
    await expect(comparison).toContainText('用户提供')
    await expect(comparison).not.toContainText('已实测')
    await expect(comparison).not.toContainText(/平均用时|平均节省|平均提高/)
    const support = page.getByTestId('marketing-score-support')
    if (route === '/') {
      await expect(support).toBeVisible()
      await expect(support).toContainText('需要关注的得分细节')
      await expect(support).toContainText('一键配置')
    } else {
      await expect(support).toHaveCount(0)
    }

    const results = page.getByTestId('marketing-case-results')
    await expect(results).toContainText('用户提供')
    await expect(results).not.toContainText(/平均得分|平均提分|平均提高/)
    const course = results.locator('[data-case-id="course"]')
    const competition = results.locator('[data-case-id="competition"]')
    if (route !== '/competition') {
      await expect(course).toContainText('21')
      await expect(course).toContainText('90')
      await expect(course).toContainText('69')
    } else {
      await expect(course).toHaveCount(0)
    }
    if (route !== '/course') {
      await expect(competition).toContainText('60')
      await expect(competition).toContainText('全国总决赛')
      await expect(competition).toContainText('一等奖')
      await expect(competition).not.toContainText('100分')
    } else {
      await expect(competition).toHaveCount(0)
    }
  }
})

test('mobile navigation exposes getting started and supports keyboard dismissal', async ({ page }) => {
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    const toggle = page.getByRole('button', { name: '打开导航' })
    await expect(toggle).toBeVisible()
    const bounds = (await toggle.boundingBox())!
    expect(bounds.width).toBeGreaterThanOrEqual(44)
    expect(bounds.height).toBeGreaterThanOrEqual(44)
    await toggle.focus()
    await page.keyboard.press('Enter')
    const navigation = page.getByRole('navigation', { name: '官网导航' })
    const firstLink = navigation.getByRole('link', { name: '比赛备赛', exact: true })
    const start = navigation.getByRole('link', { name: '怎么开始使用' })
    await expect(start).toBeVisible()
    await page.keyboard.press('Tab')
    await expect(firstLink).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(page.getByRole('button', { name: '关闭导航' })).toBeFocused()
    // Escape works even after focus leaves the header and returns it to the toggle.
    await page.getByRole('link', { name: '看看适合我的场景', exact: true }).focus()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: '打开导航' })).toBeFocused()
    await expect(start).toBeHidden()
    await page.keyboard.press('Enter')
    await start.click()
    await expect(page).toHaveURL(/\/tools#start$/)
    await expect(page.locator('#start')).toBeInViewport()
    await expect(navigation).toBeHidden()
  }
})

test('shared typography, focus and body contrast remain readable', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    const style = await page.locator('.landing-lead').evaluate(node => {
      const s = getComputedStyle(node)
      const color = s.color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => {
        const channel = v / 255
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
      })
      const luminance = .2126 * color[0]! + .7152 * color[1]! + .0722 * color[2]!
      return { size: parseFloat(s.fontSize), contrastOnWhite: 1.05 / (luminance + .05) }
    })
    expect(style.size).toBeGreaterThanOrEqual(width === 390 ? 15 : 16)
    expect(style.contrastOnWhite).toBeGreaterThanOrEqual(4.5)
    const cta = page.locator('a[href="#scenes"]')
    await cta.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(cta).toBeFocused()
    expect(await cta.evaluate(node => parseFloat(getComputedStyle(node).outlineWidth))).toBeGreaterThanOrEqual(3)
  }
})

test('all eight tasks link to matching tool cards and six unavailable tasks remain labelled', async ({ page }) => {
  const ids = ['company', 'sourcing', 'product', 'shipping', 'marketing', 'fba', 'orders', 'pricing']
  for (const id of ids) {
    await page.goto('/')
    await page.getByTestId('landing-task-map').locator(`[data-task-id="${id}"]`).click()
    await expect(page).toHaveURL(new RegExp(`/tools#tool-${id}$`))
    const card = page.locator(`#tool-${id}`)
    await expect(card).toBeInViewport()
    await expect(card).toHaveAttribute('data-task-id', id)
    await expect(card.locator('.tool-status')).toHaveText(['product', 'orders'].includes(id) ? '需安装电脑端，使用前请咨询' : '暂未开放')
  }
  for (const path of ['/competition', '/course']) {
    await page.goto(path)
    for (const [pain, tool] of [['company', 'company'], ['selection', 'sourcing'], [path === '/competition' ? 'rates' : 'settings', 'shipping'], ['ads', 'marketing'], ['fba', 'fba'], ['pricing', 'pricing']]) {
      await page.getByTestId(`pain-${pain}`).click()
      await expect(page.locator('.desktop-comparison .after-panel')).toContainText('后续辅助方式')
      await expect(page.locator('.desktop-comparison .after-panel')).toContainText('这一项暂未开放')
      await expect(page.locator('.desktop-comparison .after-panel .availability-label')).toHaveText('暂未开放')
      await expect(page.locator('.desktop-comparison .after-panel')).not.toContainText('课赛通辅助后')
      await expect(page.getByTestId('scenario-tool-link')).toHaveAttribute('href', `/tools#tool-${tool}`)
    }
  }
})

test('task switches keep desktop panels aligned and mobile selectors compact', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const width of [1440, 1280, 768, 390]) {
    await page.setViewportSize({ width, height: 900 })
    for (const path of ['/competition', '/course']) {
      await page.goto(path)
      for (const button of await page.locator('.pain-selector button').all()) {
        await button.click()
        await expect(button).toHaveAttribute('aria-pressed', 'true')
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
        if (width > 620) {
          const before = (await page.locator('.desktop-comparison .before-panel').boundingBox())!
          const after = (await page.locator('.desktop-comparison .after-panel').boundingBox())!
          expect(Math.abs(before.y - after.y)).toBeLessThan(2)
          expect(Math.abs(before.height - after.height)).toBeLessThan(2)
        }
      }
      if (width === 390) {
        const selector = (await page.locator('.pain-selector').boundingBox())!
        expect(selector.height).toBeLessThan(310)
        await expect(page.locator('.pain-selector small')).toHaveCount(0)
      }
      await expect(page.locator('.task-preview, .preview-top, .preview-bottom')).toHaveCount(0)
    }
  }
})

test('mobile scenario starts compact and closes expanded workflow after changing tasks', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  for (const route of ['/competition', '/course']) {
    await page.goto(route)
    const comparison = page.getByTestId('scenario-comparison')
    const details = comparison.getByTestId('scenario-mobile-details')
    await expect(comparison.locator('.comparison-body')).toHaveAttribute('data-active-pain', 'company')
    await expect(comparison.locator('.pain-selector button').first()).toHaveAttribute('data-testid', 'pain-company')
    await expect(comparison.locator('.pain-selector button').first()).toHaveAttribute('aria-pressed', 'true')
    await expect(comparison.locator('.desktop-comparison')).toBeHidden()
    await expect(comparison.locator('.compact-comparison')).toBeVisible()
    await expect(comparison.locator('.compact-comparison .after-panel')).toContainText('后续辅助')
    await expect(comparison.locator('.compact-comparison .after-panel')).toContainText('暂未开放')
    await expect(details).not.toHaveAttribute('open', '')
    await expect(details.locator('.mobile-step-panels')).toBeHidden()
    await details.locator('summary').click()
    await expect(details).toHaveAttribute('open', '')
    await expect(details.locator('.mobile-step-panels')).toBeVisible()
    await expect(details.locator('.action-steps li')).toHaveCount(6)
    await expect(details.locator('.mobile-step-panels .after-panel')).toContainText('后续辅助方式')
    await expect(details.locator('.mobile-step-panels .after-panel')).toContainText('这一项暂未开放')
    await comparison.getByTestId(route === '/competition' ? 'pain-rates' : 'pain-settings').click()
    await expect(details).not.toHaveAttribute('open', '')
    await expect(details.locator('.mobile-step-panels')).toBeHidden()
    await expect(comparison.locator('.compact-comparison .after-panel')).toContainText('整理配送规则，辅助配置')
    await details.locator('summary').click()
    await expect(details.locator('.mobile-step-panels .before-panel h4')).toContainText(route === '/competition' ? '对着规则表' : '边读讲义')
  }
})

for (const width of [1440, 390]) {
  test(`tool cards open the matching session in place and restore keyboard focus at ${width}px`, async ({ page }, info) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width, height: 844 })
    // Production assets remain blocked except for the local lazy-loaded demo.
    for (const [tool, demo] of [['product', 'product'], ['shipping', 'template'], ['marketing', 'advertising'], ['fba', 'fba'], ['orders', 'shipping']]) {
      await page.goto(`/tools#tool-${tool}`)
      const button = page.locator(`[data-tool-experience="${tool}"]`)
      await button.scrollIntoViewIfNeeded()
      await button.focus()
      const beforeURL = page.url()
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('simulation')).toBeVisible()
      await expect(page.getByLabel('选择一键任务', { exact: true })).toHaveValue(demo!)
      await expect(page.getByTestId('run-status')).toHaveText('就绪')
      const lockedScroll = await page.evaluate(() => scrollY)
      await page.getByTestId('experience-close').click()
      await expect(button).toBeFocused()
      await expect(page.getByTestId('simulation')).toHaveCount(0)
      expect(await page.evaluate(() => scrollY)).toBe(lockedScroll)
      expect(page.url()).toBe(beforeURL)
      expect(await page.evaluate(() => localStorage.getItem('kst-public-simulation:v2'))).toBeNull()
    }
    await page.screenshot({ path: info.outputPath(`card-action-${width}.png`) })
  })
}

test('mobile tools have a short directory, compact details and task-aware consultation', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/tools')
  const directory = page.getByRole('navigation', { name: '工具页目录' })
  await expect(directory.getByRole('link')).toHaveCount(3)
  await expect(page.getByTestId('experience-start')).toBeInViewport({ ratio: 1 })
  await expect(page.locator('.tool-card')).toHaveCount(8)
  await expect(page.locator('.tool-details[open]')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThan(6000)
  const toolList = directory.getByRole('link', { name: '工具清单', exact: true })
  await toolList.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('#tool-list')).toBeInViewport()
  const details = page.locator('#tool-product .tool-details')
  await details.locator('summary').focus()
  await page.keyboard.press('Enter')
  await expect(details).toHaveAttribute('open', '')
  await expect(details).toContainText('准备什么')
  await expect(details.locator('p').first()).toBeVisible()
  await details.locator('summary').click()
  await expect(details).not.toHaveAttribute('open', '')
  for (const [id, title] of [['product', '发布商品'], ['orders', '订单发货']]) {
    const trigger = page.locator(`[data-tool-consult="${id}"]`)
    await trigger.scrollIntoViewIfNeeded()
    await trigger.focus()
    const position = await page.evaluate(() => scrollY)
    const url = page.url()
    await page.keyboard.press('Enter')
    const dialog = page.getByTestId('marketing-consultation-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(`咨询${title}`)
    await expect(page.getByTestId('consultation-wechat-account')).toHaveValue('Moweiiong')
    expect(await page.evaluate(() => scrollY)).toBe(position)
    expect(page.url()).toBe(url)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()
    expect(await page.evaluate(() => scrollY)).toBe(position)
  }
  await expect(page.locator('[data-tool-consult]')).toHaveCount(2)
  await expect(page.locator('#tool-shipping .tool-status')).toHaveText('暂未开放')
  await expect(page.locator('#tool-shipping [data-tool-experience]')).toContainText('在线体验')
  await page.screenshot({ path: info.outputPath('mobile-task-consultation.png') })
})

test('navigation prioritizes experience and charts use consistent before-after colors', async ({ page }) => {
  await page.goto('/tools')
  const experience = page.getByTestId('navigation-experience')
  const download = page.locator('.marketing-shell-download button').first()
  expect(await experience.evaluate(e => getComputedStyle(e).backgroundColor)).not.toBe(await download.evaluate(e => getComputedStyle(e).backgroundColor))
  expect((await download.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await download.focus()
  expect(await download.evaluate(e => parseFloat(getComputedStyle(e).outlineWidth))).toBeGreaterThanOrEqual(3)
  await page.goto('/')
  const card = page.getByTestId('metric-result').first()
  const colors = await card.evaluate(e => ({
    before: getComputedStyle(e.querySelector('.metric-bar-row em')!).backgroundColor,
    after: getComputedStyle(e.querySelector('.metric-bar-row-after em')!).backgroundColor,
    afterNumber: getComputedStyle(e.querySelector('[data-testid="after-number"]')!).color,
    delta: getComputedStyle(e.querySelector('.metric-saving')!).color,
  }))
  expect(colors.before).not.toBe(colors.after)
  expect(colors.after).toBe(colors.afterNumber)
  expect(colors.delta).not.toBe(colors.after)
})

test('mobile comparison bars start per visible card and never replay', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  const cards = page.getByTestId('metric-result')
  const revealBars = async (index: number) => cards.nth(index).locator('.metric-bars').evaluate(e => {
    window.scrollTo({ top: e.getBoundingClientRect().top + scrollY - innerHeight + e.getBoundingClientRect().height + 28, behavior: 'instant' })
  })
  await revealBars(0)
  await expect(cards.nth(0)).toHaveClass(/metric-bars-animate/)
  await expect(cards.nth(1)).not.toHaveClass(/metric-bars-animate/)
  await expect(cards.nth(2)).not.toHaveClass(/metric-bars-animate/)
  await page.waitForTimeout(1800)
  await expect(cards.nth(1)).not.toHaveClass(/metric-bars-animate/)
  await revealBars(1)
  await expect(cards.nth(1)).toHaveClass(/metric-bars-animate/)
  await expect(cards.nth(2)).not.toHaveClass(/metric-bars-animate/)
  await revealBars(2)
  await expect(cards.nth(2)).toHaveClass(/metric-bars-animate/)
  await page.waitForTimeout(1800)
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
  await revealBars(0)
  const states = await cards.nth(0).locator('.metric-bars').evaluate(e => e.getAnimations({ subtree: true }).map(a => a.playState))
  expect(states.every(state => state === 'finished')).toBe(true)
  await page.screenshot({ path: info.outputPath('per-card-comparison.png') })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  await cards.nth(0).scrollIntoViewIfNeeded()
  expect(await cards.nth(0).locator('.metric-bars').evaluate(e => e.getAnimations({ subtree: true }).length)).toBe(0)
  await expect(cards.nth(0).getByTestId('after-number')).toHaveText('2分钟')
})

function recordNavigationScroll(page: Page, duration = 900) {
  return page.evaluate(milliseconds => new Promise<{ y: number; path: string }[]>(resolve => {
    const samples: { y: number; path: string }[] = []
    const started = performance.now()
    const tick = () => {
      samples.push({ y: scrollY, path: location.pathname })
      if (performance.now() - started < milliseconds) requestAnimationFrame(tick)
      else resolve(samples)
    }
    tick()
  }), duration)
}

for (const width of [1440, 390]) {
  test(`anchors move once and keep keyboard focus nearby at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    for (const [route, hash] of [['/', 'scenes'], ['/competition', 'scenario-pains'], ['/course', 'scenario-pains'], ['/tools', 'tool-list']]) {
      await page.goto(route!)
      const link = page.locator(`a[href="#${hash}"]`).first()
      await link.scrollIntoViewIfNeeded()
      await link.focus()
      const samplesPromise = recordNavigationScroll(page)
      await page.keyboard.press('Enter')
      const samples = await samplesPromise
      // A native jump followed by a router correction reverses this trajectory.
      for (let index = 1; index < samples.length; ++index) expect(samples[index]!.y).toBeGreaterThanOrEqual(samples[index - 1]!.y - 1)
      expect(new Set(samples.map(sample => sample.y)).size).toBeGreaterThan(5)
      await expect(page.locator(`#${hash}`)).toBeFocused()
      const position = await page.evaluate(() => scrollY)
      await page.keyboard.press('Tab')
      expect(Math.abs(await page.evaluate(() => scrollY) - position)).toBeLessThan(5)
      expect(await page.evaluate(() => document.activeElement?.closest('.marketing-shell-nav') !== null)).toBe(false)
    }
  })

  test(`history restores reading position without flying or stale focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/tools')
    await page.getByRole('navigation', { name: '工具页目录' }).getByRole('link', { name: '申请使用', exact: true }).click()
    await expect(page.locator('#start')).toBeFocused()
    await page.goBack()
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0)
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => scrollY)).toBe(0)

    await page.locator('#tool-orders').evaluate(element => scrollTo({ top: scrollY + element.getBoundingClientRect().top - 100, behavior: 'instant' }))
    const position = await page.evaluate(() => scrollY)
    // Changing pages and restoring history must not inherit a global smooth scroll.
    const forward = recordNavigationScroll(page)
    await page.locator('.marketing-shell-links a[href="/competition"]').evaluate((link: HTMLAnchorElement) => link.click())
    const forwardSamples = (await forward).filter(sample => sample.path === '/competition')
    expect(new Set(forwardSamples.map(sample => sample.y)).size).toBeLessThanOrEqual(2)
    expect(await page.evaluate(() => scrollY)).toBe(0)
    const backward = recordNavigationScroll(page)
    await page.goBack()
    const backSamples = (await backward).filter(sample => sample.path === '/tools')
    expect(new Set(backSamples.map(sample => sample.y)).size).toBeLessThanOrEqual(2)
    expect(Math.abs(await page.evaluate(() => scrollY) - position)).toBeLessThan(2)
    await page.keyboard.press('Tab')
    expect(Math.abs(await page.evaluate(() => scrollY) - position)).toBeLessThan(5)

    await page.goto('/course#scenario-pains')
    await page.getByTestId('pain-products').click()
    const toolLink = page.locator('.comparison-body a[href="/tools#tool-product"]')
    await toolLink.scrollIntoViewIfNeeded()
    const scenarioPosition = await page.evaluate(() => scrollY)
    await toolLink.click()
    await expect(page.locator('#tool-product')).toBeFocused()
    await page.goBack()
    await expect(page.locator('#scenario-pains')).toBeVisible()
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => scrollY)).toBeGreaterThanOrEqual(scenarioPosition - 2)
    expect(await page.evaluate(() => document.activeElement?.closest('.marketing-shell-nav') !== null)).toBe(false)
  })
}

test('anchor motion can be interrupted and reduced motion arrives immediately', async ({ page }) => {
  await page.goto('/tools')
  const start = page.getByRole('navigation', { name: '工具页目录' }).getByRole('link', { name: '申请使用', exact: true })
  await start.click()
  await page.waitForTimeout(140)
  await page.mouse.wheel(0, 100)
  await page.waitForTimeout(100)
  const interrupted = await page.evaluate(() => scrollY)
  await page.waitForTimeout(650)
  expect(Math.abs(await page.evaluate(() => scrollY) - interrupted)).toBeLessThan(2)
  expect(await page.locator('#start').evaluate(element => element.getBoundingClientRect().top)).toBeGreaterThan(500)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/tools')
  const immediate = recordNavigationScroll(page, 500)
  await start.click()
  const samples = await immediate
  expect(new Set(samples.map(sample => sample.y)).size).toBeLessThanOrEqual(2)
  await expect(page.locator('#start')).toBeFocused()
})
