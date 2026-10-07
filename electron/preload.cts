import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

import type { AutomationTool } from '../src/automation/events.js'
import type {
  BatchEvent,
  BusinessBatchSnapshot,
  ImportPreview,
} from '../src/features/business/model.js'
import type {
  AutomationStartResult,
  AutomationPreflightResult,
  AutomationStatusResult,
  BrowserRegistrationResult,
  BrowserReleaseResult,
  BatchSelectionResult,
  ExportedImportErrorsResult,
  OpenExternalResult,
  SavedFileResult,
} from '../src/shared/ipc/electron-api.js'
import {
  parseDesktopIpcArgs,
  parseDesktopIpcEvent,
  parseSerializableIpcError,
  type BatchCreateRequest,
  type BatchFailItemRequest,
  type BatchImportError,
  type BatchImportOptions,
  type BatchRemapImportRequest,
  type BatchStartRequest,
  type BatchStoreDemoImportRequest,
  type DesktopIpcEvent,
  type DesktopIpcEventChannel,
  type DesktopIpcInvocationChannel,
  type FreightQuoteIpcPayload,
  type FreightWorkbookIpcOptions,
  type NotificationFocusPayload,
} from '../src/shared/ipc/desktop-contract.js'
import type { FreightQuoteResult } from '../src/shared/freight/types.js'
import type { ParsedFreightWorkbook } from '../src/shared/freight/workbook-parser.js'
import type { RunnerEvent } from '../src/shared/ipc/automation-contract.js'
import type { UpdateDeferPhase, UpdateSnapshot } from '../src/shared/ipc/update-contract.js'
import {
  localArtifactReadResultSchema,
  type LocalArtifactReadRequest,
  type LocalArtifactReadResult,
} from '../src/shared/ipc/artifact-contract.js'

type Unsubscribe = () => void
type UnknownCallback = (data: unknown) => void

function readRuntimeArgument(name: string): string {
  const prefix = `--${name}=`
  const argument = process.argv.find(value => value.startsWith(prefix))
  return argument ? argument.slice(prefix.length) : ''
}

