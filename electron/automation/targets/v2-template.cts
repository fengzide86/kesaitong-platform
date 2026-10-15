import { createHash } from 'node:crypto'
import { templateCreateInputSchema } from '../../../src/shared/ipc/target-contract.js'
import type { ProbeObservation, TargetBrowserPort, TemplateCreateInput, TemplateDetails, TemplateExchange, TemplateJournal, TemplateListEntry, TemplateReconciliation, TemplateRule, TemplateVerification, V2TemplateUiBinding } from './contracts.cjs'
import { targetError } from './contracts.cjs'
import { probeContext } from './v2-probe.cjs'

const fail = (code: string, text: string): never => { throw targetError(code, text) }
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail('TARGET_SCHEMA_CHANGED', '平台返回不是预期对象。')
function decoded(value: unknown): unknown {
  if (typeof value !== 'string') return value
  if (value.length > 2_000_000) return fail('TARGET_SCHEMA_CHANGED', '平台返回超出本工具的读取范围。')
  try { return JSON.parse(value) } catch { return fail('TARGET_SCHEMA_CHANGED', '平台返回的嵌套 JSON 无效。') }
}
const rows = (value: unknown): Record<string, unknown>[] => {
  const items = decoded(value)
  if (!Array.isArray(items) || items.length > 10000) return fail('TARGET_SCHEMA_CHANGED', '平台返回的列表结构不匹配。')
  return items.map(record)
}
const text = (value: unknown): string => typeof value === 'string' && value.length <= 1000 ? value : fail('TARGET_SCHEMA_CHANGED', '平台字段类型不匹配。')
const numericId = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fail('TARGET_SCHEMA_CHANGED', '平台对象 ID 无效。')
export function normaliseMoney(value: unknown): string {
  const raw = typeof value === 'number' ? String(value) : value
  if (typeof raw !== 'string' || !/^\d{1,9}(?:\.\d{1,2})?$/.test(raw)) return fail('TARGET_MONEY_INVALID', '金额必须是非负、最多两位小数的十进制数。')
  const [whole = '0', fraction = ''] = raw.split('.')
  return `${BigInt(whole)}.${fraction.padEnd(2, '0')}`
}
export function parseV2Envelope(exchange: TemplateExchange): Record<string, unknown> {
  if (exchange.method !== 'POST' || !Number.isInteger(exchange.httpStatus) || exchange.httpStatus < 200 || exchange.httpStatus >= 300) return fail('TARGET_HTTP_FAILED', '平台请求未正常返回。')
  const body = record(decoded(exchange.body))
  const result = record(decoded(body.result))
  if (result.Code !== 0) return fail('TARGET_BUSINESS_FAILED', '平台业务返回未确认成功；请在平台核对。')
  // Only the parsers below select result data. Token, redirect and raw Msg never leave this module.
  return body
}
export function parseV2TemplateList(exchange: TemplateExchange): TemplateListEntry[] {
  if (exchange.path !== '/ECrossAmazon/GetTemplateList') return fail('TARGET_RESPONSE_MISMATCH', '不是模板列表响应。')
  const templates = rows(parseV2Envelope(exchange).jsonStr).map(row => {
    if (row.DS0707 !== 0 && row.DS0707 !== 1) return fail('TARGET_SCHEMA_CHANGED', '默认模板标记不匹配。')
    return { id: numericId(row.DS0701), name: text(row.DS0705), isDefault: row.DS0707 === 1 }
  })
  if (new Set(templates.map(template => template.id)).size !== templates.length || templates.filter(template => template.isDefault).length > 1) fail('TARGET_SCHEMA_CHANGED', '模板列表存在重复对象或多个默认模板，不能继续写入。')
  return templates
}
export function parseV2TemplateDetails(exchange: TemplateExchange): TemplateDetails {
  if (exchange.path !== '/ECrossAmazon/GetFeightRelationList') return fail('TARGET_RESPONSE_MISMATCH', '不是模板详情响应。')
  const body = parseV2Envelope(exchange)
  const headers = rows(body.jsonStr1)
  if (headers.length !== 1 || headers[0]?.DS0708 !== 0 || rows(body.jsonStr3).length !== 0) return fail('TARGET_SCHEMA_CHANGED', '预期单个重量/件数模板，未确认价格分段模式。')
  const header = headers[0]!
  const rules: TemplateRule[] = rows(body.jsonStr2).map(row => {
    if (row.DS0816 !== 1 && row.DS0816 !== 2) return fail('TARGET_UNIT_UNSUPPORTED', '配送规则单位尚未确认。')
    if (typeof row.DS0805 !== 'number' || ![10001, 10002, 10003, 10004, 20001, 20002].includes(row.DS0805)) return fail('TARGET_SERVICE_UNSUPPORTED', '配送服务尚未确认。')
    return { id: numericId(row.DS0801), serviceCode: String(row.DS0805), regionText: text(row.DS0810), transitTime: text(row.DS0813), perOrder: normaliseMoney(row.DS0814), unitRate: normaliseMoney(row.DS0815), unit: row.DS0816 === 1 ? 'item' : 'lb' }
  })
  if (rules.length === 0 || new Set(rules.map(rule => rule.id)).size !== rules.length) fail('TARGET_SCHEMA_CHANGED', '模板详情缺少规则或规则 ID 重复。')
  return { id: numericId(header.DS0701), name: text(header.DS0705), pricingMode: 'weight-item', rules }
}
export function assertTemplateInput(input: TemplateCreateInput): void {
  if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name !== input.name.trim() || input.name.length > 100) fail('TARGET_INPUT_INVALID', '请填写 1–100 字且首尾无空格的模板名称。')
  if (input.currency !== 'USD' || input.pricingMode !== 'weight-item') fail('TARGET_MODE_UNSUPPORTED', '本适配仅接收已确认的美元重量/件数规则。')
  if (!templateCreateInputSchema.safeParse(input).success) fail('TARGET_INPUT_INVALID', '输入不符合当前工具的名称、最多 12 条规则及字段格式要求。')
  const coveredRegions = new Set<string>()
  for (const rule of input.rules) {
    if (rule.countries.some(country => country !== country.trim()) || rule.transitTime !== rule.transitTime.trim()) fail('TARGET_INPUT_INVALID', '国家和运输时间不能带有首尾空格。')
    for (const country of rule.countries) {
      const key = JSON.stringify([rule.serviceCode, country])
      if (coveredRegions.has(key)) fail('TARGET_INPUT_INVALID', '同一服务内存在重复或交叠国家；当前工具不支持用地址类型区分重叠规则。')
      coveredRegions.add(key)
    }
    normaliseMoney(rule.perOrder); normaliseMoney(rule.unitRate)
  }
}
export function assertTemplateReadback(input: TemplateCreateInput, templateId: number, details: TemplateDetails, regionMatches: V2TemplateUiBinding['regionMatches']): void {
  if (details.id !== templateId || details.name !== input.name || details.pricingMode !== input.pricingMode || details.rules.length !== input.rules.length) fail('TARGET_READBACK_MISMATCH', '回读的模板、名称或规则数量与本次创建不一致。')
  const unmatched = [...details.rules]
  for (const expected of input.rules) {
    const candidates = unmatched.filter(actual => actual.serviceCode === expected.serviceCode && regionMatches(actual.regionText, expected.countries) && actual.transitTime === expected.transitTime && actual.perOrder === normaliseMoney(expected.perOrder) && actual.unitRate === normaliseMoney(expected.unitRate) && actual.unit === expected.unit)
    if (candidates.length !== 1) fail('TARGET_READBACK_MISMATCH', '规则国家、服务、时效、费用或单位不能唯一核对。')
    unmatched.splice(unmatched.indexOf(candidates[0]!), 1)
  }
}
function assertContext(expected: ProbeObservation, actual: ProbeObservation): void {
  if (actual.kind !== 'matched' || actual.version !== 'v2' || actual.missing.length || !expected.localAccountRef || actual.origin !== expected.origin || actual.courseRef !== expected.courseRef || actual.shopRef !== expected.shopRef || actual.role !== expected.role || actual.localAccountRef !== expected.localAccountRef) fail('TARGET_CONTEXT_CHANGED', '平台版本、课程、店铺或登录上下文不匹配。')
}
function assertExchangeContext(exchange: TemplateExchange, expected: ProbeObservation, templateId?: number): void {
  const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  const { courseId, shopId, ds0701 } = exchange.requestFields
  if (exchange.origin !== expected.origin || !courseId || !shopId || hash([expected.origin, 'course', courseId]) !== expected.courseRef || hash([expected.origin, courseId, 'shop', shopId]) !== expected.shopRef || (templateId !== undefined && ds0701 !== String(templateId))) fail('TARGET_RESPONSE_CONTEXT_MISMATCH', '请求对应的实例、课程、店铺或模板与当前操作不一致。')
}

