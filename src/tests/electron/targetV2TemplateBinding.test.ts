import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { TargetBrowserPort, TargetControl, TargetControlState, TemplateCreateInput, TemplateExchange } from '../../../electron/automation/targets/contracts.cjs'
import type { V2TemplateDraft, V2TemplateDraftPlan } from '../../../electron/automation/targets/v2-template-binding.cjs'
import { detailExchange, listExchange, templateInput, templateSnapshot } from './fixtures/v2-template-fixture'

const require = createRequire(import.meta.url)
const { V2_TEMPLATE_FIELD_MAP, V2_TEMPLATE_SERVICES, V2_TEMPLATE_OBSERVED_FORM, buildV2TemplateDraftPlan, assertV2TemplateDraft, readV2TemplateDraft, readV2TemplateList, readV2TemplateDetails, v2TemplateDetailControl, v2TemplateRowControl } = require(resolve('dist-electron/electron/automation/targets/v2-template-binding.cjs')) as {
  V2_TEMPLATE_FIELD_MAP: Record<string, string>
  V2_TEMPLATE_SERVICES: Array<{ code: string; scope: string; containerCss: string }>
  V2_TEMPLATE_OBSERVED_FORM: { executable: boolean; evidenceLevel: string }
  buildV2TemplateDraftPlan(input: TemplateCreateInput): V2TemplateDraftPlan
  assertV2TemplateDraft(input: TemplateCreateInput, observed: V2TemplateDraft, match: (region: string, countries: readonly string[]) => boolean): void
  readV2TemplateDraft: typeof import('../../../electron/automation/targets/v2-template-binding.cjs').readV2TemplateDraft
  readV2TemplateList(browser: TargetBrowserPort): Promise<TemplateExchange>
  readV2TemplateDetails(browser: TargetBrowserPort, id: number): Promise<TemplateExchange>
  v2TemplateDetailControl(id: number): TargetControl
  v2TemplateRowControl: typeof import('../../../electron/automation/targets/v2-template-binding.cjs').v2TemplateRowControl
}
const { resolveUiBinding } = require(resolve('dist-electron/electron/automation/targets/ui-bindings.cjs')) as { resolveUiBinding(version: string): unknown }
const regionMatches = (region: string, countries: readonly string[]) => countries.length === 1 && region === countries[0]

function draft(input = templateInput): V2TemplateDraft {
  return { name: input.name, pricingModeValue: '0', currency: 'USD', services: buildV2TemplateDraftPlan(input).services.map(service => ({
    code: service.code, enabled: service.enabled, rules: service.rules.map((rule, index) => ({
      key: `synthetic-row-${index}`, regionText: rule.countries[0]!, transitTime: rule.transitTime,
      perOrder: rule.perOrder, unitRate: rule.unitRate, unitValue: rule.unit === 'item' ? '1' : '2',
    })),
  })) }
}

