import {
  app,
  dialog,
  net,
  safeStorage,
  shell,
  webContents,
  type BrowserWindow,
  type IncomingMessage,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { RecoveryStore, recoveryOwnerHash } from './recovery-store.cjs'
import type { RecoveryQuery, RecoveryReview, RecoveryPrepare } from '../../src/shared/ipc/recovery-contract.js'

import {
  parseDesktopIpcEvent,
  type NotificationFocusPayload,
} from '../../src/shared/ipc/desktop-contract.js'
import * as toolSigningConfig from '../tool-signing-config.cjs'
import type {
  TrustedEventRegistrar,
  TrustedHandleRegistrar,
} from '../ipc/trusted-ipc.cjs'
import { DesktopBatchController } from './desktop-batch-controller.cjs'
import { RunnerClient } from './runner-client.cjs'
import { ExecutionReportOutbox } from './execution-report-outbox.cjs'
import { LocalArtifactService } from './local-artifact-service.cjs'
import { FileInputController, type LocalFileSnapshot } from './file-input-controller.cjs'
import { ExecutionLease, type ExecutionPermit } from './execution-lease.cjs'
import { WorkspaceBrowserSessions } from './workspace-browser-sessions.cjs'
import { ScenarioPolicyClient } from './scenario-policy-client.cjs'
import { LocalScenesController } from './local-scenes-controller.cjs'
import { TargetExecutionController } from './targets/target-controller.cjs'
import type { LocalArtifactReadRequest, LocalArtifactReadResult } from '../../src/shared/ipc/artifact-contract.js'

type UnknownRecord = Record<string, unknown>

interface RunnerLike {
  start(tool: UnknownRecord): Promise<unknown>
  preflight(tool: UnknownRecord): Promise<UnknownRecord>
  pause(): Promise<unknown> | unknown
  resume(): Promise<unknown> | unknown
  completeUserAction(): Promise<unknown> | unknown
  cancel(): Promise<unknown>
  stop(): Promise<unknown>
}

interface EmbeddedBrowserHostLike {
  isReady(): boolean
  request(action: string, payload: UnknownRecord): Promise<unknown> | unknown
  register(guest: Electron.WebContents): unknown
  release(): unknown
}

const { EmbeddedBrowserHost } = require('./embedded-browser-host.cjs') as {
  EmbeddedBrowserHost: new () => EmbeddedBrowserHostLike
}

interface ActionNotification {
  title: string
  body: string
  focus: NotificationFocusPayload
}

interface DesktopAutomationControllerOptions {
  automationEnabled: boolean
  controlApiBase: string
  runtimeRoot: string
  deviceId?: string
  getWindow: () => BrowserWindow | null | undefined
  getDefaultFreightWorkbookPath: () => string
  registerTrustedHandle: TrustedHandleRegistrar
  registerAutomationHandle: TrustedHandleRegistrar
  registerTrustedOn: TrustedEventRegistrar
  mayOpenExternalUrl: (url: string) => boolean
  onActivityChanged: () => void
  showNotification: (notification: ActionNotification) => void
}

export interface DesktopActivityState {
  batchActive: boolean
  singleRunActive: boolean
  demoActive: boolean
}

function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null ? value as UnknownRecord : {}
}

function errorMessage(error: unknown, fallback = '未知错误'): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function installBusyError(message: string): Error & { code: 'INSTALL_BUSY' } {
  return Object.assign(new Error(message), { code: 'INSTALL_BUSY' as const })
}

/**
 * Owns every desktop Runner, batch and demo activity state. The application
 * composition only asks whether work is active and requests quiescence.
 */
export class DesktopAutomationController {
  readonly browserSessions = new WorkspaceBrowserSessions()
  private readonly options: DesktopAutomationControllerOptions
  private readonly embeddedBrowserHost = new EmbeddedBrowserHost()
  private readonly batchController: DesktopBatchController
  private readonly demoActivityTokens = new Set<string>()
  private runner: RunnerLike | null = null
  private singleRunActive = false
  private singleStartInFlight = false
  private readonly reportOutbox: ExecutionReportOutbox
  private readonly staffReportOutbox: ExecutionReportOutbox
  private readonly artifacts: LocalArtifactService
  private readonly recovery: RecoveryStore
  private singleRecovery: { owner: string; id: string; sender: WebContents; files: LocalFileSnapshot } | null = null
  private readonly executionLease: ExecutionLease
  private singlePermit: ExecutionPermit | null = null
  private singleReceipt: string | null = null
  private closing = false
  private readonly fileInputs: FileInputController
  private pendingArtifactOwner: { owner: WebContents; generation: number } | null = null
  private runnerEpoch = 0
  private runnerSerial = 0
  private sessionRevocation: Promise<void> | null = null
  private readonly targets: TargetExecutionController
  private readonly scenarioPolicy: ScenarioPolicyClient
  private readonly localScenes: LocalScenesController

