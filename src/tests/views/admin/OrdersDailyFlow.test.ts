/* eslint-disable vue/one-component-per-file -- These small components render isolated order-table slots. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { computed, defineComponent, h, inject, provide, type PropType, type Ref } from 'vue'
import OrdersView from '@/views/admin/OrdersView.vue'
import { mountWithPinia } from '@/tests/helpers'
import { authService } from '@/utils/auth'
import type { AdminOrder } from '@/features/admin/model'

const mocks = vi.hoisted(() => ({ page: vi.fn(), detail: vi.fn(), plans: vi.fn(), paid: vi.fn(), create: vi.fn(), cancel: vi.fn(), refund: vi.fn(), confirm: vi.fn(), push: vi.fn() }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }), useRouter: () => ({ push: mocks.push, replace: vi.fn() }) }))
vi.mock('@/utils/api', () => ({
  getOrdersPage: (...args: unknown[]) => mocks.page(...args), getOrder: (...args: unknown[]) => mocks.detail(...args),
  getPlansAdmin: (...args: unknown[]) => mocks.plans(...args), markOrderPaid: (...args: unknown[]) => mocks.paid(...args),
  createOrder: (...args: unknown[]) => mocks.create(...args), cancelOrder: (...args: unknown[]) => mocks.cancel(...args),
  refundOrder: (...args: unknown[]) => mocks.refund(...args), exportOrders: vi.fn(),
}))
vi.mock('@/utils', () => ({ showToast: vi.fn() }))
vi.mock('@/shared/ui/confirm', () => ({ confirmAction: (...args: unknown[]) => mocks.confirm(...args) }))

const Table = defineComponent({
  props: { data: { type: Array as PropType<AdminOrder[]>, default: () => [] } },
  setup(props, { slots }) {
    provide('order-flow-rows', computed(() => props.data))
    return () => h('div', {}, [slots.default?.(), props.data.length ? null : slots.empty?.()])
  },
})
const Column = defineComponent({
  props: { label: { type: String, required: true } },
  setup(props, { slots }) {
    const rows = inject<Ref<AdminOrder[]>>('order-flow-rows')!
    return () => h('section', { 'data-column': props.label }, rows.value.map(row => h('div', { key: row.id }, slots.default?.({ row }))))
  },
})
const order = { id: 12, order_no: 'ORDER-20261016-0012', amount: 199, status: 'pending', plan_id: 4, customer_name: '星海学校张老师', responsible: '王老师', channel: '银行转账', plan_name_snapshot: '购买时的比赛完整包' }
function mountView(width = 1440) {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: width <= 1024, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  return mountWithPinia(OrdersView, { global: { stubs: {
    PageHeader: { template: '<header><slot name="actions"/></header>' }, AsyncStateNotice: true,
    AdminDetailDrawer: { props: ['modelValue'], template: '<aside v-if="modelValue"><slot/><slot name="footer"/></aside>' },
    DataToolbar: { template: '<div><slot/><slot name="summary"/><slot name="actions"/></div>' },
    'el-card': { template: '<section><slot name="header"/><slot/></section>' },
    'el-table': Table, 'el-table-column': Column, 'el-select': true, 'el-option': true,
    'el-input': true, 'el-input-number': true, 'el-pagination': true,
    'el-alert': { props: ['title'], template: '<p>{{title}}</p>' },
    'el-tag': { template: '<span><slot/></span>' },
    'el-button': { props: ['disabled'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot/></button>' },
    'el-dropdown': { template: '<div><slot/><slot name="dropdown"/></div>' }, 'el-dropdown-menu': { template: '<div><slot/></div>' },
    'el-dropdown-item': { props: ['command'], template: '<span :data-command="command"><slot/></span>' },
  } } })
}

describe('订单页按日常处理顺序展示', () => {
  beforeEach(() => {
    vi.clearAllMocks(); authService.setRole('super_admin')
    mocks.page.mockResolvedValue({ items: [order], total: 41, page: 1, page_size: 20 })
    mocks.detail.mockResolvedValue(order)
    mocks.plans.mockResolvedValue([{ id: 4, name: '现在的套餐名称', price: 199, status: 'active' }])
    mocks.confirm.mockResolvedValue(true); mocks.paid.mockResolvedValue({})
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('订单列表在前，套餐参考默认折叠，新订单只在点击后展开', async () => {
    const wrapper = mountView(); await flushPromises()
    expect(wrapper.find('#order-create').exists()).toBe(false)
    const catalog = wrapper.get('details.plan-overview-card')
    expect(catalog.attributes('open')).toBeUndefined()
    expect(wrapper.html().indexOf('orders-list-card')).toBeLessThan(wrapper.html().indexOf('plan-overview-card'))
    expect(wrapper.findAll('.stat-card')).toHaveLength(3)
    expect(wrapper.get('.order-stats').text()).toContain('本页待收款')
    expect(wrapper.get('.order-stats').text()).not.toContain('总订单数')
    expect(wrapper.text()).toContain('共 41 笔 · 本页 1 笔')
    await wrapper.findAll('button').find(button => button.text() === '登记新订单')!.trigger('click')
    expect(wrapper.find('#order-create').exists()).toBe(true)
    await wrapper.get('#order-create').findAll('button').find(button => button.text() === '收起')!.trigger('click')
    expect(wrapper.find('#order-create').exists()).toBe(false)
    expect(mocks.create).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it.each([1024, 1440])('%spx 保留订单金额、购买时套餐和直接收款入口，不藏到更多菜单', async width => {
    const wrapper = mountView(width); await flushPromises()
    const table = wrapper.get('.orders-table')
    expect(table.get('[data-column="客户 / 订单"]').text()).toContain('星海学校张老师')
    expect(table.get('[data-column="套餐 / 金额"]').text()).toContain('¥199')
    expect(table.get('[data-column="套餐 / 金额"]').text()).toContain('购买时的比赛完整包')
    expect(table.text()).not.toContain('现在的套餐名称')
    expect(table.get('[data-column="收款 / 授权"]').text()).toBe('待收款')
    expect(table.find('[data-column="负责人 / 渠道"]').exists()).toBe(width > 1024)
    const actions = table.get('.order-actions')
    expect(actions.findAll('button').map(button => button.text())).toEqual(['详情', '标记已收款'])
    await actions.findAll('button')[1]!.trigger('click'); await flushPromises()
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '确认订单已人工收款？' }))
    expect(mocks.paid).toHaveBeenCalledWith(12)
    expect(mocks.cancel).not.toHaveBeenCalled(); expect(mocks.refund).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it.each(['support', 'agency'] as const)('%s 不因新的显著收款按钮获得直营写权限', async mode => {
    if (mode === 'support') authService.setRole('support')
    else mocks.page.mockResolvedValue({ items: [{ ...order, agency_id: 7 }], total: 1, page: 1, page_size: 20 })
    const wrapper = mountView(1024); await flushPromises()
    expect(wrapper.get('.order-actions').findAll('button').map(button => button.text())).toEqual(['详情'])
    expect(mocks.paid).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('已收款但没有关联授权时只提示核对，不声称授权已生成', async () => {
    mocks.page.mockResolvedValue({ items: [{ ...order, status: 'paid' }], total: 1, page: 1, page_size: 20 })
    const wrapper = mountView(); await flushPromises()
    expect(wrapper.get('[data-column="收款 / 授权"]').text()).toContain('授权待核对')
    expect(wrapper.get('.order-stats').text()).toContain('已收款，尚无关联授权')
    expect(wrapper.get('.order-actions').text()).not.toContain('标记已收款')
    expect(wrapper.get('.order-actions').text()).toContain('登记退款')
    expect(mocks.create).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('关联授权展示实际状态，并仍从真实订单详情进入授权核对', async () => {
    const paid = { ...order, status: 'paid', auth_code_id: 9, auth_code_status: 'active' }
    mocks.page.mockResolvedValue({ items: [paid], total: 1, page: 1, page_size: 20 }); mocks.detail.mockResolvedValue(paid)
    const wrapper = mountView(); await flushPromises()
    expect(wrapper.get('[data-column="收款 / 授权"]').text()).toContain('授权：使用中')
    await wrapper.get('.order-actions button').trigger('click'); await flushPromises()
    await wrapper.get('aside').findAll('button').find(button => button.text() === '核对关联授权')!.trigger('click')
    expect(mocks.detail).toHaveBeenCalledWith(12, {})
    expect(mocks.push).toHaveBeenCalledWith({ path: '/admin/authcodes', query: { auth_code_id: '9', return_to: '/admin/orders?record_id=12' } })
    wrapper.unmount()
  })

  it('取消订单仍在详情可用，但不与列表主操作竞争', async () => {
    const wrapper = mountView(); await flushPromises()
    expect(wrapper.get('.order-actions').text()).not.toContain('取消')
    await wrapper.get('.order-actions button').trigger('click'); await flushPromises()
    expect(wrapper.get('aside').text()).toContain('取消订单')
    wrapper.unmount()
  })
})
