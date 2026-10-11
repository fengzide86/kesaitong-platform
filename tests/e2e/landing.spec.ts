import { expect, test } from '@playwright/test'

// This is the desktop/local renderer preview, not the public marketing build.
// Current marketing, dialogs, mobile navigation and download checks belong to
// marketing-site / marketing-experience / marketing-simulation under verify:marketing.
// Server retirement (redirects, 410, API/update preservation) has its own release gate.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: [] }),
  }))
})

test('本地根预览不启动业务接口或恢复旧应用入口', async ({ page }) => {
  const businessRequests: string[] = []
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname
    if (pathname.startsWith('/api/') && pathname !== '/api/health/live') businessRequests.push(pathname)
  })
  await page.goto('/')
  await expect(page.getByTestId('marketing-hero')).toBeVisible()
  await expect(page.getByRole('navigation', { name: '官网导航' })).toBeVisible()
  await expect(page.locator('aside[aria-label="管理员导航"], .studio-sidebar, .business-sidebar')).toHaveCount(0)
  await expect(page.locator('a[href*="/admin/login"], a[href*="/user/login"], a[href*="/agent/login"]')).toHaveCount(0)
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0)
  await expect(page.getByText('hello@kst.example', { exact: true })).toHaveCount(0)
  expect(businessRequests).toEqual([])
})

test('桌面端根入口仍进入授权登录，不显示本地官网预览', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'electronAPI', { value: {}, configurable: true }) })
  await page.goto('/')
  await expect(page).toHaveURL(/#\/user\/login$/)
  await expect(page.locator('#authCode')).toBeVisible()
  await expect(page.getByTestId('marketing-hero')).toHaveCount(0)
})

for (const scenario of [
  { path: '/user/tools', login: 'user/login' },
  { path: '/business/workspace', login: 'user/login' },
  { path: '/admin/dashboard', login: 'admin/login' },
  { path: '/agent/overview', login: 'admin/login' },
]) {
  test(`未登录的本地 ${scenario.path} 仍由对应登录守卫保护`, async ({ page }) => {
    await page.goto(`/#${scenario.path}`)
    await expect.poll(() => new URL(page.url()).hash).toBe(`#/${scenario.login}`)
    await expect(page.locator(scenario.login === 'user/login' ? '#authCode' : '#adminUsername')).toBeVisible()
    await expect(page.getByRole('complementary', { name: '管理员导航' })).toHaveCount(0)
  })
}

test('未知本地路由保持未找到，不伪装成营销页或业务成功', async ({ page }) => {
  await page.goto('/#/missing-local-entry')
  await expect(page.getByRole('heading', { name: '这个页面不存在' })).toBeVisible()
  await expect(page.getByRole('link', { name: '返回可用页面' })).toBeVisible()
  await expect(page.getByTestId('marketing-hero')).toHaveCount(0)
  await expect(page.locator('#authCode')).toHaveCount(0)
})
