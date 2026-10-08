import { z } from 'zod'

import {
  createBusinessBatch,
  createToolLaunchGrant,
  getBusinessBatch,
  finishBusinessBatch,
  updateBusinessBatch,
  updateBusinessBatchItem,
} from '@/utils/api'

import {
  batchEventSchema,
  businessBatchSnapshotSchema,
  launchGrantEnvelopeSchema,
  launchGrantSchema,
  serverBatchSchema,
  emptyBatchSnapshot,
  type BatchEvent,
  type BusinessBatchSnapshot,
  type BusinessTool,
  type ImportPreview,
} from './model'
import { BusinessWorkspaceOutbox, type WorkspaceSyncState } from './workspace-outbox'
import { BusinessOutboxStorage } from './outbox-storage'
import { errorMessage, ipcPayload, requireBatchApi, unwrapData } from './workspace-helpers'

const serverBatchItemStatusSchema = z.enum(['pending', 'running', 'waiting_user', 'completed', 'failed', 'cancelled'])
const serverInterventionTypeSchema = z.enum(['login', 'captcha', 'two_factor', 'page_confirmation', 'other'])
const terminalBatchStatuses = new Set(['completed', 'cancelled', 'interrupted'])

export interface BusinessLiveDependencies {
  getOwnerScope(): string | null
  getSnapshot(): BusinessBatchSnapshot
  setSnapshot(snapshot: BusinessBatchSnapshot): void
  getSelectedTool(): BusinessTool | null
  selectItem(itemId: string): void
  setSyncState(state: WorkspaceSyncState): void
  setError(message: string | null): void
  setStorageUnavailable?(unavailable: boolean): void
}

/** Owns Electron batch events, Runner provisioning and in-session API sync. */
export class BusinessLiveCoordinator {
  private removeEventListener: (() => void) | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private syncTimer: ReturnType<typeof setTimeout> | null = null
  private initialized = false
  private disposed = false
  private lifecycle = 0
  private startupSequence = 0
  private startupBatchId: string | null = null
  private readonly abandonedStarts = new Set<string>()
  private eventRevision = 0
  private readonly provisioning = new Set<string>()
  private ownerScope: string | null = null
  private outbox: BusinessWorkspaceOutbox | null = null
  private readonly ownerOutboxes = new Map<string, BusinessWorkspaceOutbox>()
  private readonly batchOwners = new Map<string, string>()

  constructor(private readonly dependencies: BusinessLiveDependencies) {}

