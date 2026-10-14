import { generateKeyPairSync, sign } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { recipeSchema, type TargetProfile, type TargetPreflightRequest } from '../../shared/ipc/target-contract'
import { targetObservation, targetPreview, targetProfile } from '../features/target-fixtures'

const require = createRequire(import.meta.url)
const policy = require(resolve('dist-electron/electron/automation/targets/profile-policy.cjs')) as typeof import('../../../electron/automation/targets/profile-policy.cjs')
const plans = require(resolve('dist-electron/electron/automation/targets/run-plan.cjs')) as typeof import('../../../electron/automation/targets/run-plan.cjs')
const { TargetOperationJournal } = require(resolve('dist-electron/electron/automation/targets/operation-journal.cjs')) as typeof import('../../../electron/automation/targets/operation-journal.cjs')
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const pub = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64')
function profile(): TargetProfile {
  const p = targetProfile().profile
  p.allowedRoutes = [{ origin: 'https://school.example', pathPrefix: '/entry', role: 'entry' }, { origin: 'https://school.example', pathPrefix: '/ECrossAmazon', role: 'business' }]
  return p
}
function signed(p = profile()) { return { profile: p, signingKeyId: 'test', signature: sign(null, Buffer.from(policy.stableJson(p)), privateKey).toString('base64') } }
function request(): TargetPreflightRequest { return { profileId: 'school-a', profileRevision: 1, toolId: 'template', scenario: 'training', stage: 'not_applicable', input: targetPreview().plan.input } }
function plan() { return plans.buildTargetPlan(request(), profile(), targetObservation()) }

describe('target profile signature and path isolation', () => {
  it('verifies a canonical signed profile including Chinese fields', () => { expect(policy.verifyTargetProfile(signed(), pub).profile.name).toBe('学校实训') })
  it.each(['edition', 'entryUrl', 'capabilities', 'name'])('rejects a tampered %s', key => {
    const envelope = signed(); (envelope.profile as Record<string, unknown>)[key] = key === 'capabilities' ? [] : key === 'entryUrl' ? 'https://other.example/entry' : key === 'edition' ? 'v3' : 'changed'
    expect(() => policy.verifyTargetProfile(envelope, pub)).toThrow('TARGET_SIGNATURE_INVALID')
  })
  it('unknown and V3 approval cannot enable V2', () => {
    for (const edition of ['v3', 'unknown'] as const) expect(() => policy.verifyTargetProfile(signed({ ...profile(), edition }), pub)).toThrow('TARGET_NOT_APPROVED')
  })
  it.each(['https://school.example/ECrossAmazonExtra', 'https://school.example.evil.test/ECrossAmazon', 'https://other.school.example/ECrossAmazon', 'https://school.example/ECrossAmazon/%252e%252e/User', 'http://school.example/ECrossAmazon'])('rejects unaudited route %s', url => { expect(policy.routeAllowed(url, profile())).toBe(false) })
  it('allows the same audited origin and segment with query kept ephemeral', () => { expect(policy.routeAllowed('https://school.example/ECrossAmazon/SellerIndex?paras=ephemeral', profile(), 'business')).toBe(true); expect(policy.redactedUrl('https://school.example/entry?paras=x#token')).toBe('https://school.example/entry') })
  it('accepts a credential-free WebVPN V2 entry only within its reviewed origin and path', () => {
    const webVpnOrigin = 'https://http-10-28-2-187-851.webvpn.gtcfla.edu.cn'
    const webVpn = { ...profile(), entryUrl: `${webVpnOrigin}/User/LoginPage24`, allowedRoutes: [
      { origin: webVpnOrigin, pathPrefix: '/User/LoginPage24', role: 'entry' as const },
      { origin: webVpnOrigin, pathPrefix: '/User', role: 'login' as const },
      { origin: webVpnOrigin, pathPrefix: '/ECrossCommon', role: 'login' as const },
      { origin: webVpnOrigin, pathPrefix: '/ECrossCommon/CourseIndexTrainingCourse', role: 'business' as const },
      { origin: webVpnOrigin, pathPrefix: '/ECrossCommon/CourseUpdatePersonalProfile', role: 'business' as const },
      { origin: webVpnOrigin, pathPrefix: '/ECrossAmazonHome', role: 'business' as const },
      { origin: webVpnOrigin, pathPrefix: '/ECrossAmazon', role: 'business' as const },
    ] }
    const signedWebVpn = signed(webVpn)
    expect(policy.redactedUrl(`${webVpnOrigin}/User/LoginPage24?paras=fixture-only#fragment`)).toBe(webVpn.entryUrl)
    expect(policy.routeAllowed(`${webVpnOrigin}/User/LoginPage24?paras=fixture-only`, webVpn, 'entry')).toBe(true)
    expect(policy.routeAllowed(`${webVpnOrigin}/User/LoginPage24`, webVpn, 'login')).toBe(true)
    expect(policy.routeAllowed(`${webVpnOrigin}/ECrossCommon/CourseIndexTrainingCourse?paras=fixture-only`, webVpn, 'business')).toBe(true)
    expect(policy.routeAllowed(`${webVpnOrigin}/ECrossCommon/CourseUpdatePersonalProfile`, webVpn, 'business')).toBe(true)
    expect(policy.routeAllowed(`${webVpnOrigin}/ECrossAmazonHome/CourseIndexTrainingCourse?paras=fixture-only`, webVpn, 'business')).toBe(true)
    expect(policy.routeAllowed(`${webVpnOrigin}/User/LoginPage240`, webVpn, 'entry')).toBe(false)
    expect(policy.routeAllowed('https://other.webvpn.gtcfla.edu.cn/User/LoginPage24', webVpn, 'entry')).toBe(false)
    expect(policy.verifyTargetProfile(signedWebVpn, pub).profile.entryUrl).toBe(webVpn.entryUrl)
  })
  it.each(['file:///C:/secret', 'javascript:alert(1)', 'https://user:pass@school.example/', 'http://127.0.0.1/admin', 'http://192.168.1.1/', 'https://sellercentral.amazon.com/'])('rejects invalid entry %s', url => { expect(() => policy.checkedUrl(url)).toThrow() })
})

