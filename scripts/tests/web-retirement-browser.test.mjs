import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { once } from 'node:events'
import { after, before, test } from 'node:test'

const retirementWorker = fs.readFileSync(new URL('../../ops/web-retired/sw.js', import.meta.url), 'utf8')
const officialSite = 'https://kesaitong.top/#'
const oldWorker = `
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
`
let browser

before(async () => {
  // Match the repo's shared D-drive browser cache when called without its wrapper.
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && process.platform === 'win32') {
    process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.env.TOOLBOX_DATA_ROOT || 'D:\\AmazonToolboxData', 'playwright-browsers')
  }
  const { chromium } = await import('playwright-core')
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim() || undefined,
  })
})

after(async () => { await browser?.close() })

for (const scope of ['/', '/legacy/']) {
  test(`real Chromium retires only the business worker at scope ${scope}`, { timeout: 45_000 }, async () => {
    let retired = false
    const server = http.createServer((request, response) => {
      response.setHeader('Cache-Control', 'no-store')
      if (request.url?.split('?')[0] === `${scope}sw.js`) {
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8')
        response.end(retired ? retirementWorker : oldWorker)
      } else {
        response.setHeader('Content-Type', 'text/html; charset=utf-8')
        response.end('<!doctype html><title>Isolated KST retirement fixture</title><main>Old business page</main>')
      }
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const origin = `http://127.0.0.1:${server.address().port}`
    const context = await browser.newContext({ serviceWorkers: 'allow' })
    const publicNavigations = []
    const unexpectedRequests = []
    await context.route('**/*', async route => {
      const incoming = new URL(route.request().url())
      if (incoming.origin === origin) return route.continue()
      if (incoming.origin === 'https://kesaitong.top') {
        publicNavigations.push(incoming.href)
        return route.fulfill({ contentType: 'text/html', body: '<title>Official website fixture</title>' })
      }
      unexpectedRequests.push(incoming.href)
      return route.abort()
    })

    try {
      const page = await context.newPage()
      await page.goto(`${origin}${scope}old?session_fixture=do-not-forward#/admin/orders?old_fragment=private`)
      await page.evaluate(async ({ workerPath, workerScope }) => {
        await navigator.serviceWorker.register(workerPath, { scope: workerScope })
        await navigator.serviceWorker.ready
      }, { workerPath: `${scope}sw.js`, workerScope: scope })
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null)

      const secondary = await context.newPage()
      await secondary.goto(`${origin}${scope}secondary?other_fixture=private#/agent/orders`)
      await secondary.waitForFunction(() => navigator.serviceWorker.controller !== null)
      const ownedCache = `workbox-precache-v2-${origin}${scope}`
      const unrelatedCaches = [
        `workbox-precache-v2-${origin}/unrelated/`,
        'kst-user-local-cache',
        'other-app-cache',
      ]
      await page.evaluate(async ({ owned, keep }) => {
        for (const name of [owned, ...keep]) {
          const cache = await caches.open(name)
          await cache.put('/fixture-cache-entry', new Response(name))
        }
        localStorage.setItem('kst-retirement-fixture', 'preserve-local-account-preferences')
        document.cookie = 'kst-retirement-fixture=preserve-cookie; path=/; SameSite=Lax'
      }, { owned: ownedCache, keep: unrelatedCaches })

      retired = true
      const navigated = Promise.all([
        page.waitForURL(officialSite, { timeout: 20_000 }),
        secondary.waitForURL(officialSite, { timeout: 20_000 }),
      ])
      // Do not await the update in the page: successful activation destroys its context.
      await page.evaluate(() => {
        void navigator.serviceWorker.getRegistration().then(registration => registration?.update())
      })
      await navigated
      for (const target of [page, secondary]) {
        assert.equal(target.url(), officialSite)
        assert.equal(new URL(target.url()).search, '')
        assert.equal(new URL(target.url()).hash, '')
      }
      assert.equal(publicNavigations.length, 2)
      assert.ok(publicNavigations.every(url => url === 'https://kesaitong.top/'))
      assert.deepEqual(unexpectedRequests, [])

      const probe = await context.newPage()
      await probe.goto(`${origin}${scope}probe`)
      const remaining = await probe.evaluate(async () => {
        const cacheNames = await caches.keys()
        const entries = {}
        for (const name of cacheNames) {
          entries[name] = await (await (await caches.open(name)).match('/fixture-cache-entry'))?.text()
        }
        return {
          registrations: (await navigator.serviceWorker.getRegistrations()).map(registration => registration.scope),
          cacheNames,
          entries,
          localValue: localStorage.getItem('kst-retirement-fixture'),
          cookie: document.cookie,
          controlled: Boolean(navigator.serviceWorker.controller),
        }
      })
      assert.deepEqual(remaining.registrations, [])
      assert.equal(remaining.controlled, false)
      assert.deepEqual(remaining.cacheNames.sort(), unrelatedCaches.sort())
      for (const name of unrelatedCaches) assert.equal(remaining.entries[name], name)
      assert.equal(remaining.localValue, 'preserve-local-account-preferences')
      assert.match(remaining.cookie, /kst-retirement-fixture=preserve-cookie/)
    } finally {
      await context.close()
      server.closeAllConnections()
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })
}
