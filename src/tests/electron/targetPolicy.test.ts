import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { assertAllowedTarget } = require(resolve('dist-electron/electron/automation/target-policy.cjs')) as {
  assertAllowedTarget: (url: string, hosts: string[]) => void
}
const hosts = ['www.bjysoft.cn', 'idtrade.cn', 'localhost', '127.0.0.1']

describe('audited V2 origin policy', () => {
  it.each([
    'http://www.bjysoft.cn:8730/User/Welcome6',
    'http://www.bjysoft.cn:8732/ECrossAmazon/SellerIndex',
    'https://www.bjysoft.cn:8732/ECrossAmazon/SellerIndex',
    'https://school.idtrade.cn/course',
    'http://localhost:41000/fixture',
    'http://127.0.0.1:41000/fixture',
  ])('allows only an audited origin or existing compatibility target: %s', url => {
    expect(() => assertAllowedTarget(url, hosts)).not.toThrow()
  })

  it.each([
    'http://www.bjysoft.cn/ECrossAmazon/SellerIndex',
    'https://www.bjysoft.cn:443/ECrossAmazon/SellerIndex',
    'http://www.bjysoft.cn:9999/ECrossAmazon/SellerIndex',
    'http://bjysoft.cn:8732/ECrossAmazon/SellerIndex',
    'http://school.www.bjysoft.cn:8732/ECrossAmazon/SellerIndex',
    'http://www.bjysoft.cn.evil.test:8732/ECrossAmazon/SellerIndex',
    'https://sellercentral.amazon.com/inventory',
  ])('rejects wrong ports, sibling/subdomains and live commerce: %s', url => {
    expect(() => assertAllowedTarget(url, hosts)).toThrow()
  })

  it('requires the adapter to explicitly opt into the audited V2 host', () => {
    expect(() => assertAllowedTarget('http://www.bjysoft.cn:8732/', ['idtrade.cn'])).toThrow()
  })
})
