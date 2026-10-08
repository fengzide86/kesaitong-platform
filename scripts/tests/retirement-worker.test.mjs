import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

test('retirement worker removes only its exact KST precache and unregisters', async () => {
  const source = fs.readFileSync(new URL('../../ops/web-retired/sw.js', import.meta.url), 'utf8')
  const events = new Map()
  const scope = 'https://example.test/'
  const cacheKeys = new Set([
    `workbox-precache-v2-${scope}`, 'workbox-precache-v2-https://example.test/other/',
    'workbox-runtime-https://example.test/', 'customer-cache', 'unrelated-v1',
  ])
  const navigations = []
  let unregistered = 0
  let skipped = 0
  vm.runInNewContext(source, {
    self: {
      addEventListener: (name, handler) => events.set(name, handler),
      skipWaiting: async () => { skipped++ },
      registration: { scope, unregister: async () => { unregistered++ } },
      clients: { matchAll: async () => [{ navigate: async target => { navigations.push(target) } }] },
    },
    caches: { keys: async () => [...cacheKeys], delete: async key => cacheKeys.delete(key) },
  })
  let pending
  const event = { waitUntil: promise => { pending = promise } }
  events.get('install')(event)
  await pending
  events.get('activate')(event)
  await pending
  assert.equal(skipped, 1)
  assert.equal(unregistered, 1)
  assert.equal(cacheKeys.size, 4)
  assert.ok(cacheKeys.has('workbox-precache-v2-https://example.test/other/'))
  assert.ok(cacheKeys.has('customer-cache'))
  assert.deepEqual(navigations, ['https://kesaitong.top/#'])
  assert.equal(events.has('fetch'), false, 'retired worker must not intercept API/update requests')
})
