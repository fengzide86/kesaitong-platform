import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ElementPlus, { ElInput, ElSelect, ElMessageBox, ElPagination } from 'element-plus'
import type { MessageBoxData } from 'element-plus'
import AgencyRecordsView from '@/features/agency/AgencyRecordsView.vue'
import AgentOverviewView from '@/features/agency/AgentOverviewView.vue'
import type { Section, Customer, Page } from '@/features/agency/model'
const mocks = vi.hoisted(() => ({
  agencies: vi.fn(), customers: vi.fn(), orders: vi.fn(), licenses: vi.fn(), requests: vi.fn(), plans: vi.fn(), summary: vi.fn(),
  createCustomer: vi.fn(), createAgency: vi.fn(), createOrder: vi.fn(), createRequest: vi.fn(), updateCustomer: vi.fn(),
  updateAgency: vi.fn(), markPaid: vi.fn(), deliver: vi.fn(), respond: vi.fn(), exportOrders: vi.fn(), showToast: vi.fn(),
  customer: vi.fn(), order: vi.fn(), license: vi.fn(), request: vi.fn(), push: vi.fn(), replace: vi.fn(),
  refundOrder: vi.fn(), cancelOrder: vi.fn(),
  route: { query: {} },
}))
vi.mock('@/features/agency/api', () => ({ agencyApi: mocks }))
vi.mock('@/utils', () => ({ showToast: mocks.showToast }))
vi.mock('vue-router', () => ({ useRoute: () => mocks.route, useRouter: () => ({ push: mocks.push, replace: mocks.replace }) }))
const created_at = '2026-09-21T01:00:00Z'
const customer: Customer = { id: 3, name: '学生客户', agency_id: 1, agency_name: '青蓝代理', created_at }
const order = { id: 4, customer_id: 3, customer_name: '学生客户', agency_id: 1, order_no: 'TEST-ORDER', plan_id: 5, plan_name: '赛期套餐', amount: 99, status: 'pending', auth_code: null, created_at }
const empty = { data: [], total: 0, page: 1, page_size: 20 }
const wrappers: { unmount: () => void }[] = []
const drawer = { props: ['modelValue', 'title'], emits: ['update:modelValue'], template: '<section v-if="modelValue" class="test-drawer"><h2>{{title}}</h2><button aria-label="关闭详情" @click="$emit(\'update:modelValue\', false)">关闭</button><slot /></section>' }
function render(section: Section, owner = false) {
  const wrapper = mount(AgencyRecordsView, { props: { section, owner }, global: { plugins: [ElementPlus], stubs: { ElDrawer: drawer } } })
  wrappers.push(wrapper)
  return wrapper
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.route = reactive({ query: {} })
  for (const method of ['agencies', 'customers', 'orders', 'licenses', 'requests'] as const) mocks[method].mockResolvedValue(empty)
  mocks.plans.mockResolvedValue([])
})
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.restoreAllMocks() })