  async initialize(): Promise<void> {
    const owner = this.dependencies.getOwnerScope()
    if (owner !== this.ownerScope) {
      this.dispose()
      this.ownerScope = owner
      this.outbox = null
      this.provisioning.clear()
      this.dependencies.setSnapshot(emptyBatchSnapshot())
    }
    if (!owner) return
    this.disposed = false
    const lifecycle = this.lifecycle
    const valid = () => this.ownsCurrentSession() && lifecycle === this.lifecycle
    this.outbox = this.ownerOutboxes.get(owner) ?? new BusinessWorkspaceOutbox({
      updateItem: updateBusinessBatchItem, updateBatch: updateBusinessBatch, finishBatch: finishBusinessBatch,
      maySync: () => this.ownsCurrentSession() && this.ownerScope === owner,
      onState: state => { if (this.ownsCurrentSession() && this.ownerScope === owner) this.dependencies.setSyncState(state) },
      persistence: new BusinessOutboxStorage(owner, () => localStorage, () => {
        if (this.ownsCurrentSession() && this.ownerScope === owner) this.dependencies.setStorageUnavailable?.(true)
      }),
    })
    this.ownerOutboxes.set(owner, this.outbox)
    const batch = window.electronAPI?.batch
    if (!this.removeEventListener && batch) this.removeEventListener = batch.onEvent(event => this.handleEvent(event))
    const localSnapshot = await batch?.getSnapshot()
    if (!valid()) return
    const parsedLocalSnapshot = businessBatchSnapshotSchema.safeParse(localSnapshot)
    if (parsedLocalSnapshot.success && parsedLocalSnapshot.data.recordKind === 'demo') {
      if (this.dependencies.getSnapshot().status === 'idle') await batch?.cancel('interrupted').catch(() => undefined)
    } else if (parsedLocalSnapshot.success) {
      const local = parsedLocalSnapshot.data
      if (local.status === 'idle') this.dependencies.setSnapshot(local)
      else if (local.batchId && this.abandonedStarts.has(local.batchId)) await batch?.cancel('interrupted').catch(() => undefined)
      else if (local.batchId && this.batchOwners.get(local.batchId) === owner) this.dependencies.setSnapshot(local)
      else if (local.batchId && this.batchOwners.has(local.batchId)) {
        // Known foreign scene: close it locally, without sending its data using
        // the newly signed-in user's authorization or exposing its snapshot.
        await batch?.cancel('interrupted').catch(() => undefined)
      } else if (local.batchId && local.serverBatchId !== undefined) {
        try {
          // A renderer reload loses the memory association. The existing read
          // endpoint verifies authorization + device before restoring the scene.
          const owned = serverBatchSchema.extend({ client_batch_id: z.string() }).parse(unwrapData(await getBusinessBatch(local.serverBatchId)))
          if (!valid()) return
          if (String(owned.id) !== String(local.serverBatchId) || owned.client_batch_id !== local.batchId) throw new Error('批次身份不匹配')
          this.batchOwners.set(local.batchId, owner)
          // Runner may finish while the ownership request is in flight. Read
          // the host again and never overwrite a newer event with an old read.
          const eventRevision = this.eventRevision
          const latest = businessBatchSnapshotSchema.parse(await batch?.getSnapshot())
          if (!valid()) return
          if (latest.batchId !== local.batchId || String(latest.serverBatchId) !== String(local.serverBatchId) || latest.recordKind !== 'live') return
          if (eventRevision === this.eventRevision || this.dependencies.getSnapshot().batchId !== latest.batchId) {
            this.handleEvent({ type: terminalBatchStatuses.has(latest.status) ? 'batch.finished' : 'batch.restored', snapshot: latest })
          }
        } catch {
          if (valid()) this.dependencies.setError('无法确认本地批次属于当前授权，未恢复其内容；请联网后重试')
        }
      }
    }
    if (!valid()) return
    // A missing local host after app restart cannot resume real work. Only
    // reconcile its saved receipts; the owning device may create a new batch.
    const scene = this.dependencies.getSnapshot()
    const ownedScene = scene.recordKind === 'live' && scene.batchId && this.batchOwners.get(scene.batchId) === owner
    if (!localSnapshot || parsedLocalSnapshot.data?.status === 'idle' || ownedScene) {
      this.outbox.recoverInterrupted(ownedScene ? scene.serverBatchId : undefined)
    }
    this.outbox.resume()
    if (this.initialized) return
    this.initialized = true
    this.startHeartbeat()
    window.addEventListener('online', this.handleReconnect)
    window.addEventListener('focus', this.handleReconnect)
    document.addEventListener('visibilitychange', this.handleVisibilityChange)
  }

  async start(
    tool: BusinessTool,
    preview: ImportPreview,
    clientBatchId: string,
    maxOpenSessions: number,
  ): Promise<BusinessBatchSnapshot> {
    if (!this.ownsCurrentSession()) throw new Error('请先使用有效授权初始化批量工作台')
    this.invalidateStartup()
    const startupSequence = this.startupSequence
    this.startupBatchId = clientBatchId
    const lifecycle = this.lifecycle
    const owner = this.ownerScope!
    const outbox = this.outbox
    const valid = () => this.ownsCurrentSession() && this.ownerScope === owner && lifecycle === this.lifecycle && startupSequence === this.startupSequence
    let serverBatchId: string | number | undefined
    try {
      const serverBatch = serverBatchSchema.parse(unwrapData(await createBusinessBatch({
        client_batch_id: clientBatchId,
        tool_id: String(tool.id),
        tool_name: tool.name,
        total_count: preview.validCount,
      })))
      serverBatchId = serverBatch.id
      if (!valid()) throw new Error('批次启动已取消或授权已变更')
      this.batchOwners.set(clientBatchId, owner)
      const localSnapshot = businessBatchSnapshotSchema.parse(await requireBatchApi().create(ipcPayload({
        importId: preview.importId,
        batchId: clientBatchId,
        serverBatchId: serverBatch.id,
        tool,
        maxOpenSessions,
        recordKind: 'live',
      })))
      if (!valid()) throw new Error('批次启动已取消或授权已变更')
      this.dependencies.setSnapshot(localSnapshot)
      return localSnapshot
    } catch (cause) {
      this.abandonedStarts.add(clientBatchId)
      if (serverBatchId !== undefined) outbox?.retainCancellation(serverBatchId)
      throw cause
    } finally {
      if (startupSequence === this.startupSequence) this.startupBatchId = null
    }
  }

  async registerBrowser(itemId: string, webContentsId: number): Promise<void> {
    if (!this.ownsCurrentSession()) return
    const lifecycle = this.lifecycle
    await requireBatchApi().registerBrowser(itemId, webContentsId)
    if (!this.ownsCurrentSession() || lifecycle !== this.lifecycle) return
    await this.startProvisionedItem(itemId)
  }

  selectItem(itemId: string): void {
    if (!this.ownsCurrentSession()) return
    void window.electronAPI?.batch?.selectItem(itemId).catch(() => undefined)
  }

