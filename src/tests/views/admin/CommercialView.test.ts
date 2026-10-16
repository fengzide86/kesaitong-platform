import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import CommercialView from '@/views/admin/CommercialView.vue'
import { authService } from '@/utils/auth'
import type { Offer } from '@/features/admin/commercial'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), paid: vi.fn(), confirm: vi.fn(), motion: vi.fn() }))
vi.mock('@/utils/api', () => ({ api: { get: mocks.get, post: mocks.post, patch: mocks.patch }, markOrderPaid: mocks.paid }))
vi.mock('@/shared/ui/confirm', () => ({ confirmAction: mocks.confirm }))
vi.mock('@/shared/ui/workflowMotion', () => ({ scrollToWorkflowTarget: mocks.motion }))

const baseOffer: Offer = { id: 1, sku: 'competition-full', version: 1, revision: 2, status: 'active', definition: {
  name: '比赛完整包', price: '199.00', business_line: 'competition', term_type: 'project_end',
  description: '以当前已开放工具为准', allowed_capabilities: ['template.create'], services: [], availability: 'limited',
} }
let offers: unknown[]
let wrapper: VueWrapper | undefined
const stubs = { RefundEntitlementsPanel: true }
function button(label: string) {
  const result = wrapper!.findAll('button').find(item => item.text() === label)
  if (!result) throw new Error(`Missing button: ${label}`)
  return result
}
async function open() { wrapper = mount(CommercialView, { global: { stubs } }); await flushPromises(); return wrapper }
async function click(label: string) { await button(label).trigger('click'); await flushPromises() }

beforeEach(() => {
  vi.resetAllMocks()
  authService.setRole('super_admin')
  offers = [structuredClone(baseOffer)]
  mocks.get.mockImplementation(async (path: string) => {
    if (path === '/api/commercial/offers') return offers
    if (path === '/api/commercial/tool-options') return [{ capability: 'template.create', name: '配送模板', selectable: true }]
    return []
  })
  mocks.post.mockResolvedValue({ success: true, data: {} })
  mocks.patch.mockResolvedValue({ success: true, data: {} })
  mocks.confirm.mockResolvedValue(true)
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined })

