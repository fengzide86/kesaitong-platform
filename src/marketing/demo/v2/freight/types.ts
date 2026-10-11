export interface FreightDimensionsCm {
  length: number
  width: number
  height: number
}

export interface FreightTier {
  maxWeightG: number
  perKgCny: number
  fixedFeeCny: number
}

export interface FreightPerKgBand {
  maxWeightKg: number
  perKgCny: number
}

export interface FreightRateRule {
  carrierId: string
  carrierName: string
  serviceType: 'tiered' | 'epacket' | 'ups'
  countryCode: string
  countryName: string
  countryNameEn?: string
  priority: number
  suspended?: boolean
  maxWeightKg?: number
  minBillableWeightG?: number
  tiers?: FreightTier[]
  perKgCny?: number
  fixedFeeCny?: number
  percentageSurcharge?: number
  minimumSurchargeCny?: number
  volumetricDivisor?: number
  fixedPricesCny?: number[]
  perKgBands?: FreightPerKgBand[]
  fuelSurchargeIncluded?: boolean
}

export interface FreightRatePack {
  schemaVersion: 1
  resourceType: 'freight-rate-pack'
  id: string
  version: string
  name: string
  currency: 'CNY'
  exchangeRateCnyPerUsd: number
  sourceHash: string
  createdAt: string
  rules: FreightRateRule[]
  mappingWarnings?: string[]
}

export interface FreightQuoteRequest {
  country: string
  actualWeightKg: number
  dimensionsCm?: FreightDimensionsCm
  exchangeRateCnyPerUsd?: number
}

export interface FreightQuoteCandidate {
  carrierId: string
  carrierName: string
  eligible: boolean
  reason?: string
  priority: number
  actualWeightKg: number
  volumetricWeightKg?: number
  billableWeightKg?: number
  baseFreightCny?: number
  fixedFeeCny?: number
  surchargeCny?: number
  totalCny?: number
  totalUsd?: number
  warnings: string[]
}

export interface FreightQuoteResult {
  ratePackId: string
  ratePackVersion: string
  exchangeRateCnyPerUsd: number
  request: FreightQuoteRequest
  selected: FreightQuoteCandidate | null
  candidates: FreightQuoteCandidate[]
  warnings: string[]
}