function subscribe(channel: string, callback: UnknownCallback): Unsubscribe {
  const listener = (_event: IpcRendererEvent, data: unknown): void => callback(data)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

function subscribeDesktopEvent<Channel extends DesktopIpcEventChannel>(
  channel: Channel,
  callback: (data: DesktopIpcEvent<Channel>) => void,
): Unsubscribe {
  const listener = (_event: IpcRendererEvent, data: unknown): void => {
    try {
      callback(parseDesktopIpcEvent(channel, data))
    } catch (error) {
      console.warn(`[IPC] Rejected invalid ${channel} event:`, error instanceof Error ? error.message : error)
    }
  }
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

function invokeDesktop<Result>(channel: DesktopIpcInvocationChannel, ...args: unknown[]): Promise<Result> {
  const parsedArgs = parseDesktopIpcArgs(channel, args) as readonly unknown[]
  return (ipcRenderer.invoke(channel, ...parsedArgs) as Promise<Result>).catch((error: unknown) => {
    const detail = parseSerializableIpcError(error)
    if (!detail) throw error
    throw Object.assign(new Error(detail.message), {
      name: 'DesktopIpcContractError',
      code: detail.code,
      detail,
    })
  })
}

const controlApiBase = readRuntimeArgument('toolbox-control-api-base').replace(/\/$/, '')
const deviceId = readRuntimeArgument('toolbox-device-id')
const deviceName = decodeURIComponent(readRuntimeArgument('toolbox-device-name'))
const automationEnabled = readRuntimeArgument('toolbox-automation-enabled') === 'true'

// Expired/cleared authentication must also revoke this window's local evidence.
if (automationEnabled) {
  window.addEventListener('toolbox:auth-cleared', () => {
    void invokeDesktop('artifacts:clear').catch(() => undefined)
  })
}

contextBridge.exposeInMainWorld('electronAPI', {
  runtime: { controlApiBase, deviceId, deviceName },
  updates: {
    getState: (): Promise<UpdateSnapshot> => ipcRenderer.invoke('updates:get-state'),
    check: (): Promise<UpdateSnapshot> => ipcRenderer.invoke('updates:check'),
    startDownload: (): Promise<UpdateSnapshot> => ipcRenderer.invoke('updates:start-download'),
    cancelDownload: (): Promise<UpdateSnapshot> => ipcRenderer.invoke('updates:cancel-download'),
    install: (): Promise<UpdateSnapshot> => ipcRenderer.invoke('updates:install'),
    defer: (request?: { phase: UpdateDeferPhase }): Promise<UpdateSnapshot> => ipcRenderer.invoke('updates:defer', request),
    onState: (callback: (snapshot: UpdateSnapshot) => void): Unsubscribe => subscribe('updates:state', data => callback(data as UpdateSnapshot)),
  },
  demoActivity: {
    setActive: (token: string, active: boolean): Promise<void> => invokeDesktop('demo-activity:set-active', token, active),
  },
  credentialStore: {
    saveUserCode: (code: string): Promise<boolean> => invokeDesktop('credential-save-user-code', code),
    loadUserCode: (): Promise<string | null> => invokeDesktop('credential-load-user-code'),
    clearUserCode: (): Promise<boolean> => invokeDesktop('credential-clear-user-code'),
  },
  ...(automationEnabled ? { artifacts: {
    read: async (request: LocalArtifactReadRequest): Promise<LocalArtifactReadResult> =>
      localArtifactReadResultSchema.parse(await invokeDesktop('artifacts:read', request)),
    clear: (): Promise<void> => invokeDesktop('artifacts:clear'),
  }, automation: {
    start: (tool: AutomationTool): Promise<AutomationStartResult> => invokeDesktop('automation:start', tool),
    preflight: (tool: AutomationTool): Promise<AutomationPreflightResult> => invokeDesktop('automation:preflight', tool),
    pause: (): Promise<AutomationStatusResult> => invokeDesktop('automation:pause'),
    resume: (): Promise<AutomationStatusResult> => invokeDesktop('automation:resume'),
    completeUserAction: (): Promise<AutomationStatusResult> => invokeDesktop('automation:complete-user-action'),
    cancel: (): Promise<AutomationStatusResult> => invokeDesktop('automation:cancel'),
    registerBrowser: (webContentsId: number): Promise<BrowserRegistrationResult> => invokeDesktop('automation:register-browser', webContentsId),
    unregisterBrowser: (): Promise<BrowserReleaseResult> => invokeDesktop('automation:unregister-browser'),
    onEvent: (callback: (event: RunnerEvent) => void): Unsubscribe => subscribeDesktopEvent('automation:event', callback),
  }, batch: {
    storeDemoImport: (payload: BatchStoreDemoImportRequest): Promise<ImportPreview> => invokeDesktop('batch:store-demo-import', payload),
    loadSampleImport: (options: BatchImportOptions): Promise<ImportPreview> => invokeDesktop('batch:load-sample-import', options),
    saveSampleTemplate: (): Promise<SavedFileResult | null> => invokeDesktop('batch:save-sample-template'),
    remapImportItems: (payload: BatchRemapImportRequest): Promise<ImportPreview> => invokeDesktop('batch:remap-import-items', payload),
    selectImportFile: (options: BatchImportOptions): Promise<ImportPreview | null> => invokeDesktop('batch:select-import-file', options),
    parseImportFile: (options: BatchImportOptions): Promise<ImportPreview> => invokeDesktop('batch:parse-import-file', options),
    exportImportErrors: (errors: BatchImportError[]): Promise<ExportedImportErrorsResult | null> => invokeDesktop('batch:export-import-errors', errors),
    create: (payload: BatchCreateRequest): Promise<BusinessBatchSnapshot> => invokeDesktop('batch:create', payload),
    start: (payload: BatchStartRequest): Promise<AutomationStartResult> => invokeDesktop('batch:start', payload),
    failItem: (payload: BatchFailItemRequest): Promise<BusinessBatchSnapshot> => invokeDesktop('batch:fail-item', payload),
    selectItem: (itemId: string): Promise<BatchSelectionResult> => invokeDesktop('batch:select-item', itemId),
    completeUserAction: (itemId: string): Promise<BusinessBatchSnapshot> => invokeDesktop('batch:complete-user-action', itemId),
    restartItem: (itemId: string): Promise<BusinessBatchSnapshot> => invokeDesktop('batch:restart-item', itemId),
    cancel: (status?: string): Promise<BusinessBatchSnapshot> => invokeDesktop('batch:cancel', status),
    getSnapshot: (): Promise<BusinessBatchSnapshot | null> => invokeDesktop('batch:get-snapshot'),
    registerBrowser: (itemId: string, webContentsId: number): Promise<BrowserRegistrationResult> => invokeDesktop('batch:register-browser', itemId, webContentsId),
    unregisterBrowser: (itemId: string): Promise<BrowserReleaseResult> => invokeDesktop('batch:unregister-browser', itemId),
    onEvent: (callback: (event: BatchEvent) => void): Unsubscribe => subscribeDesktopEvent('batch:event', callback),
  },
  launchTool: (data: Record<string, unknown>): void => ipcRenderer.send('launch-tool', data),
  onLaunchToolError: (callback: (payload: { message: string }) => void): Unsubscribe => subscribe('launch-tool-error', data => callback(data as { message: string })),
  onLaunchToolSuccess: (callback: (payload: { toolName: string; platformKey?: string }) => void): Unsubscribe => subscribe('launch-tool-success', data => callback(data as { toolName: string; platformKey?: string })),
  } : {}),
  notifications: {
    onFocus: (callback: (payload: NotificationFocusPayload) => void): Unsubscribe => subscribeDesktopEvent('toolbox:notification-focus', callback),
  },
  ...(automationEnabled ? { freight: {
    getDefaultPack: (): Promise<ParsedFreightWorkbook> => invokeDesktop('freight:get-default-pack'),
    parseWorkbook: (options: FreightWorkbookIpcOptions): Promise<ParsedFreightWorkbook | null> => invokeDesktop('freight:parse-workbook', options),
    reparseWorkbook: (options: FreightWorkbookIpcOptions): Promise<ParsedFreightWorkbook> => invokeDesktop('freight:reparse-workbook', options),
    quote: (payload: FreightQuoteIpcPayload): Promise<FreightQuoteResult> => invokeDesktop('freight:quote', payload),
  } } : {}),
  openExternal: (url: string): Promise<OpenExternalResult> => invokeDesktop('open-external', url),
})
