import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElPagination, ElSelect } from 'element-plus'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AgencyCommissionPanel from '@/features/agency/AgencyCommissionPanel.vue'

const mocks = vi.hoisted(() => ({
  agencies: vi.fn(), commissionPolicy: vi.fn(), commissionSummary: vi.fn(), commissionPreview: vi.fn(),
  updateCommissionPolicy: vi.fn(), confirmCommissionSettlement: vi.fn(), commissionEntries: vi.fn(), commissionSettlements: vi.fn(),
}))
vi.mock('@/features/agency/api', () => ({ agencyApi: mocks }))
vi.mock('@/utils', () => ({ showToast: vi.fn() }))
const agency = (id: number) => ({ id, name: `样例代理${id}`, status: 'active', created_at: '2026-10-16T01:00:00Z' })
const entry = (agencyId: number, id = 1) => ({ id, agency_id: agencyId, order_id: id, order_no: `ORDER-AGENCY-${agencyId}-${id}`, kind: 'accrual', amount: 19.9, rate_snapshot: 0.1, order_amount_snapshot: 199, occurred_at: '2026-10-16T01:00:00Z', settlement_id: null })
const settlement = (agencyId: number) => ({ id: agencyId, agency_id: agencyId, month: '2026-09', amount: 19.9, count: 1, confirmed_at: '2026-10-01T01:00:00Z', note: `已核对代理${agencyId}` })
const result = <T>(data: T[], total = data.length) => ({ data, total, page: 1, page_size: 20 })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
const mountView = () => mount(AgencyCommissionPanel, { global: { plugins: [ElementPlus] } })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.agencies.mockResolvedValue(result([agency(1), agency(2)]))
  mocks.commissionPolicy.mockImplementation(async (id: number) => ({ agency_id: id, rate: 0.1 }))
  mocks.commissionSummary.mockResolvedValue({ pending_amount: 19.9, settled_amount: 39.8, accrued_amount: 59.7, refunded_amount: 0 })
  mocks.commissionEntries.mockImplementation(async (id: number) => result([entry(id)], 41))
  mocks.commissionSettlements.mockImplementation(async (id: number) => result([settlement(id)], 21))
  mocks.commissionPreview.mockResolvedValue({ agency_id: 1, month: '2026-09', amount: 19.9, count: 1, revision: 'a'.repeat(64), existing_settlement: null })
})

