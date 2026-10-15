import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import PlansView from '@/views/user/PlansView.vue'
import type { CommercialPlan } from '@/features/user/commercialCatalog'

const mocks = vi.hoisted(() => ({
  getPlans: vi.fn(),
  loadCommercialPlans: vi.fn(),
  getPublicSettings: vi.fn(),
  push: vi.fn(),
  showToast: vi.fn(),
  route: { query: {} },
}))

vi.mock('@/utils/api', () => ({ getPlans: mocks.getPlans, getPublicSettings: mocks.getPublicSettings }))
vi.mock('@/features/user/commercialCatalog', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/user/commercialCatalog')>(), loadCommercialPlans: mocks.loadCommercialPlans,
}))
vi.mock('@/utils', () => ({ showToast: mocks.showToast }))
vi.mock('vue-router', () => ({ useRoute: () => mocks.route, useRouter: () => ({ push: mocks.push }) }))

const mountPlans = () => mount(PlansView, { global: { plugins: [createPinia()] } })
function offer(sku: string, business_line: CommercialPlan['business_line'], price: string, extra: Partial<CommercialPlan> = {}): CommercialPlan {
  return { id: `offer:${sku}:1`, name: sku, plan_code: sku, business_line, price, status: 'active', duration_days: 0,
    duration_label: '约定项目全程 · 以授权结束时间为准', description: '先确认项目、平台与开放范围',
    availability: 'consult', services: [], allowed_capabilities: [], benefits: [], ...extra }
}

