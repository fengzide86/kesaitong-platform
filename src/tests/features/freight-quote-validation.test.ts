import { describe, expect, it } from 'vitest'

import { quoteFreight } from '@/shared/freight/rate-engine'
import type { FreightQuoteRequest, FreightRatePack, FreightRateRule } from '@/shared/freight/types'

function ratePack(...rules: FreightRateRule[]): FreightRatePack {
  return {
    schemaVersion: 1,
    resourceType: 'freight-rate-pack',
    id: 'inline-validation-rates',
    version: 'test-20261008',
    name: 'Inline rates for quote validation',
    currency: 'CNY',
    exchangeRateCnyPerUsd: 7,
    sourceHash: 'inline-fixture',
    createdAt: '2026-10-08T00:00:00.000Z',
    rules,
  }
}

function ePacket(overrides: Partial<FreightRateRule> = {}): FreightRateRule {
  return {
    carrierId: 'epacket',
    carrierName: 'ePacket test carrier',
    serviceType: 'epacket',
    countryCode: 'US',
    countryName: '美国',
    countryNameEn: 'United States',
    priority: 2,
    maxWeightKg: 2,
    minBillableWeightG: 50,
    perKgCny: 60,
    fixedFeeCny: 10,
    ...overrides,
  }
}

function tiered(overrides: Partial<FreightRateRule> = {}): FreightRateRule {
  return {
    carrierId: 'tiered-post',
    carrierName: 'Tiered post test carrier',
    serviceType: 'tiered',
    countryCode: 'US',
    countryName: '美国',
    countryNameEn: 'United States',
    priority: 1,
    maxWeightKg: 2,
    tiers: [
      { maxWeightG: 100, perKgCny: 30, fixedFeeCny: 5 },
      { maxWeightG: 500, perKgCny: 20, fixedFeeCny: 8 },
      { maxWeightG: 2_000, perKgCny: 10, fixedFeeCny: 12 },
    ],
    ...overrides,
  }
}

function ups(overrides: Partial<FreightRateRule> = {}): FreightRateRule {
  return {
    carrierId: 'ups',
    carrierName: 'UPS test carrier',
    serviceType: 'ups',
    countryCode: 'US',
    countryName: '美国',
    countryNameEn: 'United States',
    priority: 3,
    maxWeightKg: 100,
    volumetricDivisor: 5_000,
    fixedPricesCny: Array.from({ length: 20 }, (_, index) => 80 + index),
    perKgBands: [
      { maxWeightKg: 50, perKgCny: 20 },
      { maxWeightKg: 100, perKgCny: 15 },
    ],
    ...overrides,
  }
}

const lightParcel: FreightQuoteRequest = { country: 'US', actualWeightKg: 0.1 }
const compactDimensions = { length: 10, width: 10, height: 10 }

function expectUnavailable(rule: FreightRateRule, request: FreightQuoteRequest = lightParcel): void {
  const result = quoteFreight(ratePack(rule), request)
  expect(result.selected).toBeNull()
  expect(result.candidates).toHaveLength(1)
  expect(result.candidates[0]).toMatchObject({ eligible: false })
  expect(result.candidates[0].reason).toEqual(expect.any(String))
  expect(result.candidates[0].reason?.length).toBeGreaterThan(0)
  expect(result.candidates[0].totalCny).toBeUndefined()
  expect(result.candidates[0].totalUsd).toBeUndefined()
}

