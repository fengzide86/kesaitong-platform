import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { TargetBrowserPort, TargetControl, TargetControlState, TemplateCreateInput, TemplateExchange } from '../../../electron/automation/targets/contracts.cjs'
import { V2_MAINLAND_REGION, V2_ISLAND_REGION, V2_TEMPLATE_FIXED_TRANSIT, V2_TEMPLATE_SELECTABLE_TRANSIT } from '../../shared/ipc/target-template-options'
import { templateSnapshot } from './fixtures/v2-template-fixture'

const require = createRequire(import.meta.url)
const { createAuditedV2TemplateBinding, assertSupportedV2TemplateInput, isAuditedV2TemplateControl } = require(resolve('dist-electron/electron/automation/targets/v2-template-binding.cjs')) as typeof import('../../../electron/automation/targets/v2-template-binding.cjs')
const { createV2Template, reconcileV2Template } = require(resolve('dist-electron/electron/automation/targets/v2-template.cjs')) as typeof import('../../../electron/automation/targets/v2-template.cjs')
const { classifyTargetSnapshot } = require(resolve('dist-electron/electron/automation/targets/v2-probe.cjs')) as typeof import('../../../electron/automation/targets/v2-probe.cjs')

// This is a deterministic local UI model of the observed controls, not an R2
// capture or proof that an installed Electron client completed platform UAT.
const input: TemplateCreateInput = {
  name: 'KST-compiled-binding-fixture', currency: 'USD', pricingMode: 'weight-item', rules: [
    { serviceCode: '10001', countries: V2_MAINLAND_REGION.split(', '), transitTime: '14 - 28', perOrder: '0', unitRate: '0', unit: 'lb' },
    { serviceCode: '10002', countries: V2_MAINLAND_REGION.split(', '), transitTime: '2 - 2', perOrder: '8.99', unitRate: '0.99', unit: 'lb' },
    { serviceCode: '20001', countries: ['Canada'], transitTime: '10 - 20', perOrder: '1.23', unitRate: '0.45', unit: 'item' },
    { serviceCode: '20001', countries: ['Mexico'], transitTime: '10 - 20', perOrder: '0', unitRate: '0', unit: 'lb' },
  ],
}
interface Row { region: string; transit: string; perOrder: string; unitRate: string; unit: string }
interface Service { enabled: boolean; rows: Row[] }
function uiModel(options: { hideMexico?: boolean; ignoreDelete?: boolean; ignoreTyping?: boolean; saveTimeout?: boolean; delayedDom?: boolean } = {}) {
  let path = '/ECrossAmazon/SellerShippingTemplateSetting'
  let modal = ''
  let name = ''
  let marked = false
  let saved = false
  let saveClicks = 0
  let selectedTemplate = 1
  let countryService = ''
  let draftRowsReady = true
  let countryLeavesReady = true
  let listRowsReady = true
  const readyLater = (setReady: () => void) => { setTimeout(setReady, 2) }
  const notReady = () => { throw Object.assign(new Error('synthetic DOM not ready'), { code: 'TARGET_CONTROL_NOT_UNIQUE' }) }
  const checkedCountries = new Set<string>()
  const allCountries = ['Canada', 'Mexico', 'Japan']
  const serviceData: Record<string, Service> = {
    '10001': { enabled: true, rows: [
      { region: V2_MAINLAND_REGION, transit: '14 - 28', perOrder: '0', unitRate: '0', unit: '2' },
      { region: V2_ISLAND_REGION, transit: '14 - 28', perOrder: '4.99', unitRate: '0.99', unit: '2' },
    ] },
    '10002': { enabled: true, rows: [{ region: V2_MAINLAND_REGION, transit: '1 - 2', perOrder: '8.99', unitRate: '0.99', unit: '2' }] },
    '10003': { enabled: true, rows: [{ region: V2_MAINLAND_REGION, transit: '2', perOrder: '10.99', unitRate: '0.99', unit: '2' }] },
    '10004': { enabled: true, rows: [{ region: V2_MAINLAND_REGION, transit: '1', perOrder: '10.99', unitRate: '0.99', unit: '2' }] },
    '20001': { enabled: true, rows: [{ region: 'Canada', transit: '10 - 20', perOrder: '4.99', unitRate: '0.5', unit: '2' }] },
    '20002': { enabled: true, rows: [{ region: 'Canada', transit: '1 - 2', perOrder: '8.99', unitRate: '0.99', unit: '2' }] },
  }
  const fixed = V2_TEMPLATE_FIXED_TRANSIT as Record<string, string | undefined>
  const rowFor = (control: TargetControl): Row => {
    if (!draftRowsReady) return notReady()
    const code = /#tbody_(\d+)/.exec(control.scopeCss || '')?.[1]
    const rows = code ? serviceData[code]?.rows.filter(row => row.region === control.scopeMatch?.exactText) : []
    if (rows?.length !== 1) throw new Error('synthetic non-unique row')
    return rows[0]!
  }
  const availableCountries = () => countryLeavesReady ? allCountries.filter(country => !(options.hideMexico && country === 'Mexico') && !serviceData[countryService]!.rows.some(row => row.region === country)) : []
  const leafValue = (control: TargetControl) => /^input\.subcheckbox\[value="([^"]+)"\]$/.exec(control.css)?.[1]
  function read(control: TargetControl): TargetControlState {
    expect(isAuditedV2TemplateControl(control, 'read')).toBe(true)
    if (control.frameCss) {
      if (modal !== 'country') throw new Error('synthetic country frame absent')
      if (control.css.startsWith('button')) return { tagName: 'BUTTON', text: '确认', disabled: false }
      const country = leafValue(control)
      if (!country || !availableCountries().includes(country)) return notReady()
      return { tagName: 'INPUT', text: '', value: country, checked: checkedCountries.has(country), disabled: false }
    }
    if (control.scopeMatch) {
      const row = rowFor(control)
      const service = /#tbody_(\d+)/.exec(control.scopeCss!)![1]!
      if (control.css === '.regions_name_left') return { tagName: 'DIV', text: row.region, disabled: false }
      if (control.css === '.shippingTimeday') return fixed[service]
        ? { tagName: 'SPAN', text: row.transit, disabled: false }
        : { tagName: 'SELECT', text: '', value: row.transit, disabled: false, options: V2_TEMPLATE_SELECTABLE_TRANSIT.map(value => ({ value, text: `${value === '2 - 2' ? '2 - 4' : value} 天`, disabled: false })) }
      if (control.css.includes('unitMeasure')) return { tagName: 'SELECT', text: '', value: row.unit, disabled: false, options: [{ value: '1', text: '商品', disabled: false }, { value: '2', text: 'Lb', disabled: false }] }
      return { tagName: 'INPUT', text: '', value: control.css.includes('pricePerOrder') ? row.perOrder : row.unitRate, disabled: false }
    }
    if (control.css.includes('templateNameInput')) {
      if (!path.endsWith('SettingAdd')) throw new Error('synthetic editor not ready')
      return { tagName: 'INPUT', text: '', value: name, disabled: false }
    }
    if (control.css.includes('rateModel')) return { tagName: 'INPUT', text: '', value: '0', checked: true, disabled: false }
    if (control.css.includes('service_type')) {
      const service = /#div_(\d+)/.exec(control.scopeCss!)![1]!
      return { tagName: 'INPUT', text: '', checked: serviceData[service]!.enabled, disabled: service === '10001' }
    }
    if (control.css.includes('new_template_selected') && modal !== 'new') throw new Error('synthetic fresh selection absent')
    if (control.css.includes('sureButton') && modal !== 'saved') throw new Error('synthetic save confirmation absent')
    if (control.css === 'button#btnAddTemplate' && !path.endsWith('Setting')) throw new Error('synthetic list not ready')
    if (control.css.startsWith('div.shipping_template_link') && !listRowsReady) return notReady()
    return { tagName: control.css.startsWith('input') ? 'INPUT' : control.css.startsWith('button') ? 'BUTTON' : 'DIV', text: 'fixture', disabled: false }
  }
  const exchange = (apiPath: TemplateExchange['path']): TemplateExchange => {
    const result = { Code: 0 }
    if (apiPath === '/ECrossAmazon/SaveTemplate') return { method: 'POST', origin: templateSnapshot.origin, path: apiPath, httpStatus: 200, requestFields: { courseId: '101', shopId: '202', ds0701: '0', templateName: name }, body: { result } }
    if (apiPath === '/ECrossAmazon/GetTemplateList') return { method: 'POST', origin: templateSnapshot.origin, path: apiPath, httpStatus: 200, requestFields: { courseId: '101', shopId: '202' }, body: { result, jsonStr: [{ DS0701: 1, DS0705: 'existing-fixture', DS0707: 1 }, ...(saved ? [{ DS0701: 2, DS0705: name, DS0707: 0 }] : [])] } }
    return { method: 'POST', origin: templateSnapshot.origin, path: apiPath, httpStatus: 200, requestFields: { courseId: '101', shopId: '202', ds0701: String(selectedTemplate) }, body: { result,
      jsonStr1: [{ DS0701: selectedTemplate, DS0705: name, DS0708: 0 }], jsonStr3: [],
      jsonStr2: Object.entries(serviceData).filter(([, service]) => service.enabled).flatMap(([code, service]) => service.rows.map(row => ({ DS0805: Number(code), DS0810: row.region, DS0813: row.transit, DS0814: Number(row.perOrder), DS0815: Number(row.unitRate), DS0816: Number(row.unit) }))).map((row, index) => ({ DS0801: index + 20, ...row })),
    } }
  }
  const browser: TargetBrowserPort = {
    kind: 'fixture', inspect: vi.fn(async () => ({ ...templateSnapshot, path })),
    readControl: vi.fn(async control => read(control)), waitForControl: vi.fn(async control => {
      // Unlike the old immediate model, visible chrome and data readiness are
      // independent. Production uses the same bounded wait, never a write retry.
      for (let attempt = 0; attempt < 8; attempt++) {
        try { return read(control) } catch (error) {
          if (!(error instanceof Error) || !('code' in error) || error.code !== 'TARGET_CONTROL_NOT_UNIQUE') throw error
          await new Promise(resolve => setTimeout(resolve, 1))
        }
      }
      throw Object.assign(new Error('synthetic bounded DOM wait expired'), { code: 'TARGET_NAVIGATION_TIMEOUT' })
    }),
    readControls: vi.fn(async control => {
      expect(isAuditedV2TemplateControl(control, 'read')).toBe(true)
      if (control.frameCss) return availableCountries().map(country => ({ tagName: 'INPUT', text: '', value: country, checked: checkedCountries.has(country), disabled: false }))
      const service = /#tbody_(\d+)/.exec(control.scopeCss || '')?.[1]
      if (!service) throw new Error('synthetic unknown row scope')
      if (!draftRowsReady) return []
      return serviceData[service]!.rows.map(row => ({ tagName: 'DIV', text: row.region, disabled: false }))
    }),
    click: vi.fn(async control => {
      const readonly = isAuditedV2TemplateControl(control, 'readonly-click')
      expect(readonly || marked).toBe(true)
      expect(readonly || isAuditedV2TemplateControl(control, 'click')).toBe(true)
      if (readonly) { read(control); selectedTemplate = Number(/ds0701="(\d+)"/.exec(control.css)![1]); return }
      if (control.frameCss) {
        if (control.css.startsWith('input')) {
          const country = leafValue(control)!
          if (!availableCountries().includes(country)) throw new Error('synthetic non-pickable country')
          if (checkedCountries.has(country)) checkedCountries.delete(country); else checkedCountries.add(country)
        } else {
          expect(checkedCountries.size).toBe(1)
          serviceData[countryService]!.rows.push({ region: [...checkedCountries][0]!, transit: fixed[countryService] || '1 - 2', perOrder: '0', unitRate: '0', unit: '2' })
          modal = ''
        }
      } else if (control.css === 'button#btnAddTemplate') modal = 'new'
      else if (control.scopeCss === '#divAddTemplate') {
        path = '/ECrossAmazon/SellerShippingTemplateSettingAdd'; modal = ''
        if (options.delayedDom) { draftRowsReady = false; readyLater(() => { draftRowsReady = true }) }
      }
      else if (control.css === 'button#btnSubmit') { saveClicks++; saved = true; modal = 'saved' }
      else if (control.css.includes('sureButton')) {
        modal = ''; path = '/ECrossAmazon/SellerShippingTemplateSetting'; selectedTemplate = 1
        if (options.delayedDom) { listRowsReady = false; readyLater(() => { listRowsReady = true }) }
      }
      else if (control.css.includes('service_type')) {
        const service = /#div_(\d+)/.exec(control.scopeCss!)![1]!
        expect(service).not.toBe('10001'); serviceData[service]!.enabled = !serviceData[service]!.enabled
      } else if (control.css.includes('DeleteTemplateContent')) {
        const service = /#tbody_(\d+)/.exec(control.scopeCss!)![1]!
        if (!options.ignoreDelete) serviceData[service]!.rows = serviceData[service]!.rows.filter(row => row.region !== control.scopeMatch!.exactText)
      } else if (control.css.includes('AddDistributionRules')) {
        countryService = /#div_(\d+)/.exec(control.scopeCss!)![1]!; checkedCountries.clear(); modal = 'country'
        if (options.delayedDom) { countryLeavesReady = false; readyLater(() => { countryLeavesReady = true }) }
      }
      else throw new Error('synthetic unmodelled click')
    }),
    typeAndBlur: vi.fn(async (control, value) => {
      expect(marked).toBe(true); expect(isAuditedV2TemplateControl(control, 'type')).toBe(true)
      if (control.css.includes('templateNameInput')) name = value
      else if (!options.ignoreTyping) {
        const row = rowFor(control)
        if (control.css.includes('pricePerOrder')) row.perOrder = value; else row.unitRate = value
      }
    }),
    select: vi.fn(async (control, value) => {
      expect(marked).toBe(true); expect(isAuditedV2TemplateControl(control, 'select')).toBe(true)
      const row = rowFor(control)
      if (control.css === '.shippingTimeday') row.transit = value; else row.unit = value
    }),
    reload: vi.fn(async () => undefined), dispose: vi.fn(),
    captureResponse: vi.fn(async (apiPath, action, match) => {
      if (apiPath === '/ECrossAmazon/GetFeightRelationList') expect(match).toEqual({ templateId: 2 })
      await action()
      if (options.saveTimeout && apiPath === '/ECrossAmazon/SaveTemplate') throw Object.assign(new Error('fixture timeout after save'), { code: 'TARGET_RESPONSE_TIMEOUT' })
      return exchange(apiPath)
    }),
  }
  const journal = { beforeMutation: vi.fn(async () => { marked = true }), verified: vi.fn(async () => undefined) }
  return { browser, journal, services: serviceData, saves: () => saveClicks, userConfirm: async () => browser.click({ css: 'input.sureButton[value="确定"]', scopeCss: '.k-window' }),
    run: () => createV2Template(browser, classifyTargetSnapshot(templateSnapshot), structuredClone(input), journal, createAuditedV2TemplateBinding()) }
}