describe('PlansView 套餐与授权', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.route.query = {}
    mocks.getPlans.mockResolvedValue([])
    mocks.loadCommercialPlans.mockResolvedValue([])
    mocks.getPublicSettings.mockResolvedValue([{ key: 'wechat_id', value: 'KST-official-test' }])
    localStorage.setItem('toolbox_user', JSON.stringify({ plan_name: 'Y15 体验包', plan_code: 'Y15' }))
  })

  it('显示套餐页面和当前授权，不暴露授权码前缀', async () => {
    const wrapper = mountPlans()
    await flushPromises()

    expect(wrapper.find('.page-header-v6 h2').text()).toBe('套餐与授权')
    expect(wrapper.text()).toContain('Y15 体验包')
    expect(wrapper.text()).not.toContain('授权码前缀')
  })

  it('套餐为空时显示空状态', async () => {
    const wrapper = mountPlans()
    await flushPromises()
    expect(wrapper.find('.empty-state').text()).toContain('暂无套餐信息')
  })

  it('已人工启用的新版目录优先显示，旧授权名称保持原样', async () => {
    mocks.loadCommercialPlans.mockResolvedValue([offer('competition-guided', 'competition', '599', { name: '比赛工具与指导包', benefits: ['预约答疑 3 次，每次 30 分钟'] })])
    const wrapper = mountPlans()
    await flushPromises()
    expect(wrapper.text()).toContain('599')
    expect(wrapper.text()).toContain('预约答疑 3 次')
    expect(wrapper.text()).toContain('Y15 体验包')
    expect(mocks.getPlans).not.toHaveBeenCalled()
  })

  it('只展示启用套餐并标出当前、主推和全程服务套餐', async () => {
    mocks.getPlans.mockResolvedValue([
      { id: 1, name: 'Y15 体验包', plan_code: 'Y15', price: 15, duration_days: 3, status: 'active', benefits: ['体验工具'] },
      { id: 2, name: 'Y199 冲刺包', plan_code: 'Y199', price: 199, duration_days: 30, duration_label: '一个赛期', status: 'active', is_recommended: true, display_badge: '赛期主推', benefits: ['完整工具'] },
      { id: 3, name: 'Y999 陪跑包', plan_code: 'Y999', price: 999, duration_days: 90, status: 'active', display_badge: '全程服务', benefits: ['全程陪跑'] },
      { id: 4, name: '停用套餐', plan_code: 'Y0', price: 0, duration_days: 1, status: 'inactive' },
    ])
    const wrapper = mountPlans()
    await flushPromises()

    expect(wrapper.findAll('.plan-card')).toHaveLength(3)
    expect(wrapper.find('.plan-card.current').text()).toContain('当前使用')
    expect(wrapper.find('.plan-card.featured').text()).toContain('赛期主推')
    expect(wrapper.find('.plan-card.anchor').text()).toContain('全程服务')
  })

  it('优先展示后端整理好的权益列表，并兼容旧 features 文本', async () => {
    mocks.getPlans.mockResolvedValue([
      { id: 1, name: 'Y15 体验包', plan_code: 'Y15', price: 15, duration_days: 3, status: 'active', benefits: ['权益 A', '权益 B'] },
      { id: 2, name: 'Y199 冲刺包', plan_code: 'Y199', price: 199, duration_days: 30, status: 'active', features: '功能 1+功能 2' },
    ])
    const wrapper = mountPlans()
    await flushPromises()

    expect(wrapper.text()).toContain('权益 A')
    expect(wrapper.text()).toContain('权益 B')
    expect(wrapper.text()).toContain('功能 1')
    expect(wrapper.text()).toContain('功能 2')
  })

  it('从锁定工具进入时显示升级说明', async () => {
    mocks.route.query = { tool: 'listing' }
    const wrapper = mountPlans()
    await flushPromises()
    expect(wrapper.find('.upgrade-notice').exists()).toBe(true)
    expect(wrapper.text()).toContain('当前套餐暂未包含你选择的工具')
  })

  it('购买按钮读取官方配置并打开具体套餐咨询', async () => {
    mocks.getPlans.mockResolvedValue([
      { id: 2, name: 'Y199 冲刺包', plan_code: 'Y199', price: 199, duration_days: 30, status: 'active', benefits: ['完整工具'] },
    ])
    const wrapper = mountPlans()
    await flushPromises()
    await wrapper.find('.plan-card button').trigger('click')
    await flushPromises()
    expect(mocks.getPublicSettings).toHaveBeenCalled()
    const dialog = document.body.textContent || wrapper.text()
    expect(dialog).toContain('KST-official-test')
    expect(dialog).not.toContain('AmazonToolbox_Support')
    wrapper.unmount()
  })

  it('空权益标识不会从名称推断当前套餐，并保留展示名', async () => {
    localStorage.setItem('toolbox_user', JSON.stringify({ plan_name: 'Y199 自定义套餐', plan_code: null }))
    mocks.getPlans.mockResolvedValue([{ id: 1, name: 'Y199 冲刺包', plan_code: 'Y199', status: 'active' }])
    const wrapper = mountPlans()
    await flushPromises()
    expect(wrapper.find('.current-plan').text()).toContain('Y199 自定义套餐')
    expect(wrapper.find('.plan-card.current').exists()).toBe(false)
  })

  it('保持确认的套餐内容和主次：免费区及49/199/599，只有199推荐且咨询按钮在权益之前', async () => {
    mocks.loadCommercialPlans.mockResolvedValue([
      offer('competition-guided', 'competition', '599', { name: '比赛工具与指导包' }),
      offer('free-trial', 'trial', '0', { name: '免费体验', allowed_capabilities: ['company.register', 'product.create', 'template.create'], benefits: ['公司注册 1 次', '上品 1 个商品', '物流模板体验 1 次'] }),
      offer('competition-full', 'competition', '199', { name: '比赛完整包', benefits: ['广告、秒杀、优惠券'] }),
      offer('competition-basic', 'competition', '49', { name: '比赛基础包' }),
    ])
    const wrapper = mountPlans()
    await flushPromises()
    expect(wrapper.find('.pricing-free .pricing-price strong').text()).toBe('0')
    expect(wrapper.find('.pricing-free').text()).toContain('三项全部赠送')
    expect(wrapper.findAll('.pricing-cards article').map(node => node.attributes('data-plan'))).toEqual(['competition-basic', 'competition-full', 'competition-guided'])
    expect(wrapper.findAll('.is-recommended')).toHaveLength(1)
    const recommended = wrapper.find('.is-recommended')
    expect(recommended.find('.pricing-price strong').text()).toBe('199')
    expect(recommended.find('button').element.compareDocumentPosition(recommended.find('.pricing-features').element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(wrapper.findAll('.pricing-button-primary')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('月费')
    expect(mocks.getPlans).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('比赛实训切换支持键盘；仅开启实训时不会补出比赛或免费套餐', async () => {
    mocks.loadCommercialPlans.mockResolvedValue([
      offer('competition-full', 'competition', '199'), offer('training-full', 'training', '69', { name: '实训完整工具包' }),
    ])
    const wrapper = mountPlans()
    await flushPromises()
    await wrapper.find('#platform-pricing-tab-competition').trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.find('#platform-pricing-tab-training').attributes('aria-selected')).toBe('true')
    expect(wrapper.find('#platform-pricing-panel-competition').attributes()).toHaveProperty('hidden')
    expect(wrapper.find('#platform-pricing-panel-training').attributes()).not.toHaveProperty('hidden')
    expect(wrapper.find('#platform-pricing-panel-training').text()).toContain('69')
    wrapper.unmount()
    mocks.loadCommercialPlans.mockResolvedValue([offer('training-full', 'training', '69')])
    const partial = mountPlans()
    await flushPromises()
    expect(partial.findAll('[role="tab"]')).toHaveLength(1)
    expect(partial.find('#platform-pricing-tab-training').attributes('aria-selected')).toBe('true')
    expect(partial.find('.pricing-free').exists()).toBe(false)
    expect(partial.find('.pricing-cards').exists()).toBe(false)
    partial.unmount()
  })

  it('多个单工具仅作为套餐下方次级行，服务按真实次数展示且599已含额度不重复收费', async () => {
    mocks.loadCommercialPlans.mockResolvedValue([
      offer('competition-guided', 'competition', '599', { name: '比赛工具与指导包', services: [{ code: 'appointment', count: 3, minutes_per_unit: 30 }] }),
      offer('single-template', 'single_tool', '39', { name: '物流模板工具' }),
      offer('single-product', 'single_tool', '39', { name: '上品工具' }),
      offer('service-materials-full', 'service', '79', { name: '完整资料', services: [{ code: 'materials-full', count: 1, minutes_per_unit: 0 }] }),
      offer('service-appointment', 'service', '99', { name: '预约答疑', services: [{ code: 'appointment', count: 1, minutes_per_unit: 30 }] }),
    ])
    const wrapper = mountPlans()
    await flushPromises()
    expect(wrapper.findAll('.pricing-single-tool')).toHaveLength(2)
    expect(wrapper.findAll('.pricing-single-tool .pricing-card, .pricing-single-tool .pricing-button-primary')).toHaveLength(0)
    expect(wrapper.findAll('.pricing-service-list li')).toHaveLength(2)
    expect(wrapper.find('[data-plan="service-materials-full"]').text()).toContain('79元 / 套')
    expect(wrapper.find('[data-plan="service-appointment"]').text()).toContain('99元 / 30 分钟')
    expect(wrapper.find('.pricing-included-note').text()).toContain('预约答疑 3 次，每次 30 分钟')
    expect(wrapper.find('.pricing-included-note').text()).toContain('无需重复购买')
    await wrapper.find('[data-plan="service-appointment"] button').trigger('click')
    await flushPromises()
    expect(document.body.textContent || wrapper.text()).toContain('先确认服务内容、已有套餐包含额度与预约安排')
    wrapper.unmount()
  })

  it('服务单独启用只显示实际服务，不硬编码其他价格或未启用指导包说明', async () => {
    mocks.loadCommercialPlans.mockResolvedValue([offer('service-diagnosis', 'service', '99', { name: '账号诊断', services: [{ code: 'diagnosis', count: 1, minutes_per_unit: 0 }] })])
    const wrapper = mountPlans()
    await flushPromises()
    expect(wrapper.findAll('.pricing-service-list li')).toHaveLength(1)
    expect(wrapper.find('.pricing-included-note').exists()).toBe(false)
    expect(wrapper.find('.pricing-single-tools').exists()).toBe(false)
    expect(wrapper.find('.pricing-free').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('599')
    expect(mocks.getPlans).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('服务排序与官网一致，不受接口按SKU字母排序影响', async () => {
    mocks.loadCommercialPlans.mockResolvedValue([
      offer('service-appointment', 'service', '99', { services: [{ code: 'appointment', count: 1, minutes_per_unit: 30 }] }),
      offer('service-diagnosis', 'service', '99', { services: [{ code: 'diagnosis', count: 1, minutes_per_unit: 0 }] }),
      offer('service-group-qa', 'service', '50', { services: [{ code: 'group-qa', count: 1, minutes_per_unit: 0 }] }),
      offer('service-materials-full', 'service', '79', { services: [{ code: 'materials-full', count: 1, minutes_per_unit: 0 }] }),
      offer('service-materials-topic', 'service', '29', { services: [{ code: 'materials-topic', count: 1, minutes_per_unit: 0 }] }),
    ])
    const wrapper = mountPlans()
    await flushPromises()
    expect(wrapper.findAll('.pricing-service-list li').map(row => row.attributes('data-plan'))).toEqual([
      'service-materials-topic', 'service-materials-full', 'service-diagnosis', 'service-group-qa', 'service-appointment',
    ])
    wrapper.unmount()
  })
})
