// Offline sample only. V2 field facts: template-api-evidence and
// template-price-band-2026-10-04; per-child-SKU binding is not established.
import type { ShippingTemplate, State } from './model'
import type { WorkflowReply } from './workflow-contract'

export const TEMPLATE_COUNTRIES = ['美国', '英国', '加拿大', '德国', '法国', '日本', '澳大利亚'] as const
export const TEMPLATE_SERVICES = ['标准配送', '加急配送', '两日配送', '一日配送'] as const
export interface TemplateBand { from: number; to: number | null; fee: number }
export interface TemplateRule {
  id: string; scope: 'domestic' | 'international'; countries: string[]; service: string
  transit: string; base: number; perUnit: number; unit: 'item' | 'lb'; bands: TemplateBand[]
}
export interface TemplateDetail { templateId: string; mode: 'weight' | 'price'; rules: TemplateRule[] }
export interface TemplateData { version: 1; defaultTemplateId: string; details: TemplateDetail[] }
export type TemplateCommand =
  | { type: 'save'; template: ShippingTemplate; detail: TemplateDetail }
  | { type: 'default'; id: string }
  | { type: 'delete'; id: string }
  | { type: 'assign'; id: string; productId: string }

export const createTemplateData = (): TemplateData => ({ version: 1, defaultTemplateId: 'sample-standard', details: [] })
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.length <= 200
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const nameKey = (v: string) => v.trim().toLocaleLowerCase('en-US')