  constructor(options: DesktopAutomationControllerOptions) {
    this.options = options
    this.scenarioPolicy = new ScenarioPolicyClient(async token => {
      const response = await net.fetch(`${options.controlApiBase}/api/scenarios/me`, {
        headers: { Authorization: `Bearer ${token}`, 'X-Toolbox-Version': app.getVersion() }, signal: AbortSignal.timeout(15_000),
      })
      const envelope = asRecord(await response.json())
      if (!response.ok || envelope.success !== true) throw new Error('SCENARIO_POLICY_UNAVAILABLE: 无法验证管理员场景指派，未开放运行')
      return envelope.data
    }, () => {
      this.targets?.close()
      this.browserSessions.revoke()
      void this.batchController?.cancelActiveForWindowClose().catch(() => undefined)
      void this.cancelSingle().catch(() => undefined)
    })
    this.localScenes = new LocalScenesController({ register: options.registerAutomationHandle, getWindow: options.getWindow,
      apiBase: options.controlApiBase, deviceId: () => options.deviceId || '', hasActiveWork: () => this.hasActiveWork() })
    this.executionLease = new ExecutionLease(options.onActivityChanged)
    this.recovery = new RecoveryStore(join(app.getPath('userData'), 'recovery-metadata'))
    this.fileInputs = new FileInputController(options.getWindow)
    this.artifacts = new LocalArtifactService({ directory: join(app.getPath('userData'), 'automation-artifacts') })
    this.reportOutbox = new ExecutionReportOutbox({
      directory: join(app.getPath('userData'), 'pending-records'),
      apiBase: options.controlApiBase,
      version: app.getVersion(),
      codec: safeStorage,
    })
    this.staffReportOutbox = new ExecutionReportOutbox({ directory: join(app.getPath('userData'), 'pending-staff-records'),
      apiBase: options.controlApiBase, version: app.getVersion(), codec: safeStorage, reportPath: '/api/scenarios/staff/reports' })
    this.targets = new TargetExecutionController({
      register: options.registerAutomationHandle, lease: this.executionLease, reports: this.reportOutbox,
      staffReports: this.staffReportOutbox,
      resolveSession: sender => this.resolveRecoverySession(sender, true),
      borrowedWindow: owner => {
        if (owner.kind !== 'staff') return undefined
        const scene = this.localScenes.selectedScene()
        if (scene.accountSlot !== owner.accountSlot) throw new Error('管理员账号现场已经切换')
        return this.localScenes.targetWindow(scene.accountSlot)
      },
      createBorrowedWindow: owner => {
        if (owner.kind !== 'staff' || !owner.accountSlot) throw new Error('独立管理员现场缺失')
        return this.localScenes.targetWindow(owner.accountSlot, true)
      },
      beforeCustomerOpen: () => { this.embeddedBrowserHost.release(); this.browserSessions.revoke() },
      assertScenario: (url, mode) => {
        this.scenarioPolicy.assertAllowed(url)
        if (mode && mode !== this.scenarioPolicy.current().mode) throw new Error('SCENARIO_MODE_ASSIGNED: 场景由管理员指定，不能自行切换')
      },
      scenarioAllows: url => this.scenarioPolicy.allows(url),
      directory: join(app.getPath('userData'), 'target-operations'), apiBase: options.controlApiBase,
      publicKeyB64: toolSigningConfig.publicKeyB64, signingKeyId: toolSigningConfig.keyId,
    })
    this.batchController = new DesktopBatchController({
      getWindow: options.getWindow,
      runnerEnvironment: () => this.runnerEnvironment(),
      registerAutomationHandle: options.registerAutomationHandle,
      onActivityChanged: options.onActivityChanged,
      showNotification: options.showNotification,
      recoveryStore: this.recovery,
      resolveOwner: async (sender: WebContents) => {
        const owner = await this.resolveRecoveryOwner(sender)
        if (this.scenarioPolicy.current().mode === 'competition') throw new Error('SCENARIO_LEGACY_BLOCKED: 比赛模式不能使用旧批量入口')
        return owner
      },
      validateUpload: (sender: WebContents, filePath: unknown) => this.fileInputs.validateUpload(sender, filePath),
      executionLease: this.executionLease,
      reportOutbox: this.reportOutbox,
    })
  }

  registerIpc(): void {
    if (this.options.automationEnabled) { this.reportOutbox.start(); this.staffReportOutbox.start() }
    this.registerToolLaunchIpc()
    this.registerSingleRunIpc()
    this.registerRecoveryIpc()
    this.targets.register()
    this.localScenes.register()
    this.fileInputs.register(this.options.registerAutomationHandle)
    this.options.registerAutomationHandle('artifacts:read', (event: IpcMainInvokeEvent, request: LocalArtifactReadRequest): LocalArtifactReadResult | Promise<LocalArtifactReadResult> => {
      if (this.pendingArtifactOwner?.owner === event.sender) {
        return { status: 'unavailable', kind: request.kind, code: 'NOT_AVAILABLE', message: '任务正在准备，请稍后查看本机证据。' }
      }
      return this.artifacts.read(event.sender, request)
    })
    this.options.registerAutomationHandle('artifacts:clear', (event: IpcMainInvokeEvent) => this.resetArtifactsForOwner(event.sender.id))
    this.registerDemoActivityIpc()
    this.batchController.registerIpc()
  }

  selectedItemId(): string | null {
    return this.batchController.selectedItemId()
  }