export const V2_TEMPLATE_UNSUPPORTED_UI_BRANCHES = [
  'custom-domestic-region-dialog',
  'multiple-international-countries-in-one-rule',
  'hidden-country-group-expansion',
  'price-band-and-address-type-mutations',
] as const

export async function createV2Template(browser: TargetBrowserPort, expected: ProbeObservation, input: TemplateCreateInput, journal: TemplateJournal, binding?: V2TemplateUiBinding): Promise<TemplateVerification> {
  assertTemplateInput(input)
  if (!binding) return fail('TARGET_UI_EVIDENCE_MISSING', '尚缺当前平台模板表单的审核绑定证据，已停止；不会套用旧选择器或猜测提交。')
  if (!binding.evidenceSources.length || (browser.kind !== 'fixture' && binding.verificationLevel !== 'audited-ui')) fail('TARGET_UI_EVIDENCE_MISSING', '模板表单绑定尚未取得现场证据，已停止。')
  binding.assertSupportedInput?.(input)
  assertContext(expected, await probeContext(browser))
  const listBefore = await binding.readList(browser)
  assertExchangeContext(listBefore, expected)
  const before = parseV2TemplateList(listBefore)
  if (before.some(row => row.name === input.name)) fail('TARGET_OBJECT_EXISTS', '已有同名模板，未执行创建；请先核对已有对象。')
  // Even draft controls can autosave. Durably record before the first UI mutation.
  await journal.beforeMutation()
  await binding.fillDraft(browser, input)
  await binding.assertCurrencyAndUnits(browser, input)
  assertContext(expected, await probeContext(browser))
  const saved = await browser.captureResponse('/ECrossAmazon/SaveTemplate', () => binding.save(browser))
  assertExchangeContext(saved, expected)
  // 2026-10-12 live R2 captured the new-template sentinel as the string "0".
  // SaveTemplate does not return the new ID; discover it by scoped list readback.
  if (saved.path !== '/ECrossAmazon/SaveTemplate' || saved.requestFields.templateName !== input.name || saved.requestFields.ds0701 !== '0') fail('TARGET_WRITE_MISMATCH', '观察到的保存不是本次新模板，结果需要核对。')
  parseV2Envelope(saved)
  const listAfter = await binding.readList(browser)
  assertExchangeContext(listAfter, expected)
  const after = parseV2TemplateList(listAfter)
  const matches = after.filter(row => row.name === input.name)
  if (matches.length !== 1 || before.some(row => row.id === matches[0]?.id)) fail('TARGET_READBACK_MISMATCH', '保存后的新模板不能唯一回读，禁止重复提交。')
  const template = matches[0]!
  if (template.isDefault || before.some(prior => {
    const current = after.find(row => row.id === prior.id)
    return !current || current.isDefault !== prior.isDefault || current.name !== prior.name
  })) fail('TARGET_DEFAULT_CHANGED', '已有模板或默认状态发生了预期之外的变化，需要核对。')
  if (after.length !== before.length + 1) fail('TARGET_READBACK_MISMATCH', '保存期间出现其他新增模板，需要先核对，不能判为本次唯一创建成功。')
  const detailExchange = await binding.readDetails(browser, template.id)
  assertExchangeContext(detailExchange, expected, template.id)
  const details = parseV2TemplateDetails(detailExchange)
  assertTemplateReadback(input, template.id, details, binding.regionMatches)
  assertContext(expected, await probeContext(browser))
  const receipt: TemplateVerification = { templateId: template.id, name: input.name, ruleCount: details.rules.length, verification: 'same-object-list-and-details', evidence: [saved, listAfter, detailExchange].map(exchange => ({ method: 'POST', path: exchange.path, httpStatus: exchange.httpStatus, code: 0 })) }
  await journal.verified(receipt)
  return receipt
}