describe('管理端代理返佣的日常核账', () => {
  it('默认展示所选代理的待结算订单，历史与改比例默认折叠', async () => {
    const wrapper = mountView(); await flushPromises()
    expect(mocks.commissionEntries).toHaveBeenCalledWith(1, { page: 1, page_size: 20, settled: false })
    expect(wrapper.get('.agency-selector').text()).toContain('样例代理1')
    expect(wrapper.get('.ledger-card').text()).toContain('ORDER-AGENCY-1-1')
    expect(wrapper.get('.ledger-card').text()).toContain('¥199.00')
    expect(wrapper.get('.ledger-card').text()).toContain('按 10% 记录')
    expect(wrapper.get('[data-testid="commission-rate-settings"]').attributes('open')).toBeUndefined()
    expect(wrapper.get('[data-testid="commission-history"]').attributes('open')).toBeUndefined()
    expect(mocks.commissionSettlements).not.toHaveBeenCalled()
    expect(wrapper.html().indexOf('ledger-card')).toBeLessThan(wrapper.html().indexOf('settlement-card'))
    wrapper.unmount()
  })

  it('分页和状态筛选由服务端处理，不能改变所选代理累计汇总', async () => {
    const wrapper = mountView(); await flushPromises()
    const summary = wrapper.get('.summary-grid').text()
    wrapper.getComponent(ElPagination).vm.$emit('current-change', 2); await flushPromises()
    expect(mocks.commissionEntries).toHaveBeenLastCalledWith(1, { page: 2, page_size: 20, settled: false })
    const filter = wrapper.findAllComponents(ElSelect)[1]!
    filter.vm.$emit('update:modelValue', 'settled'); filter.vm.$emit('change', 'settled'); await flushPromises()
    expect(mocks.commissionEntries).toHaveBeenLastCalledWith(1, { page: 1, page_size: 20, settled: true })
    expect(wrapper.get('.summary-grid').text()).toBe(summary)
    expect(mocks.commissionSummary).toHaveBeenCalledTimes(1)
    filter.vm.$emit('update:modelValue', 'all'); filter.vm.$emit('change', 'all'); await flushPromises()
    expect(mocks.commissionEntries).toHaveBeenLastCalledWith(1, { page: 1, page_size: 20, settled: undefined })
    wrapper.unmount()
  })

  it('切换代理后旧明细响应不会串入新代理', async () => {
    const slow = deferred<ReturnType<typeof result<ReturnType<typeof entry>>>>()
    mocks.commissionEntries.mockImplementation((id: number) => id === 1 ? slow.promise : Promise.resolve(result([entry(id)])))
    const wrapper = mountView(); await flushPromises()
    wrapper.findAllComponents(ElSelect)[0]!.vm.$emit('update:modelValue', 2); await flushPromises()
    slow.resolve(result([entry(1)])); await flushPromises()
    expect(wrapper.get('.ledger-card').text()).toContain('ORDER-AGENCY-2-1')
    expect(wrapper.get('.ledger-card').text()).not.toContain('ORDER-AGENCY-1-1')
    wrapper.unmount()
  })

  it('历史按需读取、分页，切换代理后忽略旧历史响应', async () => {
    const slow = deferred<ReturnType<typeof result<ReturnType<typeof settlement>>>>()
    mocks.commissionSettlements.mockImplementation((id: number) => id === 1 ? slow.promise : Promise.resolve(result([settlement(id)], 21)))
    const wrapper = mountView(); await flushPromises()
    const history = wrapper.get('[data-testid="commission-history"]')
    ;(history.element as HTMLDetailsElement).open = true; await history.trigger('toggle'); await flushPromises()
    expect(mocks.commissionSettlements).toHaveBeenCalledWith(1, { page: 1, page_size: 20 })
    wrapper.findAllComponents(ElSelect)[0]!.vm.$emit('update:modelValue', 2); await flushPromises()
    slow.resolve(result([settlement(1)])); await flushPromises()
    expect(history.text()).toContain('已核对代理2'); expect(history.text()).not.toContain('已核对代理1')
    history.getComponent(ElPagination).vm.$emit('current-change', 2); await flushPromises()
    expect(mocks.commissionSettlements).toHaveBeenLastCalledWith(2, { page: 2, page_size: 20 })
    wrapper.unmount()
  })

  it('读取失败不显示零或暂无记录，提供重试且禁止核账失败时确认', async () => {
    mocks.commissionSummary.mockRejectedValue(new Error('汇总读取失败'))
    mocks.commissionEntries.mockRejectedValueOnce(new Error('明细读取失败'))
    const wrapper = mountView(); await flushPromises()
    expect(wrapper.findAll('.summary-grid strong').map(node => node.text())).toEqual(['—', '—', '—', '—'])
    expect(wrapper.get('.ledger-card').text()).toContain('明细读取失败')
    expect(wrapper.get('.ledger-card').text()).not.toContain('没有返佣记录')
    await wrapper.get('#commission-month').setValue('2026-09')
    await wrapper.findAll('button').find(button => button.text() === '预览结算')!.trigger('click'); await flushPromises()
    expect(wrapper.findAll('button').find(button => button.text() === '确认已线下结算')!.attributes('disabled')).toBeDefined()
    await wrapper.findAll('button').find(button => button.text() === '重试明细')!.trigger('click'); await flushPromises()
    expect(wrapper.get('.ledger-card').text()).toContain('ORDER-AGENCY-1-1')
    expect(mocks.confirmCommissionSettlement).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('历史失败不冒充没有结算，且可独立重试', async () => {
    mocks.commissionSettlements.mockRejectedValueOnce(new Error('历史记录读取失败'))
    const wrapper = mountView(); await flushPromises()
    const history = wrapper.get('[data-testid="commission-history"]')
    ;(history.element as HTMLDetailsElement).open = true; await history.trigger('toggle'); await flushPromises()
    expect(history.text()).toContain('历史记录读取失败'); expect(history.text()).not.toContain('尚未登记过')
    await history.findAll('button').find(button => button.text() === '重试结算记录')!.trigger('click'); await flushPromises()
    expect(history.text()).toContain('已核对代理1')
    wrapper.unmount()
  })
})