describe('V2 template evidence contract (not live UI acceptance)', () => {
  it('retains the observed historical API fields and six service scopes', () => {
    expect(V2_TEMPLATE_FIELD_MAP).toEqual({ templateName: 'DS0705', pricingMode: 'DS0708', service: 'DS0805', regionText: 'DS0810', transitTime: 'DS0813', perOrder: 'DS0814', unitRate: 'DS0815', unit: 'DS0816' })
    expect(V2_TEMPLATE_SERVICES.filter(service => service.scope === 'domestic').map(service => service.code)).toEqual(['10001', '10002', '10003', '10004'])
    expect(V2_TEMPLATE_SERVICES.filter(service => service.scope === 'international').map(service => service.code)).toEqual(['20001', '20002'])
    expect(V2_TEMPLATE_FIELD_MAP).not.toHaveProperty('handlingTime')
    expect(V2_TEMPLATE_FIELD_MAP).not.toHaveProperty('addressType')
  })
  it('opens only the current R2-audited workflow, not unknown or V3 adapters', () => {
    expect(V2_TEMPLATE_OBSERVED_FORM).toMatchObject({ executable: true, evidenceLevel: 'R2' })
    expect(resolveUiBinding('bjysoft-v2-template.1')).toMatchObject({ verificationLevel: 'audited-ui' })
    expect(resolveUiBinding('bjysoft-v3-template.1')).toBeUndefined()
    expect(resolveUiBinding('unknown')).toBeUndefined()
  })
  it('specifies disabled services explicitly and does not modify the input', () => {
    const input = structuredClone(templateInput)
    const plan = buildV2TemplateDraftPlan(input)
    expect(plan.services.filter(service => service.enabled).map(service => service.code)).toEqual(['20001'])
    expect(plan.services.filter(service => !service.enabled)).toHaveLength(5)
    plan.services.find(service => service.enabled)!.rules[0]!.countries.push('another-fixture')
    expect(input).toEqual(templateInput)
  })
  it('validates a complete one-rule draft from independently supplied observations', () => {
    expect(() => assertV2TemplateDraft(templateInput, draft(), regionMatches)).not.toThrow()
  })
  it('rejects the untouched default service even when requested rows match', () => {
    const observed = draft()
    observed.services[0]!.enabled = true
    expect(() => assertV2TemplateDraft(templateInput, observed, regionMatches)).toThrowError(expect.objectContaining({ code: 'TARGET_DRAFT_MISMATCH' }))
  })
  it('rejects an extra default rule inside an otherwise intended service', () => {
    const observed = draft()
    const service = observed.services.find(row => row.enabled)!
    service.rules.push({ ...service.rules[0]!, key: 'unexpected-default-row' })
    expect(() => assertV2TemplateDraft(templateInput, observed, regionMatches)).toThrowError(expect.objectContaining({ code: 'TARGET_DRAFT_MISMATCH' }))
  })
  it.each(['EUR', '', '美元'])('requires actually observed USD currency: %s', currency => {
    expect(() => assertV2TemplateDraft(templateInput, { ...draft(), currency }, regionMatches)).toThrow()
  })
  it.each(['1', '', 'weight-item'])('rejects unconfirmed DOM mode value %s', pricingModeValue => {
    expect(() => assertV2TemplateDraft(templateInput, { ...draft(), pricingModeValue }, regionMatches)).toThrow()
  })
  it.each(['unitValue', 'unitRate', 'perOrder', 'transitTime', 'regionText'])('rejects a stale %s value before submission', field => {
    const observed = draft()
    const row = observed.services.find(service => service.enabled)!.rules[0]!
    Object.assign(row, { [field]: field === 'unitValue' ? '2' : field.endsWith('Rate') || field === 'perOrder' ? '9.99' : 'unmatched' })
    expect(() => assertV2TemplateDraft(templateInput, observed, regionMatches)).toThrow()
  })
  it('requires all six uniquely identified services instead of trusting a partial read', () => {
    const incomplete = draft(); incomplete.services.pop()
    const duplicated = draft(); duplicated.services[0] = { ...duplicated.services[1]! }
    expect(() => assertV2TemplateDraft(templateInput, incomplete, regionMatches)).toThrow()
    expect(() => assertV2TemplateDraft(templateInput, duplicated, regionMatches)).toThrow()
  })
  it('compares multi-rule drafts without relying on row order', () => {
    const input: TemplateCreateInput = { ...templateInput, rules: [templateInput.rules[0]!, { ...templateInput.rules[0]!, countries: ['second-fixture-country'], unit: 'lb' }] }
    const observed = draft(input)
    observed.services.find(service => service.enabled)!.rules.reverse()
    expect(() => assertV2TemplateDraft(input, observed, regionMatches)).not.toThrow()
    const rules = observed.services.find(service => service.enabled)!.rules
    rules[0]!.key = rules[1]!.key
    expect(() => assertV2TemplateDraft(input, observed, regionMatches)).toThrow()
  })
})

