import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'
import OrdersView from '@/views/admin/OrdersView.vue'
import { mountWithPinia } from '@/tests/helpers'
import { authService } from '@/utils/auth'
import { usePlatformStore } from '@/stores/platform'
import type { AdminOrder } from '@/features/admin/model'

const mocks = vi.hoisted(() => ({ page: vi.fn(), detail: vi.fn(), plans: vi.fn(), export: vi.fn(), toast: vi.fn(), push: vi.fn(), replace: vi.fn(), route: { query: {} } }))
vi.mock('@/utils/api', () => ({
  getOrdersPage: (...args: unknown[]) => mocks.page(...args),
  getOrder: (...args: unknown[]) => mocks.detail(...args),
  getPlansAdmin: (...args: unknown[]) => mocks.plans(...args),
  exportOrders: (...args: unknown[]) => mocks.export(...args),
  createOrder: vi.fn(), markOrderPaid: vi.fn(), cancelOrder: vi.fn(), refundOrder: vi.fn(),
}))
vi.mock('@/utils', () => ({ showToast: (...args: unknown[]) => mocks.toast(...args) }))
vi.mock('vue-router', () => ({ useRoute: () => mocks.route, useRouter: () => ({ push: mocks.push, replace: mocks.replace }) }))
vi.mock('element-plus', () => ({ ElMessageBox: { prompt: vi.fn() } }))

const order = (id: number, status = 'pending') => ({ id, order_no: `ORDER-${id}`, amount: 99, status })
const result = (id: number, total = 41) => ({ items: [order(id)], total, page: 1, page_size: 20 })
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function mountOrders() {
  return mountWithPinia(OrdersView, { global: { stubs: {
    PageHeader: true, AsyncStateNotice: true, AdminDetailDrawer: { props: ['modelValue'], template: '<section v-if="modelValue" data-testid="order-detail"><slot/><slot name="footer"/></section>' },
    DataToolbar: { template: '<div><slot/><slot name="summary"/><slot name="actions"/></div>' },
    'el-card': { template: '<section><slot name="header"/><slot/></section>' },
    'el-table': true, 'el-table-column': true, 'el-select': true, 'el-option': true,
    'el-input': true, 'el-tag': true, 'el-dropdown': true,
    'el-dropdown-item': true, 'el-dropdown-menu': true,
    'el-alert': { props: ['title'], template: '<p>{{title}}</p>' },
    'el-pagination': { props: ['currentPage', 'total', 'pageSize'], emits: ['current-change'], template: '<button data-testid="next-page" @click="$emit(\'current-change\', 2)">下一页</button>' },
    'el-button': { emits: ['click'], template: '<button @click="$emit(\'click\')"><slot/></button>' },
  } } })
}
interface OrderViewState {
  orders: AdminOrder[]; total: number; page: number; filterStatus: string; loadError: string
  changePage: (page: number) => void; exportOrdersData: () => Promise<void>
  detailOrder: AdminOrder | null; openOrderDetail: (order: unknown) => Promise<void>; detailError: string; showDetailDrawer: boolean
  filterSource: 'direct' | 'agency' | 'all'; canOperateOrder: (order: unknown) => boolean
}

