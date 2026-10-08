import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RecoveryRecord } from '../../shared/ipc/recovery-contract'
const require = createRequire(import.meta.url)
const { RecoveryStore, recoveryOwnerHash } = require('../../../dist-electron/electron/automation/recovery-store.cjs')
const { BatchCoordinator } = require('../../../dist-electron/electron/automation/batch-coordinator.cjs')
const roots: string[] = []
const root = () => { const value = mkdtempSync(join(tmpdir(), 'kst-recovery-')); roots.push(value); return value }
const owner = recoveryOwnerHash(['test', 1, 'auth', 'device'])
const tool = { id: 'listing', launchGrant: { toolVersion: '1.0.0' }, targetUrl: 'http://localhost:8080/form?paras=do-not-save' }
interface TestRunnerOptions {
  onEvent(event: Record<string, unknown>): void
  onHostRequest(action: string, payload: Record<string, unknown>): Promise<unknown>
}
interface TestRunner { options: TestRunnerOptions; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }
afterEach(() => { for (const directory of roots.splice(0)) rmSync(directory, { recursive: true, force: true }) })

describe('durable recovery ledger', () => {
  it('proves failure before any mutation, blocks unknown and completed input, but allows unrelated work', () => {
    const store = new RecoveryStore(root())
    const first = store.begin(owner, tool, { sku: 'one' })
    store.observe(owner, first.id, { type: 'run.failed', error: { code: 'BROWSER_NOT_FOUND' } })
    expect(store.list(owner)[0]).toMatchObject({ classification: 'not_submitted', retryAllowed: true })
    const retry = store.begin(owner, tool, { sku: 'one' })
    expect(retry.attemptId).not.toBe(first.attemptId)
    store.mutation(owner, retry.id)
    store.observe(owner, retry.id, { type: 'run.failed', error: { code: 'TIMEOUT' } })
    expect(store.list(owner).at(-1)).toMatchObject({ classification: 'needs_review', retryAllowed: false })
    expect(() => store.begin(owner, tool, { sku: 'one' })).toThrow(/核对/)
    expect(store.begin(owner, tool, { sku: 'unrelated' })).toBeDefined()
  })
  it('recovers a crash as unknown even when no mutation was seen and manual completion never upgrades execution', () => {
    const directory = root(); let store = new RecoveryStore(directory)
    const record = store.begin(owner, tool, { sku: 'one' })
    store.observe(owner, record.id, { type: 'run.started', runId: 'local_one' })
    store = new RecoveryStore(directory)
    const interrupted = store.list(owner)[0]
    expect(interrupted).toMatchObject({ classification: 'needs_review', executionStatus: 'interrupted', retryAllowed: false })
    const reviewed = store.review(owner, record.id, interrupted.revision, 'completed')
    expect(reviewed).toMatchObject({ classification: 'manual_completed', executionStatus: 'interrupted', retryAllowed: false })
    expect(() => store.begin(owner, tool, { sku: 'one' })).toThrow(/已完成/)
    expect(() => store.review(owner, record.id, interrupted.revision, 'not_completed')).toThrow(/变化/)
  })
  it('atomically fails closed before dispatch when storage cannot replace the ledger', () => {
    const directory = root(); const store = new RecoveryStore(directory)
    const record = store.begin(owner, tool, { password: 'LOCAL-PRIVATE', sku: 'one' })
    const saved = readFileSync(join(directory, 'ledger-v1.json'), 'utf8')
    expect(saved).not.toMatch(/LOCAL-PRIVATE|paras|password|"sku"/)
    expect(store.list(recoveryOwnerHash(['other']))).toEqual([])
    rmSync(join(directory, 'ledger-v1.json')); mkdirSync(join(directory, 'ledger-v1.json'))
    const dispatch = vi.fn()
    expect(() => { store.mutation(owner, record.id); dispatch() }).toThrow(/原子保存/)
    expect(dispatch).not.toHaveBeenCalled()
  })
  it('exports only failed/review rows, no account/input/ids; validates original row, fingerprint and version', () => {
    const store = new RecoveryStore(root())
    const first = store.begin(owner, tool, { sku: 'secret', password: 'no-export' }, { batchId: 'batch', itemId: 'one', originalRow: 2 })
    store.mutation(owner, first.id); store.observe(owner, first.id, { type: 'run.failed', error: { code: 'TIMEOUT' } })
    const second = store.begin(owner, tool, { sku: 'done' }, { batchId: 'batch', itemId: 'two', originalRow: 3 })
    store.observe(owner, second.id, { type: 'run.completed' })
    const csv = store.csv(owner, 'batch')
    expect(csv.count).toBe(1); expect(csv.content).not.toMatch(/secret|no-export|batch|one|two/)
    expect(store.matchRetry(owner, 'batch', { sourceRow: 2, input: { password: 'no-export', sku: 'secret' } }, 'listing', '1.0.0')).toBeNull()
    const current = store.list(owner)[0]; store.review(owner, first.id, current.revision, 'not_completed')
    expect(store.matchRetry(owner, 'batch', { sourceRow: 2, input: { sku: 'secret', password: 'no-export' } }, 'listing', '1.0.0')).toBe(first.id)
    expect(() => store.matchRetry(owner, 'batch', { sourceRow: 2, input: { sku: 'changed' } }, 'listing', '1.0.0')).toThrow(/变化/)
    expect(() => store.matchRetry(owner, 'batch', { sourceRow: 2, input: { sku: 'secret', password: 'no-export' } }, 'listing', '1.1.0')).toThrow(/变化/)
  })
  it('rejects corrupt and old unsupported metadata instead of claiming no submission', () => {
    const directory = root(); writeFileSync(join(directory, 'ledger-v1.json'), '{"version":0,"records":[]}')
    const store = new RecoveryStore(directory)
    expect(() => store.list(owner)).toThrow(/账本损坏/)
    expect(() => store.begin(owner, tool, {})).toThrow(/账本损坏/)
    expect(readFileSync(join(directory, 'ledger-v1.json'), 'utf8')).toBe('{"version":0,"records":[]}')
    const blocked = join(root(), 'not-a-directory'); writeFileSync(blocked, 'keep')
    const unavailable = new RecoveryStore(blocked)
    expect(() => unavailable.begin(owner, tool, {})).toThrow(/初始化/)
    expect(readFileSync(blocked, 'utf8')).toBe('keep')
  })
  it('rejects a missing consumption marker instead of exposing a consumed attempt as retryable', () => {
    const directory = root(); const store = new RecoveryStore(directory)
    store.begin(owner, tool, { fixture: 'private' })
    const path = join(directory, 'ledger-v1.json')
    const ledger = JSON.parse(readFileSync(path, 'utf8')) as { records: Array<Record<string, unknown>> }
    delete ledger.records[0]!.consumedBy
    writeFileSync(path, JSON.stringify(ledger))
    expect(() => new RecoveryStore(directory).list(owner)).toThrow(/账本损坏/)
  })
  it('keeps consumed queue history private and excludes a successful row from failure exports', () => {
    const directory = root(); const store = new RecoveryStore(directory)
    const queued = store.queue(owner, tool, [{ input: { fixture: 'row' }, batchId: 'batch', itemId: 'row', originalRow: 2 }])[0]!
    const attempt = store.begin(owner, tool, { fixture: 'row' }, { batchId: 'batch', itemId: 'row', originalRow: 2, retryOf: queued.id })
    store.observe(owner, attempt.id, { type: 'run.completed' })
    expect(store.list(owner)).toHaveLength(1)
    expect(store.list(owner)[0]).toMatchObject({ classification: 'verified' })
    expect(store.csv(owner, 'batch').count).toBe(0)
    expect(new RecoveryStore(directory).csv(owner, 'batch').count).toBe(0)
    expect(readFileSync(join(directory, 'ledger-v1.json'), 'utf8')).toContain(queued.id)
  })
  it('atomically registers never-dispatched rows and preserves their proof through a process restart', () => {
    const directory = root()
    const store = new RecoveryStore(directory)
    const [record] = store.queue(owner, tool, [{ input: { sku: 'not-dispatched', password: 'do-not-save' }, batchId: 'batch', itemId: 'item', originalRow: 8 }])
    const restarted = new RecoveryStore(directory)
    expect(restarted.list(owner)[0]).toMatchObject({ executionStatus: 'queued', classification: 'not_submitted', originalRow: 8, retryAllowed: true })
    expect(() => restarted.begin(owner, tool, { sku: 'not-dispatched', password: 'do-not-save' })).toThrow(/排队/)
    expect(restarted.matchRetry(owner, 'batch', { sourceRow: 8, input: { sku: 'not-dispatched', password: 'do-not-save' } }, 'listing', '1.0.0')).toBe(record.id)
    expect(readFileSync(join(directory, 'ledger-v1.json'), 'utf8')).not.toMatch(/do-not-save|not-dispatched|password/)
  })
})

