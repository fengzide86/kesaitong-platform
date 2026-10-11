import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { newProduct, type Product } from './model'
import { evaluateSampleShipping, quoteSampleShipping, readSampleShippingWeight, SAMPLE_CARRIER_RATES, SAMPLE_RATE_PACK, SAMPLE_SHIPPING_RATE_VERSION, type SampleShippingDimensions } from './shipping-demo'
import ShippingQuotePanel from './ShippingQuotePanel.vue'
import { quoteFreight } from '../../../shared/freight/rate-engine'
import type { FreightRatePack } from '../../../shared/freight/types'

const smallDimensions = { lengthCm: 24, widthCm: 12, heightCm: 8 }
const copyPack = (): FreightRatePack => JSON.parse(JSON.stringify(SAMPLE_RATE_PACK)) as FreightRatePack

describe('strict core integration for fictional quotes', () => {
  it.each([false, true])('validates duplicate country and carrier identity before grouping: bad-first=%s', (badFirst) => {
    for (const [field, value] of [
      ['countryName', undefined], ['countryName', ''], ['countryName', 'United States'], ['countryName', ' 美国 '],
      ['countryCode', undefined], ['countryCode', 'GB'], ['carrierName', undefined], ['carrierName', ''],
      ['carrierName', 'ePacket'], ['carrierName', ' E 邮宝 '], ['carrierName', '燕文'],
    ] as const) {
      const pack = copyPack()
      const original = pack.rules.find(rule => rule.countryCode === 'US' && rule.serviceType === 'epacket')!
      const malformed = { ...original, [field]: value }
      if (badFirst) pack.rules.unshift(malformed as typeof original)
      else pack.rules.push(malformed as typeof original)
      expect(() => evaluateSampleShipping('美国', 0.25, smallDimensions, pack), `${field}=${String(value)}`)
        .toThrow('国家或渠道身份不一致')
    }
  })

  it('preserves pack warnings when every carrier is rejected before core evaluation', () => {
    const pack = copyPack()
    for (const rule of pack.rules) rule.maxWeightKg = Number.NaN
    const result = evaluateSampleShipping('美国', 0.25, smallDimensions, pack)
    expect(result.quotes).toEqual([])
    expect(result.warnings).toEqual(pack.mappingWarnings)
  })

  it.each([false, true])('rejects an entire carrier with a malformed duplicate regardless of order: bad-first=%s', (badFirst) => {
    const pack = copyPack()
    const original = pack.rules.find(rule => rule.countryCode === 'US' && rule.serviceType === 'epacket')!
    const incomplete = { ...original, perKgCny: undefined }
    if (badFirst) pack.rules.unshift(incomplete)
    else pack.rules.push(incomplete)
    const result = evaluateSampleShipping('美国', 0.25, smallDimensions, pack)
    expect(result.quotes.map(quote => quote.carrier)).toEqual(['燕文', '中邮', 'UPS'])
    expect(result.candidates.find(candidate => candidate.carrier === 'E 邮宝')?.unavailableReason).toContain('缺少合法')
  })

  it('keeps valid conflicting duplicates unavailable and accepts equivalent tier ordering', () => {
    const pack = copyPack()
    const original = pack.rules.find(rule => rule.countryCode === 'US' && rule.serviceType === 'epacket')!
    pack.rules.push({ ...original, perKgCny: 1 })
    const conflict = evaluateSampleShipping('美国', 0.25, smallDimensions, pack)
    expect(conflict.quotes.some(quote => quote.carrier === 'E 邮宝')).toBe(false)
    expect(conflict.candidates.find(candidate => candidate.carrier === 'E 邮宝')?.unavailableReason).toContain('冲突')
    expect(conflict.warnings.some(warning => warning.includes('冲突费率'))).toBe(true)
    const equivalent = copyPack()
    const post = equivalent.rules.find(rule => rule.countryCode === 'US' && rule.carrierName === '中邮')!
    equivalent.rules.push({ ...post, tiers: [...post.tiers!].reverse() })
    expect(quoteSampleShipping('美国', 0.25, smallDimensions, equivalent)).toEqual(quoteSampleShipping('美国', 0.25, smallDimensions))
  })

  it('does not silently map two distinct channel IDs onto one visible carrier', () => {
    const pack = copyPack()
    const original = pack.rules.find(rule => rule.countryCode === 'US' && rule.serviceType === 'epacket')!
    pack.rules.push({ ...original, carrierId: 'another-epacket', perKgCny: 1 })
    const result = evaluateSampleShipping('美国', 0.25, smallDimensions, pack)
    expect(result.candidates.find(candidate => candidate.carrier === 'E 邮宝')?.unavailableReason).toContain('多个渠道标识')
    expect(result.quotes.some(quote => quote.carrier === 'E 邮宝')).toBe(false)
  })

  it.each(['中邮', 'E 邮宝', 'UPS'])('does not recommend the suspended %s channel', (carrier) => {
    const pack = copyPack()
    pack.rules.find(rule => rule.countryCode === 'US' && rule.carrierName === carrier)!.suspended = true
    const result = evaluateSampleShipping('美国', 0.25, smallDimensions, pack)
    expect(result.candidates.find(candidate => candidate.carrier === carrier)?.unavailableReason).toContain('暂停')
    expect(result.quotes.some(quote => quote.carrier === carrier)).toBe(false)
  })

  it('checks the UPS cap against rounded billable volume, not only actual weight', () => {
    expect(quoteSampleShipping('美国', 0.25, { lengthCm: 100, widthCm: 50, heightCm: 20 }).find(quote => quote.carrier === 'UPS'))
      .toMatchObject({ billableWeightKg: 20, totalCny: 1130 })
    const result = evaluateSampleShipping('美国', 0.25, { lengthCm: 100, widthCm: 50, heightCm: 20.01 })
    expect(result.candidates.find(candidate => candidate.carrier === 'UPS')?.unavailableReason).toBe('计费重量超过 20kg 限重')
  })

  it('keeps individually rounded displayed fee components equal to the total', () => {
    const pack = copyPack()
    Object.assign(pack.rules.find(rule => rule.countryCode === 'US' && rule.serviceType === 'epacket')!, {
      perKgCny: 33.36, fixedFeeCny: 0.006, percentageSurcharge: 0.5,
    })
    const quote = quoteSampleShipping('美国', 0.1, undefined, pack).find(item => item.carrier === 'E 邮宝')!
    expect(quote).toMatchObject({ weightChargeCny: 3.34, fixedCny: 0.01, surchargeCny: 1.68, totalCny: 5.03 })
    expect(quote.weightChargeCny + quote.fixedCny + quote.surchargeCny).toBeCloseTo(quote.totalCny, 10)
  })

  it('shows runtime rounding uncertainty and clears stale warnings when input changes', async () => {
    const wrapper = mount(ShippingQuotePanel, { props: { country: '美国', weightKg: 0.150001 } })
    await wrapper.get('[data-action="calculate-shipping"]').trigger('click')
    expect(wrapper.get('[data-testid="shipping-calculation-warnings"]').text()).toContain('不足 1g')
    await wrapper.get('[name="quoteWeight"]').setValue('0.25')
    expect(wrapper.find('[data-testid="shipping-calculation-warnings"]').exists()).toBe(false)
    await wrapper.get('[data-action="calculate-shipping"]').trigger('click')
    expect(wrapper.get('[data-testid="shipping-calculation-warnings"]').text()).not.toContain('不足 1g')
    wrapper.unmount()
  })
})