  async completeUserAction(itemId: string): Promise<void> {
    const lifecycle = this.lifecycle
    if (!this.ownsCurrentSession()) return
    const next = await requireBatchApi().completeUserAction(itemId)
    if (this.ownsCurrentSession() && lifecycle === this.lifecycle) this.dependencies.setSnapshot(next)
  }

  async restartItem(itemId: string): Promise<void> {
    const lifecycle = this.lifecycle
    if (!this.ownsCurrentSession()) return
    if (this.dependencies.getSnapshot().status !== 'running') throw new Error('批次已结束，请重新导入需要处理的账号并新建批次')
    const next = await requireBatchApi().restartItem(itemId)
    if (this.ownsCurrentSession() && lifecycle === this.lifecycle) this.dependencies.setSnapshot(next)
  }

  async cancel(status: 'completed' | 'cancelled' | 'interrupted' = 'cancelled'): Promise<void> {
    this.invalidateStartup()
    const startupSequence = this.startupSequence
    const lifecycle = this.lifecycle
    const outbox = this.outbox
    const serverBatchId = this.dependencies.getSnapshot().serverBatchId
    const next = await requireBatchApi().cancel(status)
    if (!this.ownsCurrentSession() || lifecycle !== this.lifecycle || startupSequence !== this.startupSequence) {
      if (serverBatchId !== undefined && status !== 'completed') outbox?.retainCancellation(serverBatchId)
      return
    }
    this.dependencies.setSnapshot(next)
    if (serverBatchId !== undefined) {
      this.syncFinalItems()
      this.outbox?.queueFinish({ batchId: serverBatchId, status })
      await this.flushWithin(1_500)
    }
  }

  async cancelLocal(status: string): Promise<void> {
    this.invalidateStartup()
    const lifecycle = this.lifecycle
    await window.electronAPI?.batch?.cancel(status)
    if (lifecycle === this.lifecycle) this.provisioning.clear()
  }

  flushWithin(timeoutMs: number): Promise<boolean> {
    return this.outbox?.flushWithin(timeoutMs) ?? Promise.resolve(true)
  }