describe('batch recovery queue', () => {
  it('marks before mutation, prohibits blind retry, reimports only reviewed rows and retains successful history', async () => {
    const store = new RecoveryStore(root()); const runners: TestRunner[] = []; const ready = new Set<string>()
    const coordinator = new BatchCoordinator({ recoveryStore: store, hostManager: { register: (id: string) => ready.add(id), release: (id: string) => ready.delete(id), releaseAll: () => ready.clear(), isReady: (id: string) => ready.has(id), request: vi.fn(), size: () => ready.size },
      runnerFactory: (options: TestRunnerOptions) => { const runner = { options, start: vi.fn().mockResolvedValue({}), stop: vi.fn().mockResolvedValue(undefined) }; runners.push(runner); return runner } })
    const rows = [2, 3, 4].map((sourceRow, index) => ({ itemId: `item_${index}`, sourceRow, input: { sku: `sku_${index}` }, preview: {}, accountLabelMasked: '***' }))
    coordinator.storeImport({ importId: 'first', rows, errors: [] }, owner); coordinator.create({ importId: 'first', batchId: 'batch', owner, tool, recordKind: 'live' })
    coordinator.registerBrowser('item_0', {}); await coordinator.startItem('item_0', tool)
    runners[0].options.onEvent({ type: 'run.completed' })
    coordinator.registerBrowser('item_1', {}); await coordinator.startItem('item_1', tool)
    await runners[1].options.onHostRequest('recovery.before-mutation', {})
    runners[1].options.onEvent({ type: 'run.failed', error: { code: 'TIMEOUT' } })
    await expect(coordinator.restartItem('item_1')).rejects.toMatchObject({ code: 'RECOVERY_REVIEW_REQUIRED' })
    await coordinator.cancel()
    const unknown = (store.list(owner) as RecoveryRecord[]).filter(row => row.originalRow === 3).at(-1)!
    store.review(owner, unknown.id, unknown.revision, 'not_completed')
    coordinator.storeImport({ importId: 'original', rows, errors: [] }, owner)
    const prepared = coordinator.prepareRecovery(owner, { batchId: 'batch', importId: 'original', toolId: 'listing', toolVersion: '1.0.0' })
    expect((prepared.rows as Array<{ sourceRow: number }>).map(row => row.sourceRow)).toEqual([3, 4])
    expect(prepared.errors).toHaveLength(1)
    expect(coordinator.snapshot().items[0].status).toBe('completed')
    coordinator.create({ importId: prepared.importId, batchId: 'next', owner, tool, recordKind: 'live' })
    const nextItem = coordinator.snapshot().items[0]
    expect(nextItem.attemptId).not.toBe(unknown.attemptId)
    coordinator.registerBrowser(nextItem.itemId, {}); await coordinator.startItem(nextItem.itemId, tool)
    expect(runners).toHaveLength(3)
    expect(runners[2].start.mock.calls[0][0].executionContext.sessionId).not.toBe('session_item_1')
    await expect(coordinator.restartItem(nextItem.itemId)).rejects.toBeDefined()
  })
})
