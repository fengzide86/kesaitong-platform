import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { BatchCoordinator } = require('../../../dist-electron/electron/automation/batch-coordinator.cjs')

function createHarness(recordKind = 'live') {
  const ready = new Set()
  const runners = []
  const hostManager = {
    register: (itemId) => { ready.add(itemId); return { itemId } },
    release: (itemId) => ready.delete(itemId),
    releaseAll: () => ready.clear(),
    isReady: (itemId) => ready.has(itemId),
    size: () => ready.size,
    request: vi.fn(),
  }
  const coordinator = new BatchCoordinator({
    scriptPath: 'runner.cjs',
    hostManager,
    runnerFactory: (options) => {
      const runner = {
        options,
        start: vi.fn().mockResolvedValue({ accepted: true }),
        stop: vi.fn().mockResolvedValue(undefined),
        completeUserAction: vi.fn().mockResolvedValue(undefined),
      }
      runners.push(runner)
      return runner
    },
  })
  coordinator.storeImport({
    importId: 'import-1', fileName: 'accounts.xlsx', errors: [], rows: [
      { itemId: 'one', input: { account_label: '客户一' }, preview: { account_label: '客***一' }, accountLabelMasked: '客***一' },
      { itemId: 'two', input: { account_label: '客户二' }, preview: { account_label: '客***二' }, accountLabelMasked: '客***二' },
    ],
  })
  coordinator.create({ importId: 'import-1', batchId: 'batch-1', serverBatchId: 1, tool: { id: 'register' }, recordKind })
  return { coordinator, runners }
}

describe('BatchCoordinator', () => {
  it('终态重试明确要求重新导入，不伪造 pending 或重新执行已清理输入', async () => {
    const { coordinator, runners } = createHarness('demo')
    await coordinator.startItem('one', {})
    runners[0].options.onEvent({ type: 'run.failed', error: { message: '失败' } })
    await Promise.resolve() // release the execution lease only once stop settles
    await coordinator.startItem('two', {})
    runners[1].options.onEvent({ type: 'run.completed' })
    expect(coordinator.snapshot().status).toBe('completed')
    await expect(coordinator.restartItem('one')).rejects.toMatchObject({ code: 'BATCH_REIMPORT_REQUIRED' })
    expect(coordinator.snapshot().items[0].status).toBe('failed')
    expect(coordinator.batch.items.every(item => item.input === null)).toBe(true)
    expect(runners).toHaveLength(2)
  })

  it('活动批次仍允许失败项重试，全部启动授权失败也正确封闭批次', async () => {
    const { coordinator } = createHarness()
    coordinator.failProvision('one')
    await coordinator.restartItem('one')
    expect(coordinator.snapshot().items[0].status).toBe('pending')
    coordinator.failProvision('two')
    expect(coordinator.snapshot().provisioningItemId).toBe('one')
    coordinator.failProvision('one')
    expect(coordinator.snapshot().status).toBe('completed')
    expect(coordinator.batch.items.every(item => item.input === null)).toBe(true)
  })

  it('服务端任务编号重映射后保留本地 Excel 输入和源行号，但预览不暴露原始输入', () => {
    const ready = new Set()
    const coordinator = new BatchCoordinator({
      hostManager: { register: vi.fn(), release: vi.fn(), releaseAll: vi.fn(), isReady: itemId => ready.has(itemId), size: () => 0, request: vi.fn() },
    })
    const imported = coordinator.storeImport({ importId: 'source', fileName: 'sample.xlsx', errors: [], rows: [
      { itemId: 'local-1', sourceRow: 4, input: { account_label: '客户一', sku: 'SKU-001' }, preview: { account_label: '客***' }, accountLabelMasked: '客***' },
    ] })
    expect(structuredClone(imported).rows[0].sourceRow).toBe(4)
    expect(JSON.stringify(imported)).not.toMatch(/客户一|SKU-001|"input"/)
    const remapped = coordinator.remapImportItems('source', ['server-item-1'])
    expect(structuredClone(remapped).rows[0]).toMatchObject({ itemId: 'server-item-1', sourceRow: 4 })
    expect(JSON.stringify(remapped)).not.toMatch(/客户一|SKU-001|"input"/)
    coordinator.create({ importId: remapped.importId, batchId: 'batch-remap', tool: { id: 'listing' }, recordKind: 'demo' })
    expect(coordinator.batch.items[0]).toMatchObject({ itemId: 'server-item-1', sourceRow: 4, input: { account_label: '客户一', sku: 'SKU-001' } })
    expect(structuredClone(coordinator.snapshot()).items[0]).toMatchObject({ itemId: 'server-item-1', sourceRow: 4 })
    expect(JSON.stringify(coordinator.snapshot())).not.toMatch(/客户一|SKU-001|"input"/)
  })

  it('Demo 批次不需要 webview 就能使用独立 Playwright 沙盒', async () => {
    const { coordinator, runners } = createHarness('demo')

    await coordinator.startItem('one', { scriptKey: 'demo.register_walkthrough_v1' })

    expect(runners[0].start).toHaveBeenCalledWith(expect.objectContaining({
      browserMode: 'playwright',
      executionMode: 'demo',
      executionContext: expect.objectContaining({ itemId: 'one' }),
    }))
    expect(coordinator.snapshot()).toMatchObject({ recordKind: 'demo', activeItemId: 'one' })
  })

  it('一个账号等待用户操作时保留现场并继续下一行，活动 Runner 始终只有一个', async () => {
    const { coordinator, runners } = createHarness()
    expect(coordinator.snapshot().provisioningItemId).toBe('one')

    coordinator.registerBrowser('one', {})
    await coordinator.startItem('one', {})
    expect(coordinator.snapshot().activeItemId).toBe('one')

    runners[0].options.onEvent({ type: 'user.action_required', action: { type: 'captcha', instruction: '完成验证' } })
    let snapshot = coordinator.snapshot()
    expect(snapshot.items[0]).toMatchObject({ status: 'waiting_user', interventionType: 'captcha', browserReady: true })
    expect(snapshot.provisioningItemId).toBe('two')
    expect(snapshot.activeItemId).toBeNull()

    coordinator.registerBrowser('two', {})
    await coordinator.startItem('two', {})
    snapshot = coordinator.snapshot()
    expect(snapshot.activeItemId).toBe('two')
    expect(snapshot.items.filter(item => item.status === 'running')).toHaveLength(1)
    expect(snapshot.items[0]).not.toHaveProperty('input')
  })

  it('启动授权失败会结束当前准备态并让后续账号继续', () => {
    const { coordinator } = createHarness()
    coordinator.failProvision('one', '授权未通过')
    const snapshot = coordinator.snapshot()
    expect(snapshot.items[0]).toMatchObject({ status: 'failed', message: '授权未通过' })
    expect(snapshot.provisioningItemId).toBe('two')
  })

  it('结束批次会清理浏览器与原始输入', async () => {
    const { coordinator } = createHarness()
    coordinator.registerBrowser('one', {})
    await coordinator.startItem('one', {})
    const snapshot = await coordinator.cancel('cancelled')
    expect(snapshot.status).toBe('cancelled')
    expect(snapshot.activeItemId).toBeNull()
    expect(snapshot.items.every(item => ['cancelled', 'failed', 'completed'].includes(item.status))).toBe(true)
  })
})
