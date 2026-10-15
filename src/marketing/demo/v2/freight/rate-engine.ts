import type {
  FreightQuoteCandidate,
  FreightQuoteRequest,
  FreightQuoteResult,
  FreightRatePack,
  FreightRateRule,
} from './types.js'

const EPSILON = 1e-9

function roundMoney(value: number): number {
  const cents = value * 100
  if (!Number.isFinite(cents) || Math.abs(cents) > Number.MAX_SAFE_INTEGER) return NaN
  const halfCent = Math.floor(cents) + 0.5
  const tolerance = Math.min(Number.EPSILON * Math.max(1, Math.abs(cents)) * 4, 1e-7)
  return Math.round(Math.abs(cents - halfCent) <= tolerance ? halfCent : cents) / 100
}

function ceilCent(value: number): number {
  const cents = value * 100
  if (!Number.isFinite(cents) || Math.abs(cents) > Number.MAX_SAFE_INTEGER) return NaN
  const nearest = Math.round(cents)
  const tolerance = Math.min(Number.EPSILON * Math.max(1, Math.abs(cents)) * 4, 1e-7)
  return (nearest > 0 && Math.abs(cents - nearest) <= tolerance ? nearest : Math.ceil(cents)) / 100
}

function nonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function positive(value: unknown): value is number {
  return nonNegative(value) && value > 0
}

function normalizeCountry(value: string): string {
  return value.trim().toLowerCase().replace(/[\s._-]+/g, '')
}

function matchesCountry(rule: FreightRateRule, country: string): boolean {
  const target = normalizeCountry(country)
  return [rule.countryCode, rule.countryName, rule.countryNameEn]
    .some(value => typeof value === 'string' && normalizeCountry(value) === target)
}

function ineligible(rule: FreightRateRule, request: FreightQuoteRequest, reason: string, warnings: string[] = []): FreightQuoteCandidate {
  return {
    carrierId: rule.carrierId,
    carrierName: rule.carrierName,
    eligible: false,
    reason,
    priority: rule.priority,
    actualWeightKg: request.actualWeightKg,
    warnings,
  }
}

function totals(
  rule: FreightRateRule,
  request: FreightQuoteRequest,
  exchangeRate: number,
  values: { billableWeightKg: number; volumetricWeightKg?: number; baseFreightCny: number; fixedFeeCny: number; warnings?: string[] },
): FreightQuoteCandidate {
  if (!nonNegative(values.baseFreightCny) || !nonNegative(values.fixedFeeCny) || !positive(values.billableWeightKg)) {
    return ineligible(rule, request, '费用或计费重量缺失、无效或超出计算范围')
  }
  // CNY fee lines are rounded to cents before adding so the displayed lines reconcile.
  const baseFreightCny = roundMoney(values.baseFreightCny)
  const fixedFeeCny = roundMoney(values.fixedFeeCny)
  const subtotal = roundMoney(baseFreightCny + fixedFeeCny)
  const surcharge = rule.percentageSurcharge !== undefined
    ? roundMoney(Math.max(subtotal * rule.percentageSurcharge, rule.minimumSurchargeCny ?? 0))
    : 0
  const totalCny = roundMoney(subtotal + surcharge)
  const totalUsd = ceilCent(totalCny / exchangeRate)
  if (![baseFreightCny, fixedFeeCny, subtotal, surcharge, totalCny, totalUsd].every(nonNegative)) {
    return ineligible(rule, request, '费用计算超出有效数值范围')
  }
  return {
    carrierId: rule.carrierId,
    carrierName: rule.carrierName,
    eligible: true,
    priority: rule.priority,
    actualWeightKg: request.actualWeightKg,
    volumetricWeightKg: values.volumetricWeightKg,
    billableWeightKg: values.billableWeightKg,
    baseFreightCny,
    fixedFeeCny,
    surchargeCny: surcharge,
    totalCny,
    totalUsd,
    warnings: values.warnings || [],
  }
}

function quoteTiered(rule: FreightRateRule, request: FreightQuoteRequest, exchangeRate: number): FreightQuoteCandidate {
  if (rule.maxWeightKg !== undefined && request.actualWeightKg > rule.maxWeightKg + EPSILON) {
    return ineligible(rule, request, `超过 ${rule.maxWeightKg}kg 限重`)
  }
  const weightG = request.actualWeightKg * 1_000
  const tiers = rule.tiers
  if (!Array.isArray(tiers) || !tiers.length || tiers.some(tier => !tier || !positive(tier.maxWeightG))
    || new Set(tiers.map(tier => tier.maxWeightG)).size !== tiers.length) {
    return ineligible(rule, request, '重量区间缺失或无效')
  }
  const tier = [...tiers].sort((a, b) => a.maxWeightG - b.maxWeightG).find(item => weightG <= item.maxWeightG + EPSILON)
  if (!tier) return ineligible(rule, request, '没有匹配的重量区间')
  if (!nonNegative(tier.perKgCny) || !nonNegative(tier.fixedFeeCny)) {
    return ineligible(rule, request, '匹配重量区间的费率缺失或无效')
  }
  return totals(rule, request, exchangeRate, {
    billableWeightKg: request.actualWeightKg,
    baseFreightCny: request.actualWeightKg * tier.perKgCny,
    fixedFeeCny: tier.fixedFeeCny,
  })
}

