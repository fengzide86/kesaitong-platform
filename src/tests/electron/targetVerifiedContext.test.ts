import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LocalContextValidation } from '../../../electron/automation/targets/verified-context.cjs'
import type { TargetPreflightRequest } from '../../shared/ipc/target-contract'
import { targetObservation, targetPreview, targetProfile } from '../features/target-fixtures'

const require = createRequire(import.meta.url)
const identity = require(resolve('dist-electron/electron/automation/targets/verified-context.cjs')) as typeof import('../../../electron/automation/targets/verified-context.cjs')
const plans = require(resolve('dist-electron/electron/automation/targets/run-plan.cjs')) as typeof import('../../../electron/automation/targets/run-plan.cjs')
const now = Date.parse('2026-10-12T12:00:00Z')
const origin = 'https://fixture.invalid'
function evidence(): LocalContextValidation {
  return { origin, siteEpoch: 7, logoHash: identity.VERIFIED_V2_LOGO_SHA256,
    loginEvidence: { origin, siteEpoch: 7, loginType: '24', accountRef: identity.localLoginAccountRef(origin, '24', '880001'), authenticatedAt: now - 1000 },
    map: { origin, path: '/ECrossAmazonHome/GetPage', httpStatus: 200, code: 0, request: { courseId: '101' }, record: { A1001: '101', B3001: '303', B3101: '202', A0902: '404' } },
    identity: { origin, path: '/ECrossCommon/GetPersonalProfileInformation', httpStatus: 200, code: 0, request: { userId: '404', loginType: '24' }, record: { LoginName: '880001', StudentNo: '880001' } },
    identityField: { value: '880001', readonly: true } }
}
const page = () => ({ origin, siteEpoch: 7, courseId: '101', companyId: '303', shopId: '202', userId: '404' })
const request = (): TargetPreflightRequest => ({ profileId: 'school-a', profileRevision: 1, toolId: 'template', scenario: 'training', stage: 'not_applicable', input: targetPreview().plan.input })

describe('owned successful login + map + parameterised personal profile binding', () => {
  it('returns only immutable hashed references, not source records or original account numbers', () => {
    const source = evidence(); const proof = identity.validateLocalContext(source, now)
    expect(Object.isFrozen(proof)).toBe(true); expect(Object.isFrozen(proof.evidence)).toBe(true)
    expect(proof.localAccountRef).toMatch(/^[a-f0-9]{64}$/)
    expect(() => identity.assertVerifiedPageContext(proof, page(), now + 100)).not.toThrow()
    for (const raw of ['880001', 'LoginName', 'StudentNo', 'A0902', 'B3001', 'accountValue']) expect(JSON.stringify(proof)).not.toContain(raw)
    source.map.record.A1001 = '909'
    expect(() => identity.assertVerifiedPageContext(proof, page(), now + 100)).not.toThrow()
  })
  it('does not treat a matching readonly personal profile as a who-am-I response', () => {
    const source = evidence(); source.loginEvidence = undefined
    expect(() => identity.validateLocalContext(source, now)).toThrowError(expect.objectContaining({ code: 'TARGET_LOGIN_EVIDENCE_REQUIRED' }))
  })
  it.each(['origin', 'siteEpoch', 'loginType', 'accountRef', 'authenticatedAt'] as const)('rejects another or future successful-login evidence: %s', key => {
    const source = evidence()
    Object.assign(source.loginEvidence!, { [key]: key === 'siteEpoch' ? 8 : key === 'authenticatedAt' ? now + 1 : key === 'origin' ? 'https://other.invalid' : key === 'accountRef' ? 'a'.repeat(64) : '21' })
    expect(() => identity.validateLocalContext(source, now)).toThrow()
  })
  it.each(['request-course', 'profile-user', 'profile-type', 'login-name', 'student-number', 'readonly-value', 'editable-field', 'company-missing', 'shop-missing', 'user-missing'] as const)('rejects broken independent evidence link: %s', field => {
    const source = evidence()
    if (field === 'request-course') source.map.request.courseId = '999'
    if (field === 'profile-user') source.identity.request.userId = '999'
    if (field === 'profile-type') source.identity.request.loginType = '21'
    if (field === 'login-name') source.identity.record.LoginName = '880002'
    if (field === 'student-number') source.identity.record.StudentNo = '880002'
    if (field === 'readonly-value') source.identityField.value = '880002'
    if (field === 'editable-field') source.identityField.readonly = false
    if (field === 'company-missing') delete source.map.record.B3001
    if (field === 'shop-missing') delete source.map.record.B3101
    if (field === 'user-missing') delete source.map.record.A0902
    expect(() => identity.validateLocalContext(source, now)).toThrowError(expect.objectContaining({ code: 'TARGET_IDENTITY_MISMATCH' }))
  })
  it.each(['map', 'identity'] as const)('requires exact observed path/origin and HTTP+business success for %s', kind => {
    for (const change of [{ origin: 'https://other.invalid' }, { httpStatus: 302 }, { code: 1 }, { path: '/unverified' }]) {
      const source = evidence(); Object.assign(source[kind], change)
      expect(() => identity.validateLocalContext(source, now)).toThrowError(expect.objectContaining({ code: 'TARGET_IDENTITY_RESPONSE_INVALID' }))
    }
  })
  it('does not infer V2 from a logo filename or a different image hash', () => {
    const source = evidence(); source.logoHash = 'logo-v2.png'
    expect(() => identity.validateLocalContext(source, now)).toThrowError(expect.objectContaining({ code: 'TARGET_VERSION_UNVERIFIED' }))
  })
  it.each(['origin', 'siteEpoch', 'courseId', 'companyId', 'shopId', 'userId'] as const)('invalidates proof on subsequent page scope change: %s', key => {
    const proof = identity.validateLocalContext(evidence(), now)
    const changed = { ...page(), [key]: key === 'siteEpoch' ? 8 : key === 'origin' ? 'https://other.invalid' : '999' }
    expect(() => identity.assertVerifiedPageContext(proof, changed, now + 100)).toThrow()
  })
  it('rejects expired, tampered and future proof without reusing old login context', () => {
    const proof = identity.validateLocalContext(evidence(), now)
    expect(() => identity.assertVerifiedPageContext(proof, page(), now + identity.LOCAL_CONTEXT_MAX_AGE_MS)).toThrow()
    expect(() => identity.assertVerifiedPageContext({ ...proof, shopRef: 'a'.repeat(64) }, page(), now + 1)).toThrow()
    expect(() => identity.assertVerifiedPageContext(proof, page(), now - 1)).toThrow()
  })
})