  dispose(): void {
    this.invalidateStartup()
    this.disposed = true
    this.lifecycle += 1
    this.removeEventListener?.()
    this.removeEventListener = null
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.syncTimer) clearTimeout(this.syncTimer)
    this.outbox?.dispose()
    this.heartbeatTimer = null
    this.syncTimer = null
    this.initialized = false
    window.removeEventListener('online', this.handleReconnect)
    window.removeEventListener('focus', this.handleReconnect)
    document.removeEventListener('visibilitychange', this.handleVisibilityChange)
  }

  private readonly handleReconnect = (): void => {
    if (this.ownsCurrentSession()) this.outbox?.reconnect()
  }

  private readonly handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') this.handleReconnect()
  }

  private handleEvent(input: unknown): void {
    if (!this.ownsCurrentSession()) return
    const parsed = batchEventSchema.safeParse(input)
    if (!parsed.success) return
    const event: BatchEvent = parsed.data
    if (event.snapshot?.recordKind === 'demo') return
    if (event.snapshot?.batchId && this.abandonedStarts.has(event.snapshot.batchId)) return
    if (event.snapshot?.batchId && this.batchOwners.get(event.snapshot.batchId) !== this.ownerScope) return
    const current = this.dependencies.getSnapshot()
    if (event.snapshot?.batchId === current.batchId && terminalBatchStatuses.has(current.status)) return
    this.eventRevision += 1
    if (event.snapshot) this.dependencies.setSnapshot(event.snapshot)
    if (event.type === 'batch.item_ready' && event.itemId) this.dependencies.selectItem(event.itemId)
    if (event.type === 'batch.item_updated' && event.itemId) this.syncItem(event.itemId)
    if (event.type === 'batch.finished') {
      const finalStatus = event.snapshot?.status === 'completed' ? 'completed'
        : event.snapshot?.status === 'interrupted' ? 'interrupted' : 'cancelled'
      const serverBatchId = event.snapshot?.serverBatchId
      if (serverBatchId !== undefined) {
        // Cancellation emits only batch.finished; persist its full final item
        // snapshot before sealing the batch, including never-started rows.
        this.syncFinalItems()
        this.outbox?.queueFinish({ batchId: serverBatchId, status: finalStatus })
        void this.outbox?.flush()
      }
    }
    this.scheduleSummarySync()
  }

  private async startProvisionedItem(itemId: string): Promise<void> {
    if (!this.ownsCurrentSession()) return
    const owner = this.ownerScope
    const lifecycle = this.lifecycle
    const valid = () => this.ownsCurrentSession() && this.ownerScope === owner && lifecycle === this.lifecycle
    const snapshot = this.dependencies.getSnapshot()
    if (this.provisioning.has(itemId) || snapshot.provisioningItemId !== itemId) return
    this.provisioning.add(itemId)
    try {
      const tool = snapshot.tool || this.dependencies.getSelectedTool()
      if (!tool) throw new Error('当前批次缺少工具配置')
      const platformKey = tool.platform_key || tool.platformKey || 'amazon'
      const envelope = launchGrantEnvelopeSchema.parse(await createToolLaunchGrant(tool.id, {
        platformKey,
        deviceId: window.electronAPI?.runtime?.deviceId || localStorage.getItem('toolbox_device_id') || '',
        executionMode: 'batch',
        clientBatchId: snapshot.batchId,
        clientItemId: itemId,
        idempotencyKey: `${snapshot.batchId}:${itemId}:${snapshot.items.find(item => item.itemId === itemId)?.attemptId || 'initial'}`,
      }))
      if (!valid()) return
      const grant = envelope.launch_data || envelope.grant || (envelope.token ? launchGrantSchema.parse(envelope) : null)
      if (!grant) throw new Error('批量启动授权不完整')
      await requireBatchApi().start(ipcPayload({
        itemId,
        tool: {
          ...tool,
          platformKey: grant.platform_key || platformKey,
          targetUrl: grant.target_url || tool.target_url || tool.targetUrl,
          executionMode: 'live',
          launchGrant: {
            token: grant.token,
            expiresAt: grant.expires_at || envelope.expires_at,
            expiresIn: envelope.expires_in,
            scriptKey: grant.script_key,
            runnerApiVersion: grant.runner_api_version || 1,
            toolVersion: grant.tool_version || '1.0.0',
            toolManifest: grant.tool_manifest,
            toolSignature: grant.tool_signature,
            signingKeyId: grant.signing_key_id,
            signatureRequired: Boolean(grant.signature_required),
          },
        },
      }))
    } catch (cause) {
      if (!valid()) return
      const message = errorMessage(cause, '无法启动该账号')
      this.dependencies.setError(message)
      const failed = await requireBatchApi().failItem({ itemId, message }).catch(() => null)
      if (failed && valid()) this.dependencies.setSnapshot(failed)
      throw cause
    } finally {
      if (valid()) this.provisioning.delete(itemId)
    }
  }

  private syncItem(itemId: string): void {
    const snapshot = this.dependencies.getSnapshot()
    const batchId = snapshot.serverBatchId
    const item = snapshot.items.find(candidate => candidate.itemId === itemId)
    if (batchId === undefined || !item) return
    const status = serverBatchItemStatusSchema.safeParse(item.status)
    if (!status.success) return
    const intervention = serverInterventionTypeSchema.safeParse(item.interventionType)
    this.outbox?.queueItem({
      batchId,
      itemId,
      payload: {
        account_label_masked: item.accountLabelMasked || '未命名账号',
        status: status.data,
        intervention_type: intervention.success ? intervention.data : item.interventionType ? 'other' : undefined,
        customer_message: item.message || undefined,
      },
    })
  }

  private scheduleSummarySync(): void {
    if (this.syncTimer) clearTimeout(this.syncTimer)
    this.syncTimer = null
    if (!this.ownsCurrentSession() || this.dependencies.getSnapshot().status !== 'running') return
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null
      this.syncSummary()
    }, 250)
  }

  private syncFinalItems(): void {
    for (const item of this.dependencies.getSnapshot().items) this.syncItem(item.itemId)
  }

  private syncSummary(): void {
    const snapshot = this.dependencies.getSnapshot()
    const batchId = snapshot.serverBatchId
    if (!this.ownsCurrentSession() || snapshot.recordKind === 'demo' || batchId === undefined || snapshot.status !== 'running') return
    const counts = snapshot.counts
    this.outbox?.queueBatch({
      batchId,
      payload: {
        status: 'running',
        pending_count: counts.pending || 0,
        running_count: counts.running || 0,
        waiting_count: counts.waiting || 0,
        completed_count: counts.completed || 0,
        failed_count: counts.failed || 0,
      },
    })
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return
    this.heartbeatTimer = setInterval(() => {
      if (this.dependencies.getSnapshot().status === 'running') this.syncSummary()
    }, 30_000)
  }

  private ownsCurrentSession(): boolean {
    return !this.disposed && this.ownerScope !== null && this.dependencies.getOwnerScope() === this.ownerScope
  }

  private invalidateStartup(): void {
    this.startupSequence += 1
    if (this.startupBatchId) this.abandonedStarts.add(this.startupBatchId)
    this.startupBatchId = null
  }
}
