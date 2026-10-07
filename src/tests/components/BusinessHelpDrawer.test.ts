import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

const mocks = vi.hoisted(() => ({ useStore: vi.fn(), createFeedback: vi.fn(), getMyFeedbacks: vi.fn(), getAuth: vi.fn() }))
vi.mock('@/stores/businessWorkspace', () => ({ useBusinessWorkspaceStore: mocks.useStore }))
vi.mock('@/utils/api', () => ({ createFeedback: mocks.createFeedback, getMyFeedbacks: mocks.getMyFeedbacks }))
vi.mock('@/utils/auth', () => ({ authService: { getAuth: mocks.getAuth } }))
import BusinessHelpDrawer from '@/features/business/BusinessHelpDrawer.vue'

const wrappers: VueWrapper[] = []
function render() {
  const wrapper = mount(BusinessHelpDrawer, { props: { modelValue: true, entryPoint: '导入问题' }, global: { stubs: {
    ElDrawer: { props: ['modelValue'], template: '<section v-if="modelValue"><slot /></section>' },
  } } })
  wrappers.push(wrapper)
  return wrapper
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.getAuth.mockReturnValue({ token: 'owner-test' })
  mocks.getMyFeedbacks.mockResolvedValue([])
  mocks.createFeedback.mockResolvedValue({})
  mocks.useStore.mockReturnValue(reactive({
    snapshot: { status: 'idle', recordKind: 'live', items: [], counts: {} },
    selectedTool: null, syncState: 'synced', liveStorageUnavailable: false,
  }))
})
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()))

describe('B support entry independent of execution', () => {
  it('loads existing account replies and accepts a help request before importing or creating a batch', async () => {
    const wrapper = render()
    await flushPromises()
    expect(mocks.getMyFeedbacks).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('就当前问题求助')
    expect(wrapper.text()).toContain('没有工具或尚未导入时')
    await wrapper.get('textarea').setValue('导入表格时提示缺列，应该准备哪些字段？')
    await wrapper.findAll('button').find(button => button.text() === '提交给客服支持')!.trigger('click')
    await flushPromises()
    const payload = mocks.createFeedback.mock.calls[0]![0]
    expect(payload.content).toContain('帮助入口：导入问题')
    expect(payload.content).toContain('未选择工具；尚未开始批次')
    expect(wrapper.text()).toContain('已提交')
    expect(wrapper.find('a[href^="/user/"]').exists()).toBe(false)
  })

  it('attaches only a batch summary, not source rows, account values or browser artifacts', async () => {
    const store = mocks.useStore()
    store.snapshot = { batchId: 'local-private-id', tool: { name: '发货助手' }, status: 'running', recordKind: 'live',
      items: [{ password: 'private-secret', accountLabelMasked: 'private-account', browserReady: true }], counts: { failed: 1 } }
    const wrapper = render()
    await flushPromises()
    await wrapper.get('textarea').setValue('结果待核对，请协助确认下一步。')
    await wrapper.findAll('button').find(button => button.text() === '提交给客服支持')!.trigger('click')
    await flushPromises()
    const payload = mocks.createFeedback.mock.calls[0]![0]
    expect(payload.content).toContain('发货助手；真实执行；总数 1')
    expect(payload.content).not.toMatch(/private-secret|private-account|local-private-id/)
    expect(wrapper.text()).toContain('未完成”不等于“确定未写入')
  })

  it('preserves the user message after submission failure and supports reply-load retry', async () => {
    mocks.getMyFeedbacks.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([])
    mocks.createFeedback.mockRejectedValue(new Error('offline'))
    const wrapper = render()
    await flushPromises()
    expect(wrapper.text()).toContain('回复暂时无法加载')
    await wrapper.findAll('button').find(button => button.text() === '刷新回复')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('回复暂时无法加载')
    await wrapper.get('textarea').setValue('导入提示不一致')
    await wrapper.findAll('button').find(button => button.text() === '提交给客服支持')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('求助未提交成功')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('导入提示不一致')
  })

  it('uses the selected history summary instead of another active batch when asking about records', async () => {
    const store = mocks.useStore()
    store.snapshot = { batchId: 'another-batch', tool: { name: '另一个活动工具' }, recordKind: 'live', items: [{}], counts: {} }
    const wrapper = render()
    await wrapper.setProps({ entryPoint: '批次记录核对', context: { toolName: '历史模板工具', recordKind: 'live', status: 'completed', total: 3 } })
    await wrapper.get('textarea').setValue('请协助核对这条历史记录。')
    await wrapper.findAll('button').find(button => button.text() === '提交给客服支持')!.trigger('click')
    await flushPromises()
    const payload = mocks.createFeedback.mock.calls[0]![0]
    expect(payload.content).toContain('历史模板工具；真实批次记录；记录状态 completed；总数 3')
    expect(payload.content).not.toMatch(/另一个活动工具|another-batch/)
  })
})