function productWeight(weight: unknown, unit: unknown): Product {
  const product = newProduct()
  product.moreDetails.shippingWeight = weight as string
  product.moreDetails.shippingWeightUnit = unit as string
  product.compliance.itemWeight = '9'
  return product
}

describe('sample Shipping Weight extraction', () => {
  it('reads only Shipping Weight and converts the editor units to kg', () => {
    expect(readSampleShippingWeight(productWeight(' 0.25 ', ' kg '))).toBe(0.25)
    expect(readSampleShippingWeight(productWeight('250', 'g'))).toBe(0.25)
    expect(readSampleShippingWeight(productWeight('1', 'lb'))).toBeCloseTo(0.45359237, 8)
    expect(readSampleShippingWeight(productWeight('16', 'oz'))).toBeCloseTo(0.45359237, 8)
    expect(readSampleShippingWeight(productWeight('.25', 'KG'))).toBe(0.25)
  })

  it('never falls back to a nonempty Item Weight when Shipping Weight is missing or illegal', () => {
    for (const value of ['', ' ', '0', '-1', '0.25kg', 'NaN', 'Infinity', '0x10', '1e400']) {
      expect(readSampleShippingWeight(productWeight(value, 'kg'))).toBe(0)
    }
    expect(readSampleShippingWeight(productWeight('0.25', ''))).toBe(0)
    expect(readSampleShippingWeight(productWeight('0.25', 'unknown'))).toBe(0)
    expect(readSampleShippingWeight(productWeight('0.25', '__proto__'))).toBe(0)
    const product = productWeight('0.25', 'kg')
    delete product.moreDetails.shippingWeight
    expect(readSampleShippingWeight(product)).toBe(0)
    expect(readSampleShippingWeight(undefined as unknown as Product)).toBe(0)
  })

  it('rejects schema type drift including numeric, null, object and Symbol fields without coercing', () => {
    for (const value of [0.25, null, undefined, {}, [], Symbol('weight')]) {
      expect(readSampleShippingWeight(productWeight(value, 'kg'))).toBe(0)
      expect(readSampleShippingWeight(productWeight('0.25', value))).toBe(0)
    }
  })
})

