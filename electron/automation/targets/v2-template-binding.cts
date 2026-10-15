import type { TargetBrowserPort, TargetControl, TargetControlState, TemplateCreateInput, TemplateExchange, V2TemplateUiBinding } from './contracts.cjs'
import { targetError } from './contracts.cjs'
import { assertTemplateInput, normaliseMoney } from './v2-template.cjs'
import { V2_MAINLAND_REGION, V2_ISLAND_REGION, V2_TEMPLATE_FIXED_TRANSIT, V2_TEMPLATE_SELECTABLE_TRANSIT } from '../../../src/shared/ipc/target-template-options.js'
export { V2_MAINLAND_REGION, V2_ISLAND_REGION }

/**
 * R1 DOM observations from both 2026-10-12 entries plus the current public
 * deployment R2 save/readback establish this bounded form workflow. A binding
 * is not permission to execute: verified identity, approved profile/route,
 * grant, edition and a write-ahead journal are enforced by the host/recipe.
 */
export const V2_TEMPLATE_FIELD_MAP = Object.freeze({
  templateName: 'DS0705', pricingMode: 'DS0708', service: 'DS0805',
  regionText: 'DS0810', transitTime: 'DS0813', perOrder: 'DS0814',
  unitRate: 'DS0815', unit: 'DS0816',
} as const)
export const V2_TEMPLATE_SERVICES = Object.freeze([
  { code: '10001', label: '标准配送', scope: 'domestic', containerCss: '#div_10001' },
  { code: '10002', label: '加急配送', scope: 'domestic', containerCss: '#div_10002' },
  { code: '10003', label: '两日达', scope: 'domestic', containerCss: '#div_10003' },
  { code: '10004', label: '一日达', scope: 'domestic', containerCss: '#div_10004' },
  { code: '20001', label: '标准配送', scope: 'international', containerCss: '#div_20001' },
  { code: '20002', label: '加急配送', scope: 'international', containerCss: '#div_20002' },
] as const)
export type V2ServiceCode = typeof V2_TEMPLATE_SERVICES[number]['code']
export const V2_TEMPLATE_OBSERVED_FORM = Object.freeze({
  evidenceLevel: 'R2', executable: true,
  editorPath: '/ECrossAmazon/SellerShippingTemplateSettingAdd',
  nameCss: 'input#templateNameInput[name="templateName"]',
  saveCss: 'button#btnSubmit', cancelCss: 'button#btnCancel',
  rateModelCss: 'input[name="rateModel"][value="0"]',
  serviceToggleCss: 'input[name="service_type"]',
  // The following controls are meaningful only inside an independently unique
  // audited rule row. They are never used as document-wide first-match queries.
  unitCss: 'select[name="unitMeasure"]',
  perOrderCss: 'input[name="pricePerOrder"]', unitRateCss: 'input[name="unitPrice"]',
  transitCss: 'select.shippingTimeday',
  listPath: '/ECrossAmazon/SellerShippingTemplateSetting', listScopeCss: '#shippingTemplateLinks',
  rowCss: 'tr.nonPrimeRule', regionCss: '.regions_name_left',
  // Current DOM: domestic standard service is checked and disabled. A proposed
  // international-only draft must not silently inherit its default mainland row.
  mandatoryService: '10001',
} as const)

export interface V2TemplateDraftRule {
  /** Stable DOM identity in this service, not a guessed positional index. */
  key: string
  regionText: string
  /** Must come from a proven UI-to-DS0813 roundtrip, not guessed option labels. */
  transitTime: string
  perOrder: string
  unitRate: string
  unitValue: string
}
export interface V2TemplateDraft {
  name: string
  pricingModeValue: string
  /** Audited fixed-USD form contract, not an inferred currency from '$' alone. */
  currency: string
  services: Array<{ code: string; enabled: boolean; rules: V2TemplateDraftRule[] }>
}
export interface V2TemplateDraftPlan {
  services: Array<{ code: V2ServiceCode; enabled: boolean; rules: TemplateCreateInput['rules'] }>
}