  mayNavigateRuntime(url: string): boolean {
    return url === 'about:blank' || this.scenarioPolicy.allows(url)
  }
  toolExecutionLease(): ExecutionLease { return this.executionLease }

  async checkExternalNavigation(sender: WebContents, url: string, expectedSession?: { owner: string; token: string }): Promise<boolean> {
    const token = await sender.executeJavaScript('sessionStorage.getItem("toolbox_token")', false) as unknown
    if (expectedSession && token !== expectedSession.token) throw new Error('场景身份已变化')
    if (typeof token !== 'string' || !token) return true // Public help before login.
    const policy = await this.scenarioPolicy.refresh(token)
    if (await sender.executeJavaScript('sessionStorage.getItem("toolbox_token")', false) !== token) throw new Error('场景身份已变化')
    if (policy.status !== 'unassigned') this.scenarioPolicy.assertAllowed(url)
    if (policy.mode === 'competition') {
      // Keep subsequent redirects inside the same guarded Electron surface;
      // opening the OS browser would lose the approved-origin boundary.
      await this.targets.openAssignedUrl(sender, url, expectedSession?.owner)
      return false
    }
    return true
  }

  activityState(): DesktopActivityState {
    return {
      batchActive: this.batchController.isActive(),
      singleRunActive: this.singleRunActive || this.singleStartInFlight || this.executionLease.busy,
      demoActive: this.demoActivityTokens.size > 0,
    }
  }

  hasActiveWork(): boolean {
    const state = this.activityState()
    return state.batchActive || state.singleRunActive || state.demoActive
  }

  clearDemoActivity(): void {
    this.demoActivityTokens.clear()
    this.options.onActivityChanged()
  }

  resetArtifactsForOwner(ownerId: number): void {
    this.artifacts.reset(ownerId)
    this.fileInputs.clear(ownerId)
    if (this.pendingArtifactOwner?.owner.id === ownerId) this.pendingArtifactOwner = null
  }

  async cancelActiveForWindowClose(): Promise<void> {
    this.targets.close()
    await this.batchController.cancelActiveForWindowClose()
    await this.cancelSingle()
  }

  async cleanup(): Promise<void> {
    this.closing = true
    this.scenarioPolicy.reset()
    this.localScenes.dispose()
    this.targets.dispose()
    this.runnerEpoch += 1
    this.executionLease.close()
    this.singlePermit = null
    this.singleStartInFlight = false
    if (this.singleRecovery) {
      try { this.recovery.observe(this.singleRecovery.owner, this.singleRecovery.id, { type: 'run.interrupted' }) }
      catch { /* Always stop the Runner even when the recovery disk is unavailable. */ }
    }
    this.artifacts.clear()
    this.pendingArtifactOwner = null
    this.reportOutbox.dispose()
    this.staffReportOutbox.dispose()
    this.embeddedBrowserHost.release()
    this.browserSessions.revoke()
    const cleanupTasks: Promise<unknown>[] = [(async () => { await this.batchController.cleanup(); await this.reportOutbox.drain?.(); await this.staffReportOutbox.drain() })()]
    if (this.runner) cleanupTasks.push(this.runner.stop())

    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>(resolve => { timeoutId = setTimeout(resolve, 5000) })
    const results = await Promise.race([Promise.allSettled(cleanupTasks), timeout])
    if (timeoutId) clearTimeout(timeoutId)
    if (!Array.isArray(results)) throw installBusyError('Automation cleanup timed out')

    const failures: unknown[] = []
    for (const result of results) {
      if (result.status !== 'rejected') continue
      failures.push(result.reason)
      console.error('[Automation] 清理失败:', errorMessage(result.reason))
    }
    if (failures.length) {
      const message = errorMessage(failures[0])
      if (/timed?\s*out|timeout/i.test(message)) {
        throw installBusyError(`Automation cleanup timed out: ${message}`)
      }
      throw new Error(`Automation cleanup failed: ${message}`)
    }

    this.runner = null
    this.singleRunActive = false
  }

  private assertEpoch(epoch: number): void {
    if (this.closing || epoch !== this.runnerEpoch) throw new Error('SESSION_REVOKED: 原执行准备已失效，请重新打开工具。')
  }

  private releaseSinglePermit(): void { this.singlePermit?.release(); this.singlePermit = null }

  private releaseUnusedReceipt(record = this.singleRecovery, receipt = this.singleReceipt): void {
    if (!record || !receipt) return
    try {
      if (this.recovery.list(record.owner).find(row => row.id === record.id)?.classification === 'not_submitted') {
        void this.reportOutbox.releaseReservation(receipt).catch(() => { /* retain reservation on storage failure */ })
      }
    } catch { /* Unknown evidence must retain its reserved slot. */ }
  }

  private async cancelSingle(): Promise<void> {
    this.runnerEpoch += 1
    const runner = this.runner
    const record = this.singleRecovery
    this.runner = null
    this.singleRecovery = null
    this.pendingArtifactOwner = null
    if (record) {
      try { this.recovery.observe(record.owner, record.id, { type: 'run.cancelled' }); this.releaseUnusedReceipt(record) }
      catch { /* Always stop; the prior mutation marker still prevents blind retry. */ }
    }
    // A stopping Runner retains ownership until it has stopped; stale requests
    // are rejected by epoch, including a launch suspended in auth/file I/O.
    await runner?.stop()
    this.releaseSinglePermit()
    this.singleRunActive = false
    this.options.onActivityChanged()
  }

