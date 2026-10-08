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
import { FileInputController } from './file-input-controller.cjs'
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
  private readonly options: DesktopAutomationControllerOptions
  private readonly embeddedBrowserHost = new EmbeddedBrowserHost()
  private readonly batchController: DesktopBatchController
  private readonly demoActivityTokens = new Set<string>()
  private runner: RunnerLike | null = null
  private singleRunActive = false
  private singleStartInFlight = false
  private readonly reportOutbox: ExecutionReportOutbox
  private readonly artifacts: LocalArtifactService
  private readonly recovery: RecoveryStore
  private singleRecovery: { owner: string; id: string; sender: WebContents } | null = null
  private readonly fileInputs: FileInputController
  private pendingArtifactOwner: { owner: WebContents; generation: number } | null = null
  private runnerEpoch = 0
  private sessionRevocation: Promise<void> | null = null

  constructor(options: DesktopAutomationControllerOptions) {
    this.options = options
    this.recovery = new RecoveryStore(join(app.getPath('userData'), 'recovery-metadata'))
    this.fileInputs = new FileInputController(options.getWindow)
    this.artifacts = new LocalArtifactService({ directory: join(app.getPath('userData'), 'automation-artifacts') })
    this.reportOutbox = new ExecutionReportOutbox({
      directory: join(app.getPath('userData'), 'pending-records'),
      apiBase: options.controlApiBase,
      version: app.getVersion(),
      codec: safeStorage,
    })
    this.batchController = new DesktopBatchController({
      getWindow: options.getWindow,
      runnerEnvironment: () => this.runnerEnvironment(),
      registerAutomationHandle: options.registerAutomationHandle,
      onActivityChanged: options.onActivityChanged,
      showNotification: options.showNotification,
      recoveryStore: this.recovery,
      resolveOwner: (sender: WebContents) => this.resolveRecoveryOwner(sender),
      validateUpload: (sender: WebContents, filePath: unknown) => this.fileInputs.validateUpload(sender, filePath),
    })
  }

  registerIpc(): void {
    if (this.options.automationEnabled) this.reportOutbox.start()
    this.registerToolLaunchIpc()
    this.registerSingleRunIpc()
    this.registerRecoveryIpc()
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

  activityState(): DesktopActivityState {
    return {
      batchActive: this.batchController.isActive(),
      singleRunActive: this.singleRunActive,
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
    await this.batchController.cancelActiveForWindowClose()
    await this.runner?.cancel().catch(() => undefined)
    this.singleRunActive = false
  }

  async cleanup(): Promise<void> {
    this.artifacts.clear()
    this.pendingArtifactOwner = null
    this.reportOutbox.dispose()
    this.embeddedBrowserHost.release()
    const cleanupTasks: Promise<unknown>[] = [this.batchController.cleanup()]
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
    this.runner = new RunnerClient({
      scriptPath: join(__dirname, '..', 'automation-runner.cjs'),
      env: { ...this.runnerEnvironment(), TOOLBOX_PERSIST_REPORTS: '1' },
      onEvent: (rawEvent: unknown) => {
        if (epoch !== this.runnerEpoch) return
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
        if (['run.completed', 'run.failed', 'run.cancelled'].includes(event.type)) this.singleRunActive = false
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
        if (epoch !== this.runnerEpoch) throw new Error('SESSION_REVOKED: 原授权现场已经退出，已禁止继续操作。')
        if (action === 'files.validate-upload' || (action === 'browser.action' && asRecord(payload.action).kind === 'upload')) {
          const record = this.singleRecovery
          if (!record || await this.resolveRecoveryOwner(record.sender) !== record.owner || epoch !== this.runnerEpoch || this.singleRecovery !== record) throw new Error('授权已变化，已禁止上传本机文件。')
          const upload = asRecord(payload.action)
          const filePath = action === 'files.validate-upload' ? payload.filePath
            : typeof upload.inputKey === 'string' ? asRecord(payload.input)[upload.inputKey] : upload.value
          const result = await this.fileInputs.validateUpload(record.sender, filePath)
          if (epoch !== this.runnerEpoch || this.singleRecovery !== record) throw new Error('SESSION_REVOKED: 原授权上传已经退出。')
          if (action === 'files.validate-upload') return result
        }
        if (action === 'recovery.before-mutation') {
          const record = this.singleRecovery
          if (!record) throw new Error('缺少本机恢复记录，已禁止提交。')
          if (await this.resolveRecoveryOwner(record.sender) !== record.owner || epoch !== this.runnerEpoch || this.singleRecovery !== record) throw new Error('授权已变化，已禁止继续提交。')
          this.recovery.mutation(record.owner, record.id)
          return { saved: true }
        }
        return action === 'execution.report' ? this.reportOutbox.submit(payload) : this.embeddedBrowserHost.request(action, payload)
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
          await shell.openExternal(data.launchUrl)
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
      this.singleStartInFlight = true
      const pending = { owner: event.sender, generation: this.artifacts.begin(event.sender) }
      this.pendingArtifactOwner = pending
      try {
        this.singleRecovery = null
        // Renderer keys are display hints only. The verified control catalog is
        // authoritative, including when the renderer omits or empties its list.
        const session = tool.executionMode === 'live' ? await this.resolveRecoverySession(event.sender) : null
        const paths = session ? await this.trustedFilePaths(event.sender, session.token, tool.id, input) : []
        const validation = await this.fileInputs.validate(event.sender, paths)
        if (epoch !== this.runnerEpoch) throw new Error('SESSION_REVOKED: 授权已经退出，请重新打开工具。')
        if (!validation.valid) throw new Error(`LOCAL_FILE_UNREADABLE: ${validation.issues[0]?.message || '本机文件无法读取'}`)
        if (session) {
          if (event.sender.isDestroyed() || this.options.getWindow()?.webContents !== event.sender || await event.sender.executeJavaScript('sessionStorage.getItem("toolbox_token")', false) !== session.token) throw new Error('授权在文件验证期间已变化，请重新打开工具。')
          const owner = session.owner
          const context = asRecord(tool.executionContext)
          const record = this.recovery.begin(owner, tool, asRecord(context.input))
          this.singleRecovery = { owner, id: record.id, sender: event.sender }
        }
        const result = await this.getRunner().start({
          ...tool,
          browserMode: this.embeddedBrowserHost.isReady() ? 'embedded-cdp' : 'playwright',
        })
        if (epoch !== this.runnerEpoch) throw new Error('SESSION_REVOKED: 原授权执行已退出，已保留待核对记录。')
        this.artifacts.registerRun(pending.owner, pending.generation, asRecord(result).runId)
        return result
      } catch (cause) {
        if (this.singleRecovery) this.recovery.observe(this.singleRecovery.owner, this.singleRecovery.id, { type: 'run.failed', error: { code: 'START_FAILED' } })
        throw cause
      } finally {
        this.singleStartInFlight = false
        if (this.pendingArtifactOwner === pending) this.pendingArtifactOwner = null
      }
    })
    register('automation:preflight', async (event: IpcMainInvokeEvent, rawTool: unknown) => {
      if (this.sessionRevocation) await this.sessionRevocation
      const tool = asRecord(rawTool)
      if (!tool.id) throw new Error('工具启动数据不完整')
      this.resetArtifactsForOwner(event.sender.id)
      return this.getRunner().preflight({
        ...tool,
        browserMode: this.embeddedBrowserHost.isReady() ? 'embedded-cdp' : 'playwright',
      })
    })
    register('automation:pause', () => this.getRunner().pause())
    register('automation:resume', () => this.getRunner().resume())
    register('automation:complete-user-action', () => this.getRunner().completeUserAction())
    register('automation:cancel', () => this.getRunner().cancel())
    register('automation:register-browser', (event: IpcMainInvokeEvent, webContentsId: unknown) => {
      const guest = webContents.fromId(Number(webContentsId))
      if (!guest || guest.getType?.() !== 'webview') throw new Error('无法注册工作区浏览器')
      if (guest.hostWebContents && guest.hostWebContents.id !== event.sender.id) {
        throw new Error('工作区浏览器归属校验失败')
      }
      return this.embeddedBrowserHost.register(guest)
    })
    register('automation:unregister-browser', () => this.embeddedBrowserHost.release())
  }

  private async resolveRecoverySession(sender: WebContents): Promise<{ owner: string; token: string }> {
    const token: unknown = await sender.executeJavaScript('sessionStorage.getItem("toolbox_token")', false)
    if (typeof token !== 'string' || !token) throw new Error('请先登录有效授权后查看本机恢复记录。')
    const response = await net.fetch(`${this.options.controlApiBase}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Toolbox-Version': app.getVersion() }, signal: AbortSignal.timeout(15000),
    })
    const envelope = asRecord(await response.json())
    const user = asRecord(envelope.data)
    if (!response.ok || envelope.success !== true || user.role !== 'user' || !user.user_id) throw new Error('恢复权限验证失败，请重新登录。')
    if (await sender.executeJavaScript('sessionStorage.getItem("toolbox_token")', false) !== token) throw new Error('授权在验证期间已变化，请重新打开工具。')
    // Read claims only after this exact token was accepted by the control API.
    let claims: UnknownRecord = {}
    try { claims = asRecord(JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString('utf8'))) } catch { /* opaque tokens use verified profile */ }
    return { owner: recoveryOwnerHash([this.options.controlApiBase, user.user_id, claims.auth_code_id || null, claims.device_id || user.device_id || null]), token }
  }

  private async resolveRecoveryOwner(sender: WebContents): Promise<string> {
    return (await this.resolveRecoverySession(sender)).owner
  }

  private async trustedFilePaths(sender: WebContents, token: string, toolId: unknown, input: UnknownRecord): Promise<string[]> {
    const response = await net.fetch(`${this.options.controlApiBase}/api/tools`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Toolbox-Version': app.getVersion() }, signal: AbortSignal.timeout(15000),
    })
    const catalog: unknown = await response.json()
    if (!response.ok || !Array.isArray(catalog)) throw new Error('TOOL_SCHEMA_UNAVAILABLE: 工具参数配置不可用，请稍后重试')
    const tool = catalog.map(asRecord).find(row => row.id === toolId)
    if (!tool || !Array.isArray(tool.single_input_schema)) throw new Error('TOOL_SCHEMA_UNAVAILABLE: 未找到有效工具参数配置')
    if (sender.isDestroyed() || this.options.getWindow()?.webContents !== sender || await sender.executeJavaScript('sessionStorage.getItem("toolbox_token")', false) !== token) throw new Error('授权在参数验证期间已变化，请重新打开工具。')
    const paths: string[] = []
    for (const rawField of tool.single_input_schema) {
      const field = asRecord(rawField)
      if (field.type !== 'file') continue
      if (typeof field.key !== 'string' || !field.key) throw new Error('TOOL_SCHEMA_UNAVAILABLE: 文件参数配置无效')
      const value = input[field.key]
      if (value === undefined || value === null || value === '') {
        if (field.required !== false) throw new Error('LOCAL_FILE_REQUIRED: 请先选择工具所需的本机文件')
      } else if (typeof value !== 'string') throw new Error('LOCAL_FILE_REQUIRED: 文件参数必须来自本机文件选择')
      else paths.push(value)
    }
    return paths
  }

  private registerRecoveryIpc(): void {
    const register = this.options.registerAutomationHandle
    register('recovery:revoke-session', async () => {
      this.runnerEpoch += 1
      const prior = this.singleRecovery
      const runner = this.runner
      this.runner = null
      this.singleRecovery = null
      this.singleRunActive = false
      this.pendingArtifactOwner = null
      const sender = this.options.getWindow()?.webContents
      if (sender) this.resetArtifactsForOwner(sender.id)
      this.embeddedBrowserHost.release()
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
    })
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
      const origin = this.recovery.origin(await this.resolveRecoveryOwner(event.sender), id)
      if (!origin || !this.options.mayOpenExternalUrl(origin)) throw new Error('记录未保存可安全打开的平台入口，请自行打开平台核对。')
      await shell.openExternal(origin)
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