function quoteEPacket(rule: FreightRateRule, request: FreightQuoteRequest, exchangeRate: number): FreightQuoteCandidate {
  if (!nonNegative(rule.perKgCny) || !nonNegative(rule.fixedFeeCny) || !nonNegative(rule.minBillableWeightG)) {
    return ineligible(rule, request, '每公斤费率、固定费或最低计费重量缺失或无效')
  }
  if (rule.maxWeightKg !== undefined && request.actualWeightKg > rule.maxWeightKg + EPSILON) {
    return ineligible(rule, request, `超过 ${rule.maxWeightKg}kg 限重`)
  }
  const billableWeightG = Math.max(request.actualWeightKg * 1_000, rule.minBillableWeightG)
  const billableWeightKg = billableWeightG / 1_000
  if (rule.maxWeightKg !== undefined && billableWeightKg > rule.maxWeightKg + EPSILON) {
    return ineligible(rule, request, `计费重量超过 ${rule.maxWeightKg}kg 限重`)
  }
  return totals(rule, request, exchangeRate, {
    billableWeightKg,
    baseFreightCny: billableWeightKg * rule.perKgCny,
    fixedFeeCny: rule.fixedFeeCny,
  })
}

function quoteUps(rule: FreightRateRule, request: FreightQuoteRequest, exchangeRate: number): FreightQuoteCandidate {
  const dimensions = request.dimensionsCm
  if (!dimensions || ![dimensions.length, dimensions.width, dimensions.height].every(value => Number.isFinite(value) && value > 0)) {
    return ineligible(rule, request, 'UPS 报价需要完整的长、宽、高', ['未猜测缺失尺寸'])
  }
  if (!positive(rule.volumetricDivisor)) return ineligible(rule, request, '体积重除数缺失或无效')
  const volumetricWeightKg = dimensions.length * dimensions.width * dimensions.height / rule.volumetricDivisor
  const billableWeightKg = Math.max(1, Math.ceil(Math.max(request.actualWeightKg, volumetricWeightKg) - EPSILON))
  if (!nonNegative(volumetricWeightKg) || !positive(billableWeightKg)) {
    return ineligible(rule, request, '体积重或计费重量超出有效数值范围')
  }
  if (rule.maxWeightKg !== undefined && billableWeightKg > rule.maxWeightKg + EPSILON) {
    return ineligible(rule, request, `计费重量超过 ${rule.maxWeightKg}kg 限重`)
  }
  let baseFreightCny: number | undefined
  if (billableWeightKg <= 20) baseFreightCny = rule.fixedPricesCny?.[Math.max(0, billableWeightKg - 1)]
  else {
    const bands = rule.perKgBands
    if (!Array.isArray(bands) || !bands.length || bands.some(band => !band || !positive(band.maxWeightKg))
      || new Set(bands.map(band => band.maxWeightKg)).size !== bands.length) {
      return ineligible(rule, request, 'UPS 重量区间缺失或无效')
    }
    const band = [...bands].sort((a, b) => a.maxWeightKg - b.maxWeightKg).find(item => billableWeightKg <= item.maxWeightKg)
    if (band && nonNegative(band.perKgCny)) baseFreightCny = billableWeightKg * band.perKgCny
  }
  if (!nonNegative(baseFreightCny)) return ineligible(rule, request, '匹配 UPS 重量区间的费率缺失或无效')
  const warnings = rule.fuelSurchargeIncluded === false ? ['当前费率不含燃油附加费'] : []
  return totals(rule, request, exchangeRate, {
    billableWeightKg,
    volumetricWeightKg,
    baseFreightCny,
    fixedFeeCny: 0,
    warnings,
  })
}

export function validateFreightRatePack(pack: FreightRatePack): FreightRatePack {
  if (!pack || pack.schemaVersion !== 1 || pack.resourceType !== 'freight-rate-pack') throw new Error('费率包格式不受支持')
  if (!pack.id || !pack.version || !Array.isArray(pack.rules) || !pack.rules.length) throw new Error('费率包内容不完整')
  if (pack.currency !== 'CNY') throw new Error('费率包币种不受支持，报价费率须使用人民币')
  if (pack.rules.some(rule => !rule || typeof rule !== 'object' || !rule.carrierId || !rule.carrierName)) {
    throw new Error('费率包渠道信息不完整')
  }
  if (!Number.isFinite(pack.exchangeRateCnyPerUsd) || pack.exchangeRateCnyPerUsd <= 0) throw new Error('费率包汇率无效')
  return pack
}