describe('current V2 read-only UI controls (synthetic DOM port fixtures)', () => {
  function reader() {
    const browser: TargetBrowserPort = {
      kind: 'fixture', inspect: vi.fn(async () => structuredClone(templateSnapshot)),
      readControl: vi.fn(async () => ({ tagName: 'DIV', text: 'fixture-template', disabled: false })), readControls: vi.fn(async () => []),
      waitForControl: vi.fn(async () => ({ tagName: 'DIV', text: 'fixture-template', disabled: false })),
      click: vi.fn(), select: vi.fn(), typeAndBlur: vi.fn(), reload: vi.fn(), dispose: vi.fn(),
      captureResponse: vi.fn(async (path, action) => { await action(); return path === '/ECrossAmazon/GetTemplateList' ? listExchange() : detailExchange() }),
    }
    return browser
  }
  it('reads the list by armed response capture then UI reload only', async () => {
    const browser = reader()
    await expect(readV2TemplateList(browser)).resolves.toMatchObject({ path: '/ECrossAmazon/GetTemplateList' })
    expect(browser.reload).toHaveBeenCalledOnce()
    expect(browser.click).not.toHaveBeenCalled()
    expect(browser.typeAndBlur).not.toHaveBeenCalled()
  })
  it('checks an exact same-object detail selector before triggering the request', async () => {
    const browser = reader()
    await readV2TemplateDetails(browser, 2)
    expect(browser.waitForControl).toHaveBeenCalledExactlyOnceWith({ css: 'div.shipping_template_link[ds0701="2"]', scopeCss: '#shippingTemplateLinks' })
    expect(browser.click).toHaveBeenCalledExactlyOnceWith(v2TemplateDetailControl(2))
    expect(browser.captureResponse).toHaveBeenCalledExactlyOnceWith('/ECrossAmazon/GetFeightRelationList', expect.any(Function), { templateId: 2 })
    expect(browser.typeAndBlur).not.toHaveBeenCalled()
  })
  it('does not click an absent or ambiguous template or invent its URL', async () => {
    const browser = reader()
    vi.mocked(browser.waitForControl).mockRejectedValue(new Error('synthetic non-unique'))
    await expect(readV2TemplateDetails(browser, 2)).rejects.toThrow('non-unique')
    expect(browser.click).not.toHaveBeenCalled()
    expect(browser.captureResponse).not.toHaveBeenCalled()
    expect(() => v2TemplateDetailControl(Number.NaN)).toThrow()
  })
  it('requires the actual list path and a non-expired session', async () => {
    const browser = reader()
    vi.mocked(browser.inspect).mockResolvedValue({ ...templateSnapshot, loginVisible: true })
    await expect(readV2TemplateList(browser)).rejects.toMatchObject({ code: 'TARGET_PAGE_NOT_READY' })
    expect(browser.reload).not.toHaveBeenCalled()
    vi.mocked(browser.inspect).mockResolvedValue({ ...templateSnapshot, path: '/ECrossAmazon/SellerShippingTemplateSettingAdd' })
    await expect(readV2TemplateDetails(browser, 2)).rejects.toMatchObject({ code: 'TARGET_PAGE_NOT_READY' })
    expect(browser.click).not.toHaveBeenCalled()
  })
  it('uses exact region scope instead of a positional row fallback', () => {
    expect(v2TemplateRowControl('10001', 'fixture-mainland-region', 'input[name="unitPrice"]')).toEqual({
      css: 'input[name="unitPrice"]', scopeCss: '#tbody_10001 tr.nonPrimeRule', scopeMatch: { css: '.regions_name_left', exactText: 'fixture-mainland-region' },
    })
    expect(() => v2TemplateRowControl('10001', '', 'input')).toThrow()
  })
  function draftReader() {
    const browser = reader()
    vi.mocked(browser.inspect).mockResolvedValue({ ...templateSnapshot, path: '/ECrossAmazon/SellerShippingTemplateSettingAdd' })
    vi.mocked(browser.readControls).mockImplementation(async control => control.scopeCss === '#tbody_10001'
      ? ['fixture-mainland-region', 'fixture-island-region'].map(text => ({ tagName: 'DIV', text, disabled: false })) : [])
    vi.mocked(browser.readControl).mockImplementation(async control => {
      if (control.css.includes('templateNameInput')) return { tagName: 'INPUT', text: '', value: templateInput.name, disabled: false }
      if (control.css.includes('rateModel')) return { tagName: 'INPUT', text: '', value: '0', checked: true, disabled: false }
      if (control.css.includes('service_type')) return { tagName: 'INPUT', text: '', checked: control.scopeCss === '#div_10001', disabled: control.scopeCss === '#div_10001' }
      if (!control.scopeMatch?.exactText.startsWith('fixture-')) throw new Error('row context missing')
      if (control.css === '.shippingTimeday') return { tagName: 'SPAN', text: 'fixture-transit-label', disabled: false }
      if (control.css.includes('unitMeasure')) return { tagName: 'SELECT', text: '', value: '2', disabled: false }
      return { tagName: 'INPUT', text: '', value: control.scopeMatch.exactText === 'fixture-mainland-region' ? '0' : '4.99', disabled: false }
    })
    const evidence = { assertFixedUsd: vi.fn(async () => undefined), transitTime: vi.fn((_service: string, _state: TargetControlState) => 'fixture-transit-wire-value') }
    return { browser, evidence }
  }
  it('reads every enabled default row, all service states and proven transit mapping', async () => {
    const { browser, evidence } = draftReader()
    const observed = await readV2TemplateDraft(browser, evidence)
    expect(evidence.assertFixedUsd).toHaveBeenCalledExactlyOnceWith(browser)
    expect(observed.services).toHaveLength(6)
    expect(observed.services[0]).toMatchObject({ code: '10001', enabled: true, rules: [
      { key: 'fixture-mainland-region', unitValue: '2', perOrder: '0', transitTime: 'fixture-transit-wire-value' },
      { key: 'fixture-island-region', unitValue: '2', perOrder: '4.99', transitTime: 'fixture-transit-wire-value' },
    ] })
    expect(browser.click).not.toHaveBeenCalled()
    expect(browser.select).not.toHaveBeenCalled()
    expect(browser.typeAndBlur).not.toHaveBeenCalled()
  })
  it('does not infer USD from a dollar sign or bypass missing currency evidence', async () => {
    const { browser, evidence } = draftReader()
    evidence.assertFixedUsd.mockRejectedValue(new Error('fixed currency contract unverified'))
    await expect(readV2TemplateDraft(browser, evidence)).rejects.toThrow('unverified')
    expect(browser.readControl).not.toHaveBeenCalled()
  })
  it('rejects ambiguous default region names before reading/filling individual rows', async () => {
    const { browser, evidence } = draftReader()
    vi.mocked(browser.readControls).mockResolvedValue([{ tagName: 'DIV', text: 'duplicate', disabled: false }, { tagName: 'DIV', text: 'duplicate', disabled: false }])
    await expect(readV2TemplateDraft(browser, evidence)).rejects.toMatchObject({ code: 'TARGET_DRAFT_MISMATCH' })
    expect(evidence.transitTime).not.toHaveBeenCalled()
  })
})
