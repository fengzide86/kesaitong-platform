/** Local fixture-only visual acceptance. Does not log into or write to an external platform. */
/* global process, URL, document, window, console */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const origin = process.env.KST_TARGET_UI_ORIGIN || 'http://127.0.0.1:4316'
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Only local UI fixtures are allowed')
const output = path.resolve(process.env.KST_TARGET_UI_OUTPUT || 'D:/AmazonToolboxData/audits/kst-multi-target-ui-20261012')
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.KST_EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const results = []
try {
  for (const dimensions of [{ width: 1366, scale: 1 }, { width: 1280, scale: 1 }, { width: 1024, scale: 1 }, { width: 1280, scale: 1.25 }]) {
    // 125% uses an equivalent CSS viewport and device scale; this is not a native Windows DPI claim.
    const page = await browser.newPage({ viewport: { width: Math.round(dimensions.width / dimensions.scale), height: Math.round(900 / dimensions.scale) }, deviceScaleFactor: dimensions.scale, reducedMotion: 'reduce' })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const external = []
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin === new URL(origin).origin) return route.continue()
      external.push(route.request().url()); return route.abort()
    })
    const suffix = `${dimensions.width}-${dimensions.scale === 1 ? '100' : '125'}pct`
    // Capture from the top so fixed navigation is not recorded at the last
    // clicked form control's scrolled document position in a full-page image.
    const capture = async name => { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(output, `${name}-${suffix}.png`), fullPage: true }) }
    await page.goto(`${origin}/tests/fixtures/target-ui.html`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('tool-card-配送模板').waitFor()
    await capture('user-collapsed')
    await page.getByTestId('tool-card-配送模板').click()
    await page.locator('.drawer-primary').click()
    await page.getByTestId('target-profile-select').selectOption('school-a')
    await page.getByTestId('target-open').click()
    await page.getByTestId('target-detect').click()
    await page.getByTestId('context-choice').selectOption('formal')
    await page.locator('input[placeholder="输入本次要创建的模板名称"]').fill('比赛模板 · UI 样例')
    await page.getByTestId('add-rule').click()
    await page.locator('.template-form > button').click()
    await page.locator('.target-preview').waitFor()
    await capture('user-preview')
    const userOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    if (!await page.locator('.directory-filters input[type="search"]').count()) throw new Error('Existing search was removed')
    if (!await page.locator('.formal-warning').count()) throw new Error('Formal competition warning missing')
    if (await page.locator('.target-confirm').count()) throw new Error('Fixture must not claim formal competition is executable')
    if (!await page.getByTestId('training-scope').count()) throw new Error('Reviewed course training scope is missing')
    await page.getByTestId('context-choice').selectOption('training')
    await page.locator('input[placeholder="输入本次要创建的模板名称"]').fill('实训模板 · UI 样例')
    await page.locator('.template-form > button').click()
    await page.locator('.target-confirm input').check()
    await page.locator('.target-preview button').click()
    await page.locator('.target-result.verified').waitFor()
    await capture('user-result')
    await page.getByTestId('target-refresh').click()
    await page.getByRole('status').filter({ hasText: '已刷新原平台窗口' }).waitFor()
    if (await page.locator('.target-preview').count()) throw new Error('Refresh retained stale executable plan')
    if (!await page.locator('.target-result.verified').count()) throw new Error('Refresh discarded business receipt')
    await capture('user-refresh')
    // Start from a persisted unknown-result receipt and prove the same plan
    // is blocked before the final submit button is rendered.
    await page.goto(`${origin}/tests/fixtures/target-ui.html?recovery=1`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('tool-card-配送模板').waitFor()
    await page.getByTestId('tool-card-配送模板').click()
    await page.locator('.drawer-primary').click()
    await page.getByTestId('target-profile-select').selectOption('school-a')
    await page.getByTestId('target-open').click()
    await page.getByTestId('target-detect').click()
    await page.locator('input[placeholder="输入本次要创建的模板名称"]').fill('测试模板')
    await page.locator('.template-form > button').click()
    await page.locator('.target-preview').waitFor()
    await page.getByRole('alert').filter({ hasText: '不能重复提交' }).waitFor()
    if (await page.getByRole('button', { name: '确认范围，创建并核验模板' }).count()) throw new Error('Unknown-result receipt did not block final submit')
    await capture('user-needs-review')
    await page.goto(`${origin}/tests/fixtures/target-ui.html?admin=1`, { waitUntil: 'domcontentloaded' })
    await page.locator('.target-review summary').click()
    await page.locator('.review-form').waitFor()
    await page.getByRole('textbox', { name: '课程地图指纹', exact: true }).waitFor()
    await page.getByRole('textbox', { name: '模板列表指纹', exact: true }).waitFor()
    await page.getByRole('textbox', { name: '模板编辑页指纹', exact: true }).waitFor()
    await page.getByRole('textbox', { name: '课程指纹 1', exact: true }).waitFor()
    await capture('admin-review')
    const adminOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    const result = { ...dimensions, cssWidth: Math.round(dimensions.width / dimensions.scale), userOverflow, adminOverflow, pageErrors: errors, externalRequests: external.length, scope: 'fixture UI only; 125% equivalent CSS viewport, not Windows native DPI or business acceptance' }
    results.push(result)
    console.log(JSON.stringify(result))
    await page.close()
    if (userOverflow || adminOverflow || errors.length || external.length) throw new Error(`UI acceptance failed at ${suffix}`)
  }
} finally {
  writeFileSync(path.join(output, 'visual-results.json'), JSON.stringify(results, null, 2))
  await browser.close()
}
