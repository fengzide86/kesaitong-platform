import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const requireCompiled = createRequire(resolve('package.json'))
const { validateDeclarativeAdapter } = requireCompiled('./dist-electron/electron/automation/adapter-loader.cjs') as {
  validateDeclarativeAdapter(value: unknown, manifest: unknown): { allowedHosts: string[] }
}
const { resolveScript } = requireCompiled('./dist-electron/electron/automation/scripts/registry.cjs') as {
  resolveScript(key: string): { allowedHosts: string[] }
}
const manifest = { scriptKey: 'amazon.test.v2', version: '2.0.0' }
function adapter(hosts: string[]) {
  const read = { id: 'read', kind: 'assertText', title: '读取同对象结果', selectors: [{ strategy: 'text', value: '已保存' }] }
  return { key: manifest.scriptKey, version: manifest.version, name: '本机契约验收', description: '仅验证目标策略，不运行平台操作',
    mode: 'workflow', capabilityKey: 'listing_script', inputSchema: [], defaultInput: {}, allowedHosts: hosts,
    steps: [{ id: 'read', title: '读取', detail: '只读契约', action: '读取', actions: [read] }], successChecks: [read] }
}

describe('audited Amazon V2 adapter target declarations', () => {
  it('accepts the exact audited V2 hostname without broadening to all vendor domains', () => {
    expect(validateDeclarativeAdapter(adapter(['www.bjysoft.cn']), manifest).allowedHosts).toEqual(['www.bjysoft.cn'])
  })
  it.each(['bjysoft.cn', 'evil.www.bjysoft.cn', 'www.bjysoft.cn.evil.test', '*.bjysoft.cn', 'sellercentral.amazon.com', 'example.com'])('rejects unaudited target %s', host => {
    expect(() => validateDeclarativeAdapter(adapter([host]), manifest)).toThrowError(expect.objectContaining({ code: 'ADAPTER_HOST_BLOCKED' }))
  })
  it('keeps historical simulated and loopback declarations compatible', () => {
    expect(validateDeclarativeAdapter(adapter(['idtrade.cn', 'localhost', '127.0.0.1']), manifest).allowedHosts).toEqual(['idtrade.cn', 'localhost', '127.0.0.1'])
  })
  it('built-in simulated adapters declare the same audited V2 hostname', () => {
    expect(resolveScript('amazon.listing_script.v1').allowedHosts).toContain('www.bjysoft.cn')
  })
})
