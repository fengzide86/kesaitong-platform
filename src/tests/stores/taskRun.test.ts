import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { MockAutomationAdapter } from '@/automation'
import { useTaskRunStore } from '@/stores/taskRun'

const tool = {
  id: 'tool_listing',
  name: '自动上品演示',
  platformKey: 'amazon',
  targetUrl: 'demo://amazon/tool_listing',
  executionMode: 'demo' as const,
}

describe('taskRun store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    useTaskRunStore().reset()
    delete window.electronAPI
    vi.useRealTimers()
  })

  it('通过统一事件协议推进完整模拟任务', async () => {
    const store = useTaskRunStore()
    const adapter = new MockAutomationAdapter({ stepDelay: 10 })

    store.start(tool, { adapter })

    expect(store.status).toBe('running')
    expect(store.steps).toHaveLength(6)
    expect(store.currentStep.id).toBe('prepare')
    expect(store.steps[0].status).toBe('active')

    await vi.advanceTimersByTimeAsync(60)

    expect(store.status).toBe('completed')
    expect(store.completedCount).toBe(6)
    expect(store.progressPercent).toBe(100)
    expect(store.result.summary).toBe('演示流程已走完')
    expect(store.result.recordKind).toBe('demo')
  })

  it('暂停后不推进步骤，恢复后继续执行', async () => {
    const store = useTaskRunStore()
    const adapter = new MockAutomationAdapter({ stepDelay: 20 })

    store.start(tool, { adapter })
    store.pause()

    expect(store.status).toBe('paused')
    expect(store.steps[0].status).toBe('paused')

    await vi.advanceTimersByTimeAsync(100)
    expect(store.completedCount).toBe(0)

    store.resume()
    await vi.advanceTimersByTimeAsync(20)

    expect(store.status).toBe('running')
    expect(store.completedCount).toBe(1)
    expect(store.currentStep.id).toBe('open')
  })

  it('取消任务后进入终态并停止推进', async () => {
    const store = useTaskRunStore()
    const adapter = new MockAutomationAdapter({ stepDelay: 10 })

    store.start(tool, { adapter })
    store.cancel()
    await vi.advanceTimersByTimeAsync(100)

    expect(store.status).toBe('cancelled')
    expect(store.completedCount).toBe(0)
  })

  it('可以在完成后启动新的运行实例', async () => {
    const store = useTaskRunStore()
    const firstAdapter = new MockAutomationAdapter({ stepDelay: 10 })
    store.start(tool, { adapter: firstAdapter })
    const firstRunId = store.runId
    await vi.advanceTimersByTimeAsync(60)
    expect(store.status).toBe('completed')

    const secondAdapter = new MockAutomationAdapter({ stepDelay: 10 })
    store.start(tool, { adapter: secondAdapter })

    expect(store.status).toBe('running')
    expect(store.runId).not.toBe(firstRunId)
    expect(store.completedCount).toBe(0)
    expect(store.steps[0].status).toBe('active')
  })

  it('等待取消请求完成，重复取消只调用一次适配器', async () => {
    const store = useTaskRunStore()
    const adapter = new MockAutomationAdapter({ stepDelay: 100 })
    await store.start(tool, { adapter })
    let release!: () => void
    const cancellation = vi.spyOn(adapter, 'cancel').mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
    let settled = false
    const first = store.cancel().then(() => { settled = true })
    const second = store.cancel()
    await Promise.resolve()
    expect(cancellation).toHaveBeenCalledOnce()
    expect(settled).toBe(false)
    expect(store.status).toBe('running')
    release()
    await Promise.all([first, second])
    expect(settled).toBe(true)
    // An acknowledgement is not a fabricated Runner terminal event.
    expect(store.status).toBe('running')
  })

  it('取消失败保留运行信息，允许重试并由真实事件结束', async () => {
    const store = useTaskRunStore()
    const adapter = new MockAutomationAdapter({ stepDelay: 100 })
    await store.start(tool, { adapter })
    const runId = store.runId
    vi.spyOn(adapter, 'cancel').mockImplementationOnce(() => Promise.reject(new Error('IPC unavailable')))
    await expect(store.cancel()).rejects.toThrow('IPC unavailable')
    expect(store.runId).toBe(runId)
    expect(store.status).toBe('running')
    expect(store.steps).toHaveLength(6)
    await store.cancel()
    expect(store.status).toBe('cancelled')
  })

  it('桌面端 Demo 使用本地 Runner 执行真实交互沙盒', async () => {
    const automation = {
      prepareBrowser: vi.fn().mockResolvedValue({ partition: 'persist:kst-workspace-v1-demo-fixture' }),
      onEvent: vi.fn(() => vi.fn()),
      start: vi.fn(() => Promise.resolve({ runId: 'local_run_1' })),
      preflight: vi.fn(() => Promise.resolve({
        browserMode: 'embedded-cdp', browserState: 'inspected', targetUrl: '',
        scriptKey: 'demo.test', scriptStatus: 'not_ready', canStart: false,
      } as const)),
      pause: vi.fn(),
      resume: vi.fn(),
      completeUserAction: vi.fn(),
      cancel: vi.fn(),
      registerBrowser: vi.fn(),
      unregisterBrowser: vi.fn(),
    }
    window.electronAPI = { automation }
    const store = useTaskRunStore()

    await store.start(tool, { allowInternalDemo: true })

    expect(automation.start).toHaveBeenCalledWith(tool)
    expect(store.status).toBe('preparing')
  })
})
