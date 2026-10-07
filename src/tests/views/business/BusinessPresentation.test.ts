import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import type { BusinessTool } from '@/features/business/model'

const mocks = vi.hoisted(() => ({ useStore: vi.fn(), showToast: vi.fn(), push: vi.fn() }))
vi.mock('@/stores/businessWorkspace', () => ({ useBusinessWorkspaceStore: mocks.useStore }))
vi.mock('@/utils', () => ({ showToast: mocks.showToast }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.push }), onBeforeRouteLeave: vi.fn() }))
vi.mock('@/runtime/capabilities', () => ({ getRuntimeCapabilities: () => ({ batchLive: true }) }))
vi.mock('@/runtime/desktop-download', () => ({ downloadDesktopInstaller: vi.fn() }))

import OverviewView from '@/views/business/OverviewView.vue'
import WorkspaceView from '@/views/business/WorkspaceView.vue'

function tool(id: string, overrides: Record<string, unknown> = {}): BusinessTool {
  return { id, name: id, capability_key: id, availability: 'live', script_status: 'script_ready',
    release_status: 'available', supports_live_batch: true, supports_demo_batch: false,
    demo_scenario_id: 'legacy', batch_input_schema: [{ key: 'order_id', label: '订单号', required: true }], ...overrides } as BusinessTool
}

const wrappers: VueWrapper[] = []
function render(component: typeof OverviewView | typeof WorkspaceView) {
  const wrapper = mount(component, { global: { stubs: {
    BusinessBatchRunConsole: true,
    BusinessHelpDrawer: { props: ['modelValue'], template: '<section v-if="modelValue" data-testid="business-help">使用帮助</section>' },
    RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
  } } })
  wrappers.push(wrapper)
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.useStore.mockReturnValue(reactive({
    tools: [] as BusinessTool[], bootstrap: { tools: [] }, bootstrapStale: false, bootstrapRefreshing: false,
    selectedTool: null as BusinessTool | null, isActive: false,
    snapshot: { status: 'idle', recordKind: 'live', items: [], counts: {} },
    entitlements: { max_batch_rows: 20 }, importPreview: null,
    loading: false, error: null, recoveryPending: 0, recoveryStorageUnavailable: false,
    history: [], demoHistory: [{ id: 'legacy-demo', tool_name_snapshot: '旧演示批次' }],
    historyLoading: false, historyError: null,
    init: vi.fn().mockResolvedValue(undefined), reconcileToolSelection: vi.fn(), loadHistory: vi.fn().mockResolvedValue([]),
    loadDemoHistory: vi.fn().mockResolvedValue([]), refreshBootstrap: vi.fn().mockResolvedValue(undefined),
    chooseTool: vi.fn(), selectImportFile: vi.fn(), loadSampleImport: vi.fn(), saveSampleTemplate: vi.fn(), startBatch: vi.fn(),
  }))
})
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()))

