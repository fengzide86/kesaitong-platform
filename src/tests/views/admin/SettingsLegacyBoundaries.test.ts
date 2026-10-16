import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount, type VueWrapper } from '@vue/test-utils'
import SettingsView from '@/views/admin/SettingsView.vue'
import { authService } from '@/utils/auth'

const mocks = vi.hoisted(() => ({
  push: vi.fn(), archivePlan: vi.fn(), createPlan: vi.fn(), disablePlan: vi.fn(), enablePlan: vi.fn(),
  getPlansAdmin: vi.fn(), getProfitPolicy: vi.fn(), getSettings: vi.fn(), updatePlan: vi.fn(), updateProfitPolicy: vi.fn(), updateSetting: vi.fn(),
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('@/utils/api', () => mocks)
vi.mock('@/utils', () => ({ showToast: vi.fn() }))

let wrapper: VueWrapper | undefined
async function render() {
  wrapper = shallowMount(SettingsView, { global: { stubs: {
    ElCard: { template: '<section><header><slot name="header" /></header><slot /></section>' },
    ElButton: { props: ['disabled'], template: '<button :disabled="disabled"><slot /></button>' },
    ElForm: { template: '<form><slot /></form>' },
    ElFormItem: { template: '<div><slot /></div>' },
    ElDialog: { props: ['modelValue', 'title'], template: '<section v-if="modelValue" role="dialog"><h2>{{ title }}</h2><slot /><slot name="footer" /></section>' },
    ElTable: true, ElTableColumn: true, ElInput: true, ElInputNumber: true, ElTag: true,
    ElSelect: true, ElOption: true, ElRadioGroup: true, ElRadioButton: true, ElSwitch: true,
  } } })
  await flushPromises()
  return wrapper
}
beforeEach(() => {
  vi.clearAllMocks()
  authService.setRole('super_admin')
  mocks.getPlansAdmin.mockResolvedValue([])
  mocks.getSettings.mockResolvedValue([])
  mocks.getProfitPolicy.mockResolvedValue({ version: 2, ratios: { tech: .3, market: .25, product: .15, service: .15, coordination: .1, record: .05 } })
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined })

describe('系统设置区分新业务与旧版兼容配置', () => {
  it('旧套餐和分润明确标记兼容用途，不把旧设置写成新商品来源', async () => {
    const view = await render()
    expect(view.text()).toContain('旧版套餐（兼容）')
    expect(view.text()).toContain('旧版分润规则')
    expect(view.text()).toContain('仅供旧版下单与授权流程使用')
    expect(view.text()).toContain('不修改新的成员分成台账')
    expect(mocks.getPlansAdmin).toHaveBeenCalledTimes(1)
    expect(mocks.getProfitPolicy).toHaveBeenCalledTimes(1)
    expect(mocks.createPlan).not.toHaveBeenCalled()
    expect(mocks.updatePlan).not.toHaveBeenCalled()
    expect(mocks.updateProfitPolicy).not.toHaveBeenCalled()
  })

  it.each([
    ['管理新套餐与服务 →', '/admin/commercial'],
    ['管理新成员分成 →', '/admin/team-ledger'],
  ])('主入口只导航，不创建或改动配置：%s', async (label, path) => {
    const view = await render()
    const action = view.findAll('button').find(button => button.text() === label)
    expect(action).toBeDefined()
    await action!.trigger('click')
    expect(mocks.push).toHaveBeenCalledWith(path)
    expect(mocks.createPlan).not.toHaveBeenCalled()
    expect(mocks.updateProfitPolicy).not.toHaveBeenCalled()
  })

  it('旧版新增入口继续保留，弹窗清楚标明旧版，不自动迁移', async () => {
    const view = await render()
    await view.findAll('button').find(button => button.text() === '+ 新增旧版套餐')!.trigger('click')
    expect(view.get('[role="dialog"]').text()).toContain('新增旧版套餐')
    expect(mocks.createPlan).not.toHaveBeenCalled()
  })

  it('不向无旧分润管理权限的角色新增商业配置入口', async () => {
    authService.setRole('operator')
    const view = await render()
    expect(view.find('[aria-label="当前业务入口"]').exists()).toBe(false)
    expect(view.text()).not.toContain('编辑旧版比例')
    expect(mocks.push).not.toHaveBeenCalled()
  })
})