describe('partner records workflows', () => {
  it('reads a deep linked order by id even if it is not in the current page', async () => {
    mocks.route.query = { record_id: '404' }
    mocks.order.mockResolvedValue({ ...order, id: 404, order_no: 'OLDER-ORDER' })
    const wrapper = render('orders', true)
    await flushPromises()
    expect(mocks.order).toHaveBeenCalledWith(404)
    expect(wrapper.get('.test-drawer').text()).toContain('OLDER-ORDER')
  })
  it('filters every related collection by the explicit customer and preselects it when creating', async () => {
    mocks.route.query = { customer_id: '3', create: '1' }
    mocks.customer.mockResolvedValue(customer)
    const wrapper = render('orders')
    await flushPromises()
    expect(mocks.orders).toHaveBeenCalledWith(expect.objectContaining({ customer_id: 3 }))
    const select = wrapper.findAllComponents(ElSelect).find(item => item.element.closest('.record-form'))
    expect(select?.props('modelValue')).toBe(3)
    expect(wrapper.text()).toContain('学生客户')
  })
  it('opens customer related lists with an exact scope, not a text search', async () => {
    mocks.customers.mockResolvedValue({ ...empty, data: [customer], total: 1 })
    const wrapper = render('customers', true)
    await flushPromises()
    await wrapper.findAll('button').find(item => item.text() === '查看 / 编辑')!.trigger('click')
    await flushPromises()
    expect(mocks.licenses).toHaveBeenCalledWith(expect.objectContaining({ customer_id: 3 }))
    await wrapper.get('[data-testid="customer-create-order"]').trigger('click')
    expect(mocks.push).toHaveBeenCalledWith({ path: '/admin/agency', query: { section: 'orders', customer_id: '3', create: '1' } })
  })
  it('uses effective license validity before activation in the customer summary', async () => {
    mocks.customers.mockResolvedValue({ ...empty, data: [customer], total: 1 })
    const base = { agency_id: 1, customer_id: 3, order_id: 4, code: 'TEST-CODE', activated: false, created_at }
    mocks.licenses.mockResolvedValue({ ...empty, total: 2, data: [{ ...base, id: 1, plan_name: '过期套餐', status: 'expired' }, { ...base, id: 2, plan_name: '有效套餐', status: 'unused' }] })
    const wrapper = render('customers', true)
    await flushPromises()
    await wrapper.findAll('button').find(item => item.text() === '查看 / 编辑')!.trigger('click')
    await flushPromises()
    const licenseSummary = wrapper.get('[aria-label="客户关联业务"]').findAll('.journey-group')[1]!
    expect(licenseSummary.text()).toContain('过期套餐已到期')
    expect(licenseSummary.text()).toContain('有效套餐待激活')
  })
  it('does not turn a denied customer deep link into a global create form', async () => {
    mocks.route.query = { customer_id: '91', create: '1' }
    mocks.customer.mockRejectedValue(new Error('记录不存在或不属于当前代理'))
    const wrapper = render('orders')
    await flushPromises()
    expect(wrapper.text()).toContain('记录不存在或不属于当前代理')
    expect(wrapper.find('.record-form').exists()).toBe(false)
    expect(mocks.createOrder).not.toHaveBeenCalled()
  })
  it('does not fetch an unscoped list or open create for a malformed customer id', async () => {
    mocks.route.query = { customer_id: 'not-an-id', create: '1' }
    const wrapper = render('orders')
    await flushPromises()
    expect(mocks.orders).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('客户档案编号无效')
    await wrapper.findAll('.heading-actions button')[1]!.trigger('click')
    expect(wrapper.find('.record-form').exists()).toBe(false)
  })
  it('reopens a different deep link and ignores the earlier unfinished detail', async () => {
    let complete!: (value: unknown) => void
    mocks.route.query = { record_id: '4' }
    mocks.order.mockReturnValueOnce(new Promise(resolve => { complete = resolve })).mockResolvedValueOnce({ ...order, id: 8, order_no: 'SECOND-DETAIL' })
    const wrapper = render('orders', true)
    await flushPromises()
    mocks.route.query = { record_id: '8' }
    await flushPromises()
    expect(wrapper.get('.test-drawer').text()).toContain('SECOND-DETAIL')
    complete(order)
    await flushPromises()
    expect(wrapper.get('.test-drawer').text()).toContain('SECOND-DETAIL')
  })
  it('restores a scoped second page from the URL and writes new pagination without a stale record id', async () => {
    mocks.route.query = { customer_id: '3', page: '2', q: '赛期', status: 'paid', agency_id: '1' }
    mocks.customer.mockResolvedValue(customer)
    const wrapper = render('orders', true)
    await flushPromises()
    expect(mocks.orders).toHaveBeenLastCalledWith({ page: 2, page_size: 20, q: '赛期', status: 'paid', agency_id: 1, customer_id: 3 })
    wrapper.getComponent(ElPagination).vm.$emit('current-change', 3)
    await flushPromises()
    expect(mocks.replace).toHaveBeenCalledWith({ query: { customer_id: '3', page: '3', q: '赛期', status: 'paid', agency_id: '1' } })
    mocks.route.query = { customer_id: '3', page: '2', q: '赛期', status: 'paid', agency_id: '1' }
    await flushPromises()
    expect(mocks.orders).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, q: '赛期', customer_id: 3 }))
  })
  it('shows the current support order and verified license without claiming reply means refund', async () => {
    const request = { id: 9, agency_id: 1, customer_id: 3, customer_name: '学生客户', order_id: 4, kind: 'refund', content: '申请退款', status: 'open', created_at }
    const auth_code = { id: 1, agency_id: 1, customer_id: 3, order_id: 4, code: 'TEST-CODE', plan_name: '赛期套餐', status: 'unused', activated: false, created_at }
    mocks.requests.mockResolvedValue({ ...empty, data: [request], total: 1 })
    mocks.order.mockResolvedValue({ ...order, status: 'paid', auth_code })
    const wrapper = render('requests', true)
    await flushPromises()
    await wrapper.findAll('button').find(item => item.text() === '查看详情')!.trigger('click')
    await flushPromises()
    expect(wrapper.get('.test-drawer').text()).toContain('关联订单 TEST-ORDER')
    expect(wrapper.get('.test-drawer').text()).toContain('不会自动退款或延长授权')
    await wrapper.findAll('button').find(item => item.text() === '核对关联授权')!.trigger('click')
    expect(mocks.push).toHaveBeenCalledWith({ path: '/admin/agency', query: { section: 'licenses', record_id: '1' } })
  })
  it('validates a customer drawer and sends no caller-controlled agency for agents', async () => {
    const wrapper = render('customers')
    await flushPromises()
    await wrapper.get('.heading-actions button').trigger('click')
    await wrapper.get('.record-form').trigger('submit')
    expect(wrapper.text()).toContain('请填写名称')
    await wrapper.get('#agency-record-name').setValue(' 新客户 ')
    mocks.createCustomer.mockResolvedValue(customer)
    await wrapper.get('.record-form').trigger('submit')
    await flushPromises()
    expect(mocks.createCustomer).toHaveBeenCalledWith({ name: '新客户', contact: '', notes: '' })
    expect(wrapper.find('.test-drawer').exists()).toBe(false)
  })
  it('requires owner customer assignment and preserves a failed form for retry', async () => {
    const wrapper = render('customers', true)
    await flushPromises()
    await wrapper.get('.heading-actions button').trigger('click')
    await wrapper.get('#agency-record-name').setValue('新客户')
    await wrapper.get('.record-form').trigger('submit')
    expect(wrapper.text()).toContain('请选择所属代理')
    const select = wrapper.findAllComponents(ElSelect).find(item => item.element.closest('.record-form'))
    select!.vm.$emit('update:modelValue', 1)
    await flushPromises()
    mocks.createCustomer.mockRejectedValue(new Error('网络断开，请重试'))
    await wrapper.get('.record-form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('网络断开，请重试')
    expect((wrapper.get('#agency-record-name').element as HTMLInputElement).value).toBe('新客户')
  })
  it('ignores an older list result after a refreshed request has failed', async () => {
    let complete!: (page: Page<Customer>) => void
    mocks.customers.mockReturnValueOnce(new Promise<Page<Customer>>(resolve => { complete = resolve }))
    const wrapper = render('customers')
    mocks.customers.mockRejectedValueOnce(new Error('本次刷新失败'))
    await wrapper.get('.filter-bar').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('本次刷新失败')
    complete({ data: [customer], total: 1, page: 1, page_size: 20 })
    await flushPromises()
    expect(wrapper.text()).toContain('本次刷新失败')
    expect(wrapper.text()).not.toContain('学生客户')
  })
  it('shows owner-only payment controls and no authorization issue button for an agent', async () => {
    mocks.orders.mockResolvedValue({ ...empty, data: [order], total: 1 })
    const wrapper = render('orders')
    await flushPromises()
    const button = wrapper.findAll('button').find(item => item.text() === '查看详情')
    expect(button).toBeTruthy()
    await button!.trigger('click')
    expect(wrapper.text()).toContain('等待平台负责人核对收款并交付授权')
    expect(wrapper.findAll('button').some(item => item.text() === '确认已收款')).toBe(false)
    expect(wrapper.findAll('button').some(item => item.text() === '发放授权')).toBe(false)
    expect(mocks.markPaid).not.toHaveBeenCalled()
    expect(wrapper.findAll('button').some(item => item.text() === '取消订单' || item.text() === '登记线下退款')).toBe(false)
  })
  it('retains owner refund handling in the agency area and reads the resulting separate license state', async () => {
    const prompt = vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '已线下退款', action: 'confirm' } as MessageBoxData)
    const auth_code = { id: 1, agency_id: 1, customer_id: 3, order_id: 4, code: 'TEST-CODE', plan_name: '赛期套餐', status: 'unused', activated: false, created_at }
    mocks.orders.mockResolvedValue({ ...empty, data: [{ ...order, status: 'paid', auth_code }], total: 1 })
    mocks.refundOrder.mockResolvedValue({ ...order, status: 'refunded', auth_code })
    const wrapper = render('orders', true)
    await flushPromises()
    await wrapper.findAll('button').find(item => item.text() === '查看详情')!.trigger('click')
    await wrapper.findAll('button').find(item => item.text() === '登记线下退款')!.trigger('click')
    await flushPromises()
    expect(prompt).toHaveBeenCalledWith(expect.stringContaining('不会停用授权'), '登记线下退款', expect.any(Object))
    expect(mocks.refundOrder).toHaveBeenCalledWith(4, '已线下退款')
    expect(wrapper.get('.test-drawer').text()).toContain('金额退款不等于授权停用')
    expect(wrapper.get('.test-drawer').text()).toContain('待激活')
    expect(wrapper.get('.test-drawer').findAll('button').some(item => item.text() === '复制授权码')).toBe(false)
  })
  it('cancels a pending agency order only after an owner supplies the reason', async () => {
    vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '客户取消购买', action: 'confirm' } as MessageBoxData)
    mocks.orders.mockResolvedValue({ ...empty, data: [order], total: 1 })
    mocks.cancelOrder.mockResolvedValue({ ...order, status: 'cancelled' })
    const wrapper = render('orders', true)
    await flushPromises()
    await wrapper.findAll('button').find(item => item.text() === '查看详情')!.trigger('click')
    await wrapper.findAll('button').find(item => item.text() === '取消订单')!.trigger('click')
    await flushPromises()
    expect(mocks.cancelOrder).toHaveBeenCalledWith(4, '客户取消购买')
    expect(wrapper.get('.test-drawer').text()).toContain('不再进行收款或授权交付')
  })
  it('keeps refunds visible as refunded even when a historic authorization exists', async () => {
    const auth_code = { id: 1, agency_id: 1, customer_id: 3, order_id: 4, code: 'TEST-CODE', plan_name: '赛期套餐', status: 'frozen', activated: false, created_at }
    mocks.orders.mockResolvedValue({ ...empty, data: [{ ...order, status: 'refunded', auth_code }], total: 1 })
    const wrapper = render('orders')
    await flushPromises()
    expect(wrapper.text()).toContain('已退款')
    await wrapper.findAll('button').find(button => button.text() === '查看详情')!.trigger('click')
    const detail = wrapper.get('.test-drawer')
    expect(detail.text()).toContain('历史授权记录')
    expect(detail.text()).toContain('不再进行收款或授权交付')
    expect(detail.text()).not.toContain('发送给对应客户使用')
    expect(detail.findAll('button').some(button => button.text() === '复制授权码')).toBe(false)
  })

  it.each(['cancelled', 'refunded'] as const)('does not suggest waiting for payment on %s orders without licenses', async status => {
    mocks.orders.mockResolvedValue({ ...empty, data: [{ ...order, status, auth_code: null }], total: 1 })
    const wrapper = render('orders')
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '查看详情')!.trigger('click')
    const detail = wrapper.get('.test-drawer')
    expect(detail.text()).toContain('不再进行收款或授权交付')
    expect(detail.text()).not.toContain('等待平台负责人核对收款')
    expect(detail.text()).not.toContain('等待发放授权')
  })

  it('does not offer a frozen authorization for delivery even while its order remains paid', async () => {
    const auth_code = { id: 1, agency_id: 1, customer_id: 3, order_id: 4, code: 'TEST-CODE', plan_name: '赛期套餐', status: 'frozen', activated: true, created_at }
    mocks.orders.mockResolvedValue({ ...empty, data: [{ ...order, status: 'paid', auth_code }], total: 1 })
    const wrapper = render('orders')
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '查看详情')!.trigger('click')
    expect(wrapper.get('.test-drawer').text()).toContain('不要再次交付')
    expect(wrapper.get('.test-drawer').findAll('button').some(button => button.text() === '复制授权码')).toBe(false)
  })

  it('does not offer an expired authorization for delivery or label it as waiting for activation', async () => {
    const auth_code = { id: 1, agency_id: 1, customer_id: 3, order_id: 4, code: 'TEST-EXPIRED', plan_name: '赛期套餐', status: 'expired', activated: false, expires_at: '2026-01-01T00:00:00Z', created_at }
    mocks.licenses.mockResolvedValue({ ...empty, data: [auth_code], total: 1 })
    const wrapper = render('licenses')
    await flushPromises()
    expect(wrapper.text()).toContain('已到期')
    expect(wrapper.text()).not.toContain('待激活')
    expect(wrapper.find('.records-table .el-tag--danger').exists()).toBe(true)
    await wrapper.findAll('button').find(button => button.text() === '查看详情')!.trigger('click')
    const detail = wrapper.get('.test-drawer')
    expect(detail.text()).toContain('不要再次交付')
    expect(detail.find('.el-tag--danger').text()).toBe('已到期')
    expect(detail.findAll('button').some(button => button.text() === '复制授权码')).toBe(false)
  })

  it('uses the server effective status to hide expired order delivery controls', async () => {
    const auth_code = { id: 1, agency_id: 1, customer_id: 3, order_id: 4, code: 'TEST-EXPIRED', plan_name: '赛期套餐', status: 'expired', activated: false, created_at }
    mocks.orders.mockResolvedValue({ ...empty, data: [{ ...order, status: 'paid', auth_code }], total: 1 })
    const wrapper = render('orders')
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '查看详情')!.trigger('click')
    expect(wrapper.get('.test-drawer').text()).toContain('授权已到期')
    expect(wrapper.get('.test-drawer').findAll('button').some(button => button.text() === '复制授权码')).toBe(false)
  })
  it('creates orders only after selecting a customer and a valid plan', async () => {
    mocks.plans.mockResolvedValue([{ id: 5, name: '赛期套餐', price: 99, duration_days: 30, product_type: 'consumer' }])
    const wrapper = render('orders')
    await flushPromises()
    await wrapper.findAll('.heading-actions button')[1]!.trigger('click')
    await flushPromises()
    await wrapper.get('.record-form').trigger('submit')
    expect(wrapper.text()).toContain('请选择客户')
    const selects = wrapper.findAllComponents(ElSelect).filter(item => item.element.closest('.record-form'))
    selects[0]!.vm.$emit('update:modelValue', 3)
    await flushPromises()
    await wrapper.get('.record-form').trigger('submit')
    expect(wrapper.text()).toContain('请选择套餐')
    selects[1]!.vm.$emit('update:modelValue', 5)
    await flushPromises()
    mocks.createOrder.mockResolvedValue(order)
    await wrapper.get('.record-form').trigger('submit')
    await flushPromises()
    expect(mocks.createOrder).toHaveBeenCalledWith({ customer_id: 3, plan_id: 5, platform_key: 'amazon', note: '' })
  })
  it('creates service requests without pretending to execute a refund', async () => {
    const wrapper = render('requests')
    await flushPromises()
    await wrapper.get('.heading-actions button').trigger('click')
    const selects = wrapper.findAllComponents(ElSelect).filter(item => item.element.closest('.record-form'))
    selects[0]!.vm.$emit('update:modelValue', 3)
    selects[1]!.vm.$emit('update:modelValue', 'refund')
    const textarea = wrapper.findAllComponents(ElInput).find(input => input.props('type') === 'textarea' && input.element.closest('.record-form'))
    textarea!.vm.$emit('update:modelValue', '请核对退款条件')
    await flushPromises()
    mocks.createRequest.mockResolvedValue({ id: 1 })
    await wrapper.get('.record-form').trigger('submit')
    await flushPromises()
    expect(mocks.createRequest).toHaveBeenCalledWith({ customer_id: 3, order_id: undefined, kind: 'refund', content: '请核对退款条件' })
    expect(mocks.markPaid).not.toHaveBeenCalled()
  })
  it('renders scoped overview counts and recovers from an initial error', async () => {
    mocks.summary.mockRejectedValueOnce(new Error('暂时离线'))
    const wrapper = mount(AgentOverviewView, { global: { plugins: [ElementPlus], stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.text()).toContain('暂时离线')
    mocks.summary.mockResolvedValue({ customers: 8, orders: 7, pending_orders: 2, delivered_orders: 5, open_requests: 1 })
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('暂时离线')
    expect(wrapper.get('.metrics').text()).toContain('8')
  })

  it('requires explicit owner payment confirmation and then allows authorization delivery', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as MessageBoxData)
    mocks.orders.mockResolvedValue({ ...empty, data: [order], total: 1 })
    mocks.markPaid.mockResolvedValue({ ...order, status: 'paid' })
    const wrapper = render('orders', true)
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '查看详情')!.trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '确认已收款')!.trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledOnce()
    expect(mocks.markPaid).toHaveBeenCalledWith(4)
    const auth_code = { id: 1, agency_id: 1, customer_id: 3, order_id: 4, code: 'TEST-CODE', plan_name: '赛期套餐', status: 'unused', activated: false, created_at }
    mocks.deliver.mockResolvedValue({ ...order, status: 'paid', auth_code })
    await wrapper.findAll('button').find(button => button.text() === '发放授权')!.trigger('click')
    await flushPromises()
    expect(mocks.deliver).toHaveBeenCalledWith(4)
    expect(wrapper.get('.test-drawer').text()).toContain('TEST-CODE')
    expect(wrapper.findAll('button').some(button => button.text() === '发放授权')).toBe(false)
  })

  it('does not mark an order paid when the owner cancels confirmation', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    mocks.orders.mockResolvedValue({ ...empty, data: [order], total: 1 })
    const wrapper = render('orders', true)
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '查看详情')!.trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '确认已收款')!.trigger('click')
    await flushPromises()
    expect(mocks.markPaid).not.toHaveBeenCalled()
  })

  it.each(['orders', 'agencies'] as const)('ignores a late confirmation after switching %s details', async section => {
    let confirm!: (value: MessageBoxData) => void
    vi.spyOn(ElMessageBox, 'confirm').mockReturnValue(new Promise<MessageBoxData>(resolve => { confirm = resolve }))
    if (section === 'orders') {
      mocks.orders.mockResolvedValue({ ...empty, data: [order, { ...order, id: 8, customer_name: '客户 B' }], total: 2 })
    } else {
      mocks.agencies.mockResolvedValue({ ...empty, data: [{ id: 1, name: '代理 A', status: 'active', created_at }, { id: 2, name: '代理 B', status: 'active', created_at }], total: 2 })
    }
    const wrapper = render(section, true)
    await flushPromises()
    const detailButton = section === 'orders' ? '查看详情' : '查看 / 编辑'
    await wrapper.findAll('button').filter(button => button.text() === detailButton)[0]!.trigger('click')
    await wrapper.findAll('button').find(button => button.text() === (section === 'orders' ? '确认已收款' : '停用代理'))!.trigger('click')
    await wrapper.get('[aria-label="关闭详情"]').trigger('click')
    await wrapper.findAll('button').filter(button => button.text() === detailButton)[1]!.trigger('click')
    confirm('confirm' as MessageBoxData)
    await flushPromises()
    expect(mocks.markPaid).not.toHaveBeenCalled()
    expect(mocks.updateAgency).not.toHaveBeenCalled()
    expect(wrapper.get('.test-drawer').text()).toContain(section === 'orders' ? '客户 B' : '代理 B')
  })

  it('preserves a delivery error and can retry without generating an extra local license', async () => {
    mocks.orders.mockResolvedValue({ ...empty, data: [{ ...order, status: 'paid' }], total: 1 })
    mocks.deliver.mockRejectedValue(new Error('发放请求超时'))
    const wrapper = render('orders', true)
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '查看详情')!.trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '发放授权')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('发放请求超时')
    expect(wrapper.text()).not.toContain('授权已生成')
  })

  it('requires a reply before closing a support request and never claims an automatic refund', async () => {
    const request = { id: 9, agency_id: 1, customer_id: 3, customer_name: '学生客户', kind: 'refund', content: '想申请退款', status: 'open', created_at }
    mocks.requests.mockResolvedValue({ ...empty, data: [request], total: 1 })
    const wrapper = render('requests', true)
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '查看详情')!.trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '保存回复')!.trigger('click')
    expect(wrapper.text()).toContain('请填写回复说明')
    const input = wrapper.findAllComponents(ElInput).find(component => component.props('type') === 'textarea')
    input!.vm.$emit('update:modelValue', '已说明退款申请条件，等待进一步核对')
    await flushPromises()
    mocks.respond.mockResolvedValue({ ...request, status: 'resolved', response: '已说明退款申请条件，等待进一步核对' })
    await wrapper.findAll('button').find(button => button.text() === '保存回复')!.trigger('click')
    await flushPromises()
    expect(mocks.respond).toHaveBeenCalledWith(9, { status: 'resolved', response: '已说明退款申请条件，等待进一步核对' })
    expect(wrapper.text()).toContain('不会自动退款或延长授权')
  })

  it.each(['success', 'failure'] as const)('does not let an old delivery %s replace a newly opened order detail', async outcome => {
    const second = { ...order, id: 8, order_no: 'ORDER-B', customer_name: '客户 B', status: 'paid' }
    mocks.orders.mockResolvedValue({ ...empty, data: [{ ...order, status: 'paid' }, second], total: 2 })
    let resolve!: (value: unknown) => void
    let reject!: (cause: Error) => void
    mocks.deliver.mockReturnValue(new Promise((done, fail) => { resolve = done; reject = fail }))
    const wrapper = render('orders', true)
    await flushPromises()
    await wrapper.findAll('button').filter(button => button.text() === '查看详情')[0]!.trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '发放授权')!.trigger('click')
    await wrapper.get('[aria-label="关闭详情"]').trigger('click')
    await wrapper.findAll('button').filter(button => button.text() === '查看详情')[1]!.trigger('click')
    expect(wrapper.get('.test-drawer').text()).toContain('客户 B')
    if (outcome === 'success') resolve({ ...order, status: 'paid' })
    else reject(new Error('旧订单发码失败'))
    await flushPromises()
    const detail = wrapper.get('.test-drawer')
    expect(detail.text()).toContain('客户 B')
    expect(detail.text()).toContain('ORDER-B')
    expect(detail.text()).not.toContain('学生客户')
    expect(detail.text()).not.toContain('旧订单发码失败')
  })
})