function commonRuleIssue(rule: FreightRateRule): string | null {
  if (rule.suspended) return '该渠道当前暂停服务'
  if (rule.maxWeightKg !== undefined && !positive(rule.maxWeightKg)) return '渠道限重无效'
  if (rule.percentageSurcharge !== undefined && !nonNegative(rule.percentageSurcharge)) return '附加费比例无效'
  if (rule.minimumSurchargeCny !== undefined && (!nonNegative(rule.minimumSurchargeCny) || rule.percentageSurcharge === undefined)) {
    return '附加费规则缺失或无效'
  }
  if (!['tiered', 'epacket', 'ups'].includes(rule.serviceType)) return '计费方式不受支持'
  return null
}

function billingSignature(rule: FreightRateRule): string {
  return JSON.stringify({
    countryCode: typeof rule.countryCode === 'string' ? normalizeCountry(rule.countryCode) : rule.countryCode,
    serviceType: rule.serviceType,
    suspended: rule.suspended,
    maxWeightKg: rule.maxWeightKg,
    minBillableWeightG: rule.minBillableWeightG,
    tiers: Array.isArray(rule.tiers) ? rule.tiers.map(tier => ({
      maxWeightG: tier?.maxWeightG, perKgCny: tier?.perKgCny, fixedFeeCny: tier?.fixedFeeCny,
    })).sort((a, b) => (a.maxWeightG ?? Infinity) - (b.maxWeightG ?? Infinity)) : rule.tiers,
    perKgCny: rule.perKgCny,
    fixedFeeCny: rule.fixedFeeCny,
    percentageSurcharge: rule.percentageSurcharge,
    minimumSurchargeCny: rule.minimumSurchargeCny,
    volumetricDivisor: rule.volumetricDivisor,
    fixedPricesCny: rule.fixedPricesCny,
    perKgBands: Array.isArray(rule.perKgBands) ? rule.perKgBands.map(band => ({
      maxWeightKg: band?.maxWeightKg, perKgCny: band?.perKgCny,
    })).sort((a, b) => (a.maxWeightKg ?? Infinity) - (b.maxWeightKg ?? Infinity)) : rule.perKgBands,
    fuelSurchargeIncluded: rule.fuelSurchargeIncluded,
  })
}

export function quoteFreight(packInput: FreightRatePack, request: FreightQuoteRequest): FreightQuoteResult {
  const pack = validateFreightRatePack(packInput)
  if (typeof request.country !== 'string' || !request.country.trim()) throw new Error('请选择配送国家')
  if (!Number.isFinite(request.actualWeightKg) || request.actualWeightKg <= 0) throw new Error('实际重量必须大于 0')
  const exchangeRate = request.exchangeRateCnyPerUsd === undefined ? pack.exchangeRateCnyPerUsd : request.exchangeRateCnyPerUsd
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) throw new Error('人民币兑美元汇率无效')
  const rules = pack.rules.filter(rule => matchesCountry(rule, request.country))
  const carrierSignatures = new Map<string, Set<string>>()
  for (const rule of rules) {
    const signatures = carrierSignatures.get(rule.carrierId) || new Set<string>()
    signatures.add(billingSignature(rule))
    carrierSignatures.set(rule.carrierId, signatures)
  }
  const candidates = rules.map(rule => {
    if ((carrierSignatures.get(rule.carrierId)?.size ?? 0) > 1) {
      return ineligible(rule, request, '同一目的地和渠道存在冲突费率，请核对或指定具体目的地')
    }
    const issue = commonRuleIssue(rule)
    if (issue) return ineligible(rule, request, issue)
    if (rule.serviceType === 'ups') return quoteUps(rule, request, exchangeRate)
    if (rule.serviceType === 'epacket') return quoteEPacket(rule, request, exchangeRate)
    return quoteTiered(rule, request, exchangeRate)
  }).sort((left, right) => {
    if (left.eligible !== right.eligible) return left.eligible ? -1 : 1
    if ((left.totalCny ?? Infinity) !== (right.totalCny ?? Infinity)) return (left.totalCny ?? Infinity) - (right.totalCny ?? Infinity)
    return left.priority - right.priority
  })
  const selected = candidates.find(candidate => candidate.eligible) || null
  const warnings = [...(pack.mappingWarnings || [])]
  if ([...carrierSignatures.values()].some(signatures => signatures.size > 1)) warnings.push('存在同一目的地和渠道的冲突费率，已排除相关报价')
  const weightG = request.actualWeightKg * 1_000
  if (rules.some(rule => rule.serviceType !== 'ups') && Number.isFinite(weightG) && Math.abs(weightG - Math.round(weightG)) > EPSILON) {
    warnings.push('小包资料未明确不足 1g 的取整规则，本次按输入重量估算，请核对实际计费重量')
  }
  if (!rules.length) warnings.push('当前费率包没有该国家的渠道')
  if (rules.length && !selected) warnings.push('所有匹配渠道均不可用，请检查重量、尺寸或暂停状态')
  return {
    ratePackId: pack.id,
    ratePackVersion: pack.version,
    exchangeRateCnyPerUsd: exchangeRate,
    request,
    selected,
    candidates,
    warnings,
  }
}