describe('locked target plan', () => {
  it('uses the same adapter for another verified deployment, but creates isolated scope', () => {
    const a = plan(); const p = { ...profile(), id: 'school-b' }
    const b = plans.buildTargetPlan({ ...request(), profileId: p.id }, p, targetObservation())
    expect(a.adapterVersion).toBe(b.adapterVersion); expect(a.contextHash).not.toBe(b.contextHash)
  })
  it('does not create practice/formal plans without independently reviewed competition evidence', () => {
    for (const stage of ['practice', 'formal'] as const) expect(() => plans.buildTargetPlan({ ...request(), scenario: 'competition', stage }, profile(), targetObservation())).toThrow('TARGET_SCENARIO_UNVERIFIED')
  })
  it.each(['courseRef', 'shopRef', 'localAccountRef', 'role'] as const)('blocks relogin scope change: %s', key => {
    const changed = { ...targetObservation(), [key]: key === 'role' ? 'buyer' : 'e'.repeat(64) }
    expect(() => plans.assertPlanContext(plan(), profile(), changed)).toThrow('TARGET_CONTEXT_CHANGED')
  })
  it('blocks unknown identity and version drift', () => {
    expect(() => plans.buildTargetPlan(request(), profile(), { ...targetObservation(), localAccountRef: null, missing: ['account-identity-unverified'] })).toThrow('TARGET_CONTEXT_INCOMPLETE')
    expect(() => plans.buildTargetPlan(request(), profile(), { ...targetObservation(), version: 'v3' })).toThrow('TARGET_CONTEXT_INCOMPLETE')
    expect(() => plans.buildTargetPlan(request(), profile(), { ...targetObservation(), pageFingerprint: 'e'.repeat(64) })).toThrow('TARGET_STRUCTURE_CHANGED')
  })
  it('expires without extending permission and rejects revision drift', () => {
    const p = plan()
    expect(() => plans.assertPlanContext(p, profile(), targetObservation(), Date.parse(p.expiresAt))).toThrow('TARGET_PLAN_EXPIRED')
    expect(() => plans.assertPlanContext(p, { ...profile(), revision: 2 }, targetObservation())).toThrow('TARGET_REVISION_CHANGED')
  })
})