  private runnerEnvironment(): NodeJS.ProcessEnv {
    return {
      TOOLBOX_CONTROL_API_URL: this.options.controlApiBase,
      TOOLBOX_PROFILE_ROOT: join(app.getPath('userData'), 'automation-profiles'),
      TOOLBOX_ARTIFACT_ROOT: join(app.getPath('userData'), 'automation-artifacts'),
      PLAYWRIGHT_BROWSERS_PATH: join(this.options.runtimeRoot, 'playwright-browsers'),
      TOOLBOX_FREIGHT_RATE_WORKBOOK: this.options.getDefaultFreightWorkbookPath(),
      TOOLBOX_TOOL_SIGNING_PUBLIC_KEY_B64: process.env.TOOLBOX_TOOL_SIGNING_PUBLIC_KEY_B64
        || toolSigningConfig.publicKeyB64,
    }
  }

  private getRunner(): RunnerLike {
    if (this.runner) return this.runner
    const epoch = this.runnerEpoch
    const serial = ++this.runnerSerial
    let ended = false
    this.runner = new RunnerClient({
      scriptPath: join(__dirname, '..', 'automation-runner.cjs'),
      env: { ...this.runnerEnvironment(), TOOLBOX_PERSIST_REPORTS: '1' },
      onEvent: (rawEvent: unknown) => {
        if (ended || epoch !== this.runnerEpoch || serial !== this.runnerSerial) return
        let event = parseDesktopIpcEvent('automation:event', rawEvent)
        if (this.singleRecovery) {
          try { this.recovery.observe(this.singleRecovery.owner, this.singleRecovery.id, event) }
          catch {
            void this.runner?.stop().catch(() => undefined)
            event = { ...event, type: 'run.failed', error: { code: 'RECOVERY_SAVE_FAILED', message: '本机恢复记录保存失败；执行结果待核对，请勿重复提交。' } }
          }
        }
        const pending = this.pendingArtifactOwner
        if (pending && event.type === 'run.started') {
          this.artifacts.registerRun(pending.owner, pending.generation, event.runId)
        }
        this.artifacts.observe(event)
        if (event.type === 'run.started' || event.type === 'run.preparing') this.singleRunActive = true
        if (event.type === 'user.action_required') this.releaseSinglePermit()
        if (['run.completed', 'run.failed', 'run.cancelled'].includes(event.type)) {
          ended = true
          this.singleRunActive = false
          this.releaseSinglePermit()
          this.releaseUnusedReceipt()
        }
        this.options.onActivityChanged()
        const window = this.options.getWindow()
        if (window && !window.isDestroyed()) window.webContents.send('automation:event', event)
        if (event.type === 'user.action_required') {
          const action = asRecord(event.action)
          this.options.showNotification({
            title: '自动处理需要你的操作',
            body: typeof action.title === 'string' ? action.title : '请返回工具箱完成页面操作',
            focus: { mode: 'single' },
          })
        }
      },
      onHostRequest: async (action: string, payload: UnknownRecord) => {
        if (ended || epoch !== this.runnerEpoch || serial !== this.runnerSerial) throw new Error('SESSION_REVOKED: 原授权现场已经退出，已禁止继续操作。')
        const requestPermit = this.singlePermit
        if (action !== 'execution.report') {
          if (!requestPermit) throw new Error('EXECUTION_REVOKED: 当前任务正在等待人工操作，尚未取得执行许可。')
          requestPermit.assert()
        }
        if (action === 'files.validate-upload' || (action === 'browser.action' && asRecord(payload.action).kind === 'upload')) {
          const record = this.singleRecovery
          if (!record || await this.resolveRecoveryOwner(record.sender) !== record.owner || epoch !== this.runnerEpoch || this.singleRecovery !== record) throw new Error('授权已变化，已禁止上传本机文件。')
          const upload = asRecord(payload.action)
          const filePath = action === 'files.validate-upload' ? payload.filePath
            : typeof upload.inputKey === 'string' ? asRecord(payload.input)[upload.inputKey] : upload.value
          const result = await this.fileInputs.validateUpload(record.sender, filePath)
          if (epoch !== this.runnerEpoch || this.singleRecovery !== record) throw new Error('SESSION_REVOKED: 原授权上传已经退出。')
          requestPermit!.assert()
          if (action === 'files.validate-upload') return result
        }
        if (action === 'recovery.before-mutation') {
          const record = this.singleRecovery
          if (!record) throw new Error('缺少本机恢复记录，已禁止提交。')
          if (await this.resolveRecoveryOwner(record.sender) !== record.owner || epoch !== this.runnerEpoch || this.singleRecovery !== record) throw new Error('授权已变化，已禁止继续提交。')
          await this.fileInputs.validateSnapshot(record.sender, record.files)
          this.assertEpoch(epoch)
          requestPermit!.assert()
          this.recovery.mutation(record.owner, record.id)
          return { saved: true }
        }
        if (action === 'execution.report') {
          if (!this.singleReceipt) throw new Error('RECEIPT_RESERVATION_MISSING: 缺少本次执行回执预留')
          return this.reportOutbox.submit(payload, this.singleReceipt)
        }
        return this.embeddedBrowserHost.request(action, payload)
      },
    }) as RunnerLike
    return this.runner
  }

