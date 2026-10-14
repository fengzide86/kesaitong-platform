import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserSnapshot, ProbeObservation, TargetBrowserPort, TemplateCreateInput, TemplateDetails, TemplateExchange, TemplateJournal, TemplateReconciliation, TemplateVerification, V2TemplateUiBinding } from '../../../electron/automation/targets/contracts.cjs'
import { detailExchange, listExchange, saveExchange, templateInput, templateSnapshot, makeVerifiedFixture } from './fixtures/v2-template-fixture'

const require = createRequire(import.meta.url)
const { classifyTargetSnapshot } = require(resolve('dist-electron/electron/automation/targets/v2-probe.cjs')) as { classifyTargetSnapshot(snapshot: BrowserSnapshot): ProbeObservation }
const { createV2Template, reconcileV2Template, parseV2TemplateList, parseV2TemplateDetails, normaliseMoney, assertTemplateReadback, assertTemplateInput } = require(resolve('dist-electron/electron/automation/targets/v2-template.cjs')) as {
  createV2Template(browser: TargetBrowserPort, expected: ProbeObservation, input: TemplateCreateInput, journal: TemplateJournal, binding?: V2TemplateUiBinding): Promise<TemplateVerification>
  parseV2TemplateList(exchange: TemplateExchange): Array<{ id: number; name: string }>
  parseV2TemplateDetails(exchange: TemplateExchange): TemplateDetails
  normaliseMoney(value: unknown): string
  assertTemplateInput(input: TemplateCreateInput): void
  assertTemplateReadback(input: TemplateCreateInput, id: number, details: TemplateDetails, regionMatches: V2TemplateUiBinding['regionMatches']): void
  reconcileV2Template(browser: TargetBrowserPort, expected: ProbeObservation, input: TemplateCreateInput, binding?: V2TemplateUiBinding, knownTemplateId?: number): Promise<TemplateReconciliation>
}
function setup() {
  const sequence: string[] = []
  const browser: TargetBrowserPort = {
    kind: 'fixture', inspect: vi.fn(async () => structuredClone(templateSnapshot)), readControl: vi.fn(), readControls: vi.fn(), waitForControl: vi.fn(), click: vi.fn(), typeAndBlur: vi.fn(), select: vi.fn(), reload: vi.fn(), dispose: vi.fn(),
    captureResponse: vi.fn(async (_path, action) => { await action(); return saveExchange() }),
  }
  let listReads = 0
  const binding: V2TemplateUiBinding = {
    id: 'local-contract-fixture', verificationLevel: 'fixture-only', evidenceSources: ['synthetic-schema-fixture-not-platform-uat'],
    readList: vi.fn(async () => listExchange(listReads++ > 0)), fillDraft: vi.fn(async () => { sequence.push('fill') }),
    save: vi.fn(async () => { sequence.push('save') }), readDetails: vi.fn(async () => detailExchange()),
    regionMatches: (region, countries) => countries.length === 1 && region === countries[0], assertCurrencyAndUnits: vi.fn(),
  }
  const journal: TemplateJournal = { beforeMutation: vi.fn(async () => { sequence.push('write-ahead') }), verified: vi.fn(async () => { sequence.push('verified') }) }
  const run = () => createV2Template(browser, classifyTargetSnapshot(templateSnapshot), structuredClone(templateInput), journal, binding)
  return { browser, binding, journal, sequence, run }
}
describe('target platform probe: observed evidence, not hostname guesses', () => {
  it('requires marker, Amazon route and page shape together', () => {
    expect(classifyTargetSnapshot(templateSnapshot).kind).toBe('matched')
    expect(classifyTargetSnapshot({ ...templateSnapshot, v2Marker: false, verifiedContext: undefined }).kind).toBe('unknown')
    expect(classifyTargetSnapshot({ ...templateSnapshot, amazonRoute: false }).kind).toBe('unknown')
    expect(classifyTargetSnapshot({ ...templateSnapshot, templateDom: false }).kind).toBe('unknown')
  })
  it('does not equate V3 with an executable V2 adapter', async () => {
    const test = setup()
    vi.mocked(test.browser.inspect).mockResolvedValue({ ...templateSnapshot, v2Marker: false, v3Marker: true })
    await expect(test.run()).rejects.toMatchObject({ code: 'TARGET_CONTEXT_CHANGED' })
    expect(test.journal.beforeMutation).not.toHaveBeenCalled()
  })
  it('uses the validated CSS logo without requiring a duplicate body-text version marker', () => {
    const snapshot = { ...templateSnapshot, v2Marker: false, amazonMarker: false }
    const observed = classifyTargetSnapshot(snapshot)
    expect(observed).toMatchObject({ kind: 'matched', version: 'v2', platformFamily: 'bjy-amazon' })
    expect(observed.evidence).toContain('verified-v2-logo')
    expect(classifyTargetSnapshot({ ...snapshot, v3Marker: true }).kind).toBe('ambiguous')
  })
  it('does not borrow image-version evidence from expired or another-course identity proof', () => {
    const snapshot = { ...templateSnapshot, v2Marker: false, amazonMarker: false }
    const changed = classifyTargetSnapshot({ ...snapshot, context: { ...snapshot.context, courseId: '909' } })
    expect(changed).toMatchObject({ kind: 'unknown', version: null, localAccountRef: null })
    const expired = classifyTargetSnapshot({ ...snapshot, verifiedContext: { ...snapshot.verifiedContext!, verifiedAt: 1 } })
    expect(expired).toMatchObject({ kind: 'unknown', version: null, localAccountRef: null })
  })
  it('reports conflicting versions, expired login and missing contexts', () => {
    expect(classifyTargetSnapshot({ ...templateSnapshot, v3Marker: true }).kind).toBe('ambiguous')
    expect(classifyTargetSnapshot({ ...templateSnapshot, loginVisible: true }).kind).toBe('login_required')
    expect(classifyTargetSnapshot({ ...templateSnapshot, context: {} }).missing).toContain('course-context')
  })
  it('hashes local context, keeps stable shape fingerprint and does not return raw IDs', () => {
    const observation = classifyTargetSnapshot(templateSnapshot)
    const changed = classifyTargetSnapshot({ ...templateSnapshot, context: { ...templateSnapshot.context, shopId: '999' } })
    expect(observation.shopRef).toMatch(/^[a-f0-9]{64}$/)
    expect(observation.shopRef).not.toBe(changed.shopRef)
    expect(observation.pageFingerprint).toBe(changed.pageFingerprint)
    expect(observation).not.toHaveProperty('context')
  })
  it('does not mistake a company/shop/role tuple for a verified account identity', () => {
    const context = { courseId: '101', shopId: '202', companyId: '303', roleCode: '2' }
    const observation = classifyTargetSnapshot({ ...templateSnapshot, context, verifiedContext: undefined })
    expect(observation.localAccountRef).toBeNull()
    expect(observation.missing).toContain('account-identity-unverified')
  })
})
describe('V2 template API schema and readback', () => {
  it('reads documented nested strings and drops tokens/redirects', () => {
    const list = parseV2TemplateList(listExchange(true))
    const details = parseV2TemplateDetails(detailExchange())
    expect(list[1]?.id).toBe(2)
    expect(details.rules[0]).toMatchObject({ perOrder: '1.23', unitRate: '0.45', unit: 'item' })
    expect(JSON.stringify({ list, details })).not.toContain('fixture-sensitive')
  })
  it.each([500, 302, 0, Number.NaN, 200.5])('rejects HTTP %s without mistaking it for business success', status => {
    expect(() => parseV2TemplateList({ ...listExchange(), httpStatus: status })).toThrow()
  })
  it.each([{ Code: 1 }, { Code: '0' }, {}, { Msg: '保存成功' }])('requires numeric business Code zero: %j', result => {
    const response = listExchange()
    response.body = { ...response.body as object, result: JSON.stringify(result) }
    expect(() => parseV2TemplateList(response)).toThrow()
  })
  it.each(['-1', '1.234', 'NaN', '', '1e2', null])('rejects invalid money %s', amount => {
    expect(() => normaliseMoney(amount)).toThrow()
  })
  it('preserves a valid zero instead of conflating it with missing data', () => {
    expect(normaliseMoney(0)).toBe('0.00')
    expect(normaliseMoney('1.2')).toBe('1.20')
  })
  it('checks each exact rule and rejects duplicate/changed rows', () => {
    const details = parseV2TemplateDetails(detailExchange())
    expect(() => assertTemplateReadback(templateInput, 2, details, (region, countries) => region === countries[0])).not.toThrow()
    details.rules[0]!.unitRate = '0.00'
    expect(() => assertTemplateReadback(templateInput, 2, details, () => true)).toThrow()
  })
  it('rejects duplicate template IDs and multiple default templates', () => {
    for (const field of ['DS0701', 'DS0707']) {
      const exchange = listExchange(true)
      const body = exchange.body as Record<string, unknown>
      const templates = JSON.parse(String(body.jsonStr)) as Array<Record<string, unknown>>
      templates[1]![field] = templates[0]![field]
      body.jsonStr = JSON.stringify(templates)
      expect(() => parseV2TemplateList(exchange)).toThrowError(expect.objectContaining({ code: 'TARGET_SCHEMA_CHANGED' }))
    }
  })
  it('rejects an empty rule set and repeated detail row IDs', () => {
    for (const duplicate of [false, true]) {
      const exchange = detailExchange()
      const body = exchange.body as Record<string, unknown>
      const rules = JSON.parse(String(body.jsonStr2)) as unknown[]
      body.jsonStr2 = JSON.stringify(duplicate ? [...rules, ...rules] : [])
      expect(() => parseV2TemplateDetails(exchange)).toThrowError(expect.objectContaining({ code: 'TARGET_SCHEMA_CHANGED' }))
    }
  })
  it('uses the shared 12-rule, 80-character and canonical-money input contract', () => {
    const tooMany = { ...templateInput, rules: Array.from({ length: 13 }, (_, index) => ({ ...templateInput.rules[0]!, countries: [`country-${index}`] })) }
    const longCountry = { ...templateInput, rules: [{ ...templateInput.rules[0]!, countries: ['x'.repeat(81)] }] }
    const oldLooseMoney = { ...templateInput, rules: [{ ...templateInput.rules[0]!, perOrder: '0001.00' }] }
    for (const input of [tooMany, longCountry, oldLooseMoney]) expect(() => assertTemplateInput(input)).toThrowError(expect.objectContaining({ code: 'TARGET_INPUT_INVALID' }))
  })
  it('rejects country overlap within one service but permits different services', () => {
    const overlapping = { ...templateInput, rules: [templateInput.rules[0]!, { ...templateInput.rules[0]!, unitRate: '2.00' }] }
    expect(() => assertTemplateInput(overlapping)).toThrowError(expect.objectContaining({ code: 'TARGET_INPUT_INVALID' }))
    const separate = { ...overlapping, rules: [templateInput.rules[0]!, { ...templateInput.rules[0]!, serviceCode: '20002' as const }] }
    expect(() => assertTemplateInput(separate)).not.toThrow()
  })
})
describe('one-template operation contract (fixture, not real platform execution)', () => {
  it('writes durable intent before any fill and only verifies after list + same-object details', async () => {
    const test = setup()
    const receipt = await test.run()
    expect(test.sequence).toEqual(['write-ahead', 'fill', 'save', 'verified'])
    expect(receipt.verification).toBe('same-object-list-and-details')
    expect(receipt.evidence.map(item => item.path)).toEqual(['/ECrossAmazon/SaveTemplate', '/ECrossAmazon/GetTemplateList', '/ECrossAmazon/GetFeightRelationList'])
    expect(JSON.stringify(receipt)).not.toContain('fixture-sensitive')
  })
  it('rejects missing UI evidence without running any action', async () => {
    const test = setup()
    await expect(createV2Template(test.browser, classifyTargetSnapshot(templateSnapshot), templateInput, test.journal)).rejects.toMatchObject({ code: 'TARGET_UI_EVIDENCE_MISSING' })
    expect(test.journal.beforeMutation).not.toHaveBeenCalled()
  })
  it('cannot use a fixture binding on an actual browser', async () => {
    const test = setup()
    await expect(createV2Template({ ...test.browser, kind: 'owned-webcontents' }, classifyTargetSnapshot(templateSnapshot), templateInput, test.journal, test.binding)).rejects.toMatchObject({ code: 'TARGET_UI_EVIDENCE_MISSING' })
  })
  it('does not submit when write-ahead fails', async () => {
    const test = setup()
    vi.mocked(test.journal.beforeMutation).mockRejectedValue(new Error('disk unavailable'))
    await expect(test.run()).rejects.toThrow('disk unavailable')
    expect(test.binding.fillDraft).not.toHaveBeenCalled()
    expect(test.binding.save).not.toHaveBeenCalled()
  })
  it('does not create another template with the same name', async () => {
    const test = setup()
    vi.mocked(test.binding.readList).mockResolvedValue(listExchange(true))
    await expect(test.run()).rejects.toMatchObject({ code: 'TARGET_OBJECT_EXISTS' })
    expect(test.journal.beforeMutation).not.toHaveBeenCalled()
  })
  it('does not retry a successful HTTP save whose object is missing afterwards', async () => {
    const test = setup()
    vi.mocked(test.binding.readList).mockResolvedValue(listExchange(false))
    await expect(test.run()).rejects.toMatchObject({ code: 'TARGET_READBACK_MISMATCH' })
    expect(test.binding.save).toHaveBeenCalledTimes(1)
    expect(test.journal.verified).not.toHaveBeenCalled()
  })
  it('rejects a response for another shop', async () => {
    const test = setup()
    const response = listExchange()
    response.requestFields.shopId = '999'
    vi.mocked(test.binding.readList).mockResolvedValue(response)
    await expect(test.run()).rejects.toMatchObject({ code: 'TARGET_RESPONSE_CONTEXT_MISMATCH' })
    expect(test.journal.beforeMutation).not.toHaveBeenCalled()
  })
  it('rejects the wrong detail object despite identical visible name', async () => {
    const test = setup()
    const response = detailExchange()
    response.requestFields.ds0701 = '999'
    vi.mocked(test.binding.readDetails).mockResolvedValue(response)
    await expect(test.run()).rejects.toMatchObject({ code: 'TARGET_RESPONSE_CONTEXT_MISMATCH' })
    expect(test.journal.verified).not.toHaveBeenCalled()
  })
  it('stops after the user switches account/course while the form is open', async () => {
    const test = setup()
    vi.mocked(test.browser.inspect).mockResolvedValueOnce(templateSnapshot).mockResolvedValue({ ...templateSnapshot, context: { ...templateSnapshot.context, courseId: '999' } })
    await expect(test.run()).rejects.toMatchObject({ code: 'TARGET_CONTEXT_CHANGED' })
    expect(test.binding.save).not.toHaveBeenCalled()
  })
  it('does not treat two verified accounts sharing a shop as the same session', async () => {
    const test = setup()
    vi.mocked(test.browser.inspect).mockResolvedValue({ ...templateSnapshot, verifiedContext: makeVerifiedFixture('880002', '405') })
    await expect(test.run()).rejects.toMatchObject({ code: 'TARGET_CONTEXT_CHANGED' })
    expect(test.journal.beforeMutation).not.toHaveBeenCalled()
  })
  it('does not accept an unexpected default-template change', async () => {
    const test = setup()
    const changed = listExchange(true)
    const body = changed.body as Record<string, unknown>
    const rows = JSON.parse(String(body.jsonStr)) as Array<{ DS0707: number }>
    rows[0]!.DS0707 = 0; rows[1]!.DS0707 = 1
    body.jsonStr = JSON.stringify(rows)
    vi.mocked(test.binding.readList).mockResolvedValueOnce(listExchange()).mockResolvedValue(changed)
    await expect(test.run()).rejects.toMatchObject({ code: 'TARGET_DEFAULT_CHANGED' })
    expect(test.journal.verified).not.toHaveBeenCalled()
  })
  it('requires the observed SaveTemplate request to create this exact name', async () => {
    const test = setup()
    const saved = saveExchange()
    saved.requestFields.templateName = 'another-template'
    vi.mocked(test.browser.captureResponse).mockResolvedValue(saved)
    await expect(test.run()).rejects.toMatchObject({ code: 'TARGET_WRITE_MISMATCH' })
    expect(test.journal.verified).not.toHaveBeenCalled()
  })
  it('does not treat an update of a known template as a new-template save', async () => {
    const test = setup()
    const saved = saveExchange()
    saved.requestFields.ds0701 = '1'
    vi.mocked(test.browser.captureResponse).mockResolvedValue(saved)
    await expect(test.run()).rejects.toMatchObject({ code: 'TARGET_WRITE_MISMATCH' })
    expect(test.journal.verified).not.toHaveBeenCalled()
  })
  it('does not accept a list response as SaveTemplate confirmation', async () => {
    const test = setup()
    const saved = saveExchange()
    saved.path = '/ECrossAmazon/GetTemplateList'
    vi.mocked(test.browser.captureResponse).mockResolvedValue(saved)
    await expect(test.run()).rejects.toMatchObject({ code: 'TARGET_WRITE_MISMATCH' })
  })
  it('requires review when another template also appears during the save', async () => {
    const test = setup()
    const changed = listExchange(true)
    const body = changed.body as Record<string, unknown>
    const rows = JSON.parse(String(body.jsonStr)) as unknown[]
    rows.push({ DS0701: 3, DS0705: 'separate-concurrent-template', DS0707: 0 })
    body.jsonStr = JSON.stringify(rows)
    vi.mocked(test.binding.readList).mockResolvedValueOnce(listExchange()).mockResolvedValue(changed)
    await expect(test.run()).rejects.toMatchObject({ code: 'TARGET_READBACK_MISMATCH' })
    expect(test.binding.save).toHaveBeenCalledTimes(1)
    expect(test.journal.verified).not.toHaveBeenCalled()
  })
  it('does not retry or verify after a save response timeout', async () => {
    const test = setup()
    vi.mocked(test.browser.captureResponse).mockImplementationOnce(async (_path, action) => {
      await action()
      throw Object.assign(new Error('synthetic capture timeout'), { code: 'TARGET_CAPTURE_TIMEOUT' })
    })
    await expect(test.run()).rejects.toMatchObject({ code: 'TARGET_CAPTURE_TIMEOUT' })
    expect(test.sequence).toEqual(['write-ahead', 'fill', 'save'])
    expect(test.journal.verified).not.toHaveBeenCalled()
  })
})
describe('read-only template reconciliation', () => {
  it('verifies the existing same object without filling or submitting', async () => {
    const test = setup()
    vi.mocked(test.binding.readList).mockResolvedValue(listExchange(true))
    const result = await reconcileV2Template(test.browser, classifyTargetSnapshot(templateSnapshot), templateInput, test.binding, 2)
    expect(result.status).toBe('verified')
    expect(test.binding.fillDraft).not.toHaveBeenCalled()
    expect(test.binding.save).not.toHaveBeenCalled()
    expect(test.browser.captureResponse).not.toHaveBeenCalled()
  })
  it('reports not found only after a valid scoped list response', async () => {
    const test = setup()
    expect(await reconcileV2Template(test.browser, classifyTargetSnapshot(templateSnapshot), templateInput, test.binding)).toEqual({ status: 'not_found' })
    expect(test.binding.save).not.toHaveBeenCalled()
  })
  it('rejects a same-name object that is not the originally known ID', async () => {
    const test = setup()
    vi.mocked(test.binding.readList).mockResolvedValue(listExchange(true))
    await expect(reconcileV2Template(test.browser, classifyTargetSnapshot(templateSnapshot), templateInput, test.binding, 999)).rejects.toMatchObject({ code: 'TARGET_READBACK_MISMATCH' })
  })
  it('does not mark a renamed known object as not submitted', async () => {
    const test = setup()
    const changed = listExchange(true)
    const body = changed.body as Record<string, unknown>
    const rows = JSON.parse(String(body.jsonStr)) as Array<{ DS0705: string }>
    rows[1]!.DS0705 = 'renamed-after-submission'
    body.jsonStr = JSON.stringify(rows)
    vi.mocked(test.binding.readList).mockResolvedValue(changed)
    await expect(reconcileV2Template(test.browser, classifyTargetSnapshot(templateSnapshot), templateInput, test.binding, 2)).rejects.toMatchObject({ code: 'TARGET_READBACK_MISMATCH' })
    expect(test.binding.save).not.toHaveBeenCalled()
  })
  it('cannot reconcile through an unaudited live binding', async () => {
    const test = setup()
    await expect(reconcileV2Template({ ...test.browser, kind: 'owned-webcontents' }, classifyTargetSnapshot(templateSnapshot), templateInput, test.binding)).rejects.toMatchObject({ code: 'TARGET_UI_EVIDENCE_MISSING' })
  })
})
