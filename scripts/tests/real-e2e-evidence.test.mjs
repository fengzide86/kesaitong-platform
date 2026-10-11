import assert from 'node:assert/strict'
import test from 'node:test'
import { basename } from 'node:path'
import { finalizeRealE2eEvidence, redactRealE2eLog } from '../real-e2e-evidence.mjs'

test('keeps backend stack and error while removing exact fixture secrets', () => {
  const result = redactRealE2eLog('Traceback\n export_orders.py:12\nRuntimeError\nfixture-secret\nseed-secret', ['fixture-secret', 'seed-secret'])
  assert.match(result, /Traceback\n export_orders.py:12\nRuntimeError/)
  assert.doesNotMatch(result, /fixture-secret|seed-secret/)
})

test('redacts bearer, cookies, JWT and test authorization across line endings', () => {
  const syntheticToken = ['eyJhbGciOiJIUzI1NiJ9', 'eyJ0ZXN0Ijp0cnVlfQ', 'inertsignature'].join('.')
  const result = redactRealE2eLog(`Authorization: Bearer inert\r\nCookie: test=inert\nSet-Cookie: test=inert\nE2E-B-aabbcc\n${syntheticToken}`)
  assert.doesNotMatch(result, /inert|aabbcc|eyJ/)
  assert.match(result, /Authorization: \[REDACTED\]\r\n/)
})

test('does not erase the log for empty or numeric credential metadata', () => {
  assert.equal(redactRealE2eLog('200 response followed by ECONNRESET', ['', 17, null]), '200 response followed by ECONNRESET')
})

test('strips terminal controls and longer overlapping secrets first', () => {
  assert.equal(redactRealE2eLog('\x1b[31msecret-extended\x1b[0m', ['secret', 'secret-extended']), '[TEST-SECRET]')
})

test('removes licenses created during the delivery journey, not only seed credentials', () => {
  const generated = `KST-${'AB12'.repeat(6)}`
  assert.equal(redactRealE2eLog(`Expected: ${generated}\nReceived: ${generated}`), 'Expected: [GENERATED-LICENSE]\nReceived: [GENERATED-LICENSE]')
})

function fakeFiles(failure) {
  const operations = []
  return { operations, io: {
    async readFile(filename) {
      const name = basename(filename)
      if (name === '.kst-real-e2e-owned') return failure === 'ownership' ? 'unowned' : 'kst-real-e2e-v1'
      if (name === 'credentials.json') return '{"password":"inert-secret"}'
      if (failure === 'read') throw new Error('inert-secret must not be logged')
      return 'Traceback\ninert-secret'
    },
    async writeFile(_filename, value) {
      if (failure === 'write') throw new Error('disk full')
      operations.push(value)
    },
    async rm(filename) { operations.push(`remove:${basename(filename)}`) },
  } }
}

for (const phase of ['read', 'write', 'close']) {
  test(`credential cleanup still happens after ${phase} failure without throwing over the original failure`, async () => {
    const files = fakeFiles(phase)
    const errors = await finalizeRealE2eEvidence('/owned-fixture', {
      closeLog: async () => { if (phase === 'close') throw new Error('close failure') },
    }, files.io)
    assert.ok(errors.includes(phase === 'close' ? 'log-close' : 'evidence-write'))
    assert.ok(files.operations.includes('remove:credentials.json'))
    assert.doesNotMatch(errors.join(' '), /inert-secret/)
  })
}

test('never deletes credentials when ownership marker does not match', async () => {
  const files = fakeFiles('ownership')
  const errors = await finalizeRealE2eEvidence('/unowned', { closeLog: async () => {} }, files.io)
  assert.deepEqual(errors, ['ownership-check'])
  assert.deepEqual(files.operations, [])
})