describe('business customer presentation', () => {
  it('loads real overview history without promoting legacy demos as capabilities', async () => {
    const store = mocks.useStore()
    store.tools = [tool('ship_script'), tool('demo_tool', { availability: 'demo_only' })]
    store.history = [{ id: 'real', tool_name: '订单发货', total_count: 1, completed_count: 1, failed_count: 0, status: 'completed' }]
    const wrapper = render(OverviewView)
    await flushPromises()
    expect(store.loadHistory).toHaveBeenCalledOnce()
    expect(store.loadDemoHistory).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('1 个可用批量工具')
    expect(wrapper.text()).toContain('最近真实批次')
    expect(wrapper.text()).toContain('订单发货')
    expect(wrapper.text()).not.toMatch(/旧演示批次|全部账号同步推进|所有页面与结果均为模拟/)
  })

  it('shows an honest no-live-tools state and all eight preparation topics', async () => {
    const store = mocks.useStore()
    store.tools = [tool('demo_listing', { availability: 'demo_only' })]
    const wrapper = render(WorkspaceView)
    await flushPromises()
    expect(wrapper.text()).toContain('当前还没有开放的批量工具')
    expect(wrapper.findAll('.task-preparation article')).toHaveLength(8)
    expect(wrapper.get('.help-entry').text()).toBe('使用帮助')
    expect(wrapper.get('.workspace-privacy').text()).toBe('Excel 原文和登录凭据仅留在本机')
    expect(wrapper.find('.page-header-v6__actions .workspace-privacy').exists()).toBe(false)
    expect(wrapper.text()).not.toMatch(/一键载入演示数据|8 条样例|demo_listing/)
    expect(wrapper.find('[data-testid="business-file-upload"]').exists()).toBe(false)
    await wrapper.get('.help-entry').trigger('click')
    expect(wrapper.find('[data-testid="business-help"]').exists()).toBe(true)
    expect(store.startBatch).not.toHaveBeenCalled()
    expect(store.loadSampleImport).not.toHaveBeenCalled()
  })

  it('keeps help available when bootstrap cannot load', async () => {
    const store = mocks.useStore()
    store.bootstrap = null
    store.error = '目录网络失败'
    const wrapper = render(WorkspaceView)
    await flushPromises()
    expect(wrapper.text()).toContain('批量工作台暂时无法载入')
    await wrapper.get('.help-entry').trigger('click')
    expect(wrapper.find('[data-testid="business-help"]').exists()).toBe(true)
    expect(wrapper.findAll('a').every(link => !String(link.attributes('href')).startsWith('/user/'))).toBe(true)
  })

  it('filters by the shared task vocabulary and never launches unready or demo tools', async () => {
    const store = mocks.useStore()
    const shipping = tool('ship_script', { name: '发货助手' })
    store.tools = [shipping, tool('listing_script', { name: '发布助手' }),
      tool('fba_agl', { name: 'FBA准备', script_status: 'script_not_ready' }),
      tool('demo_hidden', { availability: 'demo_only' })]
    const wrapper = render(WorkspaceView)
    await flushPromises()
    expect(wrapper.findAll('.business-tools button')).toHaveLength(3)
    const unready = wrapper.findAll('.business-tools button').find(button => button.text().includes('FBA准备'))!
    expect(unready.attributes('disabled')).toBeDefined()
    await wrapper.get('input[type="search"]').setValue('订单发货')
    expect(wrapper.findAll('.business-tools button')).toHaveLength(1)
    await wrapper.get('.business-tools button').trigger('click')
    expect(store.chooseTool).toHaveBeenCalledWith(shipping)
    expect(store.startBatch).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('一键载入演示数据')
  })

  it('preserves visible import failures and opens B support before a batch exists', async () => {
    const store = mocks.useStore()
    const selected = tool('ship_script', { name: '发货助手' })
    store.tools = [selected]
    store.selectedTool = selected
    store.selectImportFile.mockRejectedValue(new Error('缺少订单号列'))
    const wrapper = render(WorkspaceView)
    await flushPromises()
    expect(wrapper.text()).toContain('订单号：必填，使用本机真实资料')
    await wrapper.get('[data-testid="business-file-upload"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('缺少订单号列')
    await wrapper.get('[role="alert"] button').trigger('click')
    expect(wrapper.find('[data-testid="business-help"]').exists()).toBe(true)
    expect(store.startBatch).not.toHaveBeenCalled()
    expect(store.loadSampleImport).not.toHaveBeenCalled()
  })

  it('does not use a stale demo selection to create a new ordinary customer batch', async () => {
    const store = mocks.useStore()
    store.tools = [tool('ship_script')]
    store.selectedTool = tool('legacy_demo', { availability: 'demo_only' })
    store.importPreview = { validCount: 8, rows: [] }
    const wrapper = render(WorkspaceView)
    await flushPromises()
    const start = wrapper.findAll('button').find(button => button.text() === '开始批量执行')!
    expect(start.attributes('disabled')).toBeDefined()
    await start.trigger('click')
    expect(store.startBatch).not.toHaveBeenCalled()
  })

  it('uses latest same-ID catalog status to disable import and start even if an old object remains selected', async () => {
    const store = mocks.useStore()
    const old = tool('ship_script')
    store.selectedTool = old
    store.tools = [old]
    store.importPreview = { validCount: 1, rows: [] }
    const wrapper = render(WorkspaceView)
    await flushPromises()
    expect(wrapper.get('[data-testid="business-file-upload"]').attributes('disabled')).toBeUndefined()
    store.tools = [tool('ship_script', { script_status: 'blocked' })]
    store.preparationNotice = '所选工具已撤回，旧导入已清除'
    await flushPromises()
    expect(wrapper.get('[data-testid="business-file-upload"]').attributes('disabled')).toBeDefined()
    const start = wrapper.findAll('button').find(button => button.text() === '开始批量执行')!
    expect(start.attributes('disabled')).toBeDefined()
    expect(wrapper.get('.preparation-notice').text()).toContain('旧导入已清除')
    await start.trigger('click')
    expect(store.startBatch).not.toHaveBeenCalled()
  })

  it('shows current same-ID input fields and disables start when refreshed input was invalidated', async () => {
    const store = mocks.useStore()
    store.selectedTool = tool('ship_script')
    store.tools = [tool('ship_script', { batch_input_schema: [{ key: 'sku', label: '最新SKU', required: true }] })]
    const wrapper = render(WorkspaceView)
    await flushPromises()
    expect(wrapper.text()).toContain('最新SKU：必填')
    expect(wrapper.text()).not.toContain('订单号：必填')
    const start = wrapper.findAll('button').find(button => button.text() === '开始批量执行')!
    expect(start.attributes('disabled')).toBeDefined()
  })

  it('rechecks current authorization events instead of keeping an old enabled selection', async () => {
    const store = mocks.useStore()
    const selected = tool('ship_script', { available_plans: ['Y199'] })
    localStorage.setItem('toolbox_user', JSON.stringify({ plan_code: 'Y199' }))
    store.tools = [selected]; store.selectedTool = selected
    store.importPreview = { validCount: 1, rows: [] }
    const wrapper = render(WorkspaceView)
    await flushPromises()
    expect(wrapper.get('[data-testid="business-file-upload"]').attributes('disabled')).toBeUndefined()
    localStorage.setItem('toolbox_user', JSON.stringify({ plan_code: 'Y15' }))
    window.dispatchEvent(new Event('toolbox:user-updated'))
    await flushPromises()
    expect(store.reconcileToolSelection).toHaveBeenCalledOnce()
    expect(wrapper.get('[data-testid="business-file-upload"]').attributes('disabled')).toBeDefined()
  })

  it('keeps import and start disabled while directory refresh owns loading after an import settles', async () => {
    const store = mocks.useStore()
    const selected = tool('ship_script')
    store.tools = [selected]; store.selectedTool = selected
    store.importPreview = { validCount: 1, rows: [] }
    const wrapper = render(WorkspaceView)
    await flushPromises()
    store.bootstrapRefreshing = true
    store.loading = false
    await flushPromises()
    expect(wrapper.text()).toContain('正在更新工具目录，暂不能导入或开始新的批次')
    expect(wrapper.get('[data-testid="business-file-upload"]').attributes('disabled')).toBeDefined()
    const start = wrapper.findAll('button').find(button => button.text() === '开始批量执行')!
    expect(start.attributes('disabled')).toBeDefined()
    await start.trigger('click')
    expect(store.startBatch).not.toHaveBeenCalled()
    expect(store.selectImportFile).not.toHaveBeenCalled()
  })
})
