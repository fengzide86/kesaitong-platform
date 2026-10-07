import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ToolWorkspace from '@/components/ToolWorkspace.vue'
import { useAppStore } from '@/stores/app'
import { useTaskRunStore } from '@/stores/taskRun'
import { AUTOMATION_EVENT } from '@/automation'
import * as runtimeCapabilities from '@/runtime/capabilities'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  createLog: vi.fn(),
  createDemoRun: vi.fn(),
  confirmAction: vi.fn(),
  showToast: vi.fn(),
  refreshLiveLaunch: vi.fn(),
  queueDemoReceipt: vi.fn(),
  flushPendingDemoReceipts: vi.fn(),
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('@/utils/api', () => ({
  createLog: mocks.createLog,
  createDemoRun: mocks.createDemoRun,
  updateDemoRun: vi.fn().mockResolvedValue({}),
  finishDemoRun: vi.fn().mockResolvedValue({}),
  cancelDemoRun: vi.fn().mockResolvedValue({}),
}))
vi.mock('@/utils', () => ({ showToast: mocks.showToast }))
vi.mock('@/shared/ui/confirm', () => ({ confirmAction: mocks.confirmAction }))
vi.mock('@/features/automation/launch', () => ({ refreshLiveLaunch: mocks.refreshLiveLaunch }))
vi.mock('@/features/automation/demo-receipts', () => ({
  queueDemoReceipt: mocks.queueDemoReceipt,
  flushPendingDemoReceipts: mocks.flushPendingDemoReceipts,
}))

