import type { Product } from './model'
import { quoteFreight } from '../../../shared/freight/rate-engine'
import type { FreightQuoteCandidate, FreightRatePack, FreightRateRule } from '../../../shared/freight/types'

export type SampleCarrier = '中邮' | 'E 邮宝' | '燕文' | 'UPS'
export type SampleShippingCountry = '美国' | '英国'
export const SAMPLE_SHIPPING_RATE_VERSION = 'sample-v1' as const
export interface SampleShippingDimensions { lengthCm: number; widthCm: number; heightCm: number }

export interface SampleCarrierRate {
  readonly carrier: SampleCarrier
  readonly country: SampleShippingCountry
  readonly currency: 'CNY'
  readonly fixedCny: number
  readonly perKgCny: number
  readonly maxWeightKg: number
  readonly wholeKg: boolean
  readonly fictional: true
}

export interface SampleShippingQuote {
  carrier: SampleCarrier
  country: SampleShippingCountry
  currency: 'CNY'
  weightKg: number
  billableWeightKg: number
  dimensionalWeightKg: number
  fixedCny: number
  perKgCny: number
  weightChargeCny: number
  surchargeCny: number
  totalCny: number
  rateVersion: string
  billingMode: FreightRateRule['serviceType']
  pricingDescription: string
  warnings: string[]
  fictional: true
}

export interface SampleShippingCandidate {
  carrier: SampleCarrier
  quote?: SampleShippingQuote
  unavailableReason: string
}
export interface SampleShippingEvaluation {
  quotes: SampleShippingQuote[]
  candidates: SampleShippingCandidate[]
  dimensionalWeightKg: number
  warnings: string[]
}

/**
 * Deliberately invented demonstration prices, not an imported tariff or a buyer
 * shipping template. They only explain the legacy script's comparison shape.
 * No real carrier price, destination coverage or delivery promise is implied.
 */
export const SAMPLE_CARRIER_RATES: readonly SampleCarrierRate[] = Object.freeze([
  { carrier: '中邮', country: '美国', currency: 'CNY', fixedCny: 12, perKgCny: 60, maxWeightKg: 2, wholeKg: false, fictional: true },
  { carrier: 'E 邮宝', country: '美国', currency: 'CNY', fixedCny: 8, perKgCny: 40, maxWeightKg: 2, wholeKg: false, fictional: true },
  { carrier: '燕文', country: '美国', currency: 'CNY', fixedCny: 10, perKgCny: 48, maxWeightKg: 2, wholeKg: false, fictional: true },
  { carrier: 'UPS', country: '美国', currency: 'CNY', fixedCny: 30, perKgCny: 55, maxWeightKg: 20, wholeKg: true, fictional: true },
  { carrier: '中邮', country: '英国', currency: 'CNY', fixedCny: 12, perKgCny: 56, maxWeightKg: 2, wholeKg: false, fictional: true },
  { carrier: 'E 邮宝', country: '英国', currency: 'CNY', fixedCny: 8, perKgCny: 42, maxWeightKg: 2, wholeKg: false, fictional: true },
  { carrier: '燕文', country: '英国', currency: 'CNY', fixedCny: 9, perKgCny: 46, maxWeightKg: 2, wholeKg: false, fictional: true },
  { carrier: 'UPS', country: '英国', currency: 'CNY', fixedCny: 30, perKgCny: 58, maxWeightKg: 20, wholeKg: true, fictional: true },
].map(rate => Object.freeze(rate)) as SampleCarrierRate[])

const UNIT_TO_KG: Readonly<Record<string, number>> = Object.freeze({ kg: 1, g: 0.001, lb: 0.45359237, oz: 0.028349523125 })

function freezeSample<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeSample)
    Object.freeze(value)
  }
  return value
}