/** Every service is specified, including the ones that must be disabled. */
export function buildV2TemplateDraftPlan(input: TemplateCreateInput): V2TemplateDraftPlan {
  assertTemplateInput(input)
  return { services: V2_TEMPLATE_SERVICES.map(service => {
    const rules = input.rules.filter(rule => rule.serviceCode === service.code).map(rule => ({ ...rule, countries: [...rule.countries] }))
    return { code: service.code, enabled: rules.length > 0, rules }
  }) }
}

/** Current live DOM confirmed that row indices/DS1101 alone are not unique. */
export function v2TemplateRowControl(serviceCode: V2ServiceCode, regionText: string, css: string): TargetControl {
  if (!V2_TEMPLATE_SERVICES.some(service => service.code === serviceCode) || !regionText || regionText.length > 2000) throw targetError('TARGET_INPUT_INVALID', '配送服务或唯一地区行标记无效。')
  return { css, scopeCss: `#tbody_${serviceCode} tr.nonPrimeRule`, scopeMatch: { css: '.regions_name_left', exactText: regionText } }
}

export function v2TemplateDetailControl(templateId: number): TargetControl {
  if (!Number.isSafeInteger(templateId) || templateId <= 0) throw targetError('TARGET_INPUT_INVALID', '模板 ID 无效。')
  return { css: `div.shipping_template_link[ds0701="${templateId}"]`, scopeCss: '#shippingTemplateLinks' }
}

async function assertListPage(browser: TargetBrowserPort): Promise<void> {
  const snapshot = await browser.inspect()
  if (snapshot.loginVisible || !snapshot.amazonRoute || !snapshot.templateDom || snapshot.path !== V2_TEMPLATE_OBSERVED_FORM.listPath) throw targetError('TARGET_PAGE_NOT_READY', '请先进入当前课程的配送模板列表，未使用猜测地址跳转。')
}

/** UI-triggered reads only; these do not use fetch, guessed URLs or API replay. */
export async function readV2TemplateList(browser: TargetBrowserPort): Promise<TemplateExchange> {
  await assertListPage(browser)
  return browser.captureResponse('/ECrossAmazon/GetTemplateList', () => browser.reload())
}

export async function readV2TemplateDetails(browser: TargetBrowserPort, templateId: number): Promise<TemplateExchange> {
  await assertListPage(browser)
  const control = v2TemplateDetailControl(templateId)
  // The response may precede list rendering. Wait for this exact ID, never the
  // default/first template, and still reject a missing/duplicate visual object.
  await browser.waitForControl(control)
  return browser.captureResponse('/ECrossAmazon/GetFeightRelationList', () => browser.click(control), { templateId })
}

export interface V2TemplateDraftReadEvidence {
  /** Actual selected option/value -> DS0813 mapping, supplied by local code only. */
  transitTime(serviceCode: V2ServiceCode, state: TargetControlState): string
  /** Must validate the current fixed-USD contract; not just search for '$'. */
  assertFixedUsd(browser: TargetBrowserPort): Promise<void>
}