describe('signed course scene and per-page structure acceptance', () => {
  it('allows only the exact reviewed training course, never training by declaration', () => {
    const profile = targetProfile().profile
    expect(plans.buildTargetPlan(request(), profile, targetObservation()).context.scenario).toBe('training')
    for (const scopes of [undefined, [], [{ ...profile.executionScopes![0]!, courseRef: '9'.repeat(64) }]]) {
      expect(() => plans.buildTargetPlan(request(), { ...profile, executionScopes: scopes }, targetObservation())).toThrowError(expect.objectContaining({ code: 'TARGET_SCENARIO_UNVERIFIED' }))
    }
  })
  it.each(['practice', 'formal'] as const)('does not turn manual %s selection into observed competition authority', stage => {
    expect(() => plans.buildTargetPlan({ ...request(), scenario: 'competition', stage }, targetProfile().profile, targetObservation())).toThrowError(expect.objectContaining({ code: 'TARGET_SCENARIO_UNVERIFIED' }))
  })
  it('requires independently verified local identity, not only pre-populated refs', () => {
    expect(() => plans.buildTargetPlan(request(), targetProfile().profile, { ...targetObservation(), evidence: ['amazon-v2'] })).toThrowError(expect.objectContaining({ code: 'TARGET_CONTEXT_INCOMPLETE' }))
  })
  it('does not let an old single fingerprint authorise a multi-page workflow', () => {
    const profile = targetProfile().profile; profile.evidence.pageFingerprints = undefined
    expect(() => plans.buildTargetPlan(request(), profile, targetObservation())).toThrowError(expect.objectContaining({ code: 'TARGET_STRUCTURE_EVIDENCE_MISSING' }))
  })
  it('starts on the reviewed list and permits its separately reviewed editor without switching identity', () => {
    const profile = targetProfile().profile; const initial = targetObservation()
    const plan = plans.buildTargetPlan(request(), profile, initial)
    const editor = { ...initial, path: '/ECrossAmazon/SellerShippingTemplateSettingAdd', pageFingerprint: profile.evidence.pageFingerprints!.templateEditor! }
    expect(() => plans.assertPlanContext(plan, profile, editor)).not.toThrow()
    expect(() => plans.buildTargetPlan(request(), profile, editor)).toThrowError(expect.objectContaining({ code: 'TARGET_STRUCTURE_CHANGED' }))
    expect(() => plans.assertPlanContext(plan, profile, { ...editor, pageFingerprint: initial.pageFingerprint })).toThrowError(expect.objectContaining({ code: 'TARGET_STRUCTURE_CHANGED' }))
    expect(() => plans.assertPlanContext(plan, profile, { ...editor, courseRef: '9'.repeat(64) })).toThrowError(expect.objectContaining({ code: 'TARGET_CONTEXT_CHANGED' }))
  })
  it('does not accept map or lookalike route as the template-list preflight page', () => {
    for (const path of ['/ECrossAmazonHome/CourseIndex', '/ECrossAmazon/SellerShippingTemplateSettingExtra']) expect(() => plans.buildTargetPlan(request(), targetProfile().profile, { ...targetObservation(), path })).toThrow()
  })
})