/** All data below is invented. Only the existing shared calculation mechanics are reused. */
export const SAMPLE_RATE_PACK: FreightRatePack = freezeSample({
  schemaVersion: 1, resourceType: 'freight-rate-pack', id: 'fictional-demo-carrier-pack', version: SAMPLE_SHIPPING_RATE_VERSION,
  name: '模拟体验专用虚构费率包', currency: 'CNY', exchangeRateCnyPerUsd: 7.2,
  sourceHash: 'fictional-sample-v1-not-a-real-tariff', createdAt: '2026-10-08T00:00:00.000Z',
  mappingWarnings: ['完全虚构样例费率，不代表真实报价、可达性或配送时效。', 'UPS 样例价格不含燃油附加费。'],
  rules: (['美国', '英国'] as const).flatMap((country, countryIndex): FreightRateRule[] => {
    const countryCode = countryIndex === 0 ? 'US' : 'GB'
    const countryNameEn = countryIndex === 0 ? 'United States' : 'United Kingdom'
    const shared = { countryCode, countryName: country, countryNameEn, percentageSurcharge: 0, minimumSurchargeCny: 0, suspended: false }
    return [
      { ...shared, carrierId: `fictional-${countryCode}-post`, carrierName: '中邮', serviceType: 'tiered', priority: 3, maxWeightKg: 2,
        tiers: [{ maxWeightG: 150, perKgCny: countryIndex === 0 ? 70 : 66, fixedFeeCny: 12 },
          { maxWeightG: 300, perKgCny: countryIndex === 0 ? 60 : 56, fixedFeeCny: 12 },
          { maxWeightG: 2000, perKgCny: countryIndex === 0 ? 55 : 52, fixedFeeCny: 12 }] },
      { ...shared, carrierId: `fictional-${countryCode}-epacket`, carrierName: 'E 邮宝', serviceType: 'epacket', priority: 1,
        maxWeightKg: 2, minBillableWeightG: 10, perKgCny: countryIndex === 0 ? 40 : 42, fixedFeeCny: 8 },
      { ...shared, carrierId: `fictional-${countryCode}-yanwen`, carrierName: '燕文', serviceType: 'tiered', priority: 2, maxWeightKg: 2,
        tiers: [{ maxWeightG: 150, perKgCny: countryIndex === 0 ? 58 : 56, fixedFeeCny: 10 },
          { maxWeightG: 300, perKgCny: countryIndex === 0 ? 48 : 46, fixedFeeCny: 10 },
          { maxWeightG: 2000, perKgCny: countryIndex === 0 ? 44 : 42, fixedFeeCny: 10 }] },
      { ...shared, carrierId: `fictional-${countryCode}-ups`, carrierName: 'UPS', serviceType: 'ups', priority: 4,
        maxWeightKg: 20, volumetricDivisor: 5000, fixedPricesCny: Array.from({ length: 20 }, (_, index) => (countryIndex === 0 ? 85 : 88) + index * (countryIndex === 0 ? 55 : 58)),
        perKgBands: [], fuelSurchargeIncluded: false },
    ]
  }),
})

const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

/** Enforce the fictional pack's complete four-carrier schema in addition to the shared engine's billing validation. */
function sampleRuleIssue(rule: FreightRateRule): string {
  if (!rule || typeof rule !== 'object') return '样例费率规则格式无效。'
  if (![rule.carrierId, rule.carrierName, rule.countryCode, rule.countryName].every(nonempty)
    || !['中邮', 'E 邮宝', '燕文', 'UPS'].includes(rule.carrierName)
    || !['tiered', 'epacket', 'ups'].includes(rule.serviceType) || !nonnegative(rule.priority)) return '样例费率渠道或国家信息不完整。'
  if (!positive(rule.maxWeightKg) || !nonnegative(rule.percentageSurcharge) || !nonnegative(rule.minimumSurchargeCny)) return '样例费率限重或附加费字段缺失/无效。'
  if (rule.serviceType === 'tiered') {
    if (!Array.isArray(rule.tiers) || !rule.tiers.length
      || Array.from(rule.tiers).some(tier => !tier || !positive(tier.maxWeightG) || !positive(tier.perKgCny) || !nonnegative(tier.fixedFeeCny))) return '阶梯样例费率缺少合法重量区间、单价或固定费。'
  } else if (rule.serviceType === 'epacket') {
    if (!positive(rule.minBillableWeightG) || !positive(rule.perKgCny) || !nonnegative(rule.fixedFeeCny)) return 'E 邮宝样例费率缺少合法最低计费重量、单价或固定费。'
  } else if (!positive(rule.volumetricDivisor) || rule.volumetricDivisor !== 5000
    || !Array.isArray(rule.fixedPricesCny) || rule.fixedPricesCny.length !== 20 || !Array.from(rule.fixedPricesCny).every(positive)
    || !Array.isArray(rule.perKgBands) || Array.from(rule.perKgBands).some(band => !band || !positive(band.maxWeightKg) || !positive(band.perKgCny))
    || typeof rule.fuelSurchargeIncluded !== 'boolean') return 'UPS 样例费率缺少合法体积除数或完整的 1–20 kg 固定价格。'
  return ''
}

