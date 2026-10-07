import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  createBusinessBatch: vi.fn(),
  createDemoBatch: vi.fn(),
  createToolLaunchGrant: vi.fn(),
  finishDemoBatch: vi.fn(),
  finishBusinessBatch: vi.fn(),
  getBusinessBootstrap: vi.fn(),
  getBusinessBatches: vi.fn(),
  getBusinessBatch: vi.fn(),
  getDemoBatches: vi.fn(),
  getDemoBatch: vi.fn(),
  updateDemoBatch: vi.fn(),
  updateDemoBatchItem: vi.fn(),
  updateBusinessBatch: vi.fn(),
  updateBusinessBatchItem: vi.fn(),
}))

vi.mock('@/utils/api', () => ({
  ...apiMocks,
  getDemoBatchesPage: async (params: { page: number; page_size: number }) => {
    const response = await apiMocks.getDemoBatches(params)
    const data = Array.isArray(response) ? response : response.data
    return { page: params.page, page_size: params.page_size, total: response.total ?? data.length, data }
  },
}))

import { useBusinessWorkspaceStore } from '@/stores/businessWorkspace'
import { BusinessDemoCoordinator } from '@/features/business/demo-coordinator'
import { BusinessLiveCoordinator } from '@/features/business/live-coordinator'
import type { BusinessBatchSnapshot } from '@/features/business/model'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('business workspace sync outbox', () => {
  let emitBatchEvent: ((event: unknown) => void) | undefined
  let electronBatch: Record<string, ReturnType<typeof vi.fn>>

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    sessionStorage.clear()
    sessionStorage.setItem('toolbox_auth', JSON.stringify({ token: 'isolated-store-test-token', role: 'user' }))
    localStorage.setItem('toolbox_user', JSON.stringify({ user_id: 123, device_id: 'test-device', product_type: 'business' }))
    setActivePinia(createPinia())
    Object.values(apiMocks).forEach(mock => mock.mockReset())
    apiMocks.getBusinessBootstrap.mockResolvedValue({ entitlements: {}, tools: [] })
    apiMocks.getDemoBatches.mockResolvedValue([])
    apiMocks.updateBusinessBatch.mockResolvedValue({})
    apiMocks.finishBusinessBatch.mockResolvedValue({})
    apiMocks.updateDemoBatch.mockResolvedValue({})
    apiMocks.updateDemoBatchItem.mockResolvedValue({})
    apiMocks.finishDemoBatch.mockResolvedValue({})
    electronBatch = {
      onEvent: vi.fn((listener: (event: unknown) => void) => {
        emitBatchEvent = listener
        return vi.fn()
      }),
      getSnapshot: vi.fn().mockResolvedValue({ status: 'idle', recordKind: 'live', items: [] }),
      cancel: vi.fn().mockResolvedValue({ status: 'cancelled', items: [] }),
      loadSampleImport: vi.fn(),
      selectImportFile: vi.fn(),
      remapImportItems: vi.fn(),
      create: vi.fn(),
      start: vi.fn(),
    }
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        batch: electronBatch,
        demoActivity: { setActive: vi.fn().mockResolvedValue(undefined) },
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  async function preparePendingDemo() {
    const tools = [
      { id: 'old-demo-tool', name: '旧演示工具', availability: 'demo_only', demo_scenario_id: 'old' },
      { id: 'new-demo-tool', name: '新演示工具', availability: 'demo_only', demo_scenario_id: 'new' },
    ]
    apiMocks.getBusinessBootstrap.mockResolvedValue({ entitlements: {}, tools })
    electronBatch.loadSampleImport.mockResolvedValue({ importId: 'old-import', validCount: 1, rows: [], errors: [] })
    const store = useBusinessWorkspaceStore()
    await store.init()
    store.chooseTool(store.tools[0])
    await store.loadSampleImport()
    return store
  }

  async function prepareLiveSelection() {
    const tool = {
      id: 'live-tool', name: '批量发货', capability_key: 'ship_script', platform_key: 'amazon',
      availability: 'live', script_status: 'script_ready', release_status: 'available', supports_live_batch: true,
      available_plans: ['Y199'], tool_version: '1.0.0', runner_api_version: 1,
      batch_input_schema: [{ key: 'order_id', label: '订单号', required: true }],
    }
    localStorage.setItem('toolbox_user', JSON.stringify({ user_id: 123, device_id: 'test-device', product_type: 'business', plan_code: 'Y199', platform_scope: ['amazon'] }))
    apiMocks.getBusinessBootstrap.mockResolvedValue({ entitlements: { max_batch_rows: 20 }, tools: [tool] })
    electronBatch.selectImportFile.mockResolvedValue({ importId: 'prepared-import', validCount: 1, rows: [], errors: [] })
    const store = useBusinessWorkspaceStore()
    await store.init()
    store.chooseTool(store.tools[0])
    await store.selectImportFile()
    return { store, tool }
  }

  it('rebinds a same-ID withdrawn tool and clears its prepared input without executing', async () => {
    const { store, tool } = await prepareLiveSelection()
    const oldSelection = store.selectedTool
    apiMocks.getBusinessBootstrap.mockResolvedValueOnce({ entitlements: { max_batch_rows: 20 }, tools: [{ ...tool, script_status: 'blocked' }] })
    await store.refreshBootstrap()
    expect(store.selectedTool).toBe(store.tools[0])
    expect(store.selectedTool).not.toBe(oldSelection)
    expect(store.selectedTool?.script_status).toBe('blocked')
    expect(store.importPreview).toBeNull()
    expect(store.preparationNotice).toContain('旧导入已清除')
    await expect(store.selectImportFile()).rejects.toThrow('不支持批量准备')
    await expect(store.startBatch()).rejects.toThrow('请先导入有效数据')
    expect(electronBatch.selectImportFile).toHaveBeenCalledOnce()
    expect(apiMocks.createBusinessBatch).not.toHaveBeenCalled()
    store.dispose()
  })

  it.each([
    { batch_input_schema: [{ key: 'sku', label: 'SKU', required: true }] },
    { tool_version: '2.0.0' }, { runner_api_version: 2 }, { available_plans: ['Y999'] },
  ])('invalidates prior imports when same-ID preparation metadata changes: %j', async changes => {
    const { store, tool } = await prepareLiveSelection()
    apiMocks.getBusinessBootstrap.mockResolvedValueOnce({ entitlements: { max_batch_rows: 20 }, tools: [{ ...tool, ...changes }] })
    await store.refreshBootstrap()
    expect(store.selectedTool).toBe(store.tools[0])
    expect(store.selectedTool).toMatchObject(changes)
    expect(store.importPreview).toBeNull()
    expect(store.preparationNotice).toContain('旧导入已清除')
    await expect(store.startBatch()).rejects.toThrow('请先导入有效数据')
    expect(apiMocks.createBusinessBatch).not.toHaveBeenCalled()
    store.dispose()
  })

  it('invalidates old input for changed batch limits or explicit permission withdrawal', async () => {
    const { store, tool } = await prepareLiveSelection()
    apiMocks.getBusinessBootstrap.mockResolvedValueOnce({ entitlements: { max_batch_rows: 5 }, tools: [tool] })
    await store.refreshBootstrap()
    expect(store.importPreview).toBeNull()
    await store.selectImportFile()
    apiMocks.getBusinessBootstrap.mockResolvedValueOnce({ entitlements: { max_batch_rows: 5, batch_execution: false }, tools: [tool] })
    await store.refreshBootstrap()
    expect(store.importPreview).toBeNull()
    await expect(store.selectImportFile()).rejects.toThrow('不支持批量准备')
    store.dispose()
  })

  it('invalidates prepared input when the current plan changes without changing tool ID', async () => {
    const { store } = await prepareLiveSelection()
    localStorage.setItem('toolbox_user', JSON.stringify({ user_id: 123, device_id: 'test-device', product_type: 'business', plan_code: 'Y15', platform_scope: ['amazon'] }))
    store.reconcileToolSelection()
    expect(store.importPreview).toBeNull()
    await expect(store.selectImportFile()).rejects.toThrow('不支持批量准备')
    store.dispose()
  })

  it('updates descriptive metadata without clearing a compatible import', async () => {
    const { store, tool } = await prepareLiveSelection()
    const preview = store.importPreview
    apiMocks.getBusinessBootstrap.mockResolvedValueOnce({ entitlements: { max_batch_rows: 20, display_note: '新文案' }, tools: [{ ...tool, name: '新版名称', description: '更新说明' }] })
    await store.refreshBootstrap()
    expect(store.selectedTool).toBe(store.tools[0])
    expect(store.selectedTool?.name).toBe('新版名称')
    expect(store.importPreview).toBe(preview)
    expect(store.preparationNotice).toBeNull()
    store.dispose()
  })

  it('does not attach a late import parsed against a withdrawn same-ID schema', async () => {
    const { store, tool } = await prepareLiveSelection()
    const late = deferred<unknown>()
    electronBatch.selectImportFile.mockReturnValueOnce(late.promise)
    const importing = store.selectImportFile()
    apiMocks.getBusinessBootstrap.mockResolvedValueOnce({ entitlements: { max_batch_rows: 20 }, tools: [{ ...tool, batch_input_schema: [{ key: 'sku', label: 'SKU' }] }] })
    await store.refreshBootstrap()
    late.resolve({ importId: 'obsolete-schema', validCount: 1, rows: [], errors: [] })
    await importing
    expect(store.importPreview).toBeNull()
    expect(store.selectedTool?.batch_input_schema).toEqual([{ key: 'sku', label: 'SKU' }])
    store.dispose()
  })

  it('keeps refresh ownership when an overlapping import finishes first and blocks new work until blocked metadata arrives', async () => {
    const { store, tool } = await prepareLiveSelection()
    const importing = deferred<unknown>()
    const refreshing = deferred<unknown>()
    electronBatch.selectImportFile.mockReturnValueOnce(importing.promise)
    const oldImport = store.selectImportFile()
    apiMocks.getBusinessBootstrap.mockReturnValueOnce(refreshing.promise)
    const refresh = store.refreshBootstrap()
    expect(store.bootstrapRefreshing).toBe(true)
    importing.resolve({ importId: 'overlapping-import', validCount: 1, rows: [], errors: [] })
    await oldImport
    // Import completion may release its own spinner, not directory ownership.
    expect(store.loading).toBe(false)
    expect(store.bootstrapRefreshing).toBe(true)
    await expect(store.startBatch()).rejects.toThrow('正在刷新工具目录')
    await expect(store.selectImportFile()).rejects.toThrow('正在刷新工具目录')
    await expect(store.loadSampleImport()).rejects.toThrow('正在刷新工具目录')
    expect(apiMocks.createBusinessBatch).not.toHaveBeenCalled()
    expect(electronBatch.selectImportFile).toHaveBeenCalledTimes(2)
    refreshing.resolve({ entitlements: { max_batch_rows: 20 }, tools: [{ ...tool, script_status: 'blocked' }] })
    await refresh
    expect(store.bootstrapRefreshing).toBe(false)
    expect(store.selectedTool?.script_status).toBe('blocked')
    expect(store.importPreview).toBeNull()
    store.dispose()
  })

  it('reconciles withdrawn metadata after an already-pending startup rejects without retaining its old input', async () => {
    const { store, tool } = await prepareLiveSelection()
    const starting = deferred<BusinessBatchSnapshot>()
    vi.spyOn(BusinessLiveCoordinator.prototype, 'start').mockReturnValueOnce(starting.promise)
    const originalSelection = store.selectedTool
    const start = store.startBatch().catch(error => error)
    apiMocks.getBusinessBootstrap.mockResolvedValueOnce({ entitlements: { max_batch_rows: 20 }, tools: [{ ...tool, script_status: 'blocked' }] })
    await store.refreshBootstrap()
    expect(store.selectedTool).toBe(originalSelection)
    expect(store.importPreview?.importId).toBe('prepared-import')
    starting.reject(new Error('授权启动失败'))
    expect(await start).toMatchObject({ message: '授权启动失败' })
    expect(store.selectedTool).toBe(store.tools[0])
    expect(store.selectedTool?.script_status).toBe('blocked')
    expect(store.importPreview).toBeNull()
    expect(store.preparationNotice).toContain('旧导入已清除')
    expect(store.snapshot.status).toBe('idle')
    expect(electronBatch.cancel).not.toHaveBeenCalled()
    store.dispose()
  })

  it('does not rewrite a running batch tool, imported input or snapshot during directory refresh', async () => {
    const { store, tool } = await prepareLiveSelection()
    store.snapshot = { status: 'running', recordKind: 'live', tool: store.selectedTool!, items: [], counts: {} }
    const activeTool = store.selectedTool
    const activeSnapshot = store.snapshot
    const activeInput = store.importPreview
    apiMocks.getBusinessBootstrap.mockResolvedValueOnce({ entitlements: { max_batch_rows: 2 }, tools: [{ ...tool, script_status: 'blocked', tool_version: '2.0.0' }] })
    await store.refreshBootstrap()
    expect(store.tools[0].script_status).toBe('blocked')
    expect(store.selectedTool).toBe(activeTool)
    expect(store.snapshot).toBe(activeSnapshot)
    expect(store.snapshot.tool?.tool_version).toBe('1.0.0')
    expect(store.importPreview).toBe(activeInput)
    expect(electronBatch.cancel).not.toHaveBeenCalled()
    store.dispose()
  })

  it('routes cancellation to Demo while its create request is pending and snapshot still belongs to Live', async () => {
    const created = deferred<unknown>()
    apiMocks.createDemoBatch.mockReturnValueOnce(created.promise)
    apiMocks.updateDemoBatch.mockImplementation(async (id, payload) => ({ id, status: payload.status, event_seq: payload.event_seq }))
    const cancelDemo = vi.spyOn(BusinessDemoCoordinator.prototype, 'cancel')
    const cancelLive = vi.spyOn(BusinessLiveCoordinator.prototype, 'cancel')
    const store = await preparePendingDemo()
    expect(store.snapshot.recordKind).toBe('live')
    const started = store.startBatch().catch(error => error)
    expect(store.loading).toBe(true)
    expect(apiMocks.createDemoBatch).toHaveBeenCalledOnce()
    store.chooseTool(store.tools[1])
    expect(store.selectedTool?.id).toBe('old-demo-tool')

    await store.cancelBatch('cancelled')
    expect(cancelDemo).toHaveBeenCalledWith('cancelled')
    expect(cancelLive).not.toHaveBeenCalled()
    expect(store.loading).toBe(false)
    created.resolve({ id: 'late-demo-created', tool_id: 'old-demo-tool', row_count: 1, items: [] })
    expect(await started).toBeInstanceOf(Error)
    expect(electronBatch.remapImportItems).not.toHaveBeenCalled()
    expect(electronBatch.create).not.toHaveBeenCalled()
    expect(electronBatch.start).not.toHaveBeenCalled()
    expect(apiMocks.updateDemoBatch).toHaveBeenCalledWith('late-demo-created', expect.objectContaining({ status: 'cancelled' }))
    store.dispose()
  })

  it('shares one bootstrap request when the shell and workspace initialize the same owner together', async () => {
    const bootstrap = deferred<unknown>()
    apiMocks.getBusinessBootstrap.mockReturnValueOnce(bootstrap.promise)
    const store = useBusinessWorkspaceStore()
    const shellInit = store.init()
    const workspaceInit = store.init()
    expect(apiMocks.getBusinessBootstrap).toHaveBeenCalledOnce()
    bootstrap.resolve({ entitlements: { max_batch_rows: 8 }, tools: [{ id: 'shared-tool', name: '共同授权工具' }] })

    const [shell, workspace] = await Promise.all([shellInit, workspaceInit])
    expect(shell).toBe(workspace)
    expect(store.tools.map(tool => tool.id)).toEqual(['shared-tool'])
    expect(store.entitlements.max_batch_rows).toBe(8)
    expect(store.error).toBeNull()
    expect(electronBatch.onEvent).toHaveBeenCalledOnce()
    await store.init()
    expect(apiMocks.getBusinessBootstrap).toHaveBeenCalledOnce()
    store.dispose()
  })

  it('exposes a shared initial network failure and allows a clean subsequent retry', async () => {
    const failedBootstrap = deferred<unknown>()
    apiMocks.getBusinessBootstrap.mockReturnValueOnce(failedBootstrap.promise)
    const store = useBusinessWorkspaceStore()
    const shellInit = store.init().catch(error => error)
    const workspaceInit = store.init().catch(error => error)
    failedBootstrap.reject(new Error('bootstrap network unavailable'))
    expect(await shellInit).toMatchObject({ message: 'bootstrap network unavailable' })
    expect(await workspaceInit).toMatchObject({ message: 'bootstrap network unavailable' })
    expect(apiMocks.getBusinessBootstrap).toHaveBeenCalledOnce()
    expect(store.bootstrap).toBeNull()
    expect(store.error).toBe('bootstrap network unavailable')
    expect(electronBatch.getSnapshot).not.toHaveBeenCalled()

    apiMocks.getBusinessBootstrap.mockResolvedValueOnce({ entitlements: {}, tools: [{ id: 'retry-tool', name: '重试工具' }] })
    await store.init()
    expect(apiMocks.getBusinessBootstrap).toHaveBeenCalledTimes(2)
    expect(store.tools.map(tool => tool.id)).toEqual(['retry-tool'])
    expect(store.error).toBeNull()
    store.dispose()
  })

  it('does not reuse or apply a disposed bootstrap promise when the same owner reopens the workspace', async () => {
    const obsoleteBootstrap = deferred<unknown>()
    const currentBootstrap = deferred<unknown>()
    apiMocks.getBusinessBootstrap
      .mockReturnValueOnce(obsoleteBootstrap.promise)
      .mockReturnValueOnce(currentBootstrap.promise)
    const store = useBusinessWorkspaceStore()
    const oldInit = store.init().catch(error => error)
    store.dispose()
    const currentInit = store.init()
    const sharedCurrentInit = store.init()
    expect(apiMocks.getBusinessBootstrap).toHaveBeenCalledTimes(2)
    obsoleteBootstrap.resolve({ entitlements: {}, tools: [{ id: 'old-tool', name: '失效工具' }] })
    expect(await oldInit).toBeInstanceOf(Error)
    expect(store.bootstrap).toBeNull()
    expect(store.error).toBeNull()

    currentBootstrap.resolve({ entitlements: {}, tools: [{ id: 'reopened-tool', name: '重新载入工具' }] })
    await Promise.all([currentInit, sharedCurrentInit])
    expect(store.tools.map(tool => tool.id)).toEqual(['reopened-tool'])
    expect(store.error).toBeNull()
    store.dispose()
  })

  it.each([
    ['cancel', 'resolve'], ['cancel', 'reject'],
    ['dispose', 'resolve'], ['dispose', 'reject'],
  ] as const)('ignores old startup %s/%s completion without clearing a new import or its loading owner', async (invalidate, settlement) => {
    const old = deferred<BusinessBatchSnapshot>()
    const current = deferred<BusinessBatchSnapshot>()
    // Exercise facade ownership independently of coordinator lifecycle tests.
    vi.spyOn(BusinessDemoCoordinator.prototype, 'start')
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(current.promise)
    const store = await preparePendingDemo()
    const previousStart = store.startBatch().catch(error => error)
    if (invalidate === 'cancel') await store.cancelBatch('cancelled')
    else store.dispose()
    store.chooseTool(store.tools[1])
    electronBatch.loadSampleImport.mockResolvedValueOnce({ importId: 'new-import', validCount: 1, rows: [], errors: [] })
    await store.loadSampleImport()
    const currentStart = store.startBatch()
    expect(store.loading).toBe(true)
    expect(store.importPreview?.importId).toBe('new-import')

    if (settlement === 'resolve') old.resolve({ status: 'running', recordKind: 'demo', items: [], counts: {} })
    else old.reject(new Error('obsolete startup failure'))
    await previousStart
    expect(store.loading).toBe(true)
    expect(store.importPreview?.importId).toBe('new-import')
    expect(store.selectedTool?.id).toBe('new-demo-tool')
    expect(store.error).toBeNull()
    // Old finally must not unlock tool changes during the current startup.
    store.chooseTool(store.tools[0])
    expect(store.selectedTool?.id).toBe('new-demo-tool')

    current.resolve({ status: 'running', recordKind: 'demo', items: [], counts: {} })
    await currentStart
    expect(store.loading).toBe(false)
    expect(store.importPreview).toBeNull()
    store.dispose()
  })

  it.each(['cancel', 'dispose'] as const)('does not overwrite a newer import failure when an old start rejects after %s', async invalidate => {
    const old = deferred<BusinessBatchSnapshot>()
    vi.spyOn(BusinessDemoCoordinator.prototype, 'start').mockReturnValueOnce(old.promise)
    const store = await preparePendingDemo()
    const previousStart = store.startBatch().catch(error => error)
    if (invalidate === 'cancel') await store.cancelBatch('cancelled')
    else store.dispose()
    store.chooseTool(store.tools[1])
    electronBatch.loadSampleImport.mockRejectedValueOnce(new Error('new import file is invalid'))
    await expect(store.loadSampleImport()).rejects.toThrow('new import file is invalid')
    expect(store.error).toBe('new import file is invalid')
    old.reject(new Error('obsolete startup failure'))
    await previousStart
    expect(store.error).toBe('new import file is invalid')
    expect(store.loading).toBe(false)
    expect(store.selectedTool?.id).toBe('new-demo-tool')
    store.dispose()
  })

  it.each([
    { user_id: 456, device_id: 'test-device' },
    { user_id: 123, device_id: 'test-device', auth_code_id: 456 },
    { user_id: 123, device_id: 'other-device' },
  ])('clears every cached workspace slice when authorization scope changes to %j', async owner => {
    const store = await preparePendingDemo()
    apiMocks.getBusinessBatches.mockResolvedValueOnce([{ id: 10 }])
    apiMocks.getDemoBatches.mockResolvedValueOnce([{ id: 'old-batch', tool_id: 'old-demo-tool' }])
    await store.loadHistory()
    await store.loadDemoHistory()
    store.snapshot = { status: 'completed', recordKind: 'demo', serverBatchId: 'old-batch', items: [], counts: {} }
    store.selectedItemId = 'old-item'
    store.error = 'old workspace failure'
    store.historyError = 'old history failure'
    store.bootstrapStale = true
    const currentBootstrap = deferred<unknown>()
    apiMocks.getBusinessBootstrap.mockReturnValueOnce(currentBootstrap.promise)
    electronBatch.getSnapshot.mockResolvedValueOnce(null)
    localStorage.setItem('toolbox_user', JSON.stringify({ ...owner, product_type: 'business' }))

    const initialized = store.init()
    expect(store.bootstrap).toBeNull()
    expect(store.tools).toEqual([])
    expect(store.history).toEqual([])
    expect(store.demoHistory).toEqual([])
    expect(store.importPreview).toBeNull()
    expect(store.selectedTool).toBeNull()
    expect(store.selectedItemId).toBeNull()
    expect(store.snapshot).toMatchObject({ status: 'idle', items: [] })
    expect(store.error).toBeNull()
    expect(store.historyError).toBeNull()
    expect(store.bootstrapStale).toBe(false)
    expect(store.loading).toBe(false)
    expect(store.historyLoading).toBe(false)

    currentBootstrap.resolve({ entitlements: { max_batch_rows: 5 }, tools: [{ id: 'owner-tool', name: '新授权工具' }] })
    await initialized
    expect(apiMocks.getBusinessBootstrap).toHaveBeenCalledTimes(2)
    expect(store.tools.map(tool => tool.id)).toEqual(['owner-tool'])
    expect(store.entitlements.max_batch_rows).toBe(5)
    expect(store.importPreview).toBeNull()
    store.dispose()
  })

  it('rejects a late bootstrap from the previous owner without replacing the current owner state', async () => {
    const oldBootstrap = deferred<unknown>()
    const currentBootstrap = deferred<unknown>()
    apiMocks.getBusinessBootstrap
      .mockReturnValueOnce(oldBootstrap.promise)
      .mockReturnValueOnce(currentBootstrap.promise)
    electronBatch.getSnapshot.mockResolvedValue(null)
    const store = useBusinessWorkspaceStore()
    const oldInit = store.init().catch(error => error)
    localStorage.setItem('toolbox_user', JSON.stringify({ user_id: 456, device_id: 'new-device', product_type: 'business' }))
    const currentInit = store.init()
    currentBootstrap.resolve({ entitlements: {}, tools: [{ id: 'current-tool', name: '新授权工具' }] })
    await currentInit
    oldBootstrap.resolve({ entitlements: {}, tools: [{ id: 'old-tool', name: '旧授权工具' }] })
    expect(await oldInit).toMatchObject({ message: '授权已切换，请重新打开工作台' })
    expect(store.tools.map(tool => tool.id)).toEqual(['current-tool'])
    expect(electronBatch.getSnapshot).toHaveBeenCalledOnce()
    expect(store.error).toBeNull()
    store.dispose()
  })

  it.each(['resolve', 'reject'] as const)('does not let an old owner refresh %s change the new refresh loading or error', async settlement => {
    const store = await preparePendingDemo()
    const oldBootstrap = deferred<unknown>()
    apiMocks.getBusinessBootstrap.mockReturnValueOnce(oldBootstrap.promise)
    const oldRefresh = store.refreshBootstrap().catch(error => error)
    localStorage.setItem('toolbox_user', JSON.stringify({ user_id: 456, device_id: 'new-device', product_type: 'business' }))
    apiMocks.getBusinessBootstrap.mockResolvedValueOnce({ entitlements: {}, tools: [{ id: 'current-tool', name: '新授权工具' }] })
    electronBatch.getSnapshot.mockResolvedValueOnce(null)
    await store.init()
    const currentBootstrap = deferred<unknown>()
    apiMocks.getBusinessBootstrap.mockReturnValueOnce(currentBootstrap.promise)
    const currentRefresh = store.refreshBootstrap().catch(error => error)
    expect(store.loading).toBe(true)

    if (settlement === 'resolve') oldBootstrap.resolve({ entitlements: {}, tools: [{ id: 'old-tool', name: '旧授权工具' }] })
    else oldBootstrap.reject(new Error('obsolete refresh failure'))
    expect(await oldRefresh).toBeInstanceOf(Error)
    expect(store.tools.map(tool => tool.id)).toEqual(['current-tool'])
    expect(store.loading).toBe(true)
    expect(store.error).toBeNull()
    expect(store.bootstrapStale).toBe(false)

    currentBootstrap.reject(new Error('current refresh failure'))
    expect(await currentRefresh).toMatchObject({ message: 'current refresh failure' })
    expect(store.loading).toBe(false)
    expect(store.error).toBe('current refresh failure')
    expect(store.bootstrapStale).toBe(true)
    store.dispose()
  })

  it.each([
    ['live', 'resolve'], ['live', 'reject'],
    ['demo', 'resolve'], ['demo', 'reject'],
  ] as const)('invalidates previous owner %s history %s without changing the current request', async (kind, settlement) => {
    const store = await preparePendingDemo()
    const oldHistory = deferred<unknown>()
    const historyApi = kind === 'live' ? apiMocks.getBusinessBatches : apiMocks.getDemoBatches
    const load = () => kind === 'live' ? store.loadHistory() : store.loadDemoHistory()
    historyApi.mockReturnValueOnce(oldHistory.promise)
    const oldRequest = load().catch(error => error)
    localStorage.setItem('toolbox_user', JSON.stringify({ user_id: 456, device_id: 'new-device', product_type: 'business' }))
    electronBatch.getSnapshot.mockResolvedValueOnce(null)
    await store.init()
    const currentHistory = deferred<unknown>()
    historyApi.mockReturnValueOnce(currentHistory.promise)
    const currentRequest = load()

    if (settlement === 'resolve') oldHistory.resolve(kind === 'live' ? [{ id: 10 }] : [{ id: 'old-demo', tool_id: 'old' }])
    else oldHistory.reject(new Error('obsolete history failure'))
    await oldRequest
    expect(store.history).toEqual([])
    expect(store.demoHistory).toEqual([])
    expect(store.historyLoading).toBe(true)
    expect(store.historyError).toBeNull()

    currentHistory.resolve(kind === 'live' ? [{ id: 20 }] : [{ id: 'current-demo', tool_id: 'current' }])
    await currentRequest
    expect(store.historyLoading).toBe(false)
    expect(kind === 'live' ? store.history[0]?.id : store.demoHistory[0]?.id).toBe(kind === 'live' ? 20 : 'current-demo')
    store.dispose()
  })

  it.each(['resolve', 'reject'] as const)('invalidates a pending import %s when changing authorization without clearing the new import loading', async settlement => {
    const store = await preparePendingDemo()
    const oldImport = deferred<unknown>()
    electronBatch.loadSampleImport.mockReturnValueOnce(oldImport.promise)
    const oldRequest = store.loadSampleImport().catch(error => error)
    localStorage.setItem('toolbox_user', JSON.stringify({ user_id: 456, device_id: 'new-device', product_type: 'business' }))
    electronBatch.getSnapshot.mockResolvedValueOnce(null)
    await store.init()
    store.chooseTool(store.tools[1])
    const currentImport = deferred<unknown>()
    electronBatch.loadSampleImport.mockReturnValueOnce(currentImport.promise)
    const currentRequest = store.loadSampleImport()

    if (settlement === 'resolve') oldImport.resolve({ importId: 'obsolete-import', validCount: 1, rows: [], errors: [] })
    else oldImport.reject(new Error('obsolete import failure'))
    await oldRequest
    expect(store.importPreview).toBeNull()
    expect(store.loading).toBe(true)
    expect(store.error).toBeNull()
    expect(store.selectedTool?.id).toBe('new-demo-tool')

    currentImport.resolve({ importId: 'current-owner-import', validCount: 1, rows: [], errors: [] })
    await currentRequest
    expect(store.importPreview?.importId).toBe('current-owner-import')
    expect(store.loading).toBe(false)
    store.dispose()
  })

  it('keeps the workspace store as a stable public facade', () => {
    const store = useBusinessWorkspaceStore()

    expect(store).toEqual(expect.objectContaining({
      bootstrap: null,
      history: [],
      demoHistory: [],
      importPreview: null,
      selectedTool: null,
      selectedItemId: null,
      init: expect.any(Function),
      loadSampleImport: expect.any(Function),
      selectImportFile: expect.any(Function),
      startBatch: expect.any(Function),
      registerBrowser: expect.any(Function),
      completeUserAction: expect.any(Function),
      restartItem: expect.any(Function),
      cancelBatch: expect.any(Function),
      resetWorkspace: expect.any(Function),
      flushOutboxWithin: expect.any(Function),
      dispose: expect.any(Function),
    }))
  })

  it('keeps the latest item status and retries after connectivity returns', async () => {
    apiMocks.getBusinessBatch.mockResolvedValueOnce({ id: 10, client_batch_id: 'local-1' })
    electronBatch.getSnapshot.mockResolvedValue({
      batchId: 'local-1',
      serverBatchId: 10,
      status: 'running',
      recordKind: 'live',
      counts: { total: 1, running: 1 },
      items: [{
        itemId: 'item-1',
        accountLabelMasked: '客***1',
        status: 'running',
        browserReady: true,
      }],
    })
    apiMocks.updateBusinessBatchItem
      .mockRejectedValueOnce(new TypeError('network unavailable'))
      .mockResolvedValueOnce({})

    const store = useBusinessWorkspaceStore()
    await store.init()
    emitBatchEvent?.({
      type: 'batch.item_updated',
      itemId: 'item-1',
      snapshot: {
        batchId: 'local-1',
        serverBatchId: 10,
        status: 'running',
        counts: { total: 1, waiting: 1 },
        items: [{
          itemId: 'item-1',
          accountLabelMasked: '客***1',
          status: 'waiting_user',
          interventionType: 'login',
          message: '请完成登录',
          browserReady: true,
        }],
      },
    })
    await vi.advanceTimersByTimeAsync(1)
    expect(store.syncState).toBe('offline')

    await vi.advanceTimersByTimeAsync(2_100)
    expect(apiMocks.updateBusinessBatchItem).toHaveBeenCalledTimes(2)
    expect(apiMocks.updateBusinessBatchItem).toHaveBeenLastCalledWith(
      10,
      'item-1',
      expect.objectContaining({ status: 'waiting_user', intervention_type: 'login' }),
    )
    expect(store.syncState).toBe('synced')
    store.dispose()
  })

  it('keeps history failures separate from workspace bootstrap state', async () => {
    apiMocks.getDemoBatches.mockRejectedValue(new Error('history unavailable'))
    const store = useBusinessWorkspaceStore()
    await store.init()

    await expect(store.loadDemoHistory()).rejects.toThrow('history unavailable')
    expect(store.historyError).toBe('history unavailable')
    expect(store.error).toBeNull()
    expect(store.bootstrap).not.toBeNull()
    store.dispose()
  })

  it('lets the newest live history request win and own loading state', async () => {
    let resolveOld!: (value: unknown) => void
    let resolveNew!: (value: unknown) => void
    apiMocks.getBusinessBatches
      .mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve }))
      .mockReturnValueOnce(new Promise(resolve => { resolveNew = resolve }))
    const store = useBusinessWorkspaceStore()
    const old = store.loadHistory()
    const current = store.loadHistory()
    expect(store.historyLoading).toBe(true)
    resolveNew([{ id: 2 }])
    await current
    expect(store.history[0]).toMatchObject({ id: 2 })
    expect(store.historyLoading).toBe(false)
    resolveOld([{ id: 1 }])
    await old
    expect(store.history[0]).toMatchObject({ id: 2 })
    expect(store.historyLoading).toBe(false)
  })

  it('lets the newest demo history request win and keeps the loading flag', async () => {
    let resolveOld!: (value: unknown) => void
    let resolveNew!: (value: unknown) => void
    apiMocks.getDemoBatches
      .mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve }))
      .mockReturnValueOnce(new Promise(resolve => { resolveNew = resolve }))
    const store = useBusinessWorkspaceStore()
    const old = store.loadDemoHistory()
    const current = store.loadDemoHistory()
    expect(store.historyLoading).toBe(true)
    resolveNew({ data: [{ id: 'new', tool_id: 'tool-new' }] })
    await current
    expect(store.demoHistory[0]).toMatchObject({ id: 'new', tool_id: 'tool-new' })
    expect(store.historyLoading).toBe(false)
    resolveOld({ data: [{ id: 'old', tool_id: 'tool-old' }] })
    await old
    expect(store.demoHistory[0]).toMatchObject({ id: 'new', tool_id: 'tool-new' })
    expect(store.historyLoading).toBe(false)
  })

  it('caps demo sample imports at 50 rows even when entitlement is larger', async () => {
    const tool = { id: 'demo-tool', name: '演示工具', availability: 'demo_only', demo_scenario_id: 'demo' }
    apiMocks.getBusinessBootstrap.mockResolvedValue({ entitlements: { max_batch_rows: 500 }, tools: [tool] })
    electronBatch.loadSampleImport.mockResolvedValue({ importId: 'sample', validCount: 1, rows: [], errors: [] })
    const store = useBusinessWorkspaceStore()
    await store.init()
    store.chooseTool(store.tools[0])
    await store.loadSampleImport()
    expect(electronBatch.loadSampleImport).toHaveBeenCalledWith(expect.objectContaining({ maxRows: 50 }))
    store.dispose()
  })

  it.each([8, 50])('starts %i demo accounts together without starting runner sessions', async count => {
    const tool = {
      id: 'demo-tool',
      name: '批量演示工具',
      availability: 'demo_only',
      demo_scenario_id: 'concurrent-demo',
      script_key: 'demo.concurrent',
    }
    const itemIds = Array.from({ length: count }, (_, index) => `server-item-${index + 1}`)
    apiMocks.getBusinessBootstrap.mockResolvedValue({ entitlements: { max_batch_rows: 50 }, tools: [tool] })
    apiMocks.createDemoBatch.mockResolvedValue({
      data: {
        id: 'demo-batch-1',
        tool_id: 'demo-tool',
        row_count: count,
        items: itemIds.map(item_ref => ({ item_ref, status: 'queued', event_seq: 0 })),
      },
    })
    electronBatch.loadSampleImport.mockResolvedValue({
      importId: 'sample-import',
      validCount: count,
      errorCount: 0,
      rows: itemIds.map((itemId, index) => ({ itemId, preview: { account_label: `账号 ${index + 1}` } })),
      errors: [],
    })
    electronBatch.remapImportItems.mockResolvedValue({
      importId: 'remapped-import',
      validCount: count,
      errorCount: 0,
      rows: itemIds.map((itemId, index) => ({ itemId, preview: { account_label: `账号 ${index + 1}` } })),
      errors: [],
    })
    electronBatch.create.mockResolvedValue({
      batchId: 'local-demo',
      serverBatchId: 'demo-batch-1',
      status: 'running',
      recordKind: 'demo',
      counts: { total: count, pending: count, running: 0 },
      items: itemIds.map((itemId, index) => ({
        itemId,
        accountLabelMasked: `账***${index + 1}`,
        status: 'pending',
        browserReady: false,
      })),
    })

    const store = useBusinessWorkspaceStore()
    await store.init()
    store.chooseTool(store.tools[0])
    await store.loadSampleImport()
    await store.startBatch()

    expect(store.snapshot.counts.running).toBe(count)
    expect(store.items.every(item => item.status === 'running')).toBe(true)
    expect(apiMocks.updateDemoBatchItem).toHaveBeenCalledTimes(count)
    expect(electronBatch.start).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(6_000)
    expect(store.snapshot.status).toBe('completed')
    expect(apiMocks.finishDemoBatch).toHaveBeenCalledOnce()
    store.dispose()
  })

  it('runs a browser demo batch without an Electron batch bridge', async () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined })
    const tool = {
      id: 'web-demo-tool', name: '浏览器批量演示', availability: 'demo_only',
      demo_scenario_id: 'web-demo', script_key: 'demo.web',
      batch_input_schema: [{ key: 'account_label', label: '客户简称', required: true }],
    }
    const itemIds = Array.from({ length: 8 }, (_, index) => `web-item-${index + 1}`)
    apiMocks.getBusinessBootstrap.mockResolvedValue({ entitlements: { max_batch_rows: 50 }, tools: [tool] })
    apiMocks.createDemoBatch.mockResolvedValue({ data: {
      id: 'web-demo-batch', tool_id: tool.id, row_count: itemIds.length,
      items: itemIds.map(item_ref => ({ item_ref, status: 'queued', event_seq: 0 })),
    } })

    const store = useBusinessWorkspaceStore()
    await store.init()
    store.chooseTool(store.tools[0])
    await store.loadSampleImport()
    expect(store.importPreview?.validCount).toBe(8)
    await store.startBatch()

    expect(store.snapshot.recordKind).toBe('demo')
    expect(store.items).toHaveLength(8)
    expect(store.items.every(item => item.status === 'running')).toBe(true)
    expect(electronBatch.create).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(6_000)
    expect(store.snapshot.status).toBe('completed')
    store.dispose()
  })

  it('locally exits an active demo even when persistence does not respond', async () => {
    sessionStorage.setItem('toolbox_auth', JSON.stringify({ token: 'isolated-test-token', role: 'user' }))
    localStorage.setItem('toolbox_user', JSON.stringify({ user_id: 123, device_id: 'test-device', product_type: 'business' }))
    const tool = { id: 'demo-tool', name: '批量演示工具', availability: 'demo_only', demo_scenario_id: 'demo' }
    apiMocks.getBusinessBootstrap.mockResolvedValue({ entitlements: {}, tools: [tool] })
    apiMocks.createDemoBatch.mockResolvedValue({ data: {
      id: 'demo-batch-exit', tool_id: 'demo-tool', row_count: 2,
      items: ['one', 'two'].map(item_ref => ({ item_ref, status: 'queued', event_seq: 0 })),
    } })
    electronBatch.loadSampleImport.mockResolvedValue({ importId: 'source', validCount: 2, rows: [], errors: [] })
    electronBatch.remapImportItems.mockResolvedValue({ importId: 'mapped', validCount: 2, rows: [], errors: [] })
    electronBatch.create.mockResolvedValue({
      batchId: 'local-exit', serverBatchId: 'demo-batch-exit', status: 'running', recordKind: 'demo', counts: { total: 2 },
      items: ['one', 'two'].map(itemId => ({ itemId, accountLabelMasked: itemId, status: 'pending', browserReady: false })),
    })
    const never = new Promise(() => {})
    apiMocks.updateDemoBatch.mockResolvedValueOnce({}).mockReturnValueOnce(never)

    const store = useBusinessWorkspaceStore()
    await store.init()
    store.chooseTool(store.tools[0])
    await store.loadSampleImport()
    await store.startBatch()
    const exitPromise = store.cancelBatch('cancelled')
    await vi.advanceTimersByTimeAsync(2_500)
    await exitPromise

    expect(store.snapshot.status).toBe('cancelled')
    expect(store.items.every(item => item.status === 'cancelled')).toBe(true)
    expect(store.syncState).toBe('offline')
    expect(store.recoveryPending).toBe(1)
    const recoveryKey = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .find(key => key?.startsWith('toolbox_demo_recovery_v1:'))
    expect(recoveryKey).toBeDefined()
    expect(recoveryKey).not.toContain('isolated-test-token')
    store.dispose()
  })
})
