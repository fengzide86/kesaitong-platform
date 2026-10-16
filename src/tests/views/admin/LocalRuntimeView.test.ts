import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import LocalRuntimeView from '@/views/admin/LocalRuntimeView.vue'

const mocks = vi.hoisted(() => ({ getTools: vi.fn() }))
vi.mock('@/utils/api/tools', () => ({ getTools: mocks.getTools }))
vi.mock('@/features/targets/TargetWorkspace.vue', () => ({ default: { template: '<div data-testid="target-workspace" />' } }))

const stubs = {
  ElButton: { props: ['disabled', 'loading'], template: '<button :disabled="disabled || loading"><slot /></button>' },
  ElAlert: { props: ['title'], template: '<div role="alert">{{ title }}</div>' },
  ElForm: { template: '<form><slot /></form>' },
  ElFormItem: { template: '<div><slot /></div>' },
  ElInput: true,
  ElSelect: { props: ['disabled'], template: '<select :disabled="disabled"><slot /></select>' },
  ElOption: { props: ['value', 'label'], template: '<option :value="value">{{ label }}</option>' },
}
const tool = { id: 'template-tool', name: '配送模板', target_capability: 'template.create.v1', availability: 'live', script_status: 'script_ready' }
let wrapper: VueWrapper | undefined
function desktop() {
  const bridge = {
    policy: vi.fn().mockResolvedValue({ allowedOrigins: ['https://school.example'], maxScenes: 6 }),
    list: vi.fn().mockResolvedValue([{ id: 'scene-a', label: '测试账号', origin: 'https://school.example', selected: true, status: 'ready' }]),
    bounds: vi.fn().mockResolvedValue(undefined),
    hide: vi.fn().mockResolvedValue(undefined),
  }
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { scenes: bridge } })
  return bridge
}
async function click(text: string) {
  const button = wrapper!.findAll('button').find(item => item.text() === text)
  if (!button) throw new Error(`Button missing: ${text}`)
  await button.trigger('click'); await flushPromises()
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.getTools.mockResolvedValue([tool])
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.useRealTimers(); vi.unstubAllGlobals() })

describe('账号工作区工具目录失败恢复', () => {
  it('首次目录失败不误示为没有可用工具，刷新会重新读取目录', async () => {
    desktop()
    let rejectLoad!: (reason: Error) => void
    mocks.getTools.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectLoad = reject }))
    wrapper = mount(LocalRuntimeView, { global: { stubs } })
    await nextTick()
    expect(wrapper.text()).toContain('正在加载工具目录')
    expect(wrapper.text()).not.toContain('目前没有可用工具')
    rejectLoad(new Error('offline'))
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('工具目录加载失败')
    expect(wrapper.text()).not.toContain('目前没有可用工具')
    expect(wrapper.find('[data-testid="target-workspace"]').exists()).toBe(false)
    await click('刷新权限与工具')
    expect(mocks.getTools).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('配送模板')
    expect(wrapper.find('[data-testid="target-workspace"]').exists()).toBe(true)
  })

  it('权限轮询不会清除目录失败，独立重试可恢复为真实空目录', async () => {
    vi.useFakeTimers()
    const bridge = desktop()
    mocks.getTools.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([])
    wrapper = mount(LocalRuntimeView, { global: { stubs } }); await flushPromises()
    await vi.advanceTimersByTimeAsync(30_000); await flushPromises()
    expect(bridge.policy).toHaveBeenCalledTimes(2)
    expect(mocks.getTools).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[role="alert"]').text()).toContain('工具目录加载失败')
    expect(wrapper.text()).not.toContain('目前没有可用工具')
    await click('重新加载工具')
    expect(mocks.getTools).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('目前没有可用工具')
  })

  it('浏览器预览不把未读取的目录说成没有工具', async () => {
    wrapper = mount(LocalRuntimeView, { global: { stubs } }); await flushPromises()
    expect(mocks.getTools).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请在课赛通桌面客户端打开')
    expect(wrapper.text()).not.toContain('目前没有可用工具')
  })

  it('已有工具再次读取失败时保留当前工作区，不把刷新变成重新打开任务', async () => {
    desktop()
    wrapper = mount(LocalRuntimeView, { global: { stubs } }); await flushPromises()
    const workspace = wrapper.get('[data-testid="target-workspace"]').element
    mocks.getTools.mockRejectedValueOnce(new Error('offline'))
    await click('刷新权限与工具')
    expect(wrapper.get('[role="alert"]').text()).toContain('工具目录加载失败')
    expect(wrapper.get('[data-testid="target-workspace"]').element).toBe(workspace)
    expect(wrapper.text()).not.toContain('目前没有可用工具')
  })
})