describe('durable operation lifecycle', () => {
  const directory = () => mkdtempSync(join(tmpdir(), 'kst-target-journal-test-'))
  it('writes before mutation and does not reopen an uncertain operation after restart', () => {
    const root = directory(); const store = new TargetOperationJournal(root); const p = plan(); const receipt = store.begin('owner', p)
    store.transition('owner', receipt.id, { status: 'submitting' })
    const reopened = new TargetOperationJournal(root)
    expect(reopened.list('owner')[0]?.status).toBe('needs_review')
    expect(() => reopened.begin('owner', p)).toThrow('TARGET_DUPLICATE_OR_UNKNOWN')
    expect(() => reopened.transition('owner', receipt.id, { status: 'not_submitted' })).toThrow('TARGET_RESULT_UNKNOWN')
  })
  it('prepared crash is conservative; profile revision does not bypass duplicate protection', () => {
    const root = directory(); const store = new TargetOperationJournal(root); const p = plan(); store.begin('owner', p)
    expect(new TargetOperationJournal(root).list('owner')[0]?.status).toBe('needs_review')
    const upgraded = { ...p, context: { ...p.context, profileRevision: 2 } }
    expect(() => store.begin('owner', upgraded)).toThrow('TARGET_DUPLICATE_OR_UNKNOWN')
    const relabelled = { ...p, context: { ...p.context, profileId: 'same-site-new-label', scenario: 'competition' as const, stage: 'formal' as const } }
    expect(() => store.begin('owner', relabelled)).toThrow('TARGET_DUPLICATE_OR_UNKNOWN')
  })
  it('isolates account ownership and preserves verified terminal receipt', () => {
    const store = new TargetOperationJournal(directory()); const receipt = store.begin('owner', plan())
    expect(store.list('other')).toEqual([]); expect(() => store.get('other', receipt.id)).toThrow('TARGET_OPERATION_NOT_FOUND')
    expect(() => store.transition('owner', receipt.id, { status: 'verified' })).toThrow('TARGET_VERIFY_PROOF_REQUIRED')
    store.transition('owner', receipt.id, { status: 'verified', objectRef: '101', checks: ['same-object'] })
    expect(() => store.transition('owner', receipt.id, { status: 'needs_review' })).toThrow('TARGET_RECEIPT_FINAL')
  })
  it('stops if durable storage cannot be written, rather than allowing a UI write', () => {
    const path = join(directory(), 'not-a-directory'); writeFileSync(path, 'fixture')
    const store = new TargetOperationJournal(path); let submitted = false
    try { store.begin('owner', plan()); submitted = true } catch { /* expected */ }
    expect(submitted).toBe(false)
  })
  it('refuses corruption instead of overwriting history', () => {
    const root = directory(); writeFileSync(join(root, 'target-operations-v1.json'), '{bad')
    expect(() => new TargetOperationJournal(root)).toThrow('TARGET_JOURNAL_INVALID')
  })
})

describe('developer recipes are data, not remote programs', () => {
  const recipe = { schemaVersion: 1, id: 'template.create', version: '1.0.0', platformKey: 'amazon', supportedEditions: ['v2'], requiredCapability: 'template.create.v1', adapterVersion: 'bjysoft-v2-template.1', input: request().input,
    steps: ['read.context', 'read.templates', 'assert.unique', 'persist.intent', 'write.template', 'verify.same-object', 'persist.receipt'] }
  it('accepts the reviewed declarative sequence', () => { expect(recipeSchema.safeParse(recipe).success).toBe(true) })
  it.each(['javascript', 'python', 'command', 'selector'])('rejects arbitrary %s', key => { expect(recipeSchema.safeParse({ ...recipe, [key]: 'untrusted' }).success).toBe(false) })
  it('rejects skipped write-ahead or repeated writes', () => { expect(recipeSchema.safeParse({ ...recipe, steps: ['write.template', 'write.template'] }).success).toBe(false) })
})
