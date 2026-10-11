import {
  app,
  dialog,
  webContents,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type SaveDialogOptions,
} from 'electron'
import { copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { RecoveryStore } from './recovery-store.cjs'
import type { ExecutionLease } from './execution-lease.cjs'
import type { ExecutionReportOutbox } from './execution-report-outbox.cjs'
import type { RecoveryPrepare } from '../../src/shared/ipc/recovery-contract.js'

import {
  parseDesktopIpcEvent,
  type NotificationFocusPayload,
} from '../../src/shared/ipc/desktop-contract.js'
import type { TrustedHandleRegistrar } from '../ipc/trusted-ipc.cjs'

type UnknownRecord = Record<string, unknown>

interface CoordinatorLike {
  assertOwner(owner: string): void
  prepareRecovery(owner: string, request: RecoveryPrepare): unknown
  storeImport(parsed: unknown, owner?: string | null): unknown
  remapImportItems(importId: string, itemIds: string[], owner?: string | null): unknown
  create(payload: UnknownRecord): unknown
  startItem(itemId: string, tool: UnknownRecord): Promise<unknown>
  failProvision(itemId: string, message?: string): unknown
  completeUserAction(itemId: string): Promise<unknown>
  restartItem(itemId: string): Promise<unknown>
  cancel(status?: string): Promise<unknown>
  snapshot(): UnknownRecord
  registerBrowser(itemId: string, guest: Electron.WebContents): unknown
  unregisterBrowser(itemId: string): unknown
}

interface EmbeddedBrowserHostManagerLike {
  releaseAll(): unknown
}

const { BatchCoordinator } = require('./batch-coordinator.cjs') as {
  BatchCoordinator: new (options: UnknownRecord) => CoordinatorLike
}
const { parseBatchFile, writeBatchErrors } = require('./batch-importer.cjs') as {
  parseBatchFile: (filePath: string, options: UnknownRecord) => Promise<unknown>
  writeBatchErrors: (filePath: string, errors: unknown[]) => Promise<unknown>
}
const { EmbeddedBrowserHostManager } = require('./embedded-browser-host-manager.cjs') as {
  EmbeddedBrowserHostManager: new () => EmbeddedBrowserHostManagerLike
}

interface ActionNotification {
  title: string
  body: string
  focus: NotificationFocusPayload
}

interface DesktopBatchControllerOptions {
  executionLease?: ExecutionLease
  reportOutbox?: ExecutionReportOutbox
  recoveryStore: RecoveryStore
  resolveOwner: (sender: Electron.WebContents) => Promise<string>
  validateUpload?: (sender: Electron.WebContents, filePath: unknown) => Promise<unknown>
  getWindow: () => BrowserWindow | null | undefined
  runnerEnvironment: () => NodeJS.ProcessEnv
  registerAutomationHandle: TrustedHandleRegistrar
  onActivityChanged: () => void
  showNotification: (notification: ActionNotification) => void
}

function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null ? value as UnknownRecord : {}
}

function assertInternalDemo(): void {
  if (app.isPackaged || process.env.TOOLBOX_INTERNAL_DEMO !== '1') throw new Error('LEGACY_DEMO_DISABLED: 客户批量入口不再提供旧演示或模拟回退')
}

/** Owns batch import, coordinator, per-item browser hosts and batch IPC. */
export class DesktopBatchController {
  private readonly options: DesktopBatchControllerOptions
  private readonly browserHosts = new EmbeddedBrowserHostManager()
  private coordinator: CoordinatorLike | null = null
  private selectedImportPath: string | null = null
  private selectedImportOwner: string | null = null
  private selectedItem: string | null = null
  private sessionRevocation: Promise<void> | null = null
  private coordinatorEpoch = 0
  private closing = false

  constructor(options: DesktopBatchControllerOptions) {
    this.options = options
  }