  private registerToolLaunchIpc(): void {
    if (!this.options.automationEnabled) return
    this.options.registerTrustedOn('launch-tool', async (event: IpcMainEvent, rawData: unknown) => {
      const data = asRecord(rawData)
      const launchData = asRecord(data.launchData)
      const toolName = typeof data.toolName === 'string' ? data.toolName : '未知工具'
      console.log('[LaunchTool] 启动工具:', toolName, 'toolId:', launchData.tool_id)

      if (!launchData.token && typeof data.launchUrl === 'string') {
        if (this.options.mayOpenExternalUrl(data.launchUrl)) {
          let external: boolean
          try { external = await this.checkExternalNavigation(event.sender, data.launchUrl) }
          catch { event.sender.send('launch-tool-error', { message: '当前场景不允许打开此链接' }); return }
          if (external) await shell.openExternal(data.launchUrl)
          event.sender.send('launch-tool-success', { toolName })
          return
        }
        event.sender.send('launch-tool-error', { message: '不支持的启动链接格式' })
        return
      }
      if (!launchData.token || !launchData.tool_id) {
        event.sender.send('launch-tool-error', { message: '工具启动数据不完整' })
        return
      }

      try {
        const verifyUrl = `${this.options.controlApiBase}/api/tools/launch-grant/verify?token=${encodeURIComponent(String(launchData.token))}`
        const request = net.request({ method: 'POST', url: verifyUrl })
        request.on('response', (response: IncomingMessage) => {
          let body = ''
          response.on('data', (chunk: Buffer) => { body += chunk.toString() })
          response.on('end', () => {
            try {
              const result = asRecord(JSON.parse(body) as unknown)
              const resultData = asRecord(result.data)
              if (result.success === true && resultData.valid === true) {
                event.sender.send('launch-tool-success', {
                  toolName,
                  platformKey: launchData.platform_key,
                })
                return
              }
              event.sender.send('launch-tool-error', {
                message: typeof result.message === 'string' ? result.message : 'Token 验证失败',
              })
            } catch (error) {
              console.error('[LaunchTool] 解析验证响应失败:', errorMessage(error))
              event.sender.send('launch-tool-error', { message: '工具启动验证失败' })
            }
          })
        })
        request.on('error', (error: Error) => {
          console.error('[LaunchTool] 验证请求失败:', error.message)
          event.sender.send('launch-tool-error', { message: '网络连接失败，请检查后端服务' })
        })
        request.end()
      } catch (error) {
        const message = errorMessage(error)
        console.error('[LaunchTool] 启动工具异常:', message)
        event.sender.send('launch-tool-error', { message: `工具启动失败: ${message}` })
      }
    })
  }

