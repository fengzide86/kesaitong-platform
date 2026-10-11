import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import PlansView from '@/views/user/PlansView.vue'

const mocks = vi.hoisted(() => ({
  getPlans: vi.fn(),
  getPublicSettings: vi.fn(),
  push: vi.fn(),
  showToast: vi.fn(),
  route: { query: {} },
}))

vi.mock('@/utils/api', () => ({ getPlans: mocks.getPlans, getPublicSettings: mocks.getPublicSettings }))
vi.mock('@/utils', () => ({ showToast: mocks.showToast }))
vi.mock('vue-router', () => ({ useRoute: () => mocks.route, useRouter: () => ({ push: mocks.push }) }))

const mountPlans = () => mount(PlansView, { global: { plugins: [createPinia()] } })

describe('PlansView 套餐与授权', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.route.query = {}
    mocks.getPlans.mockResolvedValue([])
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
})