/** Read-only reconciliation; never calls fillDraft/save or changes a platform object. */
export async function reconcileV2Template(browser: TargetBrowserPort, expected: ProbeObservation, input: TemplateCreateInput, binding?: V2TemplateUiBinding, knownTemplateId?: number): Promise<TemplateReconciliation> {
  assertTemplateInput(input)
  if (!binding) return fail('TARGET_UI_EVIDENCE_MISSING', '缺少经审核的模板列表和详情读取绑定。')
  if (!binding.evidenceSources.length || (browser.kind !== 'fixture' && binding.verificationLevel !== 'audited-ui')) fail('TARGET_UI_EVIDENCE_MISSING', '模板读取绑定尚未取得现场证据。')
  binding.assertSupportedInput?.(input)
  assertContext(expected, await probeContext(browser))
  const list = await binding.readList(browser)
  assertExchangeContext(list, expected)
  const entries = parseV2TemplateList(list)
  const matches = entries.filter(row => row.name === input.name)
  if (knownTemplateId !== undefined && (!Number.isSafeInteger(knownTemplateId) || knownTemplateId <= 0 || entries.some(row => row.id === knownTemplateId && row.name !== input.name))) fail('TARGET_READBACK_MISMATCH', '原模板已改名或原对象 ID 无效，不能作为未提交再次创建。')
  if (matches.length === 0) {
    assertContext(expected, await probeContext(browser))
    return { status: 'not_found' }
  }
  if (matches.length !== 1 || (knownTemplateId !== undefined && matches[0]?.id !== knownTemplateId)) fail('TARGET_READBACK_MISMATCH', '模板不能唯一匹配原对象，不能判为核对完成。')
  const template = matches[0]!
  const detail = await binding.readDetails(browser, template.id)
  assertExchangeContext(detail, expected, template.id)
  assertTemplateReadback(input, template.id, parseV2TemplateDetails(detail), binding.regionMatches)
  await binding.assertCurrencyAndUnits(browser, input)
  assertContext(expected, await probeContext(browser))
  return { status: 'verified', receipt: { templateId: template.id, name: input.name, ruleCount: input.rules.length, verification: 'same-object-list-and-details', evidence: [list, detail].map(exchange => ({ method: 'POST', path: exchange.path, httpStatus: exchange.httpStatus, code: 0 })) } }
}
