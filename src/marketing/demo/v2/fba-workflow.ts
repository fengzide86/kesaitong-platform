import type { Product, State, Variant } from './model'
import type { WorkflowReply } from './workflow-contract'

// These are local rehearsal records, not an implementation of platform APIs.
// Conversion is evidenced; a successful inbound shipment is not.
export type FbaAnswer = 'yes' | 'no' | 'unknown' | ''
export interface FbaDeclaration { variantId: string; battery: FbaAnswer; hazardous: FbaAnswer }
export interface FbaConversion { productId: string; variantId: string; fnsku: string; convertedAt: string; battery: 'no'; hazardous: 'no' }
export interface FbaPreparation {
  id: string; variantId: string; name: string; quantity: number; prepBy: 'seller' | 'amazon'
  labelBy: 'seller' | 'amazon'; labelCount: number; weightLb: number; lengthIn: number; widthIn: number; heightIn: number
  status: 'local-draft'; updatedAt: string
}
export interface FbaData { version: 1; conversions: FbaConversion[]; preparations: FbaPreparation[] }
export type FbaCommand =
  | { type: 'convert'; variantIds: string[]; declarations: FbaDeclaration[] }
  | { type: 'save-preparation'; preparation: Omit<FbaPreparation, 'id' | 'status' | 'updatedAt'> }
export interface FbaRow { product: Product; variant: Variant; fnsku: string; available: number }

export function createFbaData(): FbaData { return { version: 1, conversions: [], preparations: [] } }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 240
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
const count = (value: unknown): value is number => positive(value) && Number.isSafeInteger(value) && value <= 100000
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
const locate = (state: State, id: string) => {
  const rows = state.products.flatMap(product => product.variants.filter(variant => variant.id === id).map(variant => ({ product, variant })))
  return rows.length === 1 ? rows[0] : undefined
}
const eligible = (product: Product, variant: Variant) => product.status === 'active' && variant.status === 'active' && !variant.deleted && !!variant.sku.trim()
const fnsku = (id: string) => `DEMO-FNSKU-${id}`

function preparationIssue(value: unknown, state: State, requireEligible = true): string {
  if (!record(value) || !text(value.variantId)) return '请选择一个子 SKU。'
  const row = locate(state, value.variantId)
  if (!row || requireEligible && (!eligible(row.product, row.variant) || row.variant.delivery !== 'FBA')) return '仅已转换且在售的 FBA 子 SKU 可以保存准备草稿。'
  if (!text(value.name)) return '请填写货件准备名称（最多 240 字）。'
  if (!count(value.quantity)) return '计划数量必须为 1 至 100000 的整数；这不是已入库数量。'
  if (value.prepBy !== 'seller' && value.prepBy !== 'amazon' || value.labelBy !== 'seller' && value.labelBy !== 'amazon') return '请选择预处理方与贴标方。'
  if (!count(value.labelCount) || value.labelCount !== value.quantity) return '此单 SKU 样例的标签数应与计划数量一致。'
  if (![value.weightLb, value.lengthIn, value.widthIn, value.heightIn].every(positive)) return '请填写大于 0 的箱重（lb）与长、宽、高（in）。'
  return ''
}

export function validFbaData(value: unknown, state: State): value is FbaData {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.conversions) || !Array.isArray(value.preparations)) return false
  if (value.conversions.length > 2000 || value.preparations.length > 2000) return false
  const converted = new Set<string>(); const prepared = new Set<string>(); const codes = new Set<string>()
  for (const item of value.conversions) {
    if (!record(item) || !text(item.productId) || !text(item.variantId) || !text(item.fnsku) || !date(item.convertedAt) || item.battery !== 'no' || item.hazardous !== 'no') return false
    const row = locate(state, item.variantId)
    if (!row || row.product.id !== item.productId || converted.has(item.variantId) || codes.has(item.fnsku) || item.fnsku !== fnsku(item.variantId)) return false
    converted.add(item.variantId); codes.add(item.fnsku)
  }
  for (const item of value.preparations) {
    if (!record(item) || preparationIssue(item, state, false) || !text(item.variantId) || item.id !== `DEMO-FBA-PREP-${item.variantId}` || item.status !== 'local-draft' || !date(item.updatedAt) || prepared.has(item.variantId)) return false
    prepared.add(item.variantId)
  }
  return true
}