/** Reads every enabled row, including unwanted defaults, without changing it. */
export async function readV2TemplateDraft(browser: TargetBrowserPort, evidence: V2TemplateDraftReadEvidence): Promise<V2TemplateDraft> {
  const snapshot = await browser.inspect()
  if (snapshot.loginVisible || !snapshot.amazonRoute || !snapshot.templateDom || snapshot.path !== V2_TEMPLATE_OBSERVED_FORM.editorPath) throw targetError('TARGET_PAGE_NOT_READY', '当前不是配送模板编辑页。')
  await evidence.assertFixedUsd(browser)
  const name = await browser.readControl({ css: V2_TEMPLATE_OBSERVED_FORM.nameCss })
  const mode = await browser.readControl({ css: V2_TEMPLATE_OBSERVED_FORM.rateModelCss })
  if (name.tagName !== 'INPUT' || name.value === undefined || mode.tagName !== 'INPUT' || mode.checked !== true || mode.value !== '0') throw targetError('TARGET_DRAFT_MISMATCH', '模板名称或计费模式没有在页面正确选中。')
  const services: V2TemplateDraft['services'] = []
  for (const service of V2_TEMPLATE_SERVICES) {
    const toggle = await browser.readControl({ css: V2_TEMPLATE_OBSERVED_FORM.serviceToggleCss, scopeCss: service.containerCss })
    if (toggle.tagName !== 'INPUT' || toggle.checked === undefined || (service.code === '10001' && (!toggle.checked || !toggle.disabled))) throw targetError('TARGET_DRAFT_MISMATCH', '配送服务选择器与已审核页面结构不符。')
    const rules: V2TemplateDraftRule[] = []
    if (toggle.checked) {
      const regions = await browser.readControls({ css: 'tr.nonPrimeRule .regions_name_left', scopeCss: `#tbody_${service.code}` })
      if (regions.length === 0 || regions.some(region => !region.text) || new Set(regions.map(region => region.text)).size !== regions.length) throw targetError('TARGET_DRAFT_MISMATCH', '配送地区行缺失或无法唯一识别。')
      for (const region of regions) {
        const control = (css: string) => v2TemplateRowControl(service.code, region.text, css)
        const [transit, perOrder, unitRate, unit] = await Promise.all([
          browser.readControl(control('.shippingTimeday')),
          browser.readControl(control(V2_TEMPLATE_OBSERVED_FORM.perOrderCss)),
          browser.readControl(control(V2_TEMPLATE_OBSERVED_FORM.unitRateCss)),
          browser.readControl(control(V2_TEMPLATE_OBSERVED_FORM.unitCss)),
        ])
        if (perOrder.tagName !== 'INPUT' || unitRate.tagName !== 'INPUT' || unit.tagName !== 'SELECT' || perOrder.value === undefined || unitRate.value === undefined || !['1', '2'].includes(unit.value || '')) throw targetError('TARGET_DRAFT_MISMATCH', '配送费用或单位控件缺失。')
        rules.push({ key: region.text, regionText: region.text, transitTime: evidence.transitTime(service.code, transit), perOrder: perOrder.value, unitRate: unitRate.value, unitValue: unit.value! })
      }
    }
    services.push({ code: service.code, enabled: toggle.checked, rules })
  }
  return { name: name.value, pricingModeValue: mode.value, currency: 'USD', services }
}

/**
 * Final pre-submit gate: validates the complete enabled rule set. It catches
 * untouched default rows before SaveTemplate, not only after a bad submission.
 */
export function assertV2TemplateDraft(input: TemplateCreateInput, observed: V2TemplateDraft, regionMatches: V2TemplateUiBinding['regionMatches']): void {
  const fail = (): never => { throw targetError('TARGET_DRAFT_MISMATCH', '当前模板草稿包含缺失、额外或未按计划填写的规则，未提交。') }
  const plan = buildV2TemplateDraftPlan(input)
  if (observed.name !== input.name || observed.pricingModeValue !== '0' || observed.currency !== 'USD' || observed.services.length !== plan.services.length) fail()
  for (const expected of plan.services) {
    const services = observed.services.filter(service => service.code === expected.code)
    if (services.length !== 1 || services[0]!.enabled !== expected.enabled) fail()
    const actual = services[0]!
    if (!actual.enabled) continue
    if (actual.rules.length !== expected.rules.length || actual.rules.some(rule => !rule.key) || new Set(actual.rules.map(rule => rule.key)).size !== actual.rules.length) fail()
    const remaining = [...actual.rules]
    for (const rule of expected.rules) {
      const matching = remaining.filter(row => regionMatches(row.regionText, rule.countries)
        && row.transitTime === rule.transitTime && normaliseMoney(row.perOrder) === normaliseMoney(rule.perOrder)
        && normaliseMoney(row.unitRate) === normaliseMoney(rule.unitRate) && row.unitValue === (rule.unit === 'item' ? '1' : '2'))
      if (matching.length !== 1) fail()
      remaining.splice(remaining.indexOf(matching[0]!), 1)
    }
  }
}