describe('订单远端分页与筛选一致性', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.route = reactive({ query: {} })
    authService.setRole('operator')
    mocks.page.mockResolvedValue(result(1))
    mocks.plans.mockResolvedValue([])
    mocks.detail.mockResolvedValue(order(1))
  })

  it('直接定位跨页订单并显示独立收款授权状态，不靠第一页查找', async () => {
    mocks.route.query = { record_id: '301' }
    mocks.detail.mockResolvedValue({ ...order(301, 'refunded'), auth_code_id: 9, auth_code_status: 'active', customer_name: '关联客户', customer_id: 5, agency_id: 2 })
    const wrapper = mountOrders()
    await flushPromises()
    expect(mocks.detail).toHaveBeenCalledWith(301, expect.any(Object))
    const detail = wrapper.get('[data-testid="order-detail"]')
    expect(detail.text()).toContain('关联客户')
    expect(detail.text()).toContain('金额退款不等于授权停用')
    expect(detail.text()).toContain('核对关联授权')
    await detail.findAll('button').find(item => item.text() === '核对关联授权')!.trigger('click')
    expect(mocks.push).toHaveBeenCalledWith({ path: '/admin/authcodes', query: { auth_code_id: '9', return_to: '/admin/orders?record_id=301' } })
    wrapper.unmount()
  })
  it('旧详情的慢请求不覆盖新详情或恢复已经关闭的抽屉', async () => {
    const slow = deferred<ReturnType<typeof order>>()
    const wrapper = mountOrders()
    await flushPromises()
    const state = wrapper.vm as unknown as OrderViewState
    mocks.detail.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(order(2))
    void state.openOrderDetail(order(1))
    await state.openOrderDetail(order(2))
    slow.resolve(order(1))
    await flushPromises()
    expect(state.detailOrder?.id).toBe(2)
    wrapper.unmount()
  })
  it.each([{}, { record_id: 'invalid' }])('返回列表或非法编号时清除旧详情并废弃慢响应 %s', async query => {
    mocks.route.query = { record_id: '1' }
    const slow = deferred<ReturnType<typeof order>>()
    mocks.detail.mockReturnValueOnce(slow.promise)
    const wrapper = mountOrders()
    await flushPromises()
    mocks.route.query = query
    await flushPromises()
    slow.resolve(order(1))
    await flushPromises()
    const state = wrapper.vm as unknown as OrderViewState
    expect(state.showDetailDrawer).toBe(false)
    expect(state.detailOrder).toBeNull()
    expect(wrapper.find('[data-testid="order-detail"]').exists()).toBe(false)
    wrapper.unmount()
  })
  it('从授权核对回到订单时恢复原筛选和分页', async () => {
    mocks.route.query = { record_id: '301', page: '2', status: 'refunded' }
    mocks.detail.mockResolvedValue({ ...order(301, 'refunded'), auth_code_id: 9, auth_code_status: 'active' })
    const wrapper = mountOrders()
    await flushPromises()
    expect(mocks.page).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, status: 'refunded', source: 'direct' }))
    await wrapper.get('[data-testid="order-detail"]').findAll('button').find(item => item.text() === '核对关联授权')!.trigger('click')
    expect(mocks.push).toHaveBeenCalledWith({ path: '/admin/authcodes', query: { auth_code_id: '9', return_to: '/admin/orders?record_id=301&page=2&status=refunded' } })
    wrapper.unmount()
  })
  it.each(['super_admin', 'operator', 'support'] as const)('保留 %s 的代理订单发现入口但不开启普通写操作', async role => {
    authService.setRole(role)
    const wrapper = mountOrders()
    await flushPromises()
    const state = wrapper.vm as unknown as OrderViewState
    state.filterSource = 'agency'
    await flushPromises()
    expect(mocks.page).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'agency', page: 1 }))
    expect(state.canOperateOrder({ ...order(3), agency_id: 1 })).toBe(false)
    expect(state.canOperateOrder(order(4))).toBe(role !== 'support')
    mocks.export.mockRejectedValue(new Error('stop-download'))
    await state.exportOrdersData()
    expect(mocks.export).toHaveBeenCalledWith(expect.objectContaining({ source: 'agency' }))
    state.filterSource = 'all'
    await flushPromises()
    expect(mocks.page).toHaveBeenLastCalledWith(expect.objectContaining({ source: undefined }))
    wrapper.unmount()
  })

  it('显示后端全部数量并请求第二页，不把第一页当全部', async () => {
    const wrapper = mountOrders()
    await flushPromises()
    expect(wrapper.text()).toContain('共 41 笔 · 本页 1 笔')
    expect(wrapper.text()).toContain('本页待收款')
    await wrapper.get('[data-testid="next-page"]').trigger('click')
    await flushPromises()
    expect(mocks.page).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, page_size: 20 }))
    wrapper.unmount()
  })

  it('状态筛选交给后端并重置页码，导出使用同一平台与状态', async () => {
    const wrapper = mountOrders()
    await flushPromises()
    const state = wrapper.vm as unknown as OrderViewState
    state.changePage(2)
    await flushPromises()
    state.filterStatus = 'paid'
    usePlatformStore().setAdminPlatform('amazon')
    await flushPromises()
    expect(mocks.page).toHaveBeenLastCalledWith({ page: 1, page_size: 20, status: 'paid', platform_key: 'amazon', source: 'direct' })
    // Deliberately reject before browser download; the request must still use the exact visible scope.
    mocks.export.mockRejectedValue(new Error('offline'))
    await state.exportOrdersData()
    expect(mocks.export).toHaveBeenCalledWith({ status: 'paid', platform_key: 'amazon', source: 'direct' })
    wrapper.unmount()
  })

  it.each(['success', 'failure'] as const)('旧平台的慢请求 %s 不覆盖新平台', async (outcome) => {
    const slow = deferred<ReturnType<typeof result>>()
    mocks.page.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(result(2, 7))
    const wrapper = mountOrders()
    const state = wrapper.vm as unknown as OrderViewState
    usePlatformStore().setAdminPlatform('aliexpress')
    await flushPromises()
    if (outcome === 'success') slow.resolve(result(1))
    else slow.reject(new Error('old request failed'))
    await flushPromises()
    expect(state.orders[0]?.id).toBe(2)
    expect(state.total).toBe(7)
    expect(state.loadError).toBe('')
    wrapper.unmount()
  })

  it('页面卸载后不应用仍在等待的请求', async () => {
    const slow = deferred<ReturnType<typeof result>>()
    mocks.page.mockReturnValueOnce(slow.promise)
    const wrapper = mountOrders()
    const state = wrapper.vm as unknown as OrderViewState
    wrapper.unmount()
    slow.resolve(result(1))
    await flushPromises()
    expect(state.orders).toEqual([])
  })
})