export function fbaRows(state: State, data: FbaData): FbaRow[] {
  return state.products.flatMap(product => product.variants.filter(variant => !variant.deleted && variant.delivery === 'FBA').map(variant => ({
    product, variant, fnsku: data.conversions.find(item => item.variantId === variant.id)?.fnsku ?? fnsku(variant.id),
    // General listing quantity is not a received FBA balance. No receipt has
    // occurred in this demo, including for the pre-existing seed FBA rows.
    available: 0,
  })))
}

export function fbaFingerprint(state: State, data: FbaData): string {
  return JSON.stringify({ products: state.products.map(product => ({ id: product.id, status: product.status, title: product.title,
    asin: product.asin, compliance: product.compliance, variants: product.variants })), data })
}

export function applyFbaCommand(state: State, data: FbaData, command: FbaCommand): WorkflowReply {
  const fail = (message: string): WorkflowReply => ({ ok: false, message })
  if (!validFbaData(data, state)) return fail('FBA 本地记录不完整，请重置样例后再操作。')
  if (!record(command)) return fail('未识别的 FBA 操作。')
  if (command.type === 'convert') {
    if (!Array.isArray(command.variantIds) || !command.variantIds.length || command.variantIds.length > 2000 || !command.variantIds.every(text) || new Set(command.variantIds).size !== command.variantIds.length) return fail('请勾选至少一个不同的子 SKU，不要选择父商品。')
    if (!Array.isArray(command.declarations) || command.declarations.length !== command.variantIds.length || command.declarations.some(item => !record(item) || !text(item.variantId)) || new Set(command.declarations.map(item => item.variantId)).size !== command.declarations.length) return fail('请分别完成所选 SKU 的危险品信息。')
    const resolved = command.variantIds.map(id => locate(state, id))
    for (let index = 0; index < command.variantIds.length; index++) {
      const id = command.variantIds[index]!
      const row = resolved[index]
      if (!row || !eligible(row.product, row.variant)) return fail('所选子 SKU 不存在、未在售或已删除，请回到库存重新选择。')
      if (row.variant.delivery !== 'FBM') return fail('所选 SKU 已是亚马逊配送，不会重复转换。')
      const declaration = command.declarations.find(item => item.variantId === id)
      if (!declaration || declaration.battery !== 'no' || declaration.hazardous !== 'no') return fail('本地仅验收无电池、无危险品的转换路径；“是 / 不确定”需真实平台另行核验。')
      if (row.product.compliance.batteriesIncluded || row.product.compliance.batteryRequired || row.product.compliance.hazardousRegulations.some(item => item !== 'Not Applicable')) return fail('商品合规信息与“无电池 / 无危险品”不一致，请先核对商品。')
    }
    // Validate the whole selection before mutating either shared store.
    const convertedAt = new Date().toISOString()
    for (const row of resolved) {
      if (!row) continue
      row.variant.delivery = 'FBA'
      const saved: FbaConversion = { productId: row.product.id, variantId: row.variant.id, fnsku: fnsku(row.variant.id), convertedAt, battery: 'no', hazardous: 'no' }
      const existing = data.conversions.findIndex(item => item.variantId === row.variant.id)
      if (existing < 0) data.conversions.push(saved)
      else data.conversions.splice(existing, 1, saved)
    }
    return { ok: true, message: `已转换 ${resolved.length} 个子 SKU；亚马逊库存已回读 FNSKU，可售为 0。尚未入库或发货。`, id: command.variantIds[0] }
  }
  if (command.type === 'save-preparation') {
    const issue = preparationIssue(command.preparation, state)
    if (issue) return fail(issue)
    const raw = command.preparation
    const saved: FbaPreparation = { id: `DEMO-FBA-PREP-${raw.variantId}`, variantId: raw.variantId, name: raw.name.trim(),
      quantity: raw.quantity, prepBy: raw.prepBy, labelBy: raw.labelBy, labelCount: raw.labelCount,
      weightLb: raw.weightLb, lengthIn: raw.lengthIn, widthIn: raw.widthIn, heightIn: raw.heightIn,
      status: 'local-draft', updatedAt: new Date().toISOString() }
    const existing = data.preparations.findIndex(item => item.variantId === raw.variantId)
    if (existing < 0) data.preparations.push(saved)
    else data.preparations.splice(existing, 1, saved)
    return { ok: true, message: '已保存本地货件准备草稿。未创建平台货件、未扣库存、未发出、未入库。', id: saved.id }
  }
  return fail('未识别的 FBA 操作。')
}