function validateSamplePack(pack: FreightRatePack): void {
  if (!pack || typeof pack !== 'object' || pack.schemaVersion !== 1 || pack.resourceType !== 'freight-rate-pack' || pack.currency !== 'CNY'
    || ![pack.id, pack.version, pack.name, pack.sourceHash, pack.createdAt].every(nonempty)
    || !positive(pack.exchangeRateCnyPerUsd) || !Array.isArray(pack.rules) || !pack.rules.length
    || !Array.isArray(pack.mappingWarnings) || pack.mappingWarnings.some(item => typeof item !== 'string')) throw new Error('虚构样例费率包缺少合法的必填字段。')
  // Validate identity before grouping. A malformed display name must not make a
  // duplicate rule disappear and leave another price falsely usable. This is
  // deliberately the fixed sample schema, not a real tariff alias importer.
  for (const rule of pack.rules) {
    const countryName = rule?.countryCode === 'US' ? '美国' : rule?.countryCode === 'GB' ? '英国' : undefined
    const canonical = SAMPLE_RATE_PACK.rules.find(sample => sample.carrierId === rule?.carrierId)
    if (!rule || !nonempty(rule.carrierId) || !countryName || rule.countryName !== countryName
      || !['中邮', 'E 邮宝', '燕文', 'UPS'].includes(rule.carrierName)
      || (canonical && (canonical.countryCode !== rule.countryCode || canonical.carrierName !== rule.carrierName))) {
      throw new Error('虚构样例费率包的国家或渠道身份不一致，请核对字段；未生成报价。')
    }
  }
}

/** Read Shipping Weight itself; never substitute the separate Item Weight. */
export function readSampleShippingWeight(product: Product): number {
  const details = product?.moreDetails
  const rawWeight = details?.shippingWeight
  const rawUnit = details?.shippingWeightUnit
  if (typeof rawWeight !== 'string' || typeof rawUnit !== 'string') return 0
  const text = rawWeight.trim()
  // Reject partial parses, mixed unit strings, hexadecimal and unsafe coercion.
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return 0
  const unit = rawUnit.trim().toLowerCase()
  if (!Object.hasOwn(UNIT_TO_KG, unit)) return 0
  const weightKg = Number(text) * UNIT_TO_KG[unit]!
  return Number.isFinite(weightKg) && weightKg > 0 ? weightKg : 0
}

function sampleCountry(country: string): SampleShippingCountry | undefined {
  if (typeof country !== 'string') return undefined
  const normalized = country.trim().toLowerCase()
  if (['美国', 'us', 'usa', 'united states', 'united states of america'].includes(normalized)) return '美国'
  if (['英国', 'uk', 'gb', 'united kingdom'].includes(normalized)) return '英国'
  return undefined
}

function sampleDimensions(dimensions?: SampleShippingDimensions): { length: number; width: number; height: number } | undefined {
  if (dimensions === undefined) return undefined
  if (!dimensions || typeof dimensions !== 'object') throw new RangeError('长、宽、高必须是合法的厘米数值。')
  const sides = [dimensions.lengthCm, dimensions.widthCm, dimensions.heightCm]
  if (sides.some(side => typeof side !== 'number' || !Number.isFinite(side) || side < 0)) throw new RangeError('长、宽、高必须是非负且有限的厘米数值。')
  if (sides.every(side => side === 0)) return undefined
  if (sides.some(side => side === 0)) throw new RangeError('请填写完整的长、宽、高；三项都为 0 时，UPS 不可用，小包仅按实重计算。')
  const volumeWeight = dimensions.lengthCm * dimensions.widthCm * dimensions.heightCm / 5000
  if (!Number.isFinite(volumeWeight) || volumeWeight <= 0) throw new RangeError('包裹尺寸超出样例可计算范围。')
  return { length: dimensions.lengthCm, width: dimensions.widthCm, height: dimensions.heightCm }
}