describe('套餐与服务：按实际状态管理新订单', () => {
  it('只在主动打开编辑或定位时引导，不把新草稿预览当作保存成功', async () => {
    const view = await open()
    expect(mocks.motion).not.toHaveBeenCalled()
    await click('复制为新版本')
    const editor = view.get('.panel.kst-reveal')
    expect(editor.attributes('tabindex')).toBe('-1')
    expect(editor.classes()).not.toContain('kst-confirm')
    expect(mocks.motion).toHaveBeenCalledExactlyOnceWith(editor.element, { block: 'nearest' })
    expect(mocks.post).not.toHaveBeenCalled()
    expect(mocks.patch).not.toHaveBeenCalled()
    await click('新建项目订单')
    expect(mocks.motion).toHaveBeenLastCalledWith(view.get('#commercial-orders').element, { block: 'start' })
  })

  it('默认只展示已启用版本，历史与草稿不重复出现在当前可售列表', async () => {
    offers.push({ ...structuredClone(baseOffer), id: 2, status: 'draft', version: 3 }, { ...structuredClone(baseOffer), id: 3, status: 'retired', version: 7 })
    const view = await open()
    expect(view.text()).toContain('管理可售套餐与服务')
    expect(view.text()).toContain('不会改变客户已经买到的授权')
    expect(view.findAll('[data-offer-id]')).toHaveLength(1)
    expect(view.get('[data-offer-id]').attributes('data-offer-id')).toBe('1')
    await click('待核对草稿 1')
    expect(view.get('[data-offer-id]').attributes('data-offer-id')).toBe('2')
    await click('历史版本 1')
    expect(view.get('[data-offer-id]').attributes('data-offer-id')).toBe('3')
    expect(view.text()).toContain('不再用于新订单')
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('只有草稿时直接呈现待核对内容，但不伪装已启用', async () => {
    offers = [{ ...structuredClone(baseOffer), status: 'draft', definition: { ...baseOffer.definition, name: '比赛工具与指导包', services: [{ code: 'appointment', count: 3, minutes_per_unit: 30 }] } }]
    const view = await open()
    expect(button('待核对草稿 1').attributes('aria-pressed')).toBe('true')
    expect(view.text()).toContain('预约答疑 3 次，每次 30 分钟')
    expect(view.text()).toContain('这些内容尚未对客户生效')
    expect(mocks.post).not.toHaveBeenCalled()
    expect(mocks.paid).not.toHaveBeenCalled()
  })

  it('搜索只过滤当前分类，不改变状态总数；清除后恢复列表', async () => {
    const view = await open()
    await view.get('input[type="search"]').setValue('没有此套餐')
    expect(view.findAll('[data-offer-id]')).toHaveLength(0)
    expect(view.text()).toContain('当前分类中没有找到')
    expect(button('已启用 1').exists()).toBe(true)
    await click('清除搜索')
    expect(view.findAll('[data-offer-id]')).toHaveLength(1)
  })

  it('读取失败不显示假空分类或已启用计数，重试成功才展示真实空态', async () => {
    offers = []
    mocks.get.mockRejectedValueOnce(new Error('网络中断'))
    const view = await open()
    expect(view.get('[role="alert"]').text()).toContain('网络中断')
    expect(view.find('.catalog-statuses').exists()).toBe(false)
    expect(view.text()).not.toContain('尚无新商品')
    await click('重新加载')
    expect(view.text()).toContain('尚无新商品')
    expect(button('已启用 0').exists()).toBe(true)
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it.each(['duplicate', 'unknown'] as const)('拒绝冲突或未知状态的数据，不按版本号猜测当前商品：%s', async problem => {
    if (problem === 'duplicate') offers.push({ ...structuredClone(baseOffer), id: 2, version: 9 })
    else offers = [{ ...structuredClone(baseOffer), status: 'published' }]
    const view = await open()
    expect(view.get('[role="alert"]').text()).toContain('套餐数据不完整或启用版本冲突')
    expect(view.find('.catalog-statuses').exists()).toBe(false)
    expect(view.findAll('[data-offer-id]')).toHaveLength(0)
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('39元参考模板不能启用，未配置原因直接在目录中可见', async () => {
    offers = [{ ...structuredClone(baseOffer), status: 'draft', sku: 'single-tool-39', definition: { ...baseOffer.definition, name: '单个工具', business_line: 'single_tool', price: '39', allowed_capabilities: [] } }]
    const view = await open()
    expect(view.get('.offer-block').text()).toContain('选择具体工具建立草稿')
    expect(button('确认启用').attributes('disabled')).toBeDefined()
    expect(view.get('.single-tool-panel').attributes('open')).toBeUndefined()
    await click('确认启用')
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('缺少可选工具时，折叠区标题也明确说明不能新增的原因', async () => {
    mocks.get.mockImplementation(async (path: string) => path === '/api/commercial/offers' ? offers : [])
    const view = await open()
    expect(view.get('.single-tool-panel').attributes('open')).toBeUndefined()
    expect(view.get('.single-tool-panel summary').text()).toContain('暂无已审核工具，暂不能新增')
  })

  it('启用前保留人工确认和版本号；取消不会写入', async () => {
    offers = [{ ...structuredClone(baseOffer), status: 'draft' }]
    await open()
    mocks.confirm.mockResolvedValueOnce(false)
    await click('确认启用')
    expect(mocks.post).not.toHaveBeenCalled()
    await click('确认启用')
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('不改历史授权') }))
    expect(mocks.post).toHaveBeenCalledWith('/api/commercial/offers/1/activate', { expected_revision: 2 })
  })

  it('无管理权限禁用配置与导出，不读取管理员工具目录', async () => {
    authService.setRole('operator')
    offers = [{ ...structuredClone(baseOffer), status: 'draft' }]
    const view = await open()
    expect(view.text()).toContain('当前账号不能修改套餐')
    for (const label of ['导入标准商品草稿', '编辑草稿', '确认启用', '导出已启用的公开目录']) {
      expect(button(label).attributes('disabled')).toBeDefined()
      await click(label)
    }
    expect(mocks.get).not.toHaveBeenCalledWith('/api/commercial/tool-options', expect.anything(), expect.anything())
    expect(mocks.post).not.toHaveBeenCalled()
    expect(mocks.patch).not.toHaveBeenCalled()
    expect(view.find('refund-entitlements-panel-stub').exists()).toBe(false)
  })

  it('客服角色不能提交订单、收款或服务确认', async () => {
    authService.setRole('support')
    const view = await open()
    const orderForm = view.get('#commercial-orders form')
    expect(orderForm.get('fieldset').attributes('disabled')).toBeDefined()
    await orderForm.trigger('submit')
    await flushPromises()
    expect(mocks.post).not.toHaveBeenCalled()
    expect(mocks.paid).not.toHaveBeenCalled()
  })
})
