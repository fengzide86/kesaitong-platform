import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import BusinessAccessView from '@/views/admin/BusinessAccessView.vue'

const mocks = vi.hoisted(() => ({
  getTools: vi.fn(), getPlansAdmin: vi.fn(), getAuthCodes: vi.fn(), getSettings: vi.fn(),
  updateSetting: vi.fn(), batchGenerateAuthCodes: vi.fn(), showToast: vi.fn(),
  isSuperAdmin: vi.fn(), clear: vi.fn(), replace: vi.fn(),
}))
vi.mock('@/utils/api', () => ({
  getTools: mocks.getTools, getPlansAdmin: mocks.getPlansAdmin, getAuthCodes: mocks.getAuthCodes,
  getSettings: mocks.getSettings, updateSetting: mocks.updateSetting,
  batchGenerateAuthCodes: mocks.batchGenerateAuthCodes,
}))
vi.mock('@/utils', () => ({ showToast: mocks.showToast }))
vi.mock('@/utils/auth', () => ({ authService: { isSuperAdmin: mocks.isSuperAdmin, clear: mocks.clear } }))
vi.mock('vue-router', () => ({ useRouter: () => ({ replace: mocks.replace }) }))

function liveTool(overrides: Record<string, unknown> = {}) {
  return { id: 'live', name: '批量工具', status: 'online', availability: 'live', script_status: 'script_ready', supports_live_batch: true, ...overrides }
}
function mountView() {
  return mount(BusinessAccessView, { global: {
    directives: { loading: {} },
    stubs: {
      RouterLink: { template: '<a><slot /></a>' }, ElSwitch: true,
      PageHeader: { props: ['title', 'description'], template: '<header>{{ title }} {{ description }}<slot name="actions" /></header>' },
    },
  } })
}

describe('BusinessAccessView factual batch availability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isSuperAdmin.mockReturnValue(true)
    mocks.getPlansAdmin.mockResolvedValue([{ id: 1, name: '专业包', price: 99, product_type: 'business', status: 'active' }])
    mocks.getAuthCodes.mockResolvedValue([])
    mocks.getSettings.mockResolvedValue([{ key: 'business_workspace_enabled', value: 'true' }])
    mocks.getTools.mockResolvedValue([])
  })

  it('counts only executable live batch tools and labels internal demos separately', async () => {
    mocks.getTools.mockResolvedValue([
      liveTool(), liveTool({ id: 'beta', availability: 'live_beta' }),
      liveTool({ id: 'offline', status: 'offline' }),
      liveTool({ id: 'not-ready', script_status: 'script_not_ready' }),
      liveTool({ id: 'read', script_status: 'browser_ready', target_url: 'https://example.test' }),
      liveTool({ id: 'single', supports_live_batch: false, supports_batch: true }),
      liveTool({ id: 'demo', availability: 'demo_only', supports_batch: true }),
    ])
    const wrapper = mountView(); await flushPromises()
    const card = wrapper.findAll('.readiness-grid article')[2]!
    expect(card.get('strong').text()).toBe('2 个')
    expect(card.text()).toContain('已开放批量工具')
    expect(card.text()).toContain('内部演示 1 项，不计入客户可执行工具')
    expect(wrapper.text()).not.toContain('全部按演示模式呈现')
    expect(wrapper.text()).not.toContain('当前不开放批量工具')
    expect(wrapper.text()).toContain('真实执行与内部演示分开验收')
    expect(mocks.batchGenerateAuthCodes).not.toHaveBeenCalled(); wrapper.unmount()
  })

  it('does not advertise demo-only batch entries as customer execution', async () => {
    mocks.getTools.mockResolvedValue([liveTool({ availability: 'demo_only', supports_demo_batch: true })])
    const wrapper = mountView(); await flushPromises()
    expect(wrapper.findAll('.readiness-grid article')[2]!.get('strong').text()).toBe('0 个')
    expect(wrapper.text()).toContain('暂无已开放的真实批量工具')
    expect(wrapper.text()).toContain('当前目录没有开放的真实批量工具')
    expect(wrapper.text()).toContain('本机会话上限')
    wrapper.unmount()
  })

  it('operator remains unable to fetch or change global release settings', async () => {
    mocks.isSuperAdmin.mockReturnValue(false)
    const wrapper = mountView(); await flushPromises()
    expect(mocks.getSettings).not.toHaveBeenCalled()
    expect(mocks.updateSetting).not.toHaveBeenCalled()
    expect(wrapper.find('el-switch-stub').exists()).toBe(false)
    expect(wrapper.text()).toContain('内部验证授权准备')
    expect(wrapper.text()).toContain('不可修改全局发布设置')
    wrapper.unmount()
  })

  it.each(['getSettings', 'getPlansAdmin', 'getAuthCodes', 'getTools'] as const)('isolates %s failure and offers retry rather than showing false closed/zero', async method => {
    mocks[method].mockRejectedValueOnce(new Error('offline'))
    const wrapper = mountView(); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('读取失败')
    expect(wrapper.text()).toContain('待确认')
    if (method === 'getSettings') {
      expect(wrapper.find('el-switch-stub').attributes('disabled')).toBe('true')
      expect(wrapper.find('el-switch-stub').attributes('inactive-text')).toBe('待确认')
      expect(wrapper.find('el-switch-stub').attributes('active-text')).toBe('待确认')
      await (wrapper.vm as unknown as { saveWorkspaceEnabled: (enabled: boolean) => Promise<void> }).saveWorkspaceEnabled(true)
      expect(mocks.updateSetting).not.toHaveBeenCalled()
    }
    if (method === 'getTools') {
      expect(wrapper.text()).not.toContain('当前目录没有开放的真实批量工具')
      expect(wrapper.text()).toContain('批量工具状态尚未确认')
    }
    await wrapper.get('[role="alert"] button').trigger('click'); await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.find('el-switch-stub').attributes('inactive-text')).toBe('关闭')
    expect(wrapper.find('el-switch-stub').attributes('active-text')).toBe('开启')
    wrapper.unmount()
  })
})
