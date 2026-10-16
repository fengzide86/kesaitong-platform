import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TeamLedgerView from '@/views/admin/TeamLedgerView.vue'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), confirm: vi.fn() }))
vi.mock('@/utils/api', () => ({ api: { get: mocks.get, post: mocks.post, put: mocks.put } }))
vi.mock('@/shared/ui/confirm', () => ({ confirmAction: mocks.confirm }))

let wrapper: VueWrapper | undefined
let fixtures: Record<string, unknown>
const members = [
  { id: 1, name: '林同学', active: true, version: 1, ledger_version: 7 },
  { id: 2, name: '陈同学', active: true, version: 1, ledger_version: 4 },
]
const entries = [
  { id: 101, order_id: 4, member_id: 1, item_code: 'tools', bucket: 'due', kind: 'allocation', amount: '100.00', note: '已确认的工具分成' },
  { id: 102, order_id: 5, member_id: 2, item_code: 'support', bucket: 'held', kind: 'allocation', amount: '20.00', note: '服务待完成' },
  { id: 103, order_id: null, member_id: 1, item_code: null, bucket: 'paid', kind: 'payment', amount: '30.00', note: '凭据已登记' },
  { id: 104, order_id: 5, member_id: null, item_code: 'sales', bucket: 'held', kind: 'allocation', amount: '10.00', note: '待指定成员' },
  { id: 105, order_id: 9, member_id: 99, item_code: 'legacy', bucket: 'due', kind: 'allocation', amount: '0.01', note: '成员名称尚未加载' },
]

async function render() {
  wrapper = mount(TeamLedgerView, { global: { stubs: { PageHeader: true, RouterLink: true, TeamLedgerAdjustments: true } } })
  await flushPromises()
}
function field(text: string, tag = 'input') {
  return wrapper!.findAll('label').find(label => label.text().startsWith(text) && label.find(tag).exists())!.get(tag)
}
async function click(text: string) {
  await wrapper!.findAll('button').find(button => button.text() === text)!.trigger('click')
  await flushPromises()
}
const entryRows = () => wrapper!.findAll('[data-testid="ledger-entry-row"]')
const balanceRows = () => wrapper!.findAll('[data-testid="member-balance-row"]')

beforeEach(() => {
  vi.resetAllMocks()
  fixtures = {
    '/api/team-ledger/members': structuredClone(members),
    '/api/team-ledger/summary': {
      totals: { due: '1000.01', held: '30.00', paid: '300.00', unpaid: '700.01' },
      members: [
        { ...members[0], due: '100.00', held: '0.00', paid: '30.00', unpaid: '70.00' },
        { ...members[1], due: '0.00', held: '20.00', paid: '0.00', unpaid: '0.00' },
      ],
    },
    '/api/team-ledger/entries': structuredClone(entries),
    '/api/commercial/orders': [
      { id: 4, order_no: 'KST-20261016-A04', amount: '199.00', status: 'paid', commercial: { sku: 'competition-full', definition: { name: '比赛完整包' } } },
      { id: 5, order_no: 'KST-20261016-A05', amount: '69.00', status: 'paid', commercial: { sku: 'training-full', definition: { name: '实训完整工具包' } } },
    ],
  }
  mocks.get.mockImplementation(async (path: string) => fixtures[path] ?? [])
  mocks.post.mockResolvedValue({ success: true, data: {} })
  mocks.confirm.mockResolvedValue(false)
})
afterEach(() => wrapper?.unmount())