function templateIssue(v: unknown): string {
  if (!record(v) || !text(v.id) || !text(v.name)) return '请填写模板名称。'
  if (!text(v.country) || !text(v.service) || !['kg', 'lb'].includes(String(v.unit)) || !['USD', 'CNY'].includes(String(v.currency))) return '请核对本地模板参数。'
  if (!number(v.limit) || v.limit <= 0 || !number(v.handling) || !Number.isInteger(v.handling) || !number(v.base) || !number(v.perKg)) return '限重须大于 0；处理时间须为非负整数；金额不能为负。'
  return ''
}
function detailIssue(v: unknown): string {
  if (!record(v) || !text(v.templateId) || !['weight', 'price'].includes(String(v.mode)) || !Array.isArray(v.rules) || !v.rules.length) return '至少保留一条配送规则。'
  const ids = new Set<string>(), combinations = new Set<string>()
  for (const raw of v.rules) {
    if (!record(raw) || !text(raw.id) || ids.has(raw.id)) return '配送规则标识无效或重复。'
    ids.add(raw.id)
    if (!['domestic', 'international'].includes(String(raw.scope)) || !Array.isArray(raw.countries) || !raw.countries.length || raw.countries.some(c => typeof c !== 'string' || !TEMPLATE_COUNTRIES.includes(c as typeof TEMPLATE_COUNTRIES[number])) || new Set(raw.countries).size !== raw.countries.length) return '请为每条规则选择有效且不重复的国家。'
    if (!TEMPLATE_SERVICES.includes(raw.service as typeof TEMPLATE_SERVICES[number]) || raw.scope === 'international' && !['标准配送', '加急配送'].includes(String(raw.service))) return '国际配送支持标准或加急服务。'
    if (raw.scope === 'domestic' && (raw.countries.length !== 1 || raw.countries[0] !== '美国')) return '本地美国站样例的国内规则仅适用于美国。'
    if (!text(raw.transit)) return '请填写运输时间；运输时间不包括处理时间。'
    if (!number(raw.base) || !number(raw.perUnit) || !['item', 'lb'].includes(String(raw.unit))) return '每单金额和单位价须为非负数。'
    for (const country of raw.countries) {
      const key = `${String(raw.scope)}:${String(raw.service)}:${String(country)}`
      if (combinations.has(key)) return '同一配送范围、国家与服务不能重复配置（本地体验检查）。'
      combinations.add(key)
    }
    if (!Array.isArray(raw.bands) || !raw.bands.length) return '请保留价格分段。'
    let next = 0
    for (let i = 0; i < raw.bands.length; i++) {
      const band: unknown = raw.bands[i]
      if (!record(band) || !number(band.from) || !number(band.fee) || Math.abs(band.from - next) > 0.000001) return '价格分段须从 0 开始，后一段紧接前一段加 0.01。'
      if (i === raw.bands.length - 1) { if (band.to !== null) return '最后一段价格范围须为无上限。' }
      else if (!number(band.to) || band.to < band.from || Math.abs(Math.round(band.to * 100) - band.to * 100) > 0.000001) return '价格上限须不低于起点且最多两位小数。'
      if (number(band.to)) next = Math.round((band.to + 0.01) * 100) / 100
    }
  }
  return ''
}
export function getTemplateDetail(template: ShippingTemplate, data: TemplateData): TemplateDetail {
  return clone(data.details.find(d => d.templateId === template.id) ?? { templateId: template.id, mode: 'weight', rules: [{ id: `${template.id}-rule`, scope: template.country === '美国' ? 'domestic' : 'international', countries: [template.country], service: template.service === '经济配送' ? '标准配送' : template.service, transit: '5–10 天', base: template.base, perUnit: Number((template.perKg / 2.2046226218).toFixed(2)), unit: 'lb', bands: [{ from: 0, to: null, fee: template.base }] }] })
}
export function validTemplateData(value: unknown, state: State): value is TemplateData {
  if (!record(value) || value.version !== 1 || typeof value.defaultTemplateId !== 'string' || !Array.isArray(value.details)) return false
  if (value.defaultTemplateId && !state.templates.some(t => t.id === value.defaultTemplateId)) return false
  const ids = new Set<string>()
  return value.details.every(d => {
    if (!record(d) || detailIssue(d) || typeof d.templateId !== 'string' || ids.has(d.templateId) || !state.templates.some(t => t.id === d.templateId)) return false
    ids.add(d.templateId); return true
  })
}
export function templateFingerprint(state: State, data: TemplateData): string {
  return JSON.stringify({ templates: state.templates, data, bindings: state.products.map(p => ({ id: p.id, templateId: p.offer.templateId, variants: p.variants.map(v => ({ id: v.id, sku: v.sku, deleted: v.deleted })) })) })
}
export function applyTemplateCommand(state: State, data: TemplateData, cmd: TemplateCommand): WorkflowReply {
  if (!validTemplateData(data, state)) return { ok: false, message: '模板样例数据无效，请重置体验后再试。' }
  if (!record(cmd)) return { ok: false, message: '模板操作无效。' }
  if (cmd.type === 'save') {
    const issue = templateIssue(cmd.template) || detailIssue(cmd.detail)
    if (issue) return { ok: false, message: issue }
    if (cmd.template.id !== cmd.detail.templateId) return { ok: false, message: '模板与配送规则不一致。' }
    if (state.templates.some(t => t.id !== cmd.template.id && nameKey(t.name) === nameKey(cmd.template.name))) return { ok: false, message: '模板名称已存在，请更换名称。' }
    const saved = clone(cmd.template), detail = clone(cmd.detail)
    saved.name = saved.name.trim()
    const first = detail.rules[0]!
    saved.country = first.countries.join('、'); saved.service = first.service; saved.base = first.base
    saved.perKg = first.unit === 'lb' ? Number((first.perUnit * 2.2046226218).toFixed(6)) : 0
    const templates = state.templates.filter(t => t.id !== saved.id).concat(saved)
    const details = data.details.filter(d => d.templateId !== saved.id).concat(detail)
    state.templates = templates; data.details = details
    if (!data.defaultTemplateId) data.defaultTemplateId = saved.id
    return { ok: true, id: saved.id, message: `配送模板“${saved.name}”已保存，可重新打开详情核对。` }
  }
  if (!text(cmd.id)) return { ok: false, message: '请选择有效模板。' }
  const template = state.templates.find(t => t.id === cmd.id)
  if (!template) return { ok: false, message: '模板已不存在，请重新选择。' }
  if (cmd.type === 'default') {
    data.defaultTemplateId = template.id
    return { ok: true, id: template.id, message: `默认模板已设为“${template.name}”；已有商品绑定不变。` }
  }
  if (cmd.type === 'assign') {
    const product = state.products.find(p => p.id === cmd.productId)
    if (!product || !product.variants.some(v => !v.deleted)) return { ok: false, message: '请选择仍有 SKU 的商品。' }
    product.offer.templateId = template.id
    return { ok: true, id: template.id, message: `商品已绑定“${template.name}”；全部子 SKU 继承商品设置。` }
  }
  if (cmd.type === 'delete') {
    if (data.defaultTemplateId === template.id) return { ok: false, message: '默认模板不能删除，请先切换默认模板（本地保护）。' }
    if (state.products.some(p => p.offer.templateId === template.id)) return { ok: false, message: '模板正在被商品使用，请先更换商品绑定（本地保护）。' }
    state.templates = state.templates.filter(t => t.id !== template.id)
    data.details = data.details.filter(d => d.templateId !== template.id)
    return { ok: true, id: template.id, message: `模板“${template.name}”已删除，列表已移除。` }
  }
  return { ok: false, message: '不支持此模板操作。' }
}