describe('ToolWorkspace 极简运行工作台', () => {
  let pinia

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.createDemoRun.mockResolvedValue({ id: 'remote-demo-1', tool_id: 'demo' })
    mocks.queueDemoReceipt.mockResolvedValue(true)
    mocks.flushPendingDemoReceipts.mockResolvedValue(undefined)
    pinia = createPinia()
    setActivePinia(pinia)
    useAppStore().openTool({
      id: 'demo',
      name: '自动上品演示',
      platformKey: 'amazon',
      targetUrl: 'demo://amazon/demo',
      executionMode: 'demo',
    })
  })

  afterEach(() => {
    useTaskRunStore().reset()
    vi.restoreAllMocks()
    delete window.electronAPI
    vi.useRealTimers()
  })

  function mountWorkspace() {
    return mount(ToolWorkspace, {
      global: {
        plugins: [pinia],
        stubs: {
          ElDrawer: {
            props: ['modelValue'], emits: ['update:modelValue'],
            template: '<section v-if="modelValue" role="dialog"><button data-testid="close-run-evidence" @click="$emit(\'update:modelValue\', false)">关闭查看</button><slot /></section>',
          },
        },
      },
    })
  }

  function mountStoppedLiveWorkspace(status: 'failed' | 'cancelled' | 'completed' = 'failed') {
    vi.spyOn(runtimeCapabilities, 'getRuntimeCapabilities').mockReturnValue({
      ...runtimeCapabilities.resolveRuntimeCapabilities(undefined),
      kind: 'desktop', isDesktop: true, singleLive: true,
    })
    useAppStore().openTool({ id: 'live-tool', name: '平台工具', platformKey: 'amazon', executionMode: 'live' })
    const store = useTaskRunStore()
    store.runId = 'live-existing-result-001'
    store.status = status
    store.steps = [{ id: 'verify', title: '结果核验' }]
    store.currentStepId = 'verify'
    store.error = { code: 'RESULT_UNCONFIRMED', message: '尚未确认平台结果' }
    const start = vi.spyOn(store, 'start').mockResolvedValue({ runId: 'live-new-task' })
    mocks.refreshLiveLaunch.mockResolvedValue({ id: 'live-tool', name: '平台工具', executionMode: 'live' })
    return { wrapper: mountWorkspace(), store, start }
  }

  it('只向用户显示四段业务进度，不显示内部六步明细和计时', async () => {
    const wrapper = mountWorkspace()
    await flushPromises()

    expect(wrapper.find('[data-testid="tool-workspace"]').exists()).toBe(true)
    expect(useTaskRunStore().steps).toHaveLength(6)
    expect(wrapper.findAll('.stage-list li')).toHaveLength(4)
    expect(wrapper.text()).toContain('准备')
    expect(wrapper.text()).toContain('流程展示')
    expect(wrapper.text()).not.toContain('初始化工具环境')
    expect(wrapper.text()).not.toMatch(/\d{2}:\d{2}/)
    wrapper.unmount()
  })

  it('浏览器预览不把动画完成包装成真实填写、核验或证据截图', async () => {
    const wrapper = mountWorkspace()
    await flushPromises()
    expect(wrapper.get('[data-testid="execution-scope-note"]').text()).toContain('不启动 Runner')
    expect(wrapper.get('[data-testid="result-boundary"]').text()).toContain('不代表真实任务成功')
    await vi.advanceTimersByTimeAsync(14_000)
    await flushPromises()
    expect(wrapper.get('.result-card.success').text()).toContain('流程预览已完成')
    expect(wrapper.text()).not.toContain('本地浏览器已完成真实填写')
    expect(wrapper.find('.result-proof-grid').exists()).toBe(false)
    expect(wrapper.find('.execution-evidence').exists()).toBe(false)
    wrapper.unmount()
  })

  it('具备桌面执行器时仍明确显示本地交互沙盒，而非浏览器轻量预览', async () => {
    const capability = vi.spyOn(runtimeCapabilities, 'getRuntimeCapabilities').mockReturnValue({
      ...runtimeCapabilities.resolveRuntimeCapabilities(undefined),
      kind: 'desktop', isDesktop: true, singleLive: true,
    })
    const wrapper = mountWorkspace()
    await flushPromises()
    expect(wrapper.get('[data-testid="execution-scope-note"]').text()).toContain('数据只存在本地沙盒')
    expect(wrapper.text()).not.toContain('浏览器流程预览')
    expect(wrapper.find('webview').exists()).toBe(true)
    wrapper.unmount()
    capability.mockRestore()
  })

  it('后台记录接口失败时仍正常启动本地演示', async () => {
    mocks.createDemoRun.mockRejectedValueOnce(new Error('network unavailable'))
    const wrapper = mountWorkspace()
    await flushPromises()

    expect(useTaskRunStore().status).toBe('running')
    expect(useTaskRunStore().steps).toHaveLength(6)
    expect(wrapper.find('[data-testid="tool-workspace"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('需要人工操作时只给一个明确的继续按钮', async () => {
    const wrapper = mountWorkspace()
    await flushPromises()
    const store = useTaskRunStore()
    store.applyEvent({
      type: AUTOMATION_EVENT.USER_ACTION_REQUIRED,
      runId: store.runId,
      action: { title: '请完成验证码', instruction: '在左侧页面完成验证码。' },
    })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.user-action-card').text()).toContain('请完成验证码')
    expect(wrapper.find('.user-action-card button').text()).toBe('我已完成，继续处理')
    expect(wrapper.find('.interaction-shield').exists()).toBe(false)
    wrapper.unmount()
  })

  it('停止操作必须确认，并进入可重新执行的停止结果页', async () => {
    mocks.confirmAction.mockResolvedValue(true)
    const wrapper = mountWorkspace()
    await flushPromises()

    const stopButton = wrapper.findAll('button').find(button => button.text().includes('停止演示'))
    await stopButton.trigger('click')
    await flushPromises()

    expect(mocks.confirmAction).toHaveBeenCalledWith(expect.objectContaining({
      title: '停止本次处理？',
      danger: true,
    }))
    expect(useTaskRunStore().status).toBe('cancelled')
    expect(wrapper.find('.result-card.cancelled').text()).toContain('已退出演示')
    expect(wrapper.find('.result-card.cancelled').text()).toContain('重新演示')
    expect(wrapper.find('.workspace-topbar').text()).not.toContain('返回工具箱')
    wrapper.unmount()
  })

  it('取消仍在等待时保留工作台并防止再次停止或退出', async () => {
    mocks.confirmAction.mockResolvedValue(true)
    const wrapper = mountWorkspace()
    await flushPromises()
    const store = useTaskRunStore()
    const runId = store.runId
    let release!: () => void
    const cancel = vi.spyOn(store, 'cancel').mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
    await wrapper.get('[aria-label="返回工具箱"]').trigger('click')
    await flushPromises()
    expect(useAppStore().toolVisible).toBe(true)
    expect(store.runId).toBe(runId)
    expect(wrapper.get('[aria-label="返回工具箱"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.control-button.danger').text()).toContain('正在停止')
    await wrapper.get('.control-button.danger').trigger('click')
    expect(cancel).toHaveBeenCalledOnce()
    release()
    await flushPromises()
    expect(useAppStore().toolVisible).toBe(false)
    expect(store.runId).toBeNull()
    wrapper.unmount()
  })

  it('退出取消失败时保留现场并显示可重试反馈', async () => {
    mocks.confirmAction.mockResolvedValue(true)
    const wrapper = mountWorkspace()
    await flushPromises()
    const store = useTaskRunStore()
    const runId = store.runId
    vi.spyOn(store, 'cancel').mockRejectedValueOnce(new Error('IPC disconnected'))
    await wrapper.get('[aria-label="返回工具箱"]').trigger('click')
    await flushPromises()
    expect(useAppStore().toolVisible).toBe(true)
    expect(store.runId).toBe(runId)
    expect(store.status).toBe('running')
    expect(wrapper.get('[aria-label="返回工具箱"]').attributes('disabled')).toBeUndefined()
    expect(mocks.showToast).toHaveBeenCalledWith('暂时无法退出，当前现场已保留，请重试', 'error')
    await wrapper.get('[aria-label="返回工具箱"]').trigger('click')
    await flushPromises()
    expect(useAppStore().toolVisible).toBe(false)
    wrapper.unmount()
  })

  it('停止失败不会显示已停止或丢失继续操作入口', async () => {
    mocks.confirmAction.mockResolvedValue(true)
    const wrapper = mountWorkspace()
    await flushPromises()
    const store = useTaskRunStore()
    vi.spyOn(store, 'cancel').mockRejectedValueOnce(new Error('IPC disconnected'))
    await wrapper.get('.control-button.danger').trigger('click')
    await flushPromises()
    expect(store.status).toBe('running')
    expect(wrapper.find('.result-card.cancelled').exists()).toBe(false)
    expect(wrapper.get('.control-button.danger').attributes('disabled')).toBeUndefined()
    expect(mocks.showToast).toHaveBeenCalledWith('暂时无法停止，当前现场已保留，请重试', 'error')
    wrapper.unmount()
  })

  it('模拟页面加载异常时提供安全重试，不直接暴露技术错误', async () => {
    const wrapper = mountWorkspace()
    await flushPromises()
    const store = useTaskRunStore()
    store.applyEvent({
      type: AUTOMATION_EVENT.RUN_FAILED,
      runId: store.runId,
      stepId: 'open',
      error: {
        code: 'BROWSER_NAVIGATION_TIMEOUT',
        message: 'net::ERR_TIMED_OUT',
      },
    })
    await wrapper.vm.$nextTick()

    const result = wrapper.find('.result-card.failed')
    expect(result.text()).toContain('模拟场景在准备阶段停止')
    expect(result.text()).toContain('重新加载演示')
    expect(result.find('p').text()).not.toContain('net::ERR_TIMED_OUT')
    expect(wrapper.find('.technical-details').text()).toContain('net::ERR_TIMED_OUT')
    wrapper.unmount()
  })

  it.each(['failed', 'cancelled'] as const)('live %s 优先核对平台和问题详情，不把重跑作为主操作', async status => {
    const { wrapper, start } = mountStoppedLiveWorkspace(status)
    await flushPromises()
    const result = wrapper.get(`.result-card.${status}`)
    expect(result.get('.primary-action').text()).toBe('查看问题详情')
    expect(wrapper.get('[data-testid="platform-review-guidance"]').text()).toContain('核对')
    expect(wrapper.get('.workspace-actions').text()).not.toMatch(/重新执行|发起新任务/)
    expect(result.get('[data-testid="new-live-task"]').classes()).not.toContain('primary-action')
    expect(wrapper.text()).not.toContain('可靠续跑')
    expect(wrapper.text()).not.toContain('已安全停止')
    await result.get('.primary-action').trigger('click')
    expect((result.get('.technical-details').element as HTMLDetailsElement).open).toBe(true)
    expect(start).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('live 结果待核对时取消新任务确认，不刷新授权或启动工具', async () => {
    mocks.confirmAction.mockResolvedValue(false)
    const { wrapper, store, start } = mountStoppedLiveWorkspace()
    await wrapper.get('[data-testid="new-live-task"]').trigger('click')
    await flushPromises()
    expect(mocks.confirmAction).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('不会恢复上次任务'), confirmText: '发起新任务', cancelText: '先核对平台',
    }))
    expect(mocks.refreshLiveLaunch).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
    expect(store.runId).toBe('live-existing-result-001')
    wrapper.unmount()
  })

  it('明确确认后仍沿用已有的新授权启动流程，不声称断点恢复', async () => {
    mocks.confirmAction.mockResolvedValue(true)
    const { wrapper, start } = mountStoppedLiveWorkspace()
    await wrapper.get('[data-testid="new-live-task"]').trigger('click')
    await flushPromises()
    expect(mocks.refreshLiveLaunch).toHaveBeenCalledOnce()
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ executionMode: 'live' }), { mode: 'live' })
    wrapper.unmount()
  })

  it('只读预检重新扫描不新增 live 新任务确认，也不刷新启动授权', async () => {
    vi.spyOn(runtimeCapabilities, 'getRuntimeCapabilities').mockReturnValue({
      ...runtimeCapabilities.resolveRuntimeCapabilities(undefined),
      kind: 'desktop', isDesktop: true, singleLive: true,
    })
    const preflight = vi.fn().mockResolvedValue({
      browserMode: 'embedded-cdp', browserState: 'inspected', targetUrl: 'https://platform.invalid',
      scriptKey: 'pending-script', scriptStatus: 'not_ready', canStart: false,
    })
    window.electronAPI = { automation: {
      preflight, start: vi.fn(), pause: vi.fn(), resume: vi.fn(), completeUserAction: vi.fn(),
      cancel: vi.fn(), registerBrowser: vi.fn(), unregisterBrowser: vi.fn(), onEvent: vi.fn(),
    } }
    useAppStore().openTool({ id: 'unready-tool', name: '只读预检', executionMode: 'preflight' })
    const wrapper = mountWorkspace()
    await wrapper.get('.preflight-actions .primary-action').trigger('click')
    await flushPromises()
    expect(preflight).toHaveBeenCalledOnce()
    expect(mocks.confirmAction).not.toHaveBeenCalled()
    expect(mocks.refreshLiveLaunch).not.toHaveBeenCalled()
    expect(window.electronAPI.automation.start).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('live 记录待同步不会出现重跑式同步按钮或把页面指纹称作截图', async () => {
    const { wrapper, store, start } = mountStoppedLiveWorkspace('completed')
    store.result = { reportWarning: '回执待补传', pageFingerprint: 'a'.repeat(64) }
    await wrapper.vm.$nextTick()
    const note = wrapper.get('[data-testid="record-sync-status"]')
    expect(note.text()).toContain('不会为同步记录重新运行工具')
    expect(note.find('button').exists()).toBe(false)
    expect(wrapper.get('.result-proof-grid').text()).toContain('未提供截图')
    expect(wrapper.text()).not.toContain('截图保存在本机')
    expect(start).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('仅重试演示记录同步不启动新任务，并保持本次任务状态', async () => {
    mocks.queueDemoReceipt.mockResolvedValue(false)
    const wrapper = mountWorkspace()
    await flushPromises()
    const store = useTaskRunStore()
    store.applyEvent({ type: AUTOMATION_EVENT.RUN_COMPLETED, runId: store.runId, result: {} })
    await flushPromises()
    const originalRunId = store.runId
    const start = vi.spyOn(store, 'start')
    mocks.queueDemoReceipt.mockResolvedValue(true)
    await wrapper.get('[data-testid="record-sync-status"] button').trigger('click')
    await flushPromises()
    expect(start).not.toHaveBeenCalled()
    expect(store.runId).toBe(originalRunId)
    expect(store.status).toBe('completed')
    expect(wrapper.find('[data-testid="record-sync-status"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('联系客服只携带问题状态，不自动声称平台操作失败或传出截图和页面原文', async () => {
    const { wrapper, store } = mountStoppedLiveWorkspace()
    store.result = { screenshot: 'C:\\private\\client.png', pageText: '客户原文', token: 'sensitive' }
    await wrapper.get('.technical-details button').trigger('click')
    await flushPromises()
    const context = JSON.parse(localStorage.getItem('toolbox_support_context') || '{}')
    expect(context).toMatchObject({ run_status: 'failed', execution_mode: 'live', result_requires_review: true })
    expect(Object.keys(context).sort()).toEqual(['error_code', 'execution_mode', 'platform_key', 'problem_code', 'record_pending', 'result_requires_review', 'run_id', 'run_status', 'tool_id', 'tool_name'])
    expect(JSON.stringify(context)).not.toMatch(/client\.png|客户原文|sensitive/)
    expect(mocks.push).toHaveBeenCalledWith('/user/ai-chat')
    wrapper.unmount()
  })

  const pngDataUrl = 'data:image/png;base64,aGVsbG8='
  function useArtifactReader(read = vi.fn()) {
    window.electronAPI = { artifacts: { read, clear: vi.fn().mockResolvedValue(undefined) } }
    return read
  }

  it('没有本机截图和读取桥时仍可查看安全诊断，不暴露任意结果和同步警告原文', async () => {
    const { wrapper, store, start } = mountStoppedLiveWorkspace('completed')
    store.result = { reportWarning: 'private-token-warning', pageText: 'private-page-text', cookie: 'private-cookie' }
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="view-local-screenshot"]').exists()).toBe(false)
    await wrapper.get('[data-testid="view-run-diagnostic"]').trigger('click')
    const drawer = wrapper.get('[data-testid="run-evidence-drawer"]')
    expect(drawer.get('[data-testid="run-diagnostic-summary"]').text()).toContain('记录待同步，无需重新执行任务')
    expect(drawer.text()).toContain('没有安全读取本机诊断文件的能力')
    expect(drawer.text()).not.toMatch(/private-token|private-page|private-cookie/)
    expect(start).not.toHaveBeenCalled()
    expect(store.status).toBe('completed')
    wrapper.unmount()
  })

  it('只有读取能力和本次截图标记齐全时才给截图入口，并按runId读取不传路径', async () => {
    let release!: (value: unknown) => void
    const read = useArtifactReader(vi.fn().mockImplementation(() => new Promise(resolve => { release = resolve })))
    const { wrapper, store, start } = mountStoppedLiveWorkspace()
    store.result = { screenshot: 'C:\\private\\client.png' }
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="view-local-screenshot"]').trigger('click')
    expect(read).toHaveBeenCalledWith({ runId: 'live-existing-result-001', kind: 'screenshot' })
    expect(wrapper.get('[data-testid="screenshot-loading"]').text()).toContain('正在读取本机截图')
    release({ status: 'available', kind: 'screenshot', dataUrl: pngDataUrl })
    await flushPromises()
    expect(wrapper.get('[data-testid="local-screenshot"]').attributes('src')).toBe(pngDataUrl)
    expect(wrapper.get('[data-testid="run-evidence-drawer"]').text()).not.toContain('C:\\private')
    expect(start).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('截图缺失和读取失败可真实反馈并只重读图片，不重跑任务或改变同步状态', async () => {
    const read = useArtifactReader(vi.fn()
      .mockResolvedValueOnce({ status: 'unavailable', kind: 'screenshot', code: 'MISSING', message: 'private-path-detail' })
      .mockRejectedValueOnce(new Error('private-token-detail'))
      .mockResolvedValueOnce({ status: 'available', kind: 'screenshot', dataUrl: pngDataUrl }))
    const { wrapper, store, start } = mountStoppedLiveWorkspace()
    store.artifacts = [{ type: 'screenshot', path: 'C:\\private\\client.png' }]
    store.result = { reportWarning: '待同步' }
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="view-local-screenshot"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="screenshot-unavailable"]').text()).toContain('不存在或已被清理')
    await wrapper.get('[data-testid="reload-screenshot"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="screenshot-unavailable"]').attributes('role')).toBe('alert')
    expect(wrapper.get('[data-testid="screenshot-unavailable"]').text()).toContain('不会重新执行工具')
    expect(wrapper.text()).not.toMatch(/private-path-detail|private-token-detail/)
    await wrapper.get('[data-testid="reload-screenshot"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="local-screenshot"]').exists()).toBe(true)
    expect(read).toHaveBeenCalledTimes(3)
    expect(start).not.toHaveBeenCalled()
    expect(store.status).toBe('failed')
    expect(wrapper.get('[data-testid="record-sync-status"]').text()).toContain('不会为同步记录重新运行工具')
    wrapper.unmount()
  })

  it('诊断只展示通过契约的统计，区分网络事件与业务结果，并能切换到截图', async () => {
    const read = useArtifactReader(vi.fn().mockImplementation(async ({ kind }) => kind === 'diagnostic'
      ? { status: 'available', kind, summary: { runStatus: 'failed', errorCode: 'RESULT_UNCONFIRMED', pageFingerprint: 'a'.repeat(64), pageChanged: false, recordPending: true,
        pageScan: { controlCount: 4, formCount: 1, headingCount: 2 }, network: { recordCount: 3, dropped: 0, responseCount: 2, failureCount: 1 } } }
      : { status: 'available', kind, dataUrl: pngDataUrl }))
    const { wrapper, store, start } = mountStoppedLiveWorkspace()
    store.result = { screenshot: 'registered.png' }
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="view-run-diagnostic"]').trigger('click')
    await flushPromises()
    const summary = wrapper.get('[data-testid="local-diagnostic-summary"]').text()
    expect(summary).toContain('控件 4 · 表单 1 · 标题 2')
    expect(summary).toContain('失败 1 · 丢弃 0（不代表业务结果）')
    expect(summary).toContain('不是截图')
    expect(wrapper.get('[data-testid="evidence-review-guidance"]').text()).toContain('同一平台业务对象')
    await wrapper.get('[data-testid="artifact-tab-screenshot"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="local-screenshot"]').attributes('src')).toBe(pngDataUrl)
    expect(read.mock.calls.map(call => call[0].kind)).toEqual(['diagnostic', 'screenshot'])
    expect(start).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it.each([
    { status: 'available', kind: 'screenshot', dataUrl: 'https://private.invalid/client.png' },
    { status: 'available', kind: 'diagnostic', summary: { runStatus: 'failed', pageText: 'private-page-text' } },
  ])('拒绝无效或包含额外原文的证据响应，不展示原文或远程图片 %j', async response => {
    useArtifactReader(vi.fn().mockResolvedValue(response))
    const { wrapper, store } = mountStoppedLiveWorkspace()
    store.result = { screenshot: 'registered.png' }
    await wrapper.vm.$nextTick()
    const kind = response.kind === 'screenshot' ? 'screenshot' : 'diagnostic'
    await wrapper.get(`[data-testid="${kind === 'screenshot' ? 'view-local-screenshot' : 'view-run-diagnostic'}"]`).trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="local-screenshot"]').exists()).toBe(false)
    expect(wrapper.get(`[data-testid="${kind}-unavailable"]`).attributes('role')).toBe('alert')
    expect(wrapper.get('[data-testid="run-evidence-drawer"]').text()).not.toMatch(/private\.invalid|private-page-text/)
    wrapper.unmount()
  })

  it('切换诊断会忽略稍后返回的截图，关闭查看后也不保留图片', async () => {
    let release!: (value: unknown) => void
    useArtifactReader(vi.fn().mockImplementation(({ kind }) => kind === 'screenshot'
      ? new Promise(resolve => { release = resolve })
      : Promise.resolve({ status: 'unavailable', kind, code: 'NO_EVIDENCE', message: 'no file' })))
    const { wrapper, store } = mountStoppedLiveWorkspace()
    store.result = { screenshot: 'registered.png' }
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="view-local-screenshot"]').trigger('click')
    await wrapper.get('[data-testid="artifact-tab-diagnostic"]').trigger('click')
    await flushPromises()
    release({ status: 'available', kind: 'screenshot', dataUrl: pngDataUrl })
    await flushPromises()
    expect(wrapper.find('[data-testid="run-diagnostic-panel"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="local-screenshot"]').exists()).toBe(false)
    await wrapper.get('[data-testid="close-run-evidence"]').trigger('click')
    expect(wrapper.find('[data-testid="run-evidence-drawer"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it.each(['new-run', 'auth-cleared'] as const)('%s 后清空查看器并忽略旧请求，不让旧截图串入新会话', async change => {
    let release!: (value: unknown) => void
    useArtifactReader(vi.fn().mockImplementation(() => new Promise(resolve => { release = resolve })))
    const { wrapper, store } = mountStoppedLiveWorkspace()
    store.result = { screenshot: 'registered.png' }
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="view-local-screenshot"]').trigger('click')
    if (change === 'new-run') store.runId = 'different-run'
    else window.dispatchEvent(new CustomEvent('toolbox:auth-cleared'))
    await wrapper.vm.$nextTick()
    release({ status: 'available', kind: 'screenshot', dataUrl: pngDataUrl })
    await flushPromises()
    expect(wrapper.find('[data-testid="run-evidence-drawer"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="local-screenshot"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it.each([{ user_id: 2, auth_code_id: 'license-one' }, { user_id: 1, auth_code_id: 'license-two' }])('正常同账号资料刷新保持截图查看，身份或授权变化才清空查看器 %j', async nextIdentity => {
    sessionStorage.setItem('toolbox_user', JSON.stringify({ user_id: 1, auth_code_id: 'license-one', name: '客户一', role: 'user' }))
    useArtifactReader(vi.fn().mockResolvedValue({ status: 'available', kind: 'screenshot', dataUrl: pngDataUrl }))
    const { wrapper, store } = mountStoppedLiveWorkspace()
    store.result = { screenshot: 'registered.png' }
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="view-local-screenshot"]').trigger('click')
    await flushPromises()
    sessionStorage.setItem('toolbox_user', JSON.stringify({ user_id: 1, auth_code_id: 'license-one', name: '新昵称', expires_at: '2027-01-01', role: 'user' }))
    window.dispatchEvent(new CustomEvent('toolbox:user-updated'))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="local-screenshot"]').exists()).toBe(true)
    sessionStorage.setItem('toolbox_user', JSON.stringify({ ...nextIdentity, role: 'user' }))
    window.dispatchEvent(new CustomEvent('toolbox:user-updated'))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="run-evidence-drawer"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('没有运行编号的只读预检只显示状态摘要，不伪造截图或读取文件', async () => {
    const read = useArtifactReader(vi.fn())
    vi.spyOn(runtimeCapabilities, 'getRuntimeCapabilities').mockReturnValue({ ...runtimeCapabilities.resolveRuntimeCapabilities(undefined), kind: 'desktop', isDesktop: true, singleLive: true })
    useAppStore().openTool({ id: 'preflight', name: '只读检查', executionMode: 'preflight' })
    const start = vi.spyOn(useTaskRunStore(), 'start')
    const wrapper = mountWorkspace()
    await wrapper.get('[data-testid="view-run-diagnostic"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="diagnostic-unavailable"]').text()).toContain('只读预检没有运行编号')
    expect(wrapper.get('[data-testid="run-diagnostic-summary"]').text()).toContain('未执行任何业务动作')
    expect(wrapper.find('[data-testid="view-local-screenshot"]').exists()).toBe(false)
    expect(read).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
