import type { State } from './model'
import type { WorkflowReply } from './workflow-contract'

// Offline fixtures only. These checks are deliberately not claims about the
// real platform's eligibility, time zone, auction, or delivery rules.
export interface AdvertisingProductRef {
  productId: string; variantId: string; sku: string; asin: string
}
export interface AdvertisingCandidate extends AdvertisingProductRef {
  title: string; term: string; delivery: 'FBM' | 'FBA'; quantity: number; price: number
}
export interface AdvertisingDraft {
  name: string; groupName: string; budgetUsd: number; defaultBidUsd: number
  startAt: string; endAt: string; timeZone: 'Asia/Shanghai'
  targeting: 'automatic' | 'manual'; strategy: 'down' | 'up-and-down' | 'fixed'
  topOfSearchPercent: number; productPagesPercent: number
  keywords: string[]; negativeKeywords: string[]; products: AdvertisingProductRef[]
}
export interface AdvertisingCampaign extends AdvertisingDraft {
  id: string; groupId: string; status: 'draft' | 'scheduled' | 'paused'; createdAt: string
}
export interface AdvertisingData { version: 1; campaigns: AdvertisingCampaign[] }
export type AdvertisingCommand =
  | { type: 'save'; campaignId?: string; draft: AdvertisingDraft; publish: boolean }
  | { type: 'status'; campaignId: string; status: 'scheduled' | 'paused' }

export function createAdvertisingData(): AdvertisingData { return { version: 1, campaigns: [] } }