  registerIpc(): void {
    const register = this.options.registerAutomationHandle
    register('batch:store-demo-import', (_event: IpcMainInvokeEvent, rawPayload: unknown) => {
      assertInternalDemo()
      const payload = asRecord(rawPayload)
      const rawRows = Array.isArray(payload.rows) ? payload.rows.slice(0, 100) : []
      if (!rawRows.length) throw new Error('本地演示项为空')
      const importId = typeof payload.importId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(payload.importId)
        ? payload.importId
        : `demo_import_${Date.now()}`
      return this.getCoordinator().storeImport({
        importId,
        fileName: '本地交互演示数据',
        rows: rawRows.map((value, index) => {
          const row = asRecord(value)
          const itemId = typeof row.itemId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(row.itemId)
            ? row.itemId
            : `demo_item_${index + 1}`
          const accountLabel = typeof row.accountLabel === 'string'
            ? row.accountLabel.slice(0, 80)
            : `演示项 ${index + 1}`
          return {
            itemId,
            input: asRecord(row.input),
            preview: { account_label: accountLabel },
            accountLabelMasked: accountLabel,
          }
        }),
        errors: [],
      })
    })

    register('batch:select-import-file', async (event: IpcMainInvokeEvent, rawOptions: unknown) => {
      await this.sessionRevocation
      const owner = await this.options.resolveOwner(event.sender)
      const dialogOptions: Electron.OpenDialogOptions = {
        title: '选择批量数据文件',
        properties: ['openFile'],
        filters: [{ name: '批量数据', extensions: ['xlsx', 'csv'] }],
      }
      const window = this.options.getWindow()
      const result = window
        ? await dialog.showOpenDialog(window, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)
      if (result.canceled || !result.filePaths[0]) return null
      const selectedPath = result.filePaths[0]
      const parsed = await parseBatchFile(selectedPath, asRecord(rawOptions))
      if (await this.options.resolveOwner(event.sender) !== owner) throw new Error('RECOVERY_OWNER_MISMATCH: 授权已经变化，请重新选择文件。')
      this.selectedImportPath = selectedPath
      this.selectedImportOwner = owner
      return this.getCoordinator().storeImport(parsed, owner)
    })
    register('batch:parse-import-file', async (event: IpcMainInvokeEvent, rawOptions: unknown) => {
      await this.sessionRevocation
      if (!this.selectedImportPath) throw new Error('请先选择批量数据文件')
      const owner = await this.options.resolveOwner(event.sender)
      if (this.selectedImportOwner !== owner) throw new Error('RECOVERY_OWNER_MISMATCH: 原文件不属于当前授权，请重新选择。')
      const parsed = await parseBatchFile(this.selectedImportPath, asRecord(rawOptions))
      if (await this.options.resolveOwner(event.sender) !== owner) throw new Error('RECOVERY_OWNER_MISMATCH: 授权已经变化，请重新选择文件。')
      return this.getCoordinator().storeImport(parsed, owner)
    })
    register('batch:load-sample-import', async (event: IpcMainInvokeEvent, rawOptions: unknown) => {
      await this.sessionRevocation
      const owner = await this.options.resolveOwner(event.sender)
      const templatePath = this.sampleTemplatePath()
      if (!existsSync(templatePath)) throw new Error('内置测试 Excel 不存在，请更新桌面客户端')
      const parsed = await parseBatchFile(templatePath, asRecord(rawOptions))
      if (await this.options.resolveOwner(event.sender) !== owner) throw new Error('RECOVERY_OWNER_MISMATCH: 授权已经变化，请重新选择文件。')
      return this.getCoordinator().storeImport(parsed, owner)
    })
    register('batch:save-sample-template', async () => {
      const templatePath = this.sampleTemplatePath()
      if (!existsSync(templatePath)) throw new Error('内置测试 Excel 不存在，请更新桌面客户端')
      const options: SaveDialogOptions = {
        title: '保存 B 端测试 Excel',
        defaultPath: 'B端批量自动化测试数据.xlsx',
        filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
      }
      const window = this.options.getWindow()
      const result = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return null
      copyFileSync(templatePath, result.filePath)
      return { filePath: result.filePath }
    })
    register('batch:remap-import-items', async (event: IpcMainInvokeEvent, rawPayload: unknown) => {
      await this.sessionRevocation
      const owner = await this.options.resolveOwner(event.sender)
      const payload = asRecord(rawPayload)
      const itemIds = Array.isArray(payload.itemIds)
        ? payload.itemIds.map(value => String(value || '')).filter(Boolean)
        : []
      return this.getCoordinator().remapImportItems(String(payload.importId || ''), itemIds, owner)
    })
    register('batch:export-import-errors', async (_event: IpcMainInvokeEvent, rawErrors: unknown) => {
      const errors = Array.isArray(rawErrors) ? rawErrors : []
      const options: SaveDialogOptions = {
        title: '导出导入问题',
        defaultPath: '批量导入问题.csv',
        filters: [{ name: 'CSV 文件', extensions: ['csv'] }],
      }
      const window = this.options.getWindow()
      const result = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return null
      return writeBatchErrors(result.filePath, errors)
    })
    register('batch:create', async (event: IpcMainInvokeEvent, payload: unknown) => {
      await this.sessionRevocation
      const epoch = this.coordinatorEpoch
      const data = asRecord(payload)
      if (data.recordKind !== 'live') assertInternalDemo()
      const owner = data.recordKind === 'demo' ? null : await this.options.resolveOwner(event.sender)
      this.assertEpoch(epoch)
      return this.getCoordinator().create({ ...data, owner })
    })
    register('batch:start', async (event: IpcMainInvokeEvent, payload: unknown) => {
      await this.sessionRevocation
      const epoch = this.coordinatorEpoch
      const data = asRecord(payload)
      if (asRecord(data.tool).executionMode !== 'live') assertInternalDemo()
      const coordinator = this.getCoordinator()
      coordinator.assertOwner(await this.options.resolveOwner(event.sender))
      this.assertEpoch(epoch)
      return coordinator.startItem(String(data.itemId || ''), asRecord(data.tool))
    })
    register('batch:fail-item', async (event: IpcMainInvokeEvent, payload: unknown) => {
      await this.authorizeBatch(event)
      const data = asRecord(payload)
      return this.getCoordinator().failProvision(
        String(data.itemId || ''),
        typeof data.message === 'string' ? data.message : undefined,
      )
    })
    register('batch:complete-user-action', async (event: IpcMainInvokeEvent, itemId: unknown) => {
      await this.authorizeBatch(event)
      return this.getCoordinator().completeUserAction(String(itemId || ''))
    })
    register('batch:restart-item', async (event: IpcMainInvokeEvent, itemId: unknown) => {
      await this.authorizeBatch(event)
      return this.getCoordinator().restartItem(String(itemId || ''))
    })
    register('batch:cancel', async (event: IpcMainInvokeEvent, status: unknown) => {
      await this.authorizeBatch(event)
      this.selectedItem = null
      return this.getCoordinator().cancel(typeof status === 'string' ? status : 'cancelled')
    })
    register('batch:get-snapshot', async (event: IpcMainInvokeEvent) => {
      await this.sessionRevocation
      if (this.getCoordinator().snapshot().status !== 'idle') await this.authorizeBatch(event)
      return this.getCoordinator().snapshot()
    })
    register('batch:select-item', async (event: IpcMainInvokeEvent, rawItemId: unknown) => {
      await this.authorizeBatch(event)
      const itemId = String(rawItemId || '')
      this.selectedItem = itemId
      return { itemId, snapshot: this.getCoordinator().snapshot() }
    })
    register(
      'batch:register-browser',
      async (event: IpcMainInvokeEvent, rawItemId: unknown, webContentsId: unknown) => {
        await this.authorizeBatch(event)
        const itemId = String(rawItemId || '')
        const guest = webContents.fromId(Number(webContentsId))
        if (!guest || guest.getType?.() !== 'webview') throw new Error('无法注册批量工作区浏览器')
        if (guest.hostWebContents && guest.hostWebContents.id !== event.sender.id) {
          throw new Error('批量浏览器归属校验失败')
        }
        return this.getCoordinator().registerBrowser(itemId, guest)
      },
    )
    register('batch:unregister-browser', async (event: IpcMainInvokeEvent, itemId: unknown) => {
      await this.authorizeBatch(event)
      return this.getCoordinator().unregisterBrowser(String(itemId || ''))
    })
  }