describe('freight quote validation and calculation', () => {
  it.each(['perKgCny', 'fixedFeeCny'] as const)('keeps missing ePacket %s unavailable instead of quoting a free component', (field) => {
    const incomplete = ePacket({ [field]: undefined })
    const fallback = ePacket({ carrierId: 'complete-carrier', perKgCny: 80 })
    const result = quoteFreight(ratePack(incomplete, fallback), lightParcel)

    expect(result.selected).toMatchObject({ carrierId: 'complete-carrier', totalCny: 18, totalUsd: 2.58 })
    expect(result.candidates.find(candidate => candidate.carrierId === 'epacket')).toMatchObject({ eligible: false })
  })

  it.each(['perKgCny', 'fixedFeeCny'] as const)('does not bypass a missing %s in the matching low-weight tier', (field) => {
    const rule = tiered()
    const firstTier = { ...rule.tiers![0], [field]: undefined }
    rule.tiers = [firstTier, ...rule.tiers!.slice(1)]

    expectUnavailable(rule, { country: 'US', actualWeightKg: 0.05 })
    // The missing price belongs to <=100g; it must not borrow the 101-500g price.
    expect(quoteFreight(ratePack(rule), { country: 'US', actualWeightKg: 0.2 }).selected)
      .toMatchObject({ baseFreightCny: 4, fixedFeeCny: 8, totalCny: 12 })
  })

  it.each([
    ['negative', -1],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
    ['null', null],
    ['boolean', false],
  ])('rejects %s values in required monetary rates', (_name, invalidValue) => {
    const invalid = invalidValue as number
    expectUnavailable(ePacket({ perKgCny: invalid }))
    expectUnavailable(ePacket({ fixedFeeCny: invalid }))
    expectUnavailable(tiered({ tiers: [{ maxWeightG: 100, perKgCny: invalid, fixedFeeCny: 5 }] }))
    expectUnavailable(tiered({ tiers: [{ maxWeightG: 100, perKgCny: 30, fixedFeeCny: invalid }] }))
    expectUnavailable(ups({ fixedPricesCny: [invalid] }), { ...lightParcel, dimensionsCm: compactDimensions })
    expectUnavailable(ups({ perKgBands: [{ maxWeightKg: 100, perKgCny: invalid }] }), {
      country: 'US', actualWeightKg: 21, dimensionsCm: compactDimensions,
    })
  })

  it('accepts an explicitly zero fixed fee and calculates the positive unit rate', () => {
    const result = quoteFreight(ratePack(ePacket({ perKgCny: 60, fixedFeeCny: 0 })), {
      country: 'US', actualWeightKg: 0.5,
    })
    expect(result.selected).toMatchObject({ baseFreightCny: 30, fixedFeeCny: 0, surchargeCny: 0, totalCny: 30, totalUsd: 4.29 })
  })

  it('distinguishes explicitly zero unit prices from missing prices', () => {
    const result = quoteFreight(ratePack(ePacket({ perKgCny: 0, fixedFeeCny: 3 })), lightParcel)
    expect(result.selected).toMatchObject({ eligible: true, baseFreightCny: 0, fixedFeeCny: 3, totalCny: 3, totalUsd: 0.43 })
  })

  it('does not invent a ban on explicitly zero UPS monetary rates', () => {
    expect(quoteFreight(ratePack(ups({ fixedPricesCny: [0] })), {
      ...lightParcel, dimensionsCm: compactDimensions,
    }).selected).toMatchObject({ eligible: true, baseFreightCny: 0, totalCny: 0, totalUsd: 0 })
    expect(quoteFreight(ratePack(ups({ perKgBands: [{ maxWeightKg: 100, perKgCny: 0 }] })), {
      country: 'US', actualWeightKg: 21, dimensionsCm: compactDimensions,
    }).selected).toMatchObject({ eligible: true, billableWeightKg: 21, baseFreightCny: 0, totalCny: 0 })
  })

  it('uses the complete original tier even when the next tier has a lower price', () => {
    const pack = ratePack(tiered({
      tiers: [
        { maxWeightG: 150, perKgCny: 100, fixedFeeCny: 10 },
        { maxWeightG: 500, perKgCny: 90, fixedFeeCny: 10 },
      ],
    }))
    expect(quoteFreight(pack, { country: 'US', actualWeightKg: 0.15 }).selected?.totalCny).toBe(25)
    expect(quoteFreight(pack, { country: 'US', actualWeightKg: 0.151 }).selected?.totalCny).toBe(23.59)
  })

  it('preserves country-specific weight limits and minimum billable weights', () => {
    const pack = ratePack(
      ePacket({ countryCode: 'BR', countryName: '巴西', countryNameEn: 'Brazil', minBillableWeightG: 50, maxWeightKg: 2 }),
      ePacket({ countryCode: 'IL', countryName: '以色列', countryNameEn: 'Israel', minBillableWeightG: 1, maxWeightKg: 3 }),
    )
    expect(quoteFreight(pack, { country: 'BR', actualWeightKg: 0.01 }).selected)
      .toMatchObject({ billableWeightKg: 0.05, baseFreightCny: 3, totalCny: 13 })
    expect(quoteFreight(pack, { country: 'IL', actualWeightKg: 2.5 }).selected)
      .toMatchObject({ billableWeightKg: 2.5, totalCny: 160 })
    expect(quoteFreight(pack, { country: 'BR', actualWeightKg: 2.5 }).selected).toBeNull()
  })

  it('requires a declared ePacket minimum rather than inventing 1g, while allowing explicit zero', () => {
    expectUnavailable(ePacket({ minBillableWeightG: undefined }))
    expect(quoteFreight(ratePack(ePacket({ minBillableWeightG: 0, perKgCny: 100, fixedFeeCny: 0 })), {
      country: 'US', actualWeightKg: 0.01,
    }).selected).toMatchObject({ billableWeightKg: 0.01, totalCny: 1 })
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, null, false])('rejects an invalid ePacket minimum billable weight (%s)', (invalidValue) => {
    expectUnavailable(ePacket({ minBillableWeightG: invalidValue as number }))
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined])('rejects an undeclared or invalid UPS volumetric divisor (%s)', (invalid) => {
    expectUnavailable(ups({ volumetricDivisor: invalid }), { ...lightParcel, dimensionsCm: compactDimensions })
  })

  it('rejects UPS quotes without complete usable dimensions', () => {
    expectUnavailable(ups())
    expectUnavailable(ups(), { ...lightParcel, dimensionsCm: { length: 10, width: 10, height: 0 } })
    expectUnavailable(ups(), { ...lightParcel, dimensionsCm: { length: 10, width: Number.NaN, height: 10 } })
  })

  it('applies the UPS limit to rounded billable weight, including volumetric weight', () => {
    const rule = ups({ maxWeightKg: 20 })
    expectUnavailable(rule, { country: 'US', actualWeightKg: 1, dimensionsCm: { length: 50, width: 50, height: 50 } })
    expectUnavailable(rule, { country: 'US', actualWeightKg: 1, dimensionsCm: { length: 50, width: 40, height: 50.01 } })
    expect(quoteFreight(ratePack(rule), {
      country: 'US', actualWeightKg: 1, dimensionsCm: { length: 50, width: 40, height: 50 },
    }).selected).toMatchObject({ volumetricWeightKg: 20, billableWeightKg: 20, baseFreightCny: 99, totalCny: 99 })
  })

  it('keeps UPS volumetric divisor and integer billable rounding visible in the numerical result', () => {
    expect(quoteFreight(ratePack(ups()), {
      country: 'US', actualWeightKg: 0.15, dimensionsCm: { length: 15, width: 10, height: 8 },
    }).selected).toMatchObject({ actualWeightKg: 0.15, volumetricWeightKg: 0.24, billableWeightKg: 1, totalCny: 80 })
    expect(quoteFreight(ratePack(ups()), {
      country: 'US', actualWeightKg: Number.MIN_VALUE, dimensionsCm: { length: 0.01, width: 0.01, height: 0.01 },
    }).selected).toMatchObject({ billableWeightKg: 1, totalCny: 80 })
  })

  it('keeps a missing UPS price unavailable rather than borrowing an adjacent weight price', () => {
    expectUnavailable(ups({ fixedPricesCny: [undefined as unknown as number, 81] }), {
      ...lightParcel, dimensionsCm: compactDimensions,
    })
    expectUnavailable(ups({
      perKgBands: [
        { maxWeightKg: 50, perKgCny: undefined as unknown as number },
        { maxWeightKg: 100, perKgCny: 15 },
      ],
    }), { country: 'US', actualWeightKg: 21, dimensionsCm: compactDimensions })
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('does not silently replace an invalid explicit exchange rate (%s)', (exchangeRateCnyPerUsd) => {
    expect(() => quoteFreight(ratePack(ePacket()), { ...lightParcel, exchangeRateCnyPerUsd })).toThrow(/汇率/)
  })

  it('uses the declared pack rate only when an override is absent', () => {
    const pack = ratePack(ePacket({ perKgCny: 70, fixedFeeCny: 0 }))
    expect(quoteFreight(pack, lightParcel)).toMatchObject({ exchangeRateCnyPerUsd: 7, selected: { totalCny: 7, totalUsd: 1 } })
    expect(quoteFreight(pack, { ...lightParcel, exchangeRateCnyPerUsd: 8 }))
      .toMatchObject({ exchangeRateCnyPerUsd: 8, selected: { totalCny: 7, totalUsd: 0.88 } })
  })

  it('treats undeclared surcharges as none and distinguishes zero from a missing percentage', () => {
    expect(quoteFreight(ratePack(ePacket()), lightParcel).selected).toMatchObject({ surchargeCny: 0, totalCny: 16 })
    expect(quoteFreight(ratePack(ePacket({ percentageSurcharge: 0, minimumSurchargeCny: 0 })), lightParcel).selected)
      .toMatchObject({ surchargeCny: 0, totalCny: 16 })
    expect(quoteFreight(ratePack(ePacket({ percentageSurcharge: 0, minimumSurchargeCny: 2 })), lightParcel).selected)
      .toMatchObject({ surchargeCny: 2, totalCny: 18 })
    expect(quoteFreight(ratePack(ePacket({ percentageSurcharge: 0.1 })), lightParcel).selected)
      .toMatchObject({ surchargeCny: 1.6, totalCny: 17.6 })
    expectUnavailable(ePacket({ minimumSurchargeCny: 2 }))
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, null, false])('rejects invalid surcharge values (%s)', (invalidValue) => {
    const invalid = invalidValue as number
    expectUnavailable(ePacket({ percentageSurcharge: invalid, minimumSurchargeCny: 0 }))
    expectUnavailable(ePacket({ percentageSurcharge: 0.1, minimumSurchargeCny: invalid }))
  })

  it('rounds CNY components before totaling and converts that exact payable total to USD', () => {
    const candidate = quoteFreight(ratePack(ePacket({ perKgCny: 3.336, fixedFeeCny: 0.006 })), {
      country: 'US', actualWeightKg: 1,
    }).selected!
    expect(candidate).toMatchObject({ baseFreightCny: 3.34, fixedFeeCny: 0.01, surchargeCny: 0, totalCny: 3.35, totalUsd: 0.48 })
    expect(candidate.totalCny).toBeCloseTo(candidate.baseFreightCny! + candidate.fixedFeeCny! + candidate.surchargeCny!, 8)

    const charged = quoteFreight(ratePack(ePacket({
      perKgCny: 3.336, fixedFeeCny: 0.006, percentageSurcharge: 0.5,
    })), { country: 'US', actualWeightKg: 1 }).selected!
    expect(charged).toMatchObject({ baseFreightCny: 3.34, fixedFeeCny: 0.01, surchargeCny: 1.68, totalCny: 5.03, totalUsd: 0.72 })
  })

  it('rounds a decimal half-cent up even when binary floating point is just below the midpoint', () => {
    const result = quoteFreight(ratePack(ePacket({ perKgCny: 100.75, fixedFeeCny: 0 })), lightParcel)
    expect(result.selected).toMatchObject({ baseFreightCny: 10.08, fixedFeeCny: 0, totalCny: 10.08, totalUsd: 1.44 })
    expect(quoteFreight(ratePack(ePacket({ perKgCny: 0.75, fixedFeeCny: 10 })), lightParcel).selected)
      .toMatchObject({ baseFreightCny: 0.08, fixedFeeCny: 10, totalCny: 10.08 })
  })

  it('rounds even a very small positive USD amount up to one cent', () => {
    const result = quoteFreight(ratePack(ePacket({ perKgCny: 0.1, fixedFeeCny: 0 })), {
      ...lightParcel, exchangeRateCnyPerUsd: 1_000_000_000_000,
    })
    expect(result.selected).toMatchObject({ baseFreightCny: 0.01, totalCny: 0.01, totalUsd: 0.01 })
  })

  it.each(['epacket', 'tiered', 'ups'] as const)('keeps a suspended %s channel out of selection', (serviceType) => {
    const rule = serviceType === 'epacket' ? ePacket() : serviceType === 'tiered' ? tiered() : ups()
    expectUnavailable({ ...rule, suspended: true }, { ...lightParcel, dimensionsCm: compactDimensions })
  })

  it('rejects overflowed monetary calculations instead of returning an infinite eligible quote', () => {
    expectUnavailable(ePacket({ perKgCny: Number.MAX_VALUE, fixedFeeCny: Number.MAX_VALUE }))
    expectUnavailable(ePacket({ perKgCny: Number.MAX_VALUE, fixedFeeCny: 0 }))
  })

  it('does not pick the cheaper of conflicting rows for the same carrier and country code', () => {
    const conflicting = ratePack(
      ups({ countryCode: 'SX', countryName: '圣马丁', countryNameEn: 'St. Martin (France)', fixedPricesCny: [90] }),
      ups({ countryCode: 'SX', countryName: '圣马丁', countryNameEn: 'St. Maarten (Netherlands)', fixedPricesCny: [70] }),
      ePacket({ countryCode: 'SX', countryName: '圣马丁', countryNameEn: 'St. Martin', carrierId: 'reliable-carrier', perKgCny: 200, fixedFeeCny: 90 }),
    )
    const result = quoteFreight(conflicting, { country: 'SX', actualWeightKg: 0.1, dimensionsCm: compactDimensions })
    expect(result.selected).toMatchObject({ carrierId: 'reliable-carrier', totalCny: 110 })
    expect(result.candidates.filter(candidate => candidate.carrierId === 'ups').every(candidate => !candidate.eligible)).toBe(true)

    const exactCountry = quoteFreight(conflicting, {
      country: 'St. Martin (France)', actualWeightKg: 0.1, dimensionsCm: compactDimensions,
    })
    expect(exactCountry.selected).toMatchObject({ carrierId: 'ups', totalCny: 90 })
  })

  it('accepts duplicated country aliases when their complete charging configuration agrees', () => {
    const result = quoteFreight(ratePack(
      ups({ countryCode: 'SX', countryName: '圣马丁', countryNameEn: 'St. Martin (France)', fixedPricesCny: [90] }),
      ups({ countryCode: 'SX', countryName: '圣马丁', countryNameEn: 'St. Maarten (Netherlands)', fixedPricesCny: [90] }),
    ), { country: 'SX', actualWeightKg: 0.1, dimensionsCm: compactDimensions })
    expect(result.selected).toMatchObject({ carrierId: 'ups', eligible: true, totalCny: 90 })
    expect(result.candidates.every(candidate => candidate.eligible && candidate.totalCny === 90)).toBe(true)
  })

  it('recognizes equivalent tier and band prices regardless of object key insertion order', () => {
    const tierResult = quoteFreight(ratePack(tiered(), tiered({
      carrierName: 'Same tiered carrier with reordered keys',
      tiers: [
        { perKgCny: 10, fixedFeeCny: 12, maxWeightG: 2_000 },
        { fixedFeeCny: 8, maxWeightG: 500, perKgCny: 20 },
        { perKgCny: 30, fixedFeeCny: 5, maxWeightG: 100 },
      ],
    })), lightParcel)
    expect(tierResult.selected).toMatchObject({ eligible: true, baseFreightCny: 3, fixedFeeCny: 5, totalCny: 8 })
    expect(tierResult.candidates.every(candidate => candidate.eligible && candidate.totalCny === 8)).toBe(true)

    const bandResult = quoteFreight(ratePack(ups(), ups({
      carrierName: 'Same UPS carrier with reordered keys',
      perKgBands: [
        { perKgCny: 15, maxWeightKg: 100 },
        { perKgCny: 20, maxWeightKg: 50 },
      ],
    })), { country: 'US', actualWeightKg: 21, dimensionsCm: compactDimensions })
    expect(bandResult.selected).toMatchObject({ eligible: true, billableWeightKg: 21, totalCny: 420 })
    expect(bandResult.candidates.every(candidate => candidate.eligible && candidate.totalCny === 420)).toBe(true)
  })
})