function sampleAsin(productId: string, variantId: string): string {
  // A local stable display identifier, not the parent's ASIN or a real ASIN.
  let hash = 2166136261
  for (const char of `${productId}\u0000${variantId}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return `DEMO${(hash >>> 0).toString(36).toUpperCase().padStart(7, '0')}`
}

export function advertisingCandidates(state: State): AdvertisingCandidate[] {
  return state.products.filter(product => product.status === 'active').flatMap(product =>
    product.variants.filter(variant => !variant.deleted && variant.status === 'active' && variant.sku.trim()).map(variant => ({
      productId: product.id, variantId: variant.id, sku: variant.sku,
      asin: sampleAsin(product.id, variant.id), title: product.title, term: variant.term,
      delivery: variant.delivery, quantity: variant.quantity, price: variant.price,
    })))
}

export function createAdvertisingDraft(now = new Date()): AdvertisingDraft {
  const tomorrow = new Date(now.getTime() + 86_400_000 + 8 * 3_600_000).toISOString().slice(0, 10)
  const nextDay = new Date(now.getTime() + 2 * 86_400_000 + 8 * 3_600_000).toISOString().slice(0, 10)
  return { name: '', groupName: '', budgetUsd: 10, defaultBidUsd: 0.53,
    startAt: `${tomorrow}T10:00`, endAt: `${nextDay}T20:00`, timeZone: 'Asia/Shanghai',
    targeting: 'automatic', strategy: 'down', topOfSearchPercent: 0, productPagesPercent: 0,
    keywords: [], negativeKeywords: [], products: [] }
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, max = 160): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1_000_000
const percent = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 900
const key = (value: string) => value.trim().toLocaleLowerCase('en-US')
const pair = (value: AdvertisingProductRef) => JSON.stringify([value.productId, value.variantId])
const list = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 100 && value.every(item => text(item, 200)) && new Set(value.map(item => key(item))).size === value.length

export function advertisingDateTime(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return Number.NaN
  const result = Date.parse(`${value}:00+08:00`)
  if (!Number.isFinite(result)) return Number.NaN
  return new Date(result + 8 * 3_600_000).toISOString().slice(0, 16) === value ? result : Number.NaN
}

function validRef(value: unknown): value is AdvertisingProductRef {
  return record(value) && text(value.productId, 240) && text(value.variantId, 240) && text(value.sku, 240)
    && value.asin === sampleAsin(value.productId, value.variantId)
}

function draftError(value: unknown): string {
  if (!record(value)) return '广告表单格式不正确。'
  if (!text(value.name) || !text(value.groupName)) return '请填写广告活动名称和广告组名称（最多 160 个字符）。'
  if (!amount(value.budgetUsd)) return '每日预算必须是大于 0 的有效金额。'
  if (!amount(value.defaultBidUsd)) return '默认竞价必须是大于 0 的有效金额。'
  if (value.timeZone !== 'Asia/Shanghai') return '本地样例使用明确的 Asia/Shanghai 时区。'
  const start = advertisingDateTime(value.startAt), end = advertisingDateTime(value.endAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return '请填写有效的开始和结束日期，结束时间须晚于开始时间。'
  if (value.targeting !== 'automatic' && value.targeting !== 'manual') return '请选择自动投放或手动投放。'
  if (!['down', 'up-and-down', 'fixed'].includes(String(value.strategy))) return '请选择有效的广告活动竞价策略。'
  if (!percent(value.topOfSearchPercent) || !percent(value.productPagesPercent)) return '广告位调整须为 0–900 的整数百分比（本地样例规则）。'
  if (!list(value.keywords) || !list(value.negativeKeywords)) return '关键词须逐行填写且不能重复，最多 100 条。'
  if (value.targeting === 'manual' && !value.keywords.length) return '本地手动投放样例需要至少一个关键词。'
  if (!Array.isArray(value.products) || !value.products.length || value.products.length > 100 || !value.products.every(validRef)) return '请添加有效的子商品，不能使用父 ASIN 代替子商品标识。'
  if (new Set(value.products.map(pair)).size !== value.products.length) return '同一个子商品不能重复加入广告组。'
  return ''
}

export function validAdvertisingData(value: unknown, state: State): value is AdvertisingData {
  // Saved references are historical snapshots. Later product edits/deletion
  // must not erase campaign history; each new save rechecks current candidates.
  void state
  if (!record(value) || value.version !== 1 || !Array.isArray(value.campaigns) || value.campaigns.length > 100) return false
  const ids = new Set<string>(), groupIds = new Set<string>(), names = new Set<string>()
  for (const campaign of value.campaigns) {
    if (!record(campaign) || draftError(campaign) || !text(campaign.id, 240) || !text(campaign.groupId, 240)
      || !['draft', 'scheduled', 'paused'].includes(String(campaign.status)) || typeof campaign.createdAt !== 'string'
      || !Number.isFinite(Date.parse(campaign.createdAt))) return false
    const name = key(campaign.name as string)
    if (ids.has(campaign.id) || groupIds.has(campaign.groupId) || names.has(name)) return false
    ids.add(campaign.id); groupIds.add(campaign.groupId); names.add(name)
  }
  return true
}

export function advertisingFingerprint(state: State, data: AdvertisingData): string {
  return JSON.stringify({ candidates: advertisingCandidates(state), campaigns: data.campaigns })
}

function currentProductsError(state: State, refs: AdvertisingProductRef[]): string {
  const candidates = advertisingCandidates(state)
  for (const ref of refs) {
    const current = candidates.find(candidate => candidate.productId === ref.productId && candidate.variantId === ref.variantId)
    if (!current || current.sku !== ref.sku || current.asin !== ref.asin) return '已选子商品已被修改、停用或移除，请重新读取并选择。'
  }
  return ''
}

export function applyAdvertisingCommand(state: State, data: AdvertisingData, command: AdvertisingCommand): WorkflowReply {
  const fail = (message: string): WorkflowReply => ({ ok: false, message })
  if (!validAdvertisingData(data, state)) return fail('广告样例数据已损坏，不能继续写入。')
  if (!record(command)) return fail('未知广告操作。')
  if (command.type === 'status') {
    const campaign = data.campaigns.find(item => item.id === command.campaignId)
    if (!campaign) return fail('广告活动不存在，请返回列表重新读取。')
    if (!['scheduled', 'paused'].includes(command.status)) return fail('未知活动状态。')
    if (campaign.status === 'draft') return fail('草稿请先进入编辑并启动广告活动。')
    if (campaign.status === command.status) return fail('该广告已处于目标状态，不重复操作。')
    if (command.status === 'scheduled') {
      const issue = currentProductsError(state, campaign.products)
      if (issue) return fail(issue)
      if (advertisingDateTime(campaign.endAt) <= Date.now()) return fail('活动结束时间已过，请先编辑排期再恢复。')
    }
    const next = data.campaigns.map(item => item.id === campaign.id ? { ...item, status: command.status } : item)
    data.campaigns = next
    return { ok: true, id: campaign.id, message: command.status === 'paused' ? '样例活动已暂停，列表可回读。' : '样例活动已恢复，列表可回读。' }
  }
  if (command.type !== 'save' || typeof command.publish !== 'boolean') return fail('未知广告操作。')
  const issue = draftError(command.draft)
  if (issue) return fail(issue)
  const draft = command.draft
  const currentIssue = currentProductsError(state, draft.products)
  if (currentIssue) return fail(currentIssue)
  const previous = command.campaignId ? data.campaigns.find(item => item.id === command.campaignId) : undefined
  if (command.campaignId && !previous) return fail('待编辑活动不存在，请返回列表重新读取。')
  if (!previous && data.campaigns.length >= 100) return fail('本地样例最多保留 100 条活动，请重置体验后再试。')
  if (data.campaigns.some(item => item.id !== previous?.id && key(item.name) === key(draft.name))) return fail('广告活动名称已存在，请更换名称，避免重复创建。')
  if (command.publish && (!previous || previous.status === 'draft' || previous.startAt !== draft.startAt)
    && advertisingDateTime(draft.startAt) <= Date.now()) return fail('启动本地样例时，开始时间必须晚于当前时间。')
  if (command.publish && advertisingDateTime(draft.endAt) <= Date.now()) return fail('活动结束时间已过，请调整排期。')
  if (previous && previous.status !== 'draft' && !command.publish) return fail('已启动的活动不能倒退为草稿；可保存修改或暂停。')
  const id = previous?.id ?? `sample-ad-${crypto.randomUUID()}`
  const campaign: AdvertisingCampaign = {
    ...JSON.parse(JSON.stringify(draft)) as AdvertisingDraft,
    name: draft.name.trim(), groupName: draft.groupName.trim(), id,
    groupId: previous?.groupId ?? `sample-group-${crypto.randomUUID()}`,
    createdAt: previous?.createdAt ?? new Date().toISOString(),
    status: command.publish ? previous?.status === 'paused' ? 'paused' : 'scheduled' : 'draft',
  }
  const next = previous ? data.campaigns.map(item => item.id === id ? campaign : item) : [...data.campaigns, campaign]
  if (!validAdvertisingData({ version: 1, campaigns: next }, state)) return fail('活动校验失败，未保存任何修改。')
  data.campaigns = next
  return { ok: true, id, message: command.publish ? '广告活动已保存，请在广告组详情核对商品与竞价。' : '完整样例表单已保存为草稿，尚未启动。' }
}