  selectedItemId(): string | null {
    return this.selectedItem
  }

  prepareRecovery(owner: string, request: RecoveryPrepare): unknown {
    return this.getCoordinator().prepareRecovery(owner, request)
  }

  isActive(): boolean {
    return this.coordinator?.snapshot()?.status === 'running'
  }

  async cancelActiveForWindowClose(): Promise<void> {
    await this.coordinator?.cancel('interrupted').catch(() => undefined)
  }

  async cleanup(): Promise<void> {
    this.closing = true
    this.coordinatorEpoch += 1
    this.selectedItem = null
    this.selectedImportPath = null
    this.selectedImportOwner = null
    this.browserHosts.releaseAll()
    if (!this.coordinator) return
    await this.coordinator.cancel('interrupted')
    this.coordinator = null
  }

  async revokeSession(): Promise<void> {
    if (this.sessionRevocation) return this.sessionRevocation
    this.coordinatorEpoch += 1
    this.selectedItem = null
    this.selectedImportPath = null
    this.selectedImportOwner = null
    const previous = this.coordinator
    this.sessionRevocation = (async () => {
      if (previous) await previous.cancel('interrupted')
      this.browserHosts.releaseAll()
      this.coordinator = null
    })()
    try { await this.sessionRevocation } finally { this.sessionRevocation = null }
  }