describe('compiled V2 template workflow against an isolated UI model', () => {
  it('preserves required mainland, removes unwanted defaults, fills costs and adds a country via the actual form controls', async () => {
    const h = uiModel()
    const receipt = await h.run()
    expect(receipt).toMatchObject({ templateId: 2, ruleCount: 4 })
    expect(h.saves()).toBe(1)
    expect(h.services['10001']!.rows).toHaveLength(1)
    expect(h.services['10002']!.rows[0]!.transit).toBe('2 - 2')
    expect(h.services['10003']!.enabled).toBe(false)
    expect(h.services['10004']!.enabled).toBe(false)
    expect(h.services['20002']!.enabled).toBe(false)
    expect(h.services['20001']!.rows).toEqual([
      { region: 'Canada', transit: '10 - 20', perOrder: '1.23', unitRate: '0.45', unit: '1' },
      { region: 'Mexico', transit: '10 - 20', perOrder: '0', unitRate: '0', unit: '2' },
    ])
    expect(h.journal.verified).toHaveBeenCalledOnce()
    // The success confirmation already triggers the second list response.
    // Reloading again risks aborting that automatic request.
    expect(h.browser.reload).toHaveBeenCalledOnce()
  })
  it('waits for asynchronously populated draft rows, country leaves and the exact new list object', async () => {
    const h = uiModel({ delayedDom: true })
    await expect(h.run()).resolves.toMatchObject({ templateId: 2, ruleCount: 4 })
    expect(h.saves()).toBe(1)
    expect(h.browser.waitForControl).toHaveBeenCalledWith({ css: 'input.subcheckbox[value="Mexico"]', frameCss: 'iframe', framePath: '/ECrossAmazon/SellerShippingTemplateSettingCountryGJ' })
    expect(h.browser.waitForControl).toHaveBeenCalledWith({ css: 'div.shipping_template_link[ds0701="2"]', scopeCss: '#shippingTemplateLinks' })
    expect(h.browser.reload).toHaveBeenCalledOnce()
  })
  it.each([{ hideMexico: true }, { ignoreDelete: true }, { ignoreTyping: true }])('never saves when visible/action state does not match the plan: %j', async options => {
    const h = uiModel(options)
    await expect(h.run()).rejects.toMatchObject({ code: expect.stringMatching(/^TARGET_(COUNTRY_NOT_AVAILABLE|DRAFT_MISMATCH|NAVIGATION_TIMEOUT)$/) })
    expect(h.saves()).toBe(0)
    expect(h.journal.verified).not.toHaveBeenCalled()
  })
  it('does not repeat a timeout save, then reconciles the persisted same object read-only', async () => {
    const h = uiModel({ saveTimeout: true })
    await expect(h.run()).rejects.toMatchObject({ code: 'TARGET_RESPONSE_TIMEOUT' })
    expect(h.saves()).toBe(1)
    expect(h.journal.verified).not.toHaveBeenCalled()
    await h.userConfirm()
    const result = await reconcileV2Template(h.browser, classifyTargetSnapshot(templateSnapshot), input, createAuditedV2TemplateBinding())
    expect(result.status).toBe('verified')
    expect(h.saves()).toBe(1)
  })
  it('requires mainland before any operation and does not guess a domestic country dialog', () => {
    expect(() => assertSupportedV2TemplateInput({ ...input, rules: input.rules.filter(rule => rule.serviceCode !== '10001') })).toThrowError(expect.objectContaining({ code: 'TARGET_REGION_UNSUPPORTED' }))
    expect(() => assertSupportedV2TemplateInput({ ...input, rules: [...input.rules, { ...input.rules[0]!, serviceCode: '10003', countries: ['California'], transitTime: '2' }] })).toThrowError(expect.objectContaining({ code: 'TARGET_REGION_UNSUPPORTED' }))
  })
  it('retains first-phase limits instead of correcting platform option mistakes', () => {
    expect(() => assertSupportedV2TemplateInput({ ...input, rules: input.rules.map(rule => rule.serviceCode === '10002' ? { ...rule, transitTime: '2 - 4' } : rule) })).toThrow()
    expect(() => assertSupportedV2TemplateInput({ ...input, rules: input.rules.map(rule => rule.countries[0] === 'Mexico' ? { ...rule, countries: ['Mexico', 'Japan'] } : rule) })).toThrow()
  })
  it.each([
    { css: '#password' },
    { css: 'input.subcheckbox[value="Mexico"]', frameCss: 'iframe', framePath: '/User/Sign' },
    { css: 'input[name="unitPrice"]', scopeCss: '#tbody_10001 tr.nonPrimeRule' },
    { css: 'input[name="unitPrice"]', scopeCss: '#tbody_10001 tr.nonPrimeRule', scopeMatch: { css: '*', exactText: V2_MAINLAND_REGION } },
    { css: 'div.shipping_template_link[ds0701="2"], #password', scopeCss: '#shippingTemplateLinks' },
  ])('rejects unreviewed or broadened control shapes: %j', control => {
    for (const action of ['read', 'readonly-click', 'click', 'type', 'select'] as const) expect(isAuditedV2TemplateControl(control, action)).toBe(false)
  })
})