describe('visible sample shipping calculator', () => {
  it('calculates by a real button, selects a quoted route and immediately invalidates it when input changes', async () => {
    const wrapper = mount(ShippingQuotePanel, { props: { country: '美国', weightKg: 0.25 } })
    expect(wrapper.find('[name="quoteLength"]').element).toHaveProperty('value', '0')
    expect(wrapper.findAll('[data-quote-carrier]')).toHaveLength(0)
    await wrapper.get('[data-action="calculate-shipping"]').trigger('click')
    expect(wrapper.emitted('quoted')?.at(-1)?.[0]).toHaveLength(3)
    expect(wrapper.get('[data-testid="shipping-quotes"]').text()).toContain('UPS 报价需要完整的长、宽、高')
    expect(wrapper.get('[data-testid="shipping-quotes"]').text()).toContain('最低可用样例价')
    await wrapper.get('[data-quote-carrier="E 邮宝"]').trigger('click')
    expect(wrapper.emitted('selected')?.at(-1)).toEqual(['E 邮宝'])
    expect(wrapper.get('[data-quote-carrier="E 邮宝"]').attributes('aria-pressed')).toBe('true')
    await wrapper.get('[name="quoteWeight"]').setValue('2.5')
    expect(wrapper.emitted('quoted')?.at(-1)).toEqual([[]])
    expect(wrapper.findAll('[data-quote-carrier]')).toHaveLength(0)
    wrapper.unmount()
  })

  it('makes incomplete sizes a visible error, then exposes UPS dimensional billing after valid input', async () => {
    const wrapper = mount(ShippingQuotePanel, { props: { country: '美国', weightKg: 0.25 } })
    await wrapper.get('[name="quoteLength"]').setValue('30')
    await wrapper.get('[data-action="calculate-shipping"]').trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toContain('请填写完整的长、宽、高')
    expect(wrapper.emitted('quoted')?.at(-1)).toEqual([[]])
    await wrapper.get('[name="quoteWidth"]').setValue('25')
    await wrapper.get('[name="quoteHeight"]').setValue('20')
    await wrapper.get('[data-action="calculate-shipping"]').trigger('click')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="shipping-quotes"]').text()).toContain('UPS 体积重 3 kg')
    expect(wrapper.get('[data-testid="shipping-quotes"]').text()).toContain('¥195.00')
    wrapper.unmount()
  })

  it('shows all unavailable reasons and clears previously computed rows on parent context changes', async () => {
    const wrapper = mount(ShippingQuotePanel, { props: { country: '美国', weightKg: 2.5, dimensions: smallDimensions } })
    await wrapper.get('[data-action="calculate-shipping"]').trigger('click')
    expect(wrapper.get('[data-testid="shipping-quotes"]').text()).toContain('超过 2kg 限重')
    expect(wrapper.findAll('[data-quote-carrier]')).toHaveLength(1)
    await wrapper.setProps({ country: '德国' })
    expect(wrapper.emitted('quoted')?.at(-1)).toEqual([[]])
    expect(wrapper.findAll('[data-quote-carrier]')).toHaveLength(0)
    await wrapper.get('[data-action="calculate-shipping"]').trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toContain('不会继续发货')
    expect(wrapper.get('[data-testid="shipping-quotes"]').text()).toContain('该目的国没有虚构样例费率')
    wrapper.unmount()
  })

  it('labels multi-item estimates without silently multiplying the product weight or claiming whole-order freight', async () => {
    const wrapper = mount(ShippingQuotePanel, { props: { country: '美国', weightKg: 0.25, dimensions: smallDimensions, quantity: 2 } })
    expect(wrapper.text()).toContain('本订单含 2 件商品')
    expect(wrapper.text()).toContain('不代表整笔订单的实际运费')
    expect(wrapper.text()).not.toContain('旧脚本')
    await wrapper.get('[data-action="calculate-shipping"]').trigger('click')
    expect((wrapper.emitted('quoted')?.at(-1)?.[0] as { weightKg: number }[]).every(quote => quote.weightKg === 0.25)).toBe(true)
    wrapper.unmount()
  })
})