  private registerSingleRunIpc(): void {
    const register = this.options.registerAutomationHandle
    register('automation:start', async (event: IpcMainInvokeEvent, rawTool: unknown) => {
      if (this.sessionRevocation) await this.sessionRevocation
      const epoch = this.runnerEpoch
      this.assertEpoch(epoch)
      const tool = asRecord(rawTool)
      if (!tool.id) throw new Error('工具启动数据不完整')
      if (tool.executionMode !== 'live' && !(tool.executionMode === 'demo' && !app.isPackaged && process.env.TOOLBOX_INTERNAL_DEMO === '1')) {
        throw new Error('LEGACY_DEMO_DISABLED: 客户执行入口不再提供旧演示或模拟回退')
      }
      const context = asRecord(tool.executionContext)
      const input = asRecord(context.input)
      // Keep the original single-Runner boundary while binding evidence to one
      // launch request. Auth reset must not release a still-pending start.
      if (this.singleStartInFlight || this.singleRunActive) {
        throw Object.assign(new Error('当前任务尚未结束，请先停止或等待结束。'), { code: 'RUN_ALREADY_ACTIVE' })
      }
      const permit = this.executionLease.acquire()
      this.singleStartInFlight = true
      this.singlePermit = permit
      this.options.onActivityChanged()
      const pending = { owner: event.sender, generation: this.artifacts.begin(event.sender) }
      this.pendingArtifactOwner = pending
      let receipt: string | null = null
      let runnerStarted = false
      try {
        this.singleRecovery = null
        this.singleReceipt = null
        // Renderer keys are display hints only. The verified control catalog is
        // authoritative, including when the renderer omits or empties its list.
        const session = tool.executionMode === 'live' ? await this.resolveRecoverySession(event.sender) : null
        if (session) {
          if (this.scenarioPolicy.current().mode === 'competition') throw new Error('SCENARIO_LEGACY_BLOCKED: 比赛动作尚未验收，不能通过旧入口执行')
          this.scenarioPolicy.assertAllowed(String(tool.targetUrl || ''))
        }
        this.assertEpoch(epoch)
        if (session && this.embeddedBrowserHost.isReady() && !this.browserSessions.matches(session.owner, tool.platformKey === 'aliexpress' ? 'aliexpress' : 'amazon')) {
          throw new Error('BROWSER_OWNER_CHANGED: 请重新打开工具，以隔离当前平台账号。')
        }
        const fields = session ? await this.trustedFilePaths(event.sender, session.token, tool.id, input) : {}
        this.assertEpoch(epoch)
        const files = await this.fileInputs.snapshot(event.sender, input, fields)
        this.assertEpoch(epoch)
        if (session) {
          if (event.sender.isDestroyed() || this.options.getWindow()?.webContents !== event.sender || await event.sender.executeJavaScript('sessionStorage.getItem("toolbox_token")', false) !== session.token) throw new Error('授权在文件验证期间已变化，请重新打开工具。')
          this.assertEpoch(epoch)
          receipt = await this.reportOutbox.reserve(asRecord(tool.launchGrant).token)
          this.assertEpoch(epoch)
          this.singleReceipt = receipt
          const owner = session.owner
          const record = this.recovery.begin(owner, tool, files.input, { legacyInput: input })
          this.singleRecovery = { owner, id: record.id, sender: event.sender, files }
        }
        permit.assert()
        if (this.runner) { await this.runner.stop(); this.assertEpoch(epoch); this.runner = null }
        runnerStarted = true
        const result = await this.getRunner().start({
          ...tool,
          browserMode: this.embeddedBrowserHost.isReady() ? 'embedded-cdp' : 'playwright',
        })
        if (epoch !== this.runnerEpoch) throw new Error('SESSION_REVOKED: 原授权执行已退出，已保留待核对记录。')
        this.artifacts.registerRun(pending.owner, pending.generation, asRecord(result).runId)
        return result
      } catch (cause) {
        if (epoch === this.runnerEpoch && this.singleRecovery) this.recovery.observe(this.singleRecovery.owner, this.singleRecovery.id, { type: 'run.failed', error: { code: 'START_FAILED' } })
        if (runnerStarted && epoch === this.runnerEpoch) {
          await this.runner?.stop()
          this.runner = null
          this.runnerEpoch += 1
          this.singleRunActive = false
        }
        if (receipt && !runnerStarted) await this.reportOutbox.releaseReservation(receipt)
        permit.release()
        if (this.singlePermit === permit) this.singlePermit = null
        throw cause
      } finally {
        this.singleStartInFlight = false
        if (this.pendingArtifactOwner === pending) this.pendingArtifactOwner = null
        this.options.onActivityChanged()
      }
    })
    register('automation:preflight', async (event: IpcMainInvokeEvent, rawTool: unknown) => {
      if (this.sessionRevocation) await this.sessionRevocation
      const tool = asRecord(rawTool)
      if (!tool.id) throw new Error('工具启动数据不完整')
      await this.resolveRecoverySession(event.sender)
      if (this.scenarioPolicy.current().mode === 'competition') throw new Error('SCENARIO_LEGACY_BLOCKED: 请使用指定的受控比赛入口')
      this.scenarioPolicy.assertAllowed(String(tool.targetUrl || ''))
      this.assertEpoch(this.runnerEpoch)
      if (this.singleRunActive) throw new Error('RUN_ALREADY_ACTIVE: 请先结束当前任务')
      const permit = this.executionLease.acquire()
      this.singlePermit = permit
      const epoch = this.runnerEpoch
      try {
        if (this.embeddedBrowserHost.isReady()) {
          const owner = await this.resolveRecoveryOwner(event.sender)
          this.assertEpoch(epoch)
          if (!this.browserSessions.matches(owner, tool.platformKey === 'aliexpress' ? 'aliexpress' : 'amazon')) throw new Error('BROWSER_OWNER_CHANGED: 请重新打开工具')
        }
        permit.assert()
        return await this.getRunner().preflight({
        ...tool,
        browserMode: this.embeddedBrowserHost.isReady() ? 'embedded-cdp' : 'playwright',
      }) } finally { permit.release(); if (this.singlePermit === permit) this.singlePermit = null }
    })
    register('automation:pause', () => this.runner?.pause())
    const resume = async (complete: boolean) => {
      this.assertEpoch(this.runnerEpoch)
      if (!this.runner || !this.singleRunActive) throw new Error('当前任务已结束')
      this.singlePermit ||= this.executionLease.acquire()
      this.singlePermit.assert()
      try { return await (complete ? this.runner.completeUserAction() : this.runner.resume()) }
      catch (cause) { this.releaseSinglePermit(); throw cause }
    }
    register('automation:resume', () => resume(false))
    register('automation:complete-user-action', () => resume(true))
    register('automation:cancel', () => this.cancelSingle())
    register('automation:prepare-browser', async (event: IpcMainInvokeEvent, platform: string) => {
      if (this.sessionRevocation) await this.sessionRevocation
      let epoch = this.runnerEpoch
      this.assertEpoch(epoch)
      const owner = await this.resolveRecoveryOwner(event.sender)
      if (this.scenarioPolicy.current().mode === 'competition') throw new Error('SCENARIO_LEGACY_BLOCKED: 请使用指定的受控比赛入口')
      this.assertEpoch(epoch)
      if (!this.browserSessions.matches(owner, platform)) {
        // Changing a verified owner retires old browser scenes. Opening another
        // tool for the same owner must not silently cancel a live batch.
        const changedOwner = this.browserSessions.hasGrant && !this.browserSessions.isOwner(owner)
        if (changedOwner) { await this.revokeSession(); epoch = this.runnerEpoch }
        else {
          if (this.hasActiveWork()) throw new Error('RUN_ALREADY_ACTIVE: 请先结束当前任务')
          this.embeddedBrowserHost.release()
        }
      }
      this.assertEpoch(epoch)
      if (await this.resolveRecoveryOwner(event.sender) !== owner) throw new Error('授权已变化，请重新打开工具')
      this.assertEpoch(epoch)
      if (this.executionLease.busy) throw new Error('RUN_ALREADY_ACTIVE: 请先结束当前任务再切换工具现场')
      this.targets.close()
      return this.browserSessions.prepare(owner, platform)
    })
    register('automation:register-browser', async (event: IpcMainInvokeEvent, webContentsId: unknown) => {
      const epoch = this.runnerEpoch
      const owner = await this.resolveRecoveryOwner(event.sender)
      this.assertEpoch(epoch)
      const guest = webContents.fromId(Number(webContentsId))
      if (!guest || guest.getType?.() !== 'webview') throw new Error('无法注册工作区浏览器')
      if (guest.hostWebContents?.id !== event.sender.id) {
        throw new Error('工作区浏览器归属校验失败')
      }
      this.browserSessions.assertGuest(guest, owner)
      if (this.singleRunActive || this.singleStartInFlight) throw new Error('RUN_ALREADY_ACTIVE: 任务执行期间不能替换浏览器')
      return this.embeddedBrowserHost.register(guest)
    })
    register('automation:unregister-browser', () => this.embeddedBrowserHost.release())
  }

