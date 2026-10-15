import { app, dialog, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

import type { FreightQuoteRequest, FreightRatePack } from '../../src/shared/freight/types.js'
import type { TrustedHandleRegistrar } from '../ipc/trusted-ipc.cjs'
import { ToolkitRuntime } from '../automation/toolkit-runtime.cjs'
import { freightTool } from '../automation/toolkit-examples.cjs'
import type { ExecutionLease } from '../automation/execution-lease.cjs'

const { parseFreightWorkbook } = require('./rate-pack.cjs') as {
  parseFreightWorkbook: (filePath: string, options: UnknownRecord) => Promise<UnknownRecord>
}

type UnknownRecord = Record<string, unknown>

interface DesktopFreightControllerOptions {
  getWindow: () => BrowserWindow | null | undefined
  registerAutomationHandle: TrustedHandleRegistrar
  getExecutionLease: () => ExecutionLease
}

function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null ? value as UnknownRecord : {}
}

/** Owns the desktop-only freight workbook selection, cache and IPC surface. */
export class DesktopFreightController {
  private readonly getWindow: () => BrowserWindow | null | undefined
  private readonly registerAutomationHandle: TrustedHandleRegistrar
  private selectedWorkbookPath: string | null = null
  private defaultPackCache: { mtimeMs: number; parsed: UnknownRecord } | null = null
  private readonly getExecutionLease: () => ExecutionLease

  constructor(options: DesktopFreightControllerOptions) {
    this.getWindow = options.getWindow
    this.registerAutomationHandle = options.registerAutomationHandle
    this.getExecutionLease = options.getExecutionLease
  }

  defaultWorkbookPath(): string {
    return app.isPackaged
      ? join(process.resourcesPath, 'rates', 'FreightTemplate_v2.xlsx')
      : join(app.getAppPath(), 'resources', 'rates', 'FreightTemplate_v2.xlsx')
  }

  registerIpc(): void {
    this.registerAutomationHandle('freight:get-default-pack', () => this.loadDefaultPack())
    this.registerAutomationHandle(
      'freight:parse-workbook',
      async (_event: IpcMainInvokeEvent, rawOptions: unknown) => {
        const options = asRecord(rawOptions)
        const dialogOptions: Electron.OpenDialogOptions = {
          title: '选择物流费率工作簿',
          properties: ['openFile'],
          filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
        }
        const window = this.getWindow()
        const result = window
          ? await dialog.showOpenDialog(window, dialogOptions)
          : await dialog.showOpenDialog(dialogOptions)
        if (result.canceled || !result.filePaths[0]) return null
        this.selectedWorkbookPath = result.filePaths[0]
        return parseFreightWorkbook(this.selectedWorkbookPath, options)
      },
    )
    this.registerAutomationHandle(
      'freight:reparse-workbook',
      (_event: IpcMainInvokeEvent, rawOptions: unknown) => {
        if (!this.selectedWorkbookPath) throw new Error('请先选择物流费率工作簿')
        return parseFreightWorkbook(this.selectedWorkbookPath, asRecord(rawOptions))
      },
    )
    this.registerAutomationHandle(
      'freight:quote',
      async (event: IpcMainInvokeEvent, rawPayload: unknown) => {
        const payload = asRecord(rawPayload)
        const parsed = payload.pack ? { pack: payload.pack } : await this.loadDefaultPack()
        const pack = asRecord(parsed).pack as FreightRatePack
        const tool = freightTool(pack, async () => ({ schemaVersion: 1, principal: { kind: 'local', id: `window-${event.sender.id}` },
          siteOrigin: null, accountSlot: null, localAccountRef: null, projectRef: null, mode: 'local', policyRevision: `freight:${pack.version}` }))
        const runtime = new ToolkitRuntime(tool, {
          lease: this.getExecutionLease(),
          authorize: async (_context, descriptor) => {
            if (event.sender.isDestroyed() || event.sender !== this.getWindow()?.webContents || descriptor.effect !== 'calculation') throw new Error('本机计算上下文已失效')
          },
          saveIntent: async () => { throw new Error('本机运费计算不得写入外部平台') },
          // Pure calculator outputs are returned to the user, not recorded as
          // external task completion or customer execution income/usage.
          saveResult: async () => {},
        })
        const prepared = await runtime.prepare(asRecord(payload.request) as unknown as FreightQuoteRequest)
        const verified = await runtime.execute(prepared.operationId)
        if (verified.status !== 'verified') throw new Error('本机运费计算结果未通过复核')
        return verified.result
      },
    )
  }

  private async loadDefaultPack(): Promise<UnknownRecord> {
    const filePath = this.defaultWorkbookPath()
    if (!existsSync(filePath)) throw new Error('内置费率表不存在，请更新桌面客户端')
    const mtimeMs = statSync(filePath).mtimeMs
    if (this.defaultPackCache?.mtimeMs === mtimeMs) return this.defaultPackCache.parsed
    const parsed = await parseFreightWorkbook(filePath, {
      id: 'competition-freight',
      version: '1.0.0',
      exchangeRateCnyPerUsd: 7,
    }) as UnknownRecord
    this.defaultPackCache = { mtimeMs, parsed }
    return parsed
  }
}
