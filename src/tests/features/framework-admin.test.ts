import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CommercialView from '@/views/admin/CommercialView.vue'
import TeamLedgerView from '@/views/admin/TeamLedgerView.vue'
import ScenariosView from '@/views/admin/ScenariosView.vue'
import RefundEntitlementsPanel from '@/features/admin/RefundEntitlementsPanel.vue'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), paid: vi.fn(), confirm: vi.fn() }))
vi.mock('@/utils/api', () => ({ api: { get: mocks.get, post: mocks.post, put: mocks.put, patch: mocks.patch }, markOrderPaid: mocks.paid }))
vi.mock('@/shared/ui/confirm', () => ({ confirmAction: mocks.confirm }))

const definition = { name: '比赛完整包', price: '199.00', business_line: 'competition', term_type: 'project_end', description: '测试商品', allowed_capabilities: ['template.create'], services: [], availability: 'limited' }
const offer = { id: 1, sku: 'competition-full', version: 1, revision: 3, status: 'draft', definition }
const order = { id: 4, order_no: 'fixture-order', status: 'paid', amount: '199.00', refund_amount: '0.00', commercial: { sku: offer.sku, definition, project_id: 'test-project', ends_at: '2027-01-01T00:00:00Z', site_origin: 'https://example.test' } }
let wrapper: VueWrapper | undefined
let fixtures: Record<string, unknown>
function button(text: string) {
  const match = wrapper!.findAll('button').find(item => item.text() === text)
  if (!match) throw new Error(`Button missing: ${text}`)
  return match
}
function input(text: string, tag = 'input') {
  const label = wrapper!.findAll('label').find(item => item.text().startsWith(text))
  if (!label) throw new Error(`Label missing: ${text}`)
  return label.get(tag)
}
async function click(text: string) { await button(text).trigger('click'); await flushPromises() }
const stubs = { TeamLedgerAdjustments: true, ProjectScopesPanel: true, RefundEntitlementsPanel: true }

beforeEach(() => {
  vi.resetAllMocks()
  fixtures = {
    '/api/commercial/offers': [structuredClone(offer)], '/api/commercial/orders': [structuredClone(order)],
    '/api/commercial/tool-options': [{ capability: 'template.create', name: '配送模板', selectable: true }],
    '/api/team-ledger/summary': { totals: { due: '0', held: '0', paid: '0', unpaid: '0' }, members: [] },
  }
  mocks.get.mockImplementation(async (path: string) => fixtures[path] ?? [])
  mocks.post.mockResolvedValue({ success: true, data: {} })
  mocks.put.mockResolvedValue({ success: true, data: {} })
  mocks.confirm.mockResolvedValue(true)
})
afterEach(() => wrapper?.unmount())