  private async resolveRecoverySession(sender: WebContents, allowStaff = false): Promise<import('./targets/target-controller.cjs').TargetSessionOwner> {
    const token: unknown = await sender.executeJavaScript('sessionStorage.getItem("toolbox_token")', false)
    if (typeof token !== 'string' || !token) throw new Error('请先登录有效授权后查看本机恢复记录。')
    const response = await net.fetch(`${this.options.controlApiBase}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Toolbox-Version': app.getVersion() }, signal: AbortSignal.timeout(15000),
    })
    const envelope = asRecord(await response.json())
    const user = asRecord(envelope.data)
    const staff = allowStaff && ['super_admin', 'operator', 'support'].includes(String(user.role)) && Boolean(user.staff_id)
    if (!response.ok || envelope.success !== true || (user.role !== 'user' && !staff) || !user.user_id) throw new Error('恢复权限验证失败，请重新登录。')
    const policy = await this.scenarioPolicy.refresh(token)
    if (policy.principal.kind !== (staff ? 'staff' : 'customer') || policy.principal.id !== String(user.user_id)) throw new Error('场景身份不匹配')
    if (await sender.executeJavaScript('sessionStorage.getItem("toolbox_token")', false) !== token) throw new Error('授权在验证期间已变化，请重新打开工具。')
    // Read claims only after this exact token was accepted by the control API.
    let claims: UnknownRecord = {}
    try { claims = asRecord(JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString('utf8'))) } catch { /* opaque tokens use verified profile */ }
    if (staff) {
      const scene = this.localScenes.selectedScene()
      if (scene.owner !== `staff:${user.user_id}`) throw new Error('账号现场不属于当前管理员')
      return { owner: recoveryOwnerHash([this.options.controlApiBase, 'staff', user.user_id, this.options.deviceId, scene.accountSlot]),
        token, kind: 'staff', deviceId: this.options.deviceId, accountSlot: scene.accountSlot }
    }
    return {
      owner: recoveryOwnerHash([this.options.controlApiBase, user.user_id, claims.auth_code_id || null, claims.device_id || user.device_id || null]),
      token,
      kind: 'customer',
      deviceId: String(claims.device_id || user.device_id || ''),
      accountSlot: 'single',
    }
  }

  private async resolveRecoveryOwner(sender: WebContents): Promise<string> {
    return (await this.resolveRecoverySession(sender)).owner
  }

  private async trustedFilePaths(sender: WebContents, token: string, toolId: unknown, input: UnknownRecord): Promise<Record<string, string>> {
    const response = await net.fetch(`${this.options.controlApiBase}/api/tools`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Toolbox-Version': app.getVersion() }, signal: AbortSignal.timeout(15000),
    })
    const catalog: unknown = await response.json()
    if (!response.ok || !Array.isArray(catalog)) throw new Error('TOOL_SCHEMA_UNAVAILABLE: 工具参数配置不可用，请稍后重试')
    const tool = catalog.map(asRecord).find(row => row.id === toolId)
    if (!tool || !Array.isArray(tool.single_input_schema)) throw new Error('TOOL_SCHEMA_UNAVAILABLE: 未找到有效工具参数配置')
    if (sender.isDestroyed() || this.options.getWindow()?.webContents !== sender || await sender.executeJavaScript('sessionStorage.getItem("toolbox_token")', false) !== token) throw new Error('授权在参数验证期间已变化，请重新打开工具。')
    const paths: Record<string, string> = {}
    for (const rawField of tool.single_input_schema) {
      const field = asRecord(rawField)
      if (field.type !== 'file') continue
      if (typeof field.key !== 'string' || !field.key) throw new Error('TOOL_SCHEMA_UNAVAILABLE: 文件参数配置无效')
      const value = input[field.key]
      if (value === undefined || value === null || value === '') {
        if (field.required !== false) throw new Error('LOCAL_FILE_REQUIRED: 请先选择工具所需的本机文件')
      } else if (typeof value !== 'string') throw new Error('LOCAL_FILE_REQUIRED: 文件参数必须来自本机文件选择')
      else paths[field.key] = value
    }
    return paths
  }

  private async revokeSession(): Promise<void> {
      this.scenarioPolicy.reset()
      this.localScenes.dispose()
      this.targets.close()
      this.runnerEpoch += 1
      // Revokes the old owner's permit but preserves target host-drain fences;
      // signing in again cannot overlap an unfinished browser operation.
      this.executionLease.invalidate()
      this.singlePermit = null
      const prior = this.singleRecovery
      const runner = this.runner
      this.runner = null
      this.singleRecovery = null
      this.singleRunActive = false
      this.pendingArtifactOwner = null
      const sender = this.options.getWindow()?.webContents
      if (sender) this.resetArtifactsForOwner(sender.id)
      this.embeddedBrowserHost.release()
      this.browserSessions.revoke()
      if (prior) {
        try { this.recovery.observe(prior.owner, prior.id, { type: 'run.interrupted', error: { code: 'SESSION_REVOKED' } }) }
        catch { /* unavailable ledger keeps further execution fail-closed */ }
      }
      const previous = this.sessionRevocation
      const current = (async () => {
        await previous
        await Promise.all([runner?.stop(), this.batchController.revokeSession()])
        this.options.onActivityChanged()
      })()
      this.sessionRevocation = current
      await current
      if (this.sessionRevocation === current) this.sessionRevocation = null
  }

  private registerRecoveryIpc(): void {
    const register = this.options.registerAutomationHandle
    register('recovery:revoke-session', () => this.revokeSession())
    register('recovery:list', async (event: IpcMainInvokeEvent, query: RecoveryQuery) => this.recovery.list(await this.resolveRecoveryOwner(event.sender), query.batchId))
    register('recovery:review', async (event: IpcMainInvokeEvent, request: RecoveryReview) => this.recovery.review(await this.resolveRecoveryOwner(event.sender), request.id, request.revision, request.conclusion))
    register('recovery:prepare', async (event: IpcMainInvokeEvent, request: RecoveryPrepare) => this.batchController.prepareRecovery(await this.resolveRecoveryOwner(event.sender), request))
    register('recovery:read-evidence', async (event: IpcMainInvokeEvent, id: string) => {
      const owner = await this.resolveRecoveryOwner(event.sender)
      const record = this.recovery.list(owner).find(row => row.id === id)
      if (!record?.runId) return { status: 'unavailable', kind: 'screenshot', code: 'NO_EVIDENCE', message: '这条记录没有可读取的本机证据。' }
      return this.artifacts.readRecoveredScreenshot(record.runId, async () => {
        try { return !event.sender.isDestroyed() && await this.resolveRecoveryOwner(event.sender) === owner } catch { return false }
      })
    })
    register('recovery:open-platform', async (event: IpcMainInvokeEvent, id: string) => {
      const owner = await this.resolveRecoverySession(event.sender)
      const origin = this.recovery.origin(owner.owner, id)
      if (!origin || !this.options.mayOpenExternalUrl(origin)) throw new Error('记录未保存可安全打开的平台入口，请自行打开平台核对。')
      this.scenarioPolicy.assertAllowed(origin)
      if (await this.checkExternalNavigation(event.sender, origin, owner)) await shell.openExternal(origin)
    })
    register('recovery:export', async (event: IpcMainInvokeEvent, query: RecoveryQuery) => {
      const owner = await this.resolveRecoveryOwner(event.sender)
      const csv = this.recovery.csv(owner, query.batchId)
      const window = this.options.getWindow()
      const options = { title: '导出失败及待核对行', defaultPath: 'KST-待处理行.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] }
      const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return null
      // Revalidate the account after the asynchronous native dialog.
      if (await this.resolveRecoveryOwner(event.sender) !== owner) throw new Error('授权已经切换，已取消导出。')
      writeFileSync(result.filePath, this.recovery.csv(owner, query.batchId).content, { encoding: 'utf8', mode: 0o600 })
      return { count: csv.count, fileName: 'KST-待处理行.csv' }
    })
  }

  private registerDemoActivityIpc(): void {
    this.options.registerTrustedHandle(
      'demo-activity:set-active',
      (_event: IpcMainInvokeEvent, token: unknown, active: unknown): void => {
        if (typeof token !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(token)) {
          throw new TypeError('Invalid demo activity token')
        }
        if (typeof active !== 'boolean') throw new TypeError('Invalid demo activity state')
        if (active) this.demoActivityTokens.add(token)
        else this.demoActivityTokens.delete(token)
        this.options.onActivityChanged()
      },
    )
  }

}
