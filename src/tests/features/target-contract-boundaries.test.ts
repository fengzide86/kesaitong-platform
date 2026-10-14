import { describe, expect, it } from 'vitest'
import { TARGET_PROFILE_LIMITS, targetOpenRequestSchema, targetProfileSchema, targetRouteSchema, templateCreateInputSchema } from '@/shared/ipc/target-contract'
import { targetProfile } from './target-fixtures'

describe('target profile shared boundary contract', () => {
  const template = { name: '中文 模板', currency: 'USD', pricingMode: 'weight-item', rules: [{ countries: ['Canada'], serviceCode: '20001', transitTime: '10 - 20', perOrder: '0', unitRate: '0', unit: 'lb' }] }
  it.each(['\n', '\r', '\t', '\u0000', '\u007F', '\u2028', '\u2029'])('rejects control character %j before input can imply a submission', character => {
    expect(templateCreateInputSchema.safeParse({ ...template, name: `模板${character}名称` }).success).toBe(false)
    expect(templateCreateInputSchema.safeParse({ ...template, name: `模板${character}` }).success).toBe(false)
  })
  it('preserves Chinese names and ordinary spaces', () => {
    expect(templateCreateInputSchema.parse(template).name).toBe('中文 模板')
  })
  it('has one explicit UI/IPC limit map matching backend persisted fields', () => {
    expect(TARGET_PROFILE_LIMITS).toEqual({ name: 100, entryUrl: 2048, routeOrigin: 300, routePathPrefix: 300, rawOpenUrl: 8192 })
  })
  it.each([100, 101])('profile name length %s has the same boundary as registration', length => {
    expect(targetProfileSchema.safeParse({ ...targetProfile().profile, name: 'a'.repeat(length) }).success).toBe(length === 100)
  })
  it.each([2048, 2049])('persisted clean URL length %s', length => {
    const base = 'https://school.example/'
    expect(targetProfileSchema.safeParse({ ...targetProfile().profile, entryUrl: base + 'a'.repeat(length - base.length) }).success).toBe(length === 2048)
  })
  it.each([300, 301])('route prefix length %s', length => {
    expect(targetRouteSchema.safeParse({ origin: 'https://school.example', pathPrefix: '/' + 'a'.repeat(length - 1), role: 'business' }).success).toBe(length === 300)
  })
  it.each([300, 301])('route origin length %s', length => {
    const base = 'https://'
    const host = ('a'.repeat(40) + '.').repeat(6)
    const origin = base + host + 'a'.repeat(length - base.length - host.length - 4) + '.com'
    expect(targetRouteSchema.safeParse({ origin, pathPrefix: '/entry', role: 'entry' }).success).toBe(length === 300)
  })
  it('long local query fits raw paste limit without increasing clean entry limit', () => {
    const base = 'https://school.example/entry?paras='
    const entryUrl = base + 'a'.repeat(8192 - base.length)
    expect(targetOpenRequestSchema.parse({ entryUrl }).entryUrl).toBe(entryUrl)
    expect(targetOpenRequestSchema.safeParse({ entryUrl: entryUrl + 'a' }).success).toBe(false)
    expect(targetOpenRequestSchema.safeParse({ entryUrl: 'https://school.example/' + 'a'.repeat(2048) + '?paras=short' }).success).toBe(false)
  })
})
