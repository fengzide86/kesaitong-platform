import type { AutomationTool } from '../../automation/events.js'
import type {
  BatchEvent,
  BusinessBatchSnapshot,
  ImportPreview,
} from '../../features/business/model.js'
import type {
  FreightQuoteResult,
} from '../freight/types.js'
import type {
  ParsedFreightWorkbook,
} from '../freight/workbook-parser.js'
import type {
  BatchCreateRequest,
  BatchFailItemRequest,
  BatchImportError,
  BatchImportOptions,
  BatchRemapImportRequest,
  BatchStartRequest,
  BatchStoreDemoImportRequest,
  FreightQuoteIpcPayload,
  FreightWorkbookIpcOptions,
  NotificationFocusPayload,
} from './desktop-contract.js'
import type { RunnerEvent, RunnerPreflightResult } from './automation-contract.js'
import type { UpdateDeferPhase, UpdateSnapshot } from './update-contract.js'
import type { LocalArtifactReadRequest, LocalArtifactReadResult } from './artifact-contract.js'

export interface LocalArtifactBridge {
  read(request: LocalArtifactReadRequest): Promise<LocalArtifactReadResult>
  clear(): Promise<void>
}

export interface UpdateBridge {
  getState(): Promise<UpdateSnapshot>
  check(): Promise<UpdateSnapshot>
  startDownload(): Promise<UpdateSnapshot>
  cancelDownload(): Promise<UpdateSnapshot>
  install(): Promise<UpdateSnapshot>
  defer(request?: { phase: UpdateDeferPhase }): Promise<UpdateSnapshot>
  onState(callback: (state: UpdateSnapshot) => void): () => void
}

export interface DemoActivityBridge {
  setActive(token: string, active: boolean): Promise<void>
}

export interface AutomationStartResult {
  runId: string
}

export type AutomationPreflightResult = RunnerPreflightResult

export interface AutomationStatusResult {
  status: string
}

export interface BrowserRegistrationResult {
  id: number
  url: string
}

export interface BrowserReleaseResult {
  released: boolean
}

export interface BatchSelectionResult {
  itemId: string
  snapshot: BusinessBatchSnapshot
}

export interface SavedFileResult {
  filePath: string
}

export interface ExportedImportErrorsResult extends SavedFileResult {
  count: number
}

export interface BatchBridge {
  storeDemoImport(payload: BatchStoreDemoImportRequest): Promise<ImportPreview>
  loadSampleImport(options: BatchImportOptions): Promise<ImportPreview>
  saveSampleTemplate(): Promise<SavedFileResult | null>
  remapImportItems(payload: BatchRemapImportRequest): Promise<ImportPreview>
  selectImportFile(options: BatchImportOptions): Promise<ImportPreview | null>
  parseImportFile(options: BatchImportOptions): Promise<ImportPreview>
  exportImportErrors(errors: BatchImportError[]): Promise<ExportedImportErrorsResult | null>
  create(payload: BatchCreateRequest): Promise<BusinessBatchSnapshot>
  start(payload: BatchStartRequest): Promise<AutomationStartResult>
  failItem(payload: BatchFailItemRequest): Promise<BusinessBatchSnapshot>
  selectItem(itemId: string): Promise<BatchSelectionResult>
  completeUserAction(itemId: string): Promise<BusinessBatchSnapshot>
  restartItem(itemId: string): Promise<BusinessBatchSnapshot>
  cancel(status?: string): Promise<BusinessBatchSnapshot>
  getSnapshot(): Promise<BusinessBatchSnapshot | null>
  registerBrowser(itemId: string, webContentsId: number): Promise<BrowserRegistrationResult>
  unregisterBrowser(itemId: string): Promise<BrowserReleaseResult>
  onEvent(callback: (event: BatchEvent) => void): () => void
}

export interface AutomationBridge {
  start(tool: AutomationTool): Promise<AutomationStartResult>
  preflight(tool: AutomationTool): Promise<AutomationPreflightResult>
  pause(): Promise<AutomationStatusResult>
  resume(): Promise<AutomationStatusResult>
  completeUserAction(): Promise<AutomationStatusResult>
  cancel(): Promise<AutomationStatusResult>
  registerBrowser(webContentsId: number): Promise<BrowserRegistrationResult>
  unregisterBrowser(): Promise<BrowserReleaseResult>
  onEvent(callback: (event: RunnerEvent) => void): () => void
}

export interface CredentialStoreBridge {
  saveUserCode(code: string): Promise<boolean>
  loadUserCode(): Promise<string | null>
  clearUserCode(): Promise<boolean>
}

export interface FreightBridge {
  getDefaultPack(): Promise<ParsedFreightWorkbook>
  parseWorkbook(options: FreightWorkbookIpcOptions): Promise<ParsedFreightWorkbook | null>
  reparseWorkbook(options: FreightWorkbookIpcOptions): Promise<ParsedFreightWorkbook>
  quote(payload: FreightQuoteIpcPayload): Promise<FreightQuoteResult>
}

export interface NotificationBridge {
  onFocus(callback: (payload: NotificationFocusPayload) => void): () => void
}

export interface OpenExternalResult {
  success: boolean
  message?: string
}

export interface ToolboxElectronApi {
  runtime?: { controlApiBase?: string; deviceId?: string; deviceName?: string }
  updates?: UpdateBridge
  demoActivity?: DemoActivityBridge
  batch?: BatchBridge
  automation?: AutomationBridge
  artifacts?: LocalArtifactBridge
  credentialStore?: CredentialStoreBridge
  notifications?: NotificationBridge
  freight?: FreightBridge
  launchTool?(data: Record<string, unknown>): void
  onLaunchToolError?(callback: (payload: { message: string }) => void): () => void
  onLaunchToolSuccess?(callback: (payload: { toolName: string; platformKey?: string }) => void): () => void
  openExternal?(url: string): Promise<OpenExternalResult>
}
