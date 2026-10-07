import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessageBox, ElSelect } from 'element-plus'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AgencyCommissionPanel from '@/features/agency/AgencyCommissionPanel.vue'

const mocks = vi.hoisted(() => ({
  agencies: vi.fn(), commissionPolicy: vi.fn(), commissionSummary: vi.fn(), commissionPreview: vi.fn(),
  updateCommissionPolicy: vi.fn(), confirmCommissionSettlement: vi.fn(), toast: vi.fn(),
}))
vi.mock('@/features/agency/api', () => ({ agencyApi: mocks }))
vi.mock('@/utils', () => ({ showToast: mocks.toast }))
const createdAt = '2026-09-21T01:00:00Z'
const agency = (id: number, name = `代理 ${id}`) => ({ id, name, status: 'active', created_at: createdAt })
const summary = { pending_amount: '12.34', settled_amount: 3, accrued_amount: 20, refunded_amount: '-1.23' }
const preview = { agency_id: 1, month: '2026-09', amount: '12.34', count: 2, revision: 'a'.repeat(64), existing_settlement: null }
const settlement = { id: 3, agency_id: 1, month: '2026-09', amount: '12.34', count: 2, confirmed_at: createdAt, note: '负责人确认 2026-09 线下结算' }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.agencies.mockResolvedValue({ data: [agency(1), agency(2)], total: 2, page: 1, page_size: 100 })
  mocks.commissionPolicy.mockImplementation(async (id: number) => ({ agency_id: id, rate: id === 1 ? 0.1 : 0.2 }))
  mocks.commissionSummary.mockResolvedValue(summary)
  mocks.commissionPreview.mockResolvedValue(preview)
  mocks.updateCommissionPolicy.mockImplementation(async (id: number, rate: number | null) => ({ agency_id: id, rate }))
  mocks.confirmCommissionSettlement.mockResolvedValue(settlement)
})

describe('返佣页面隔离与确认流程', () => {
  it('does not let the previous agency response overwrite a switched agency', async () => {
    let resolveFirst!: (value: unknown) => void
    const first = new Promise(resolve => { resolveFirst = resolve })
    mocks.commissionPolicy.mockImplementation((id: number) => id === 1 ? first : Promise.resolve({ agency_id: 2, rate: 0.2 }))
    const wrapper = mount(AgencyCommissionPanel, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    const select = wrapper.findComponent(ElSelect)
    select.vm.$emit('update:modelValue', 2)
    await flushPromises()
    expect(wrapper.text()).toContain('20%')
    resolveFirst({ agency_id: 1, rate: 0.01 })
    await flushPromises()
    expect(wrapper.text()).toContain('20%')
    expect(wrapper.text()).not.toContain('1%')
    wrapper.unmount()
  })

  it('uses the loaded rate as CAS expected_rate without a hidden reread', async () => {
    const wrapper = mount(AgencyCommissionPanel, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    const input = wrapper.find('#commission-rate')
    await input.setValue('25')
    await wrapper.findAll('button').find(button => button.text() === '保存比例')!.trigger('click')
    await flushPromises()
    expect(mocks.updateCommissionPolicy).toHaveBeenCalledWith(1, 0.25, 0.1)
    expect(mocks.commissionPolicy).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('requires explicit confirmation and prevents duplicate settlement requests', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    let resolve!: (value: unknown) => void
    mocks.confirmCommissionSettlement.mockReturnValue(new Promise(done => { resolve = done }))
    const wrapper = mount(AgencyCommissionPanel, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    await wrapper.find('#commission-month').setValue(preview.month)
    await wrapper.findAll('button').find(button => button.text() === '预览结算')!.trigger('click')
    await flushPromises()
    expect(mocks.commissionPreview).toHaveBeenCalledWith(1, preview.month)
    const button = wrapper.findAll('button').find(item => item.text() === '确认已线下结算')!
    await button.trigger('click')
    await button.trigger('click')
    expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
    expect(mocks.confirmCommissionSettlement).toHaveBeenCalledTimes(1)
    resolve(settlement)
    await flushPromises()
    expect(mocks.toast).toHaveBeenCalledWith('已登记线下结算，不会自动转账', 'success')
    wrapper.unmount()
  })
})