function adaptQuote(candidate: FreightQuoteCandidate, rule: FreightRateRule, country: SampleShippingCountry, version: string): SampleShippingQuote | undefined {
  if (!candidate.eligible || !positive(candidate.actualWeightKg) || !positive(candidate.billableWeightKg)
    || !nonnegative(candidate.baseFreightCny) || !nonnegative(candidate.fixedFeeCny) || !nonnegative(candidate.surchargeCny)
    || !positive(candidate.totalCny) || (candidate.volumetricWeightKg !== undefined && !nonnegative(candidate.volumetricWeightKg))) return undefined
  const tier = rule.tiers?.slice().sort((left, right) => left.maxWeightG - right.maxWeightG)
    .find(item => candidate.actualWeightKg * 1000 <= item.maxWeightG + 1e-9)
  const perKgCny = rule.serviceType === 'ups' ? 0 : rule.serviceType === 'epacket' ? rule.perKgCny! : tier?.perKgCny
  if (perKgCny === undefined) return undefined
  return {
    carrier: rule.carrierName as SampleCarrier, country, currency: 'CNY', weightKg: candidate.actualWeightKg,
    billableWeightKg: candidate.billableWeightKg, dimensionalWeightKg: candidate.volumetricWeightKg ?? 0,
    fixedCny: candidate.fixedFeeCny, perKgCny, weightChargeCny: candidate.baseFreightCny, surchargeCny: candidate.surchargeCny,
    totalCny: candidate.totalCny, rateVersion: version, billingMode: rule.serviceType,
    pricingDescription: rule.serviceType === 'ups' ? `${candidate.billableWeightKg} kg 固定运费` : `${candidate.billableWeightKg} kg × ¥${perKgCny.toFixed(2)}/kg`,
    warnings: [...candidate.warnings], fictional: true,
  }
}

/** Includes unavailable candidates so the UI can explain, not hide, route exclusions. */
export function evaluateSampleShipping(country: string, weightKg: number, dimensions?: SampleShippingDimensions, ratePack: FreightRatePack = SAMPLE_RATE_PACK): SampleShippingEvaluation {
  validateSamplePack(ratePack)
  const dimensionsCm = sampleDimensions(dimensions)
  const dimensionalWeightKg = dimensionsCm ? dimensionsCm.length * dimensionsCm.width * dimensionsCm.height / 5000 : 0
  const destination = sampleCountry(country)
  const validWeight = typeof weightKg === 'number' && Number.isFinite(weightKg) && weightKg > 0
  const carriers: SampleCarrier[] = ['中邮', 'E 邮宝', '燕文', 'UPS']
  // Reject a whole visible carrier group when any member is malformed. Dropping
  // only the bad row would hide conflicts from the core and make order matter.
  const groups = carriers.map(carrier => {
    const matches = ratePack.rules.filter(rule => rule?.countryName === destination && rule.carrierName === carrier)
    const issue = matches.map(sampleRuleIssue).find(Boolean)
      || (new Set(matches.map(rule => rule.carrierId)).size > 1 ? '同一目的地和承运人存在多个渠道标识，请核对样例费率。' : '')
    return { carrier, matches, issue }
  })
  const rules = groups.flatMap(group => group.issue ? [] : group.matches)
  const core = destination && validWeight && rules.length ? quoteFreight({ ...ratePack, rules }, { country: destination, actualWeightKg: weightKg, dimensionsCm }) : undefined
  const candidates: SampleShippingCandidate[] = groups.map(({ carrier, matches, issue }) => {
    const rule = matches[0]
    if (!destination || !rule) return { carrier, unavailableReason: '该目的国没有虚构样例费率。' }
    if (!validWeight) return { carrier, unavailableReason: 'Shipping Weight 缺失或不是合法的正数。' }
    if (issue) return { carrier, unavailableReason: issue }
    const candidate = core?.candidates.find(item => item.carrierId === rule.carrierId)
    if (!candidate?.eligible) return { carrier, unavailableReason: candidate?.reason || '没有可用的完整样例报价。' }
    const quote = adaptQuote(candidate, rule, destination, ratePack.version)
    if (!quote) return { carrier, unavailableReason: '计算结果缺少合法价格，不以 0 元代替。' }
    return { carrier, quote, unavailableReason: '' }
  })
  const quotes = candidates.flatMap(item => item.quote ? [item.quote] : []).sort((left, right) => left.totalCny - right.totalCny)
  candidates.sort((left, right) => (left.quote?.totalCny ?? Number.POSITIVE_INFINITY) - (right.quote?.totalCny ?? Number.POSITIVE_INFINITY))
  return { quotes, candidates, dimensionalWeightKg, warnings: [...new Set(core?.warnings ?? ratePack.mappingWarnings ?? [])] }
}

/** Empty results mean the sample must not proceed with warehouse delivery. */
export function quoteSampleShipping(country: string, weightKg: number, dimensions?: SampleShippingDimensions, ratePack: FreightRatePack = SAMPLE_RATE_PACK): SampleShippingQuote[] {
  return evaluateSampleShipping(country, weightKg, dimensions, ratePack).quotes
}
