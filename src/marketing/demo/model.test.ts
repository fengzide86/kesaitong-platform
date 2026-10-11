import { describe, expect, it } from 'vitest'
import { seedSimulation, newProduct, saveProduct, saveTemplate, convertFba, saveCampaign, warehouseAction, confirmShipment, readSimulation, SIMULATION_STORAGE_KEY } from './model'

describe('public simulation domain boundaries', () => {
  it('rejects required fields and duplicate SKU, then persists a real sample edit', () => {
    const state = seedSimulation(), product = newProduct()
    expect(saveProduct(state, product, 'new')).toContain('商品名称')
    Object.assign(product, { title: '样例新商品', brand: 'Sample', sku: 'SAMPLE-NEW', variant: '蓝色 / M', price: 20, quantity: 3, weight: .2 })
    expect(saveProduct(state, product, 'new')).toBe('')
    expect(state.products[1]).toMatchObject({ id: 'new', published: true, sku: 'SAMPLE-NEW' })
    expect(saveProduct(state, product, 'duplicate')).toContain('已存在')
    expect(state.products).toHaveLength(2)
    const saved = { ...state.products[1]!, title: '修改后' }
    expect(saveProduct(state, saved, 'unused')).toBe('')
    expect(state.products[1]!.title).toBe('修改后')
    expect(state.products).toHaveLength(2)
  })
  it('rejects invalid numeric fields rather than allowing a fake successful save', () => {
    const state = seedSimulation()
    expect(saveProduct(state, { ...state.products[0]!, price: NaN }, 'unused')).toContain('价格')
    expect(saveTemplate(state, { ...state.templates[0]!, handling: .5 }, 'unused')).toContain('整数')
    expect(saveTemplate(state, { ...state.templates[0]!, id: '', limit: -1 }, 'new')).toContain('限重')
    expect(state.templates).toHaveLength(1)
  })
  it('requires dangerous goods confirmation and separates FBA conversion from advertising', () => {
    const state = seedSimulation()
    expect(convertFba(state, 'sample-product', false, false)).toContain('确认')
    expect(convertFba(state, 'sample-product', true, true)).toContain('含电池')
    const campaign = { id: '', name: '样例推广', productId: 'sample-product', budget: 10, bid: .5, start: '2026-10-01', end: '2026-11-01', targeting: '自动投放', status: '投放中' as const }
    expect(saveCampaign(state, campaign, 'campaign')).toContain('亚马逊配送')
    expect(convertFba(state, 'sample-product', true, false)).toBe('')
    expect(state.products[0]!.delivery).toBe('FBA')
    expect(saveCampaign(state, campaign, 'campaign')).toBe('')
    expect(state.campaigns[0]!.productId).toBe(state.products[0]!.id)
    expect(convertFba(state, 'sample-product', true, false)).toContain('已经')
    expect(saveCampaign(state, campaign, 'duplicate')).toContain('已存在')
  })
  it('confirms shipment only after warehouse sequence and exact same-order readback', () => {
    const state = seedSimulation(), order = state.orders[0]!
    expect(confirmShipment(state, order.id, '中邮', 'fake')).toContain('先在国内仓库')
    expect(warehouseAction(state, order.id, 'dispatch', '中邮')).toContain('当前仓库状态')
    expect(warehouseAction(state, order.id, 'pick')).toBe('')
    expect(warehouseAction(state, order.id, 'pack')).toBe('')
    expect(warehouseAction(state, order.id, 'dispatch')).toContain('承运人')
    expect(warehouseAction(state, order.id, 'dispatch', '中邮')).toBe('')
    expect(order.status).toBe('未发货')
    expect(confirmShipment(state, order.id, 'UPS', order.tracking)).toContain('一致')
    expect(confirmShipment(state, order.id, '中邮', order.tracking)).toBe('')
    expect(order.status).toBe('已发货')
    expect(confirmShipment(state, order.id, '中邮', order.tracking)).toContain('不能重复')
  })
  it('uses its namespaced storage only, restores edits, handles blocked and malformed storage', () => {
    const state = seedSimulation(); state.products[0]!.title = '浏览器保存样例'
    const calls: string[] = []
    const restored = readSimulation({ getItem: key => { calls.push(key); return JSON.stringify(state) } })
    expect(calls).toEqual([SIMULATION_STORAGE_KEY])
    expect(restored.state.products[0]!.title).toBe('浏览器保存样例')
    expect(restored.temporary).toBe(false)
    expect(readSimulation({ getItem: () => { throw new Error('Blocked') } }).temporary).toBe(true)
    expect(readSimulation({ getItem: () => '{oops' }).temporary).toBe(true)
    expect(readSimulation({ getItem: () => JSON.stringify({ version: 1, products: [{}], templates: [], campaigns: [], orders: [] }) }).state.products[0]!.id).toBe('sample-product')
  })
})
