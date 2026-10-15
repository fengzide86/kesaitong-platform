import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadCommercialPlans } from '@/features/user/commercialCatalog'

const { get } = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/utils/api', () => ({ api: { get } }))
const item = {
  sku: 'competition-full', version: 2, name: '比赛完整包', price: '199.00', business_line: 'competition', term_type: 'project_end',
  description: '已启用的真实目录说明', availability: 'consult',
  allowed_capabilities: ['company.register', 'product.create', 'template.create', 'ad_script', 'flash_sale', 'coupon', 'fba_agl', 'ship_script', 'freight.quote'],
  services: [],
}
const catalog = (items: unknown[]) => ({ schema_version: 1, catalog_version: 'public-v1', items })

describe('用户公开商业目录适配', () => {
  beforeEach(() => { get.mockReset() })

  it('保留已发布元数据和实际价格，仅完整比赛包作为推荐', async () => {
    get.mockResolvedValue(catalog([item, { ...item, sku: 'competition-guided', price: '599.00' }]))
    const plans = await loadCommercialPlans()
    expect(plans[0]).toMatchObject({ id: 'offer:competition-full:2', business_line: 'competition', price: '199.00', is_recommended: true })
    expect(plans[0]?.benefits).toContain('公司注册、上品、物流模板')
    expect(plans[0]?.benefits).toContain('广告、秒杀、优惠券')
    expect(plans[0]?.benefits).toContain('FBA 配送、订单发货')
    expect(plans[1]?.is_recommended).toBe(false)
    expect(get).toHaveBeenCalledWith('/api/commercial/catalog', {}, { cache: false })
  })

  it('免费三项分别列出，计算只跟随实际权益，不推断未开放功能', async () => {
    get.mockResolvedValue(catalog([{ ...item, sku: 'free-trial', price: '0', business_line: 'trial', allowed_capabilities: ['company.register', 'product.create', 'template.create', 'freight.quote'] }]))
    const [plan] = await loadCommercialPlans()
    expect(plan?.benefits).toEqual(['赛训平台内公司注册 1 次', '上品 1 个商品', '物流模板体验 1 次', '运费计算'])
    expect(plan?.benefits?.join()).not.toContain('广告')
  })

  it('服务次数和时长来自目录；79保留完整资料语义', async () => {
    get.mockResolvedValue(catalog([{ ...item, sku: 'service-materials-full', price: '79', business_line: 'service', term_type: 'service_fulfillment', allowed_capabilities: [],
      services: [{ code: 'materials-full', count: 1, minutes_per_unit: 0 }, { code: 'appointment', count: 3, minutes_per_unit: 30 }] }]))
    const [plan] = await loadCommercialPlans()
    expect(plan?.benefits).toEqual(['完整资料 1 套', '预约答疑 3 次，每次 30 分钟'])
    expect(plan?.duration_label).toBe('按约定服务次数与时长履约')
    expect(plan?.business_line).toBe('service')
  })

  it('空目录不合成默认套餐，缺失或额外内部字段严格拒绝', async () => {
    get.mockResolvedValue(catalog([]))
    expect(await loadCommercialPlans()).toEqual([])
    get.mockResolvedValue(catalog([{ ...item, internal_cost: 'private-data' }]))
    await expect(loadCommercialPlans()).rejects.toThrow()
    get.mockResolvedValue(catalog([{ ...item, allowed_capabilities: undefined }]))
    await expect(loadCommercialPlans()).rejects.toThrow()
    get.mockResolvedValue(catalog([{ ...item, price: 'NaN' }]))
    await expect(loadCommercialPlans()).rejects.toThrow()
  })
})
