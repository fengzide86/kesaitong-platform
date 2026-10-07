import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ToolsView from '@/views/user/ToolsView.vue'
import { useAppStore } from '@/stores/app'
import { usePlatformStore } from '@/stores/platform'

const mocks = vi.hoisted(() => ({ getTools: vi.fn(), createToolLaunchGrant: vi.fn(), push: vi.fn(), showToast: vi.fn(), download: vi.fn(), route: { query: {} as Record<string, unknown> } }))
vi.mock('@/utils/api', () => ({ getTools: mocks.getTools, createToolLaunchGrant: mocks.createToolLaunchGrant }))
vi.mock('@/utils', () => ({ showToast: mocks.showToast }))
vi.mock('@/runtime/desktop-download', () => ({ downloadDesktopInstaller: mocks.download }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.push }), useRoute: () => mocks.route }))

function liveTool(overrides: Record<string, unknown> = {}) {
  return { id: 'listing', name: '商品发布工具', capability_key: 'listing_script', status: 'online', availability: 'live', supports_live_single: true, script_status: 'script_ready', available_plans: ['Y15'], ...overrides }
}
function desktop() { Object.defineProperty(window, 'electronAPI', { configurable: true, value: { automation: {} } }) }
function mountView() {
  const pinia = createPinia(); setActivePinia(pinia)
  return mount(ToolsView, { global: { plugins: [pinia], stubs: {
    RouterLink: { props: ['to'], template: '<a><slot /></a>' }, ElDrawer: { template: '<aside><slot name="header" /><slot /><slot name="footer" /></aside>' },
    ElDialog: { template: '<section><slot name="header" /><slot /><slot name="footer" /></section>' }, ElForm: { template: '<form><slot /></form>' },
    ElFormItem: { template: '<label><slot /></label>' }, ElInput: true, ElInputNumber: true, ElSelect: true, ElOption: true, ElButton: true,
  } } })
}
describe('ToolsView 真实任务目录', () => {
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.removeItem('toolbox_current_platform'); mocks.route.query = {}; mocks.getTools.mockResolvedValue([])
    mocks.download.mockResolvedValue('https://example.test/KST.exe')
    mocks.createToolLaunchGrant.mockResolvedValue({ grant: { token: 'test', target_url: 'https://example.test', script_key: 'listing' } })
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined })
    localStorage.setItem('toolbox_user', JSON.stringify({ plan_name: '体验包', plan_code: 'Y15' }))
  })
  it('八任务三组始终保留准备要求，空目录不伪造工具', async () => {
    const wrapper = mountView(); await flushPromises()
    expect(wrapper.findAll('[data-task-id]').map(card => card.attributes('data-task-id'))).toEqual(['company', 'sourcing', 'product', 'shipping', 'marketing', 'fba', 'orders', 'pricing'])
    expect(wrapper.findAll('.task-group h3').map(item => item.text())).toEqual(['开局与选品', '商品与经营', '配送与履约'])
    expect(wrapper.text()).toContain('准备公司登记资料'); expect(wrapper.text()).toContain('当前平台尚无开放工具'); wrapper.unmount()
  })
  it('普通目录隐藏demo且无法从任务卡触发演示', async () => {
    mocks.getTools.mockResolvedValue([{ id: 'demo', name: '内部演示', status: 'online', availability: 'demo_only', supports_demo_single: true }])
    const wrapper = mountView(); await flushPromises(); await wrapper.get('[data-task-id="product"]').trigger('click')
    expect(wrapper.find('[data-testid="tool-card-内部演示"]').exists()).toBe(false)
    expect(mocks.createToolLaunchGrant).not.toHaveBeenCalled(); expect(useAppStore().toolVisible).toBe(false); wrapper.unmount()
  })
  it('task查询、多对多任务和未知能力保留；店铺登记不冒充公司', async () => {
    mocks.route.query = { task: 'pricing' }
    mocks.getTools.mockResolvedValue([liveTool({ id: 'price', name: '成本辅助', task_ids: ['sourcing', 'pricing'] }), liveTool({ id: 'register', name: '店铺登记', capability_key: 'register' }), liveTool({ id: 'unknown', name: '新工具', capability_key: 'future' })])
    const wrapper = mountView(); await flushPromises()
    expect(wrapper.find('[data-testid="tool-card-成本辅助"]').exists()).toBe(true)
    await wrapper.get('[data-task-id="company"]').trigger('click'); expect(wrapper.findAll('.tool-grid .tool-card')).toHaveLength(0)
    await wrapper.findAll('.directory-filters > button').find(button => button.text().startsWith('其他工具'))!.trigger('click')
    expect(wrapper.find('[data-testid="tool-card-店铺登记"]').exists()).toBe(true); expect(wrapper.find('[data-testid="tool-card-新工具"]').exists()).toBe(true); wrapper.unmount()
  })
  it('搜索任务、工具名称和描述', async () => {
    mocks.getTools.mockResolvedValue([liveTool(), liveTool({ id: 'ship', name: '订单工具', capability_key: 'ship_script', description: '处理仓库订单' })])
    const wrapper = mountView(); await flushPromises(); await wrapper.get('input[type="search"]').setValue('发布商品')
    expect(wrapper.find('[data-testid="tool-card-商品发布工具"]').exists()).toBe(true); expect(wrapper.find('[data-testid="tool-card-订单工具"]').exists()).toBe(false)
    await wrapper.get('input[type="search"]').setValue('仓库'); expect(wrapper.find('[data-testid="tool-card-订单工具"]').exists()).toBe(true); wrapper.unmount()
  })
  it('当前可用核对套餐、发布、脚本与本机能力', async () => {
    desktop(); mocks.getTools.mockResolvedValue([liveTool(), liveTool({ id: 'locked', name: '未含', available_plans: ['Y199'] }), liveTool({ id: 'offline', name: '维护', status: 'offline' }), liveTool({ id: 'notready', name: '准备', script_status: 'script_not_ready' }), liveTool({ id: 'read', name: '检查', script_status: 'browser_ready', target_url: 'https://example.test' })])
    const wrapper = mountView(); await flushPromises(); await wrapper.get('input[type="checkbox"]').setValue(true)
    expect(wrapper.findAll('.tool-grid .tool-card')).toHaveLength(2); expect(wrapper.find('[data-testid="tool-card-检查"]').exists()).toBe(true); wrapper.unmount()
  })
  it('网页版只能下载桌面端，不记作当前可用', async () => {
    mocks.getTools.mockResolvedValue([liveTool()]); const wrapper = mountView(); await flushPromises()
    expect(wrapper.text()).toContain('已开放执行'); await wrapper.get('[data-testid="tool-card-商品发布工具"]').trigger('click'); await flushPromises()
    expect(mocks.download).toHaveBeenCalledOnce(); expect(useAppStore().toolVisible).toBe(false)
    await wrapper.get('input[type="checkbox"]').setValue(true); expect(wrapper.findAll('.tool-grid .tool-card')).toHaveLength(0); wrapper.unmount()
  })
  it('平台授权范围不符时不可用且不申请执行令牌', async () => {
    desktop(); localStorage.setItem('toolbox_user', JSON.stringify({ plan_code: 'Y15', platform_scope: ['aliexpress'] }))
    mocks.getTools.mockResolvedValue([liveTool()]); const wrapper = mountView(); await flushPromises()
    expect(wrapper.get('[data-testid="tool-card-商品发布工具"]').classes()).toContain('is-platform-locked')
    expect(wrapper.get('[data-testid="tool-card-商品发布工具"]').text()).toContain('当前平台未授权')
    expect(wrapper.get('[data-testid="tool-card-商品发布工具"]').text()).not.toContain('当前套餐未包含')
    await wrapper.get('[data-testid="tool-card-商品发布工具"]').trigger('click'); expect(mocks.createToolLaunchGrant).not.toHaveBeenCalled()
    expect(mocks.push).toHaveBeenCalledWith({ path: '/user/ai-chat', query: { tool: 'listing', reason: 'platform-scope' } })
    expect(mocks.push.mock.calls.every(([target]) => target.path !== '/user/plans')).toBe(true)
    await wrapper.get('input[type="checkbox"]').setValue(true); expect(wrapper.findAll('.tool-grid .tool-card')).toHaveLength(0); wrapper.unmount()
  })
  it.each([null, undefined])('套餐名称不是权限依据 (%s)', async planCode => {
    localStorage.setItem('toolbox_user', JSON.stringify({ plan_name: 'Y199 新名称', plan_code: planCode })); mocks.getTools.mockResolvedValue([liveTool({ available_plans: ['Y199'] })])
    const wrapper = mountView(); await flushPromises(); expect(wrapper.get('[data-testid="tool-card-商品发布工具"]').classes()).toContain('is-locked')
    await wrapper.get('[data-testid="tool-card-商品发布工具"]').trigger('click'); expect(mocks.push).toHaveBeenCalledWith({ path: '/user/plans', query: { tool: 'listing' } }); expect(mocks.createToolLaunchGrant).not.toHaveBeenCalled(); wrapper.unmount()
  })
  it('授权更新后重新核对筛选', async () => {
    desktop(); mocks.getTools.mockResolvedValue([liveTool({ available_plans: ['Y199'] })]); const wrapper = mountView(); await flushPromises(); await wrapper.get('input[type="checkbox"]').setValue(true)
    expect(wrapper.findAll('.tool-grid .tool-card')).toHaveLength(0)
    localStorage.setItem('toolbox_user', JSON.stringify({ plan_name: '新名称', plan_code: 'Y199' })); window.dispatchEvent(new Event('toolbox:user-updated')); await flushPromises()
    expect(wrapper.findAll('.tool-grid .tool-card')).toHaveLength(1); wrapper.unmount()
  })
  it('只读/试用/执行分开说明，预检不申请执行令牌', async () => {
    desktop(); mocks.getTools.mockResolvedValue([liveTool({ id: 'read', name: '只读工具', script_status: 'browser_ready', target_url: 'https://example.test' }), liveTool({ id: 'beta', name: '试用工具', availability: 'live_beta' }), liveTool()])
    const wrapper = mountView(); await flushPromises(); expect(wrapper.text()).toContain('只读检查'); expect(wrapper.text()).toContain('受控试用'); expect(wrapper.text()).toContain('已开放执行'); expect(wrapper.text()).not.toContain('已验收')
    await wrapper.get('[data-testid="tool-card-只读工具"]').trigger('click'); await flushPromises(); expect(useAppStore().currentTool.executionMode).toBe('preflight'); expect(mocks.createToolLaunchGrant).not.toHaveBeenCalled(); wrapper.unmount()
  })
  it('未就绪与计算入口不落回模拟或扩大执行权限', async () => {
    desktop(); mocks.getTools.mockResolvedValue([liveTool({ script_status: 'script_not_ready' }), liveTool({ id: 'calc', name: '计算工具', tool_kind: 'calculation' })]); const wrapper = mountView(); await flushPromises()
    expect(wrapper.get('[data-testid="tool-card-商品发布工具"]').attributes('disabled')).toBeDefined(); expect(wrapper.get('[data-testid="tool-card-计算工具"]').attributes('disabled')).toBeDefined(); expect(wrapper.text()).toContain('本地计算'); expect(mocks.createToolLaunchGrant).not.toHaveBeenCalled(); wrapper.unmount()
  })
  it.each([
    { script_status: 'script_not_ready' }, { tool_kind: 'calculation' },
    { status: 'offline' }, { script_status: 'blocked' },
  ])('不可执行工具仍可读已有说明，但抽屉启动继续禁用 (%j)', async state => {
    desktop(); mocks.getTools.mockResolvedValue([liveTool({ ...state, preparation_notes: ['先准备真实任务资料'] })])
    const wrapper = mountView(); await flushPromises()
    const card = wrapper.get('[data-testid="tool-card-商品发布工具"]')
    expect(card.attributes('disabled')).toBeUndefined(); expect(card.attributes('aria-label')).toContain('查看工具说明')
    await card.trigger('click'); await flushPromises()
    expect(wrapper.get('.drawer-content').text()).toContain('先准备真实任务资料')
    expect(wrapper.get('.drawer-primary').attributes('disabled')).toBeDefined()
    await wrapper.get('.drawer-primary').trigger('click')
    expect(mocks.createToolLaunchGrant).not.toHaveBeenCalled(); expect(useAppStore().toolVisible).toBe(false); wrapper.unmount()
  })
  it('没有说明的维护工具保持禁用', async () => {
    mocks.getTools.mockResolvedValue([liveTool({ status: 'offline' })]); const wrapper = mountView(); await flushPromises()
    expect(wrapper.get('[data-testid="tool-card-商品发布工具"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.drawer-content').exists()).toBe(false); expect(mocks.createToolLaunchGrant).not.toHaveBeenCalled(); wrapper.unmount()
  })
  it('平台范围与套餐同时不符时说明平台授权，不引导购买作为解法', async () => {
    desktop(); localStorage.setItem('toolbox_user', JSON.stringify({ plan_code: 'Y15', platform_scope: ['aliexpress'] }))
    mocks.getTools.mockResolvedValue([liveTool({ available_plans: ['Y199'], preparation_notes: ['准备任务资料'] })])
    const wrapper = mountView(); await flushPromises(); await wrapper.get('[data-testid="tool-card-商品发布工具"]').trigger('click')
    expect(wrapper.get('.drawer-authorization-note').text()).toContain('更换套餐并不代表已获此平台授权')
    expect(wrapper.get('.drawer-primary').text()).toContain('核对平台授权')
    await wrapper.get('.drawer-primary').trigger('click')
    expect(mocks.push).toHaveBeenCalledWith({ path: '/user/ai-chat', query: { tool: 'listing', reason: 'platform-scope' } })
    expect(mocks.createToolLaunchGrant).not.toHaveBeenCalled(); wrapper.unmount()
  })
  it('正式工具仍通过原授权启动', async () => {
    desktop(); mocks.getTools.mockResolvedValue([liveTool()]); const wrapper = mountView(); await flushPromises(); await wrapper.get('[data-testid="tool-card-商品发布工具"]').trigger('click'); await flushPromises()
    expect(useAppStore().currentTool.executionMode).toBe('live'); expect(mocks.createToolLaunchGrant).toHaveBeenCalledOnce(); wrapper.unmount()
  })
  it('旧平台请求和晚到的启动令牌不影响当前平台', async () => {
    desktop(); mocks.getTools.mockResolvedValueOnce([liveTool()]).mockResolvedValueOnce([]); let release!: (value: unknown) => void
    mocks.createToolLaunchGrant.mockReturnValueOnce(new Promise(resolve => { release = resolve })); const wrapper = mountView(); await flushPromises(); await wrapper.get('[data-testid="tool-card-商品发布工具"]').trigger('click')
    usePlatformStore().setPlatform('aliexpress'); await flushPromises(); release({ grant: { token: 'test', target_url: 'https://example.test', script_key: 'listing' } }); await flushPromises()
    expect(useAppStore().toolVisible).toBe(false); expect(mocks.getTools).toHaveBeenLastCalledWith({ platform_key: 'aliexpress' }); wrapper.unmount()
  })
})
