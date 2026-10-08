// Independent render inspection. Only a loopback preview may be inspected.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright-core'

const origin = new URL(process.argv[2] || 'http://127.0.0.1:4300')
assert.equal(origin.hostname, '127.0.0.1')
assert.equal(origin.protocol, 'http:')
const evidenceRoot = path.resolve(process.argv[3] || 'test-results/local-experience-visual')
await mkdir(evidenceRoot, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const evidence = { origin: origin.origin, screenshots: [], requests: [], errors: [] }
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' })
    const page = await context.newPage()
    page.on('pageerror', error => evidence.errors.push(error.message))
    page.on('request', request => {
      const url = new URL(request.url())
      if (['http:', 'https:'].includes(url.protocol)) {
        evidence.requests.push({ origin: url.origin, path: url.pathname, method: request.method() })
        assert.equal(url.origin, origin.origin, 'The static simulation must not contact external services')
        assert.ok(!url.pathname.startsWith('/api/'), 'The simulation has no business API')
      }
    })
    for (const route of ['/', '/competition', '/course', '/tools', '/terms', '/demo', '/unknown-local-check']) {
      const response = await page.goto(new URL(route, origin).href)
      assert.equal(response.status(), route === '/unknown-local-check' ? 404 : 200)
      await page.locator('h1').first().waitFor()
      await page.evaluate(() => document.fonts.ready)
      await page.evaluate(() => Promise.all(document.getAnimations()
        .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => undefined))))
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
      assert.ok(overflow <= 1, `${route} at ${width}px has page overflow ${overflow}px`)
      const filename = `${width}-${route.slice(1) || 'home'}.png`
      await page.screenshot({ path: path.join(evidenceRoot, filename), fullPage: true })
      evidence.screenshots.push({ filename, route, width, overflow })
      if (route === '/demo') {
        for (const section of ['inventory', 'templates', 'advertising', 'orders', 'warehouse']) {
          await page.locator(`[data-action="nav-${section}"]`).click()
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
          assert.ok(overflow <= 1, `${section} at ${width}px has page overflow ${overflow}px`)
          const filename = `${width}-demo-${section}.png`
          await page.screenshot({ path: path.join(evidenceRoot, filename), fullPage: true })
          evidence.screenshots.push({ filename, route: `/demo#${section}`, width, overflow })
        }
        await page.locator('[data-action="nav-inventory"]').click()
        await page.locator('[data-action="new-product"]').click()
        const filename = `${width}-demo-product.png`
        await page.screenshot({ path: path.join(evidenceRoot, filename), fullPage: true })
        evidence.screenshots.push({ filename, route: '/demo#product', width })
      }
    }
    await context.close()
  }
  assert.deepEqual(evidence.errors, [])
  evidence.status = 'passed'
} catch (error) {
  evidence.status = 'failed'
  evidence.errors.push(String(error))
  throw error
} finally {
  await browser.close()
  await writeFile(path.join(evidenceRoot, 'visual-network-evidence.json'), JSON.stringify(evidence, null, 2))
}
console.log(`visual_inspection=passed (${evidence.screenshots.length} rendered screens; no external/API requests)`)
