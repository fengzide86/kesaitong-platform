import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkAudit } from '../audit-dependencies.mjs'

const clean = { metadata: { vulnerabilities: { total: 0 } }, vulnerabilities: {} }
const issue = { metadata: { vulnerabilities: { total: 2 } }, vulnerabilities: { a: {
  via: [{ name: 'build-only', url: 'https://github.com/advisories/GHSA-abcd-abcd-abcd' }],
}, parent: { via: ['a'] } } }
const policy = { expires: '2026-10-25', entries: [{ package: 'build-only', advisory: 'GHSA-abcd-abcd-abcd', reason: 'Test policy' }] }
test('reviewed build-only transitive findings have a finite exception', () => {
  assert.equal(checkAudit(clean, issue, policy, new Date('2026-10-11')).reviewedBuildAdvisories, 1)
})
test('runtime findings never inherit build exceptions', () => assert.throws(() => checkAudit(issue, issue, policy)))
test('expired and unknown advisories fail closed', () => {
  assert.throws(() => checkAudit(clean, issue, policy, new Date('2026-10-26')))
  assert.throws(() => checkAudit(clean, issue, { ...policy, entries: [] }, new Date('2026-10-11')))
})
test('registry failures are not a clean audit', () => assert.throws(() => checkAudit({}, clean, policy)))