describe('成员台账以日常查账为先', () => {
  it('总览、成员余额和明细排在配置之前，低频设置默认折叠且不写入', async () => {
    await render()
    const html = wrapper!.html()
    expect(html.indexOf('ledger-overview')).toBeLessThan(html.indexOf('member-balances-heading'))
    expect(html.indexOf('member-balances-heading')).toBeLessThan(html.indexOf('ledger-records-heading'))
    expect(html.indexOf('ledger-records-heading')).toBeLessThan(html.indexOf('ledger-settlement-settings'))
    for (const section of ['ledger-settlement-settings', 'ledger-adjustment-settings', 'ledger-rule-settings']) {
      expect(wrapper!.get(`[data-testid="${section}"]`).attributes('open')).toBeUndefined()
    }
    const fileImport = wrapper!.get('[data-testid="ledger-policy-file"]')
    expect(fileImport.attributes('open')).toBeUndefined()
    expect(fileImport.get('summary').text()).toBe('从规则文件导入')
    expect(fileImport.find('input[type="file"]').exists()).toBe(true)
    expect(wrapper!.text()).toContain('最多最近 200 条')
    expect(wrapper!.text()).toContain('不是全历史搜索')
    expect(mocks.post).not.toHaveBeenCalled()
    expect(mocks.put).not.toHaveBeenCalled()
  })

  it('筛选成员和余额情况不改变服务端累计总览，也不改变明细列表', async () => {
    await render()
    const total = wrapper!.get('[data-testid="ledger-overview"]').text()
    expect(total).toContain('¥1000.01')
    expect(total).toContain('¥700.01')
    await field('查找成员').setValue('林')
    expect(balanceRows()).toHaveLength(1)
    expect(balanceRows()[0]!.text()).toContain('林同学')
    await field('余额情况', 'select').setValue('held')
    expect(balanceRows()).toHaveLength(0)
    expect(wrapper!.text()).toContain('没有符合筛选条件的成员')
    expect(wrapper!.get('[data-testid="ledger-overview"]').text()).toBe(total)
    expect(entryRows()).toHaveLength(5)
    await click('清除成员筛选')
    expect(balanceRows()).toHaveLength(2)
    await field('余额情况', 'select').setValue('unpaid')
    expect(balanceRows()).toHaveLength(1)
    expect(balanceRows()[0]!.text()).toContain('林同学')
  })

  it('成员、订单号及状态组合筛选只作用于已加载明细，不额外调用接口', async () => {
    await render()
    const readCount = mocks.get.mock.calls.length
    const total = wrapper!.get('[data-testid="ledger-overview"]').text()
    await field('成员', 'select').setValue('2')
    await field('查找订单').setValue(' a05 ')
    await field('记录状态', 'select').setValue('held')
    expect(entryRows()).toHaveLength(1)
    expect(entryRows()[0]!.text()).toContain('服务待完成')
    expect(wrapper!.text()).toContain('已加载 5 条明细，当前显示 1 条')
    expect(mocks.get).toHaveBeenCalledTimes(readCount)
    expect(wrapper!.get('[data-testid="ledger-overview"]').text()).toBe(total)
    await field('记录状态', 'select').setValue('paid')
    expect(entryRows()).toHaveLength(0)
    expect(wrapper!.text()).toContain('已加载记录中没有匹配的明细')
    await click('清除明细筛选')
    expect(entryRows()).toHaveLength(5)
  })

  it('支持订单编号、未分配记录和缺少姓名的成员，不将缺少姓名误作未分配', async () => {
    await render()
    await field('查找订单').setValue('#9')
    expect(entryRows()).toHaveLength(1)
    expect(entryRows()[0]!.text()).toContain('订单 #9')
    expect(entryRows()[0]!.text()).toContain('成员 #99')
    await field('成员', 'select').setValue('99')
    expect(entryRows()).toHaveLength(1)
    await click('清除明细筛选')
    await field('成员', 'select').setValue('unassigned')
    expect(entryRows()).toHaveLength(1)
    expect(entryRows()[0]!.text()).toContain('待指定成员')
  })

  it('付款登记保留成员版本、人工确认与凭据，不因展开表单写账', async () => {
    await render()
    await click('登记线下付款')
    expect(wrapper!.get('.ledger-payment').text()).toContain('登记付款 · 林同学')
    expect(wrapper!.get('.ledger-payment').classes()).toContain('kst-reveal')
    expect(wrapper!.get('.ledger-payment').classes()).not.toContain('kst-confirm')
    expect(mocks.post).not.toHaveBeenCalled()
    await field('本次实际付款金额').setValue('25.00')
    await field('凭据编号').setValue('offline-receipt-001')
    await field('说明').setValue('测试线下付款')
    await wrapper!.get('.ledger-payment').trigger('submit')
    await flushPromises()
    expect(mocks.post).not.toHaveBeenCalled()
    mocks.confirm.mockResolvedValue(true)
    await wrapper!.get('.ledger-payment').trigger('submit')
    await flushPromises()
    expect(mocks.post).toHaveBeenCalledWith('/api/team-ledger/payments', {
      member_id: 1, amount: '25.00', evidence: 'offline-receipt-001', note: '测试线下付款', expected_ledger_version: 7, idempotency_key: expect.any(String),
    })
    expect(wrapper!.find('.ledger-payment').exists()).toBe(false)
  })

  it('明细使用已加载规则中的中文分配项，无法确定时提示核对，不直接显示技术编号', async () => {
    fixtures['/api/team-ledger/policies'] = [
      { id: 1, name: '规则一', version: 1, status: 'active', product_skus: [], items: [{ code: 'tools', label: '业务工具开发' }, { code: 'support', label: '客户交付支持' }] },
      { id: 2, name: '规则二', version: 2, status: 'draft', product_skus: [], items: [{ code: 'tools', label: '业务工具开发' }, { code: 'support', label: '售后支持' }] },
    ]
    await render()
    const itemCells = entryRows().map(row => row.findAll('td')[1]!)
    expect(itemCells[0]!.text()).toContain('业务工具开发')
    expect(itemCells[0]!.get('small').attributes('title')).toBe('原始分配项编号：tools')
    expect(itemCells[1]!.get('small').text()).toBe('分配项待核对')
    expect(itemCells[2]!.get('small').text()).toBe('线下付款')
    expect(itemCells[2]!.get('small').attributes('title')).toBeUndefined()
    expect(itemCells[3]!.get('small').text()).toBe('分配项待核对')
    expect(itemCells[4]!.text()).not.toContain('legacy')
  })

  it('分配项为空不一律解释为线下付款，只有真实payment类型可以这样展示', async () => {
    fixtures['/api/team-ledger/entries'] = [{ ...entries[0], item_code: null, kind: 'adjustment' }]
    await render()
    expect(entryRows()[0]!.findAll('td')[1]!.get('small').text()).toBe('分配项待核对')
  })

  it('新版分成方案仅按需读取预览，再显式导入草稿，不自动启用或变更旧规则', async () => {
    const policy = { name: '服务器返回的测试方案', product_skus: ['competition-full'], items: [{ code: 'test-item', label: '测试交付', group: '测试板块', ratio: '1', method: 'fixed', service_code: 'test-duty', purchased_service_codes: ['appointment'] }] }
    fixtures['/api/team-ledger/policy-template'] = policy
    await render()
    ;(wrapper!.get('[data-testid="ledger-rule-settings"]').element as HTMLDetailsElement).open = true
    expect(mocks.get).not.toHaveBeenCalledWith('/api/team-ledger/policy-template', expect.anything(), expect.anything())
    await click('载入新版分成方案')
    expect(wrapper!.text()).toContain('服务器返回的测试方案')
    expect(wrapper!.text()).toContain('测试板块 / 测试交付')
    expect(wrapper!.get('[data-testid="ledger-policy-summary"]').text()).toContain('1 项')
    expect(wrapper!.get('[data-testid="ledger-policy-summary"]').text()).toContain('合计 100%')
    expect(wrapper!.get('[data-testid="ledger-policy-summary"]').text()).toContain('仅预览，尚未保存')
    expect(wrapper!.get('.ledger-policy-preview').classes()).toContain('kst-reveal')
    expect(wrapper!.find('.kst-confirm').exists()).toBe(false)
    expect(wrapper!.get('[data-testid="ledger-policy-file"]').attributes('open')).toBeUndefined()
    expect(wrapper!.get('#ledger-policy-scroll-hint').text()).not.toContain('向下滚动')
    expect(mocks.post).not.toHaveBeenCalled()
    await click('导入为草稿')
    expect(mocks.post).toHaveBeenCalledTimes(1)
    expect(mocks.post).toHaveBeenCalledWith('/api/team-ledger/policies', policy)
    expect(mocks.put).not.toHaveBeenCalled()
    expect(wrapper!.text()).toContain('尚未启用')
    expect(wrapper!.find('[data-testid="ledger-policy-summary"]').exists()).toBe(false)
    expect(wrapper!.get('.kst-confirm').text()).toContain('尚未启用')
  })

  it('规则预览条数和比例合计来自真实数据，长列表提示滚动并保留末尾交付项', async () => {
    fixtures['/api/team-ledger/policy-template'] = {
      name: '非正式比例测试方案', product_skus: ['competition-full'],
      items: Array.from({ length: 19 }, (_, index) => ({ code: `fixture-${index}`, label: `测试分配项 ${index + 1}`, group: '测试板块', ratio: '0.05', service_code: index === 18 ? 'fixture-duty' : null })),
    }
    await render()
    await click('载入新版分成方案')
    const summary = wrapper!.get('[data-testid="ledger-policy-summary"]').text()
    expect(summary).toContain('19 项')
    expect(summary).toContain('合计 95%')
    expect(summary).not.toContain('100%')
    expect(wrapper!.get('#ledger-policy-scroll-hint').text()).toContain('向下滚动查看其余分配项')
    const region = wrapper!.get('[aria-label="规则明细预览"]')
    expect(region.attributes('tabindex')).toBe('0')
    expect(region.attributes('aria-describedby')).toBe('ledger-policy-scroll-hint')
    expect(region.findAll('tbody tr')).toHaveLength(19)
    expect(region.findAll('tbody tr').at(-1)!.text()).toContain('内部职责凭证')
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('可选规则文件在次级折叠区内仍可载入，预览不会自动保存', async () => {
    await render()
    const details = wrapper!.get('[data-testid="ledger-policy-file"]')
    ;(details.element as HTMLDetailsElement).open = true
    const policy = { name: '文件测试规则', product_skus: ['training-full'], items: [{ code: 'sample', label: '文件测试项', group: '测试', ratio: '0.175' }] }
    const file = new File(['fixture'], 'rule.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', { value: async () => JSON.stringify(policy) })
    const input = details.get('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flushPromises()
    expect(wrapper!.get('.ledger-policy-preview').text()).toContain('文件测试规则')
    expect(wrapper!.get('[data-testid="ledger-policy-summary"]').text()).toContain('合计 17.5%')
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('模板读取或格式验证失败会移除旧预览，不能继续误导入旧方案', async () => {
    fixtures['/api/team-ledger/policy-template'] = { name: '旧预览测试方案', product_skus: ['competition-full'], items: [{ code: 'sample', label: '测试项', group: '测试', ratio: '1' }] }
    await render()
    await click('载入新版分成方案')
    expect(wrapper!.text()).toContain('旧预览测试方案')
    mocks.get.mockRejectedValueOnce(new Error('没有读取新版方案的权限'))
    await click('载入新版分成方案')
    expect(wrapper!.text()).not.toContain('旧预览测试方案')
    expect(wrapper!.get('[role="alert"]').text()).toContain('没有读取新版方案的权限')
    expect(wrapper!.findAll('button').some(button => button.text() === '导入为草稿')).toBe(false)
    fixtures['/api/team-ledger/policy-template'] = { unexpected: true }
    await click('载入新版分成方案')
    expect(wrapper!.findAll('button').some(button => button.text() === '导入为草稿')).toBe(false)
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('刷新失败不继续展示旧明细或零余额，重试成功后恢复', async () => {
    await render()
    mocks.get.mockRejectedValueOnce(new Error('网络暂时不可用'))
    await click('刷新台账')
    expect(wrapper!.get('[role="alert"]').text()).toContain('网络暂时不可用')
    expect(entryRows()).toHaveLength(0)
    expect(wrapper!.get('[data-testid="ledger-overview"]').text()).not.toContain('¥0')
    expect(wrapper!.text()).not.toContain('暂无已确认的台账明细')
    await click('重新加载')
    expect(entryRows()).toHaveLength(5)
    expect(wrapper!.find('[role="alert"]').exists()).toBe(false)
  })
})