describe('fictional offline carrier comparison', () => {
  it('compares all eligible carriers and chooses E 邮宝 rather than a hardcoded 中邮', () => {
    const quotes = quoteSampleShipping('美国', 0.25, smallDimensions)
    expect(quotes.map(quote => quote.carrier)).toEqual(['E 邮宝', '燕文', '中邮', 'UPS'])
    expect(quotes.map(quote => quote.totalCny)).toEqual([18, 22, 27, 85])
    expect(quotes[0]).toMatchObject({ carrier: 'E 邮宝', country: '美国', currency: 'CNY', weightKg: 0.25,
      billableWeightKg: 0.25, fixedCny: 8, perKgCny: 40, totalCny: 18, fictional: true })
  })

  it('normalizes only the supported fictional destinations and has no fallback for unreachable countries', () => {
    for (const country of ['美国', 'US', 'usa', ' United States ', 'United States of America']) {
      expect(quoteSampleShipping(country, 0.25)[0]?.country).toBe('美国')
    }
    for (const country of ['英国', 'UK', 'GB', 'United Kingdom']) {
      expect(quoteSampleShipping(country, 0.25)[0]?.country).toBe('英国')
    }
    for (const country of ['', ' ', 'Mars', '德国']) expect(quoteSampleShipping(country, 0.25)).toEqual([])
  })

  it('returns no route for missing, nonpositive, nonfinite or incorrectly typed weights', () => {
    for (const weight of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(quoteSampleShipping('美国', weight)).toEqual([])
    }
    for (const weight of [undefined, null, '0.25', {}, Symbol('weight')]) {
      expect(quoteSampleShipping('美国', weight as number)).toEqual([])
    }
    for (const country of [undefined, null, 123, {}, Symbol('country')]) {
      expect(quoteSampleShipping(country as string, 0.25)).toEqual([])
    }
  })

  it('enforces 2kg small-parcel and 20kg UPS limits, billing UPS in upward integer kg', () => {
    expect(quoteSampleShipping('美国', 2, smallDimensions)).toHaveLength(4)
    expect(quoteSampleShipping('美国', 2.01, smallDimensions).map(quote => quote.carrier)).toEqual(['UPS'])
    expect(quoteSampleShipping('美国', 2.5, smallDimensions)[0]).toMatchObject({ carrier: 'UPS', billableWeightKg: 3, totalCny: 195 })
    expect(quoteSampleShipping('美国', 20, smallDimensions)[0]).toMatchObject({ carrier: 'UPS', billableWeightKg: 20, totalCny: 1130 })
    expect(quoteSampleShipping('美国', 20.01, smallDimensions)).toEqual([])
    expect(quoteSampleShipping('英国', 25, smallDimensions)).toEqual([])
  })

  it('keeps rate and quote schemas explicitly fictional with finite positive CNY totals', () => {
    expect(Object.isFrozen(SAMPLE_CARRIER_RATES)).toBe(true)
    SAMPLE_CARRIER_RATES.forEach(rate => {
      expect(Object.isFrozen(rate)).toBe(true)
      expect(typeof rate.carrier).toBe('string')
      expect(rate.fictional).toBe(true)
      expect(rate.currency).toBe('CNY')
      expect(typeof rate.wholeKg).toBe('boolean')
      expect(typeof rate.maxWeightKg).toBe('number')
    })
    const first = quoteSampleShipping('美国', 0.333)
    first.forEach(quote => {
      expect(quote.currency).toBe('CNY')
      expect(quote.fictional).toBe(true)
      expect(quote.rateVersion).toBe(SAMPLE_SHIPPING_RATE_VERSION)
      expect(typeof quote.totalCny).toBe('number')
      expect(Number.isFinite(quote.totalCny)).toBe(true)
      expect(quote.totalCny).toBeGreaterThan(0)
      expect(Math.round(quote.totalCny * 100) / 100).toBe(quote.totalCny)
    })
    first[0]!.totalCny = 0
    expect(quoteSampleShipping('美国', 0.333)[0]!.totalCny).toBeGreaterThan(0)
  })

  it('treats three zero dimensions as explicitly unprovided rather than inventing package size', () => {
    const dimensions = { lengthCm: 0, widthCm: 0, heightCm: 0 }
    expect(quoteSampleShipping('美国', 0.25, dimensions)).toEqual(quoteSampleShipping('美国', 0.25))
    expect(evaluateSampleShipping('美国', 0.25, dimensions).dimensionalWeightKg).toBe(0)
    expect(evaluateSampleShipping('美国', 0.25, dimensions).candidates.find(candidate => candidate.carrier === 'UPS')?.unavailableReason).toContain('UPS 报价需要完整的长、宽、高')
    expect(quoteSampleShipping('美国', 2.5)).toEqual([])
  })

  it('uses volumetric weight only for the fictional UPS rule and shows each price component', () => {
    const quotes = quoteSampleShipping('美国', 0.25, { lengthCm: 30, widthCm: 25, heightCm: 20 })
    expect(quotes.slice(0, 3).map(quote => quote.billableWeightKg)).toEqual([0.25, 0.25, 0.25])
    expect(quotes.find(quote => quote.carrier === 'UPS')).toMatchObject({ weightKg: 0.25, dimensionalWeightKg: 3,
      billableWeightKg: 3, fixedCny: 0, perKgCny: 0, weightChargeCny: 195, surchargeCny: 0, totalCny: 195, rateVersion: 'sample-v1', billingMode: 'ups' })
    expect(quoteSampleShipping('美国', 3, { lengthCm: 10, widthCm: 10, heightCm: 10 })[0]).toMatchObject({
      carrier: 'UPS', billableWeightKg: 3, weightChargeCny: 195, totalCny: 195,
    })
  })

  it('explains small parcel and dimensional-weight exclusions instead of hiding unavailable carriers', () => {
    const overParcel = evaluateSampleShipping('美国', 2.5, smallDimensions)
    expect(overParcel.quotes.map(quote => quote.carrier)).toEqual(['UPS'])
    expect(overParcel.candidates.filter(candidate => !candidate.quote)).toHaveLength(3)
    expect(overParcel.candidates.filter(candidate => !candidate.quote).every(candidate => candidate.unavailableReason.includes('2kg'))).toBe(true)
    const largeBox = evaluateSampleShipping('美国', 0.25, { lengthCm: 100, widthCm: 100, heightCm: 100 })
    expect(largeBox.quotes.map(quote => quote.carrier)).toEqual(['E 邮宝', '燕文', '中邮'])
    expect(largeBox.candidates.find(candidate => candidate.carrier === 'UPS')).toMatchObject({
      unavailableReason: '计费重量超过 20kg 限重',
    })
    expect(evaluateSampleShipping('德国', 0.25).candidates.every(candidate => candidate.unavailableReason.includes('目的国'))).toBe(true)
    expect(evaluateSampleShipping('美国', 0).candidates.every(candidate => candidate.unavailableReason.includes('Shipping Weight'))).toBe(true)
  })

  it('rejects incomplete dimensions with an explicit error rather than returning a zero volume or a price', () => {
    for (const dimensions of [
      { lengthCm: 10, widthCm: 0, heightCm: 0 }, { lengthCm: 10, widthCm: 10, heightCm: 0 },
      { lengthCm: 0, widthCm: 10, heightCm: 10 }, { lengthCm: 10, widthCm: 0, heightCm: 10 },
    ]) expect(() => quoteSampleShipping('美国', 0.25, dimensions)).toThrow('请填写完整的长、宽、高')
  })

  it('rejects malformed, negative, nonfinite or overflowing dimensions without unsafe coercion', () => {
    for (const dimensions of [
      null, {}, Symbol('dimensions'), { lengthCm: '10', widthCm: 10, heightCm: 10 },
      { lengthCm: Symbol('length'), widthCm: 10, heightCm: 10 },
      { lengthCm: -1, widthCm: 10, heightCm: 10 }, { lengthCm: Number.NaN, widthCm: 10, heightCm: 10 },
      { lengthCm: Number.POSITIVE_INFINITY, widthCm: 10, heightCm: 10 },
      { lengthCm: Number.MAX_VALUE, widthCm: 10, heightCm: 10 },
    ]) expect(() => quoteSampleShipping('美国', 0.25, dimensions as unknown as SampleShippingDimensions)).toThrow(RangeError)
  })

  it('uses the shared engine rather than duplicating its rounding, tier, minimum weight or volumetric rules', () => {
    for (const country of ['美国', '英国']) {
      for (const weightKg of [0.001, 0.15, 0.150001, 0.25, 0.3, 0.300001, 2, 2.01, 2.5, 20, 20.01]) {
        for (const dimensions of [undefined, smallDimensions, { lengthCm: 30, widthCm: 25, heightCm: 20 }]) {
          const core = quoteFreight(SAMPLE_RATE_PACK, { country, actualWeightKg: weightKg,
            dimensionsCm: dimensions ? { length: dimensions.lengthCm, width: dimensions.widthCm, height: dimensions.heightCm } : undefined })
          const adapted = quoteSampleShipping(country, weightKg, dimensions)
          expect(adapted.map(quote => ({ carrier: quote.carrier, billable: quote.billableWeightKg, total: quote.totalCny })))
            .toEqual(core.candidates.filter(candidate => candidate.eligible).map(candidate => ({ carrier: candidate.carrierName, billable: candidate.billableWeightKg, total: candidate.totalCny })))
        }
      }
    }
  })

  it('exposes E 邮宝 minimum billed weight, tier prices and UPS fuel exclusion from the shared engine', () => {
    expect(quoteSampleShipping('美国', 0.001).find(quote => quote.carrier === 'E 邮宝')).toMatchObject({
      weightKg: 0.001, billableWeightKg: 0.01, weightChargeCny: 0.4, fixedCny: 8, totalCny: 8.4,
    })
    expect(quoteSampleShipping('美国', 0.15).find(quote => quote.carrier === '中邮')?.perKgCny).toBe(70)
    expect(quoteSampleShipping('美国', 0.150001).find(quote => quote.carrier === '中邮')?.perKgCny).toBe(60)
    expect(quoteSampleShipping('美国', 0.300001).find(quote => quote.carrier === '中邮')?.perKgCny).toBe(55)
    expect(quoteSampleShipping('美国', 0.25, smallDimensions).find(quote => quote.carrier === 'UPS')?.warnings).toContain('当前费率不含燃油附加费')
  })

  it('makes missing or invalid epacket/tier prices unavailable instead of using numeric coercion or zero fares', () => {
    for (const badPrice of [undefined, null, '', '40', Number.NaN, Number.POSITIVE_INFINITY, Symbol('rate'), 0]) {
      const pack = copyPack()
      const rule = pack.rules.find(item => item.countryCode === 'US' && item.serviceType === 'epacket')!
      ;(rule as unknown as Record<string, unknown>).perKgCny = badPrice
      const result = evaluateSampleShipping('美国', 0.25, smallDimensions, pack)
      expect(result.quotes.some(quote => quote.carrier === 'E 邮宝')).toBe(false)
      expect(result.candidates.find(item => item.carrier === 'E 邮宝')?.unavailableReason).toContain('费率缺少合法')
      expect(result.quotes.every(quote => Number.isFinite(quote.totalCny) && quote.totalCny > 0)).toBe(true)
    }
    for (const field of ['maxWeightG', 'perKgCny', 'fixedFeeCny']) {
      const pack = copyPack()
      const rule = pack.rules.find(item => item.countryCode === 'US' && item.carrierName === '中邮')!
      delete (rule.tiers![1] as unknown as Record<string, unknown>)[field]
      expect(evaluateSampleShipping('美国', 0.25, smallDimensions, pack).quotes.some(quote => quote.carrier === '中邮')).toBe(false)
    }
  })

  it('requires a finite complete UPS fixed-price table, divisor and fee fields before invoking the engine', () => {
    for (const badValue of [undefined, null, '', '5000', Number.NaN, Number.POSITIVE_INFINITY, Symbol('divisor'), 0, 6000]) {
      const pack = copyPack()
      const rule = pack.rules.find(item => item.countryCode === 'US' && item.serviceType === 'ups')!
      ;(rule as unknown as Record<string, unknown>).volumetricDivisor = badValue
      expect(evaluateSampleShipping('美国', 0.25, smallDimensions, pack).quotes.some(quote => quote.carrier === 'UPS')).toBe(false)
    }
    for (const badPrices of [[], new Array(20), Array(20).fill(0), Array(20).fill('85'), Array(20).fill(Number.NaN)]) {
      const pack = copyPack()
      const rule = pack.rules.find(item => item.countryCode === 'US' && item.serviceType === 'ups')!
      ;(rule as unknown as Record<string, unknown>).fixedPricesCny = badPrices
      expect(evaluateSampleShipping('美国', 0.25, smallDimensions, pack).quotes.some(quote => quote.carrier === 'UPS')).toBe(false)
    }
    const pack = copyPack()
    delete pack.rules.find(item => item.carrierName === 'E 邮宝')!.percentageSurcharge
    expect(evaluateSampleShipping('美国', 0.25, smallDimensions, pack).quotes.some(quote => quote.carrier === 'E 邮宝')).toBe(false)
  })

  it('rejects malformed required pack fields and keeps the fictitious source immutable', () => {
    expect(Object.isFrozen(SAMPLE_RATE_PACK)).toBe(true)
    expect(Object.isFrozen(SAMPLE_RATE_PACK.rules[0]!.tiers)).toBe(true)
    for (const badValue of [undefined, null, '', '7.2', Number.NaN, Number.POSITIVE_INFINITY, Symbol('exchange'), 0]) {
      const pack = copyPack()
      ;(pack as unknown as Record<string, unknown>).exchangeRateCnyPerUsd = badValue
      expect(() => quoteSampleShipping('美国', 0.25, smallDimensions, pack)).toThrow('虚构样例费率包')
    }
    for (const field of ['name', 'sourceHash', 'version', 'createdAt']) {
      const pack = copyPack()
      delete (pack as unknown as Record<string, unknown>)[field]
      expect(() => quoteSampleShipping('美国', 0.25, smallDimensions, pack)).toThrow('虚构样例费率包')
    }
  })
})