describe('管理端商业流程：先读、再显式确认', () => {
  it('进入商品页不导入/启用草稿，也不收款和发放授权', async () => {
    wrapper = mount(CommercialView, { global: { stubs } }); await flushPromises()
    expect(wrapper.text()).toContain('199 元完整包仍是主推方案')
    expect(mocks.post).not.toHaveBeenCalled(); expect(mocks.paid).not.toHaveBeenCalled()
    mocks.confirm.mockResolvedValue(false)
    await click('确认启用')
    expect(mocks.post).not.toHaveBeenCalled()
    mocks.confirm.mockResolvedValue(true)
    await click('确认启用')
    expect(mocks.post).toHaveBeenCalledWith('/api/commercial/offers/1/activate', { expected_revision: 3 })
  })

  it('单工具39元只建立一个已审核工具的草稿，不自动开单或授予B端权限', async () => {
    wrapper = mount(CommercialView, { global: { stubs } }); await flushPromises()
    await input('已审核工具', 'select').setValue('template.create')
    const form = wrapper.findAll('form').find(item => item.text().includes('只授予所选工具'))!
    await form.trigger('submit'); await flushPromises()
    expect(mocks.post).toHaveBeenCalledTimes(1)
    expect(mocks.post).toHaveBeenCalledWith('/api/commercial/offers', { sku: 'single-template-create', definition: expect.objectContaining({ price: '39.00', business_line: 'single_tool', allowed_capabilities: ['template.create'] }) })
    expect(mocks.paid).not.toHaveBeenCalled()
  })

  it('版本冲突明确显示，保留编辑内容，不显示成功', async () => {
    wrapper = mount(CommercialView, { global: { stubs } }); await flushPromises()
    await click('编辑草稿')
    await input('价格（元）').setValue('209.00')
    mocks.patch.mockRejectedValue(new Error('版本冲突，请刷新后核对'))
    await wrapper.findAll('form')[0]!.trigger('submit'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('版本冲突')
    expect((input('价格（元）').element as HTMLInputElement).value).toBe('209.00')
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })

  it('选择已收款订单仍不预填分配金额、不自动结算付款', async () => {
    wrapper = mount(TeamLedgerView, { global: { stubs } }); await flushPromises()
    await input('新商品已收款订单', 'select').setValue('4'); await flushPromises()
    expect((input('本次分配金额').element as HTMLInputElement).value).toBe('')
    expect(mocks.post).not.toHaveBeenCalled(); expect(mocks.put).not.toHaveBeenCalled()
    await input('本次分配金额').setValue('60.00')
    await input('结算期').setValue('2026-10')
    await input('金额说明').setValue('测试人工分配')
    const form = wrapper.findAll('form').find(item => item.text().includes('本次分配金额（手工填写）'))!
    await form.trigger('submit'); await flushPromises()
    expect(mocks.put).toHaveBeenCalledWith('/api/team-ledger/orders/4/allocation', expect.objectContaining({ amount: '60.00', expected_version: 0, acquisition_member_id: null, closing_member_id: null }))
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('比赛分配使用精确官网入口并要求确认，默认不开管理员写入权限', async () => {
    wrapper = mount(ScenariosView, { global: { stubs } }); await flushPromises()
    expect((input('额外授权已审核').element as HTMLInputElement).checked).toBe(false)
    await input('场景', 'select').setValue('competition')
    expect((input('入口网址').element as HTMLInputElement).value).toBe('https://www.idtrade.cn/User/Contest')
    await input('结束时间').setValue('2027-01-01T12:00')
    mocks.confirm.mockResolvedValue(false)
    await wrapper.findAll('form')[0]!.trigger('submit'); await flushPromises()
    expect(mocks.put).not.toHaveBeenCalled()
    mocks.confirm.mockResolvedValue(true)
    await wrapper.findAll('form')[0]!.trigger('submit'); await flushPromises()
    expect(mocks.put).toHaveBeenCalledWith('/api/scenarios/assignments/user/1', expect.objectContaining({ mode: 'competition', expected_revision: 0, allowed_origins: ['https://www.idtrade.cn'] }))
  })
})

describe('部分退款后权益核对', () => {
  it('不默认恢复工具与所有服务，核对请求绑定退款累计值和版本', async () => {
    const refunded = { ...structuredClone(order), refund_amount: '50.00' }
    fixtures['/api/commercial/orders/4'] = refunded
    fixtures['/api/commercial/orders/4/refund-entitlements'] = { order_id: 4, refund_amount: '50.00', revision: 2, current: false, retained_capabilities: ['template.create'], service_limits: { appointment: 3 }, evidence_ref: null }
    fixtures['/api/commercial/orders/4/fulfillments'] = [{ id: 1, service_code: 'appointment', order_id: 4, completed_count: 1, total_count: 3, remaining_count: 2, minutes_per_unit: 30, revision: 1 }]
    wrapper = mount(RefundEntitlementsPanel, { props: { orders: [refunded] } }); await flushPromises()
    await input('部分退款订单', 'select').setValue('4')
    await wrapper.findAll('form')[0]!.trigger('submit'); await flushPromises()
    expect((input('template.create').element as HTMLInputElement).checked).toBe(false)
    expect((input('appointment').element as HTMLInputElement).value).toBe('')
    await input('template.create').setValue(true)
    await input('appointment').setValue('1')
    await input('核对凭证编号').setValue('ticket-test')
    await wrapper.findAll('form')[1]!.trigger('submit'); await flushPromises()
    expect(mocks.post).toHaveBeenCalledWith('/api/commercial/orders/4/refund-entitlements', { expected_revision: 2, expected_refunded_total: '50.00', retained_capabilities: ['template.create'], service_limits: { appointment: 1 }, evidence_ref: 'ticket-test' })
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })
})