const countryFrame = { frameCss: 'iframe', framePath: '/ECrossAmazon/SellerShippingTemplateSettingCountryGJ' } as const
const addTemplate = { css: 'button#btnAddTemplate' }
const freshChoice = { css: '.new_template_selected[datatype="1"]', scopeCss: '#divAddTemplate' }
const newConfirm = { css: 'button[onclick="SubmitCancelTemplate(2)"]', scopeCss: '#divAddTemplate' }
const saveConfirm = { css: 'input.sureButton[value="确定"]', scopeCss: '.k-window' }
const countryConfirm = { css: 'button[onclick="SubmitCancelTemplate(2)"]', ...countryFrame }
const countryLeaves = { css: 'input.subcheckbox', ...countryFrame }
const fieldCss = ['.regions_name_left', '.shippingTimeday', V2_TEMPLATE_OBSERVED_FORM.perOrderCss, V2_TEMPLATE_OBSERVED_FORM.unitRateCss, V2_TEMPLATE_OBSERVED_FORM.unitCss] as const
const deleteRowCss = 'a[onclick="DeleteTemplateContent(this);"]'
const fixedTransit: Readonly<Partial<Record<V2ServiceCode, string>>> = V2_TEMPLATE_FIXED_TRANSIT
const selectableTransit = V2_TEMPLATE_SELECTABLE_TRANSIT
const unavailable = (message: string): never => { throw targetError('TARGET_REGION_UNSUPPORTED', message) }