  private async authorizeBatch(event: IpcMainInvokeEvent): Promise<void> {
    await this.sessionRevocation
    const epoch = this.coordinatorEpoch
    if (this.getCoordinator().snapshot().recordKind === 'demo' && !app.isPackaged && process.env.TOOLBOX_INTERNAL_DEMO === '1') return
    this.getCoordinator().assertOwner(await this.options.resolveOwner(event.sender))
    this.assertEpoch(epoch)
  }

  private assertEpoch(epoch: number): void {
    if (this.closing || epoch !== this.coordinatorEpoch) throw new Error('SESSION_REVOKED: 原批次准备已失效，请重新打开工具。')
  }

  private getCoordinator(): CoordinatorLike {
    this.assertEpoch(this.coordinatorEpoch)
    if (this.coordinator) return this.coordinator
    const epoch = this.coordinatorEpoch
    this.coordinator = new BatchCoordinator({
      scriptPath: join(__dirname, '..', 'automation-runner.cjs'),
      env: { ...this.options.runnerEnvironment(), TOOLBOX_PERSIST_REPORTS: '1' },
      executionLease: this.options.executionLease,
      reportOutbox: this.options.reportOutbox,
      recoveryStore: this.options.recoveryStore,
      authorizeMutation: async () => {
        if (epoch !== this.coordinatorEpoch) throw new Error('SESSION_REVOKED: 原批次现场已经退出。')
        const sender = this.options.getWindow()?.webContents
        if (!sender) throw new Error('窗口已经关闭，已禁止继续提交。')
        const owner = await this.options.resolveOwner(sender)
        if (epoch !== this.coordinatorEpoch) throw new Error('SESSION_REVOKED: 原批次现场已经退出。')
        return owner
      },
      validateUpload: async (payload: UnknownRecord) => {
        if (epoch !== this.coordinatorEpoch) throw new Error('SESSION_REVOKED: 原批次现场已经退出。')
        const sender = this.options.getWindow()?.webContents
        if (!sender || !this.options.validateUpload) throw new Error('LOCAL_FILE_UNAVAILABLE: 本机上传服务不可用')
        this.getCoordinator().assertOwner(await this.options.resolveOwner(sender))
        const result = await this.options.validateUpload(sender, payload.filePath)
        if (epoch !== this.coordinatorEpoch) throw new Error('SESSION_REVOKED: 原批次现场已经退出。')
        return result
      },
      hostManager: this.browserHosts,
      onEvent: (event: UnknownRecord) => {
        if (this.sessionRevocation || epoch !== this.coordinatorEpoch) return
        this.options.onActivityChanged()
        const parsedEvent = parseDesktopIpcEvent('batch:event', event)
        const window = this.options.getWindow()
        if (window && !window.isDestroyed()) window.webContents.send('batch:event', parsedEvent)
      },
      onNotify: ({ itemId, accountLabelMasked, type }: {
        itemId: string
        accountLabelMasked: string
        type: string
      }) => { if (epoch !== this.coordinatorEpoch) return; this.options.showNotification({
        title: `${accountLabelMasked || '一个客户账号'}需要操作`,
        body: ({ login: '请完成账号登录', captcha: '请完成页面验证码', two_factor: '请完成二次验证' } as Record<string, string>)[type]
          || '请完成页面提示的操作',
        focus: { mode: 'batch', itemId },
      }) },
    }) as CoordinatorLike
    return this.coordinator
  }

  private sampleTemplatePath(): string {
    return app.isPackaged
      ? join(process.resourcesPath, 'templates', 'B端批量自动化测试数据.xlsx')
      : join(app.getAppPath(), 'resources', 'templates', 'B端批量自动化测试数据.xlsx')
  }
}