function regionParts(text: string): string[] {
  // The delimiter is established by current R2 DOM/XML/details, not inferred
  // from historical field names. Embedded-comma country names remain unsupported.
  const parts = text.split(',').map(part => part.trim())
  if (parts.some(part => !part) || new Set(parts).size !== parts.length) return []
  return parts.sort()
}
export function matchV2Region(actual: string, countries: readonly string[]): boolean {
  if (!countries.length || countries.some(country => country.includes(',') || country !== country.trim())) return false
  return JSON.stringify(regionParts(actual)) === JSON.stringify([...countries].sort())
}
function safeCountry(country: string): boolean { return /^[A-Za-z][A-Za-z .,'()&/-]{0,79}$/.test(country) && !country.includes(',') }
const countryControl = (country: string): TargetControl => {
  if (!safeCountry(country)) return unavailable('首期国际规则仅支持已显示的英文国家叶子，不能生成任意选择器。')
  return { css: `input.subcheckbox[value="${country}"]`, ...countryFrame }
}

export function assertSupportedV2TemplateInput(input: TemplateCreateInput): void {
  assertTemplateInput(input)
  if (!input.rules.some(rule => rule.serviceCode === '10001' && matchV2Region(V2_MAINLAND_REGION, rule.countries))) unavailable('平台强制标准国内配送覆盖完整大陆地区；请在计划中包含这条规则，不能只创建国际规则。')
  for (const rule of input.rules) {
    const service = rule.serviceCode as V2ServiceCode
    if (service.startsWith('100')) {
      if (!matchV2Region(V2_MAINLAND_REGION, rule.countries) && !(service === '10001' && matchV2Region(V2_ISLAND_REGION, rule.countries))) unavailable('首期国内规则只支持已验证的完整大陆地区，以及标准配送的 Alaska/Hawaii/Puerto Rico 组合。')
    } else if (rule.countries.length !== 1 || !safeCountry(rule.countries[0]!)) unavailable('首期每条国际规则支持一个当前弹窗可见且可选的国家；其他国家组合尚未验证。')
    if (fixedTransit[service] ? rule.transitTime !== fixedTransit[service] : !(selectableTransit as readonly string[]).includes(rule.transitTime)) unavailable('运输时间必须使用该服务已验证的实际值；2 - 2 对应平台显示的 2 - 4 天，不自行修正。')
  }
}

function auditedTransit(service: V2ServiceCode, state: TargetControlState): string {
  const fixed = fixedTransit[service]
  if (fixed && state.tagName === 'SPAN' && state.text === fixed) return fixed
  if (!fixed && state.tagName === 'SELECT' && state.value && (selectableTransit as readonly string[]).includes(state.value)
    && state.options?.filter(option => option.value === state.value && !option.disabled).length === 1) return state.value
  throw targetError('TARGET_SCHEMA_CHANGED', '当前运输时效控件与已验证的固定值或下拉项不一致。')
}
async function assertFixedUsd(browser: TargetBrowserPort): Promise<void> {
  const snapshot = await browser.inspect()
  if (!snapshot.amazonRoute || !snapshot.templateDom || ![V2_TEMPLATE_OBSERVED_FORM.editorPath, V2_TEMPLATE_OBSERVED_FORM.listPath].includes(snapshot.path as typeof V2_TEMPLATE_OBSERVED_FORM.editorPath)) throw targetError('TARGET_MODE_UNSUPPORTED', '当前页面不属于已审核的固定美元配送模板合同。')
  // This is the current Add.js DS0814/DS0815 fixed-USD contract, corroborated by
  // R2; no currency selector exists. A dollar symbol alone is not used as proof.
}
const draftEvidence: V2TemplateDraftReadEvidence = { transitTime: auditedTransit, assertFixedUsd }

async function regionsFor(browser: TargetBrowserPort, service: V2ServiceCode): Promise<string[]> {
  const rows = await browser.readControls({ css: 'tr.nonPrimeRule .regions_name_left', scopeCss: `#tbody_${service}` })
  if (rows.some(row => !row.text) || new Set(rows.map(row => row.text)).size !== rows.length) throw targetError('TARGET_DRAFT_MISMATCH', '地区行无法唯一识别，未采用索引回退。')
  return rows.map(row => row.text)
}

async function addInternationalRow(browser: TargetBrowserPort, service: V2ServiceCode, country: string): Promise<void> {
  if (!service.startsWith('200')) return unavailable('国内新增地区弹窗未在本轮验证，未尝试点击。')
  await browser.click({ css: 'button[onclick^="AddDistributionRules"]', scopeCss: `#div_${service}` })
  await browser.waitForControl(countryConfirm)
  // The dialog chrome can precede its asynchronously populated country leaves.
  // A hidden/unavailable country remains a bounded failure, not an expansion guess.
  await browser.waitForControl(countryControl(country))
  const leaves = await browser.readControls(countryLeaves)
  if (!leaves.length || leaves.some(leaf => leaf.tagName !== 'INPUT' || leaf.checked === undefined || !leaf.value || !safeCountry(leaf.value))
    || new Set(leaves.map(leaf => leaf.value)).size !== leaves.length) throw targetError('TARGET_COUNTRY_NOT_AVAILABLE', '当前国家叶子列表不完整或结构有变化。')
  const target = leaves.filter(leaf => leaf.value === country && !leaf.disabled)
  if (target.length !== 1) throw targetError('TARGET_COUNTRY_NOT_AVAILABLE', '目标国家不可见、不可选或已被其他规则占用；未猜测展开控件。')
  for (const leaf of leaves) {
    if (!leaf.disabled && leaf.checked !== (leaf.value === country)) await browser.click(countryControl(leaf.value!))
  }
  const selected = (await browser.readControls(countryLeaves)).filter(leaf => !leaf.disabled && leaf.checked)
  if (selected.length !== 1 || selected[0]!.value !== country) throw targetError('TARGET_DRAFT_MISMATCH', '国家选择状态未与本条规则一致，未确认弹窗。')
  await browser.click(countryConfirm)
  await browser.waitForControl(v2TemplateRowControl(service, country, '.regions_name_left'))
}

/** The factory is stateful per operation; a previous task cannot confirm a new save. */
export function createAuditedV2TemplateBinding(): V2TemplateUiBinding {
  let pendingSaveConfirmation = false
  let draftInput: TemplateCreateInput | undefined
  return {
    id: 'bjysoft-v2-template-ui-20261012', verificationLevel: 'audited-ui',
    evidenceSources: ['2026-10-12-two-entry-template-dom-r1', '2026-10-12-public-v2-template-create-save-same-id-r2'],
    assertSupportedInput: assertSupportedV2TemplateInput,
    async readList(browser) {
      if (pendingSaveConfirmation) {
        await browser.waitForControl(saveConfirm)
        // Confirmation itself navigates and loads the list. A second reload can
        // abort that request and accidentally capture its failure instead.
        const exchange = await browser.captureResponse('/ECrossAmazon/GetTemplateList', () => browser.click(saveConfirm))
        await browser.waitForControl(addTemplate)
        await assertListPage(browser)
        pendingSaveConfirmation = false
        return exchange
      }
      return readV2TemplateList(browser)
    },
    async fillDraft(browser, input) {
      assertSupportedV2TemplateInput(input)
      await assertListPage(browser)
      await browser.click(addTemplate)
      await browser.waitForControl(freshChoice)
      await browser.click(newConfirm)
      await browser.waitForControl({ css: V2_TEMPLATE_OBSERVED_FORM.nameCss })
      // The name input is static chrome; the seven observed defaults are loaded
      // later. Wait for each actual row before reading/removing/editing defaults.
      for (const service of V2_TEMPLATE_SERVICES) {
        await browser.waitForControl(v2TemplateRowControl(service.code, service.scope === 'domestic' ? V2_MAINLAND_REGION : 'Canada', V2_TEMPLATE_OBSERVED_FORM.unitCss))
      }
      await browser.waitForControl(v2TemplateRowControl('10001', V2_ISLAND_REGION, V2_TEMPLATE_OBSERVED_FORM.unitCss))
      await browser.typeAndBlur({ css: V2_TEMPLATE_OBSERVED_FORM.nameCss }, input.name)
      const plan = buildV2TemplateDraftPlan(input)
      for (const service of plan.services) {
        const toggle = { css: V2_TEMPLATE_OBSERVED_FORM.serviceToggleCss, scopeCss: `#div_${service.code}` }
        const current = await browser.readControl(toggle)
        if (current.checked === undefined || (current.disabled && current.checked !== service.enabled)) throw targetError('TARGET_DRAFT_MISMATCH', '平台强制服务状态与计划不同。')
        if (current.checked !== service.enabled) await browser.click(toggle)
        if (!service.enabled) continue
        for (const region of await regionsFor(browser, service.code)) {
          if (!service.rules.some(rule => matchV2Region(region, rule.countries))) await browser.click(v2TemplateRowControl(service.code, region, deleteRowCss))
        }
        for (const rule of service.rules) {
          let matches = (await regionsFor(browser, service.code)).filter(region => matchV2Region(region, rule.countries))
          if (!matches.length && service.code.startsWith('200')) {
            await addInternationalRow(browser, service.code, rule.countries[0]!)
            matches = (await regionsFor(browser, service.code)).filter(region => matchV2Region(region, rule.countries))
          }
          if (matches.length !== 1) throw targetError('TARGET_DRAFT_MISMATCH', '目标规则不存在或不唯一，未采用第一行代替。')
          const control = (css: string) => v2TemplateRowControl(service.code, matches[0]!, css)
          const transit = await browser.readControl(control('.shippingTimeday'))
          if (auditedTransit(service.code, transit) !== rule.transitTime) {
            if (transit.tagName !== 'SELECT') throw targetError('TARGET_DRAFT_MISMATCH', '固定运输时间不能修改。')
            await browser.select(control('.shippingTimeday'), rule.transitTime)
          }
          for (const [css, desired] of [[V2_TEMPLATE_OBSERVED_FORM.perOrderCss, rule.perOrder], [V2_TEMPLATE_OBSERVED_FORM.unitRateCss, rule.unitRate]] as const) {
            const field = await browser.readControl(control(css))
            if (field.value === undefined) throw targetError('TARGET_DRAFT_MISMATCH', '金额字段缺失。')
            if (normaliseMoney(field.value) !== normaliseMoney(desired)) {
              if (field.disabled) throw targetError('TARGET_DRAFT_FIELD_LOCKED', '平台锁定的费用与计划不同，未绕过控件修改。')
              await browser.typeAndBlur(control(css), desired)
            }
          }
          const unit = await browser.readControl(control(V2_TEMPLATE_OBSERVED_FORM.unitCss))
          const wantedUnit = rule.unit === 'item' ? '1' : '2'
          if (unit.value !== wantedUnit) {
            if (unit.disabled) throw targetError('TARGET_DRAFT_FIELD_LOCKED', '平台锁定的单位与计划不同。')
            await browser.select(control(V2_TEMPLATE_OBSERVED_FORM.unitCss), wantedUnit)
          }
        }
      }
      assertV2TemplateDraft(input, await readV2TemplateDraft(browser, draftEvidence), matchV2Region)
      draftInput = structuredClone(input)
    },
    async save(browser) {
      if (!draftInput || pendingSaveConfirmation) throw targetError('TARGET_WRITE_MISMATCH', '当前操作没有已核对的草稿，或保存已经提交。')
      assertV2TemplateDraft(draftInput, await readV2TemplateDraft(browser, draftEvidence), matchV2Region)
      pendingSaveConfirmation = true
      await browser.click({ css: V2_TEMPLATE_OBSERVED_FORM.saveCss })
    },
    readDetails: readV2TemplateDetails,
    regionMatches: matchV2Region,
    async assertCurrencyAndUnits(browser, input) {
      await assertFixedUsd(browser)
      if ((await browser.inspect()).path === V2_TEMPLATE_OBSERVED_FORM.editorPath) assertV2TemplateDraft(input, await readV2TemplateDraft(browser, draftEvidence), matchV2Region)
      // Read-only reconciliation checks persisted units in parse/details.
    },
  }
}

/** Strict compiled selector grammar: variable data is never interpreted as CSS. */
export function isAuditedV2TemplateControl(control: TargetControl, action: 'read' | 'readonly-click' | 'click' | 'type' | 'select'): boolean {
  const exact = (expected: TargetControl): boolean => control.css === expected.css && control.scopeCss === expected.scopeCss && control.frameCss === expected.frameCss
    && control.framePath === expected.framePath && control.exactText === expected.exactText && control.scopeMatch?.css === expected.scopeMatch?.css && control.scopeMatch?.exactText === expected.scopeMatch?.exactText
  const detail = /^div\.shipping_template_link\[ds0701="([1-9]\d*)"\]$/.exec(control.css)
  if (detail && Number.isSafeInteger(Number(detail[1])) && exact(v2TemplateDetailControl(Number(detail[1])))) return action === 'read' || action === 'readonly-click'
  if (action === 'readonly-click') return false
  if (control.frameCss || control.framePath) {
    if (exact(countryConfirm)) return action === 'read' || action === 'click'
    if (exact(countryLeaves)) return action === 'read'
    const country = /^input\.subcheckbox\[value="([^"\\]+)"\]$/.exec(control.css)?.[1]
    return !!country && safeCountry(country) && exact(countryControl(country)) && (action === 'read' || action === 'click')
  }
  if ([addTemplate, freshChoice, newConfirm, saveConfirm, { css: V2_TEMPLATE_OBSERVED_FORM.saveCss }].some(exact)) return action === 'read' || (action === 'click' && !exact(freshChoice))
  if (exact({ css: V2_TEMPLATE_OBSERVED_FORM.nameCss })) return action === 'read' || action === 'type'
  if (exact({ css: V2_TEMPLATE_OBSERVED_FORM.rateModelCss })) return action === 'read'
  for (const service of V2_TEMPLATE_SERVICES) {
    if (exact({ css: V2_TEMPLATE_OBSERVED_FORM.serviceToggleCss, scopeCss: service.containerCss }) || exact({ css: 'button[onclick^="AddDistributionRules"]', scopeCss: service.containerCss })) return action === 'read' || action === 'click'
    if (exact({ css: 'tr.nonPrimeRule .regions_name_left', scopeCss: `#tbody_${service.code}` })) return action === 'read'
    if (control.scopeMatch?.exactText && control.scopeMatch.exactText.length <= 2000 && (fieldCss as readonly string[]).concat(deleteRowCss).includes(control.css)
      && exact(v2TemplateRowControl(service.code, control.scopeMatch.exactText, control.css))) {
      if (action === 'read') return true
      if (action === 'click') return control.css === deleteRowCss
      if (action === 'type') return [V2_TEMPLATE_OBSERVED_FORM.perOrderCss, V2_TEMPLATE_OBSERVED_FORM.unitRateCss].includes(control.css as typeof V2_TEMPLATE_OBSERVED_FORM.perOrderCss)
      if (action === 'select') return ['.shippingTimeday', V2_TEMPLATE_OBSERVED_FORM.unitCss].includes(control.css)
    }
  }
  return false
}
