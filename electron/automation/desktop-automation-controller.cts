import {
  app,
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
  private pendingArtifactOwner: { owner: WebContents; generation: number } | null = null

  constructor(options: DesktopAutomationControllerOptions) {
    this.options = options
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
    })
  }

  registerIpc(): void {
    if (this.options.automationEnabled) this.reportOutbox.start()
    this.registerToolLaunchIpc()
    this.registerSingleRunIpc()
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
    this.runner = new RunnerClient({
      scriptPath: join(__dirname, '..', 'automation-runner.cjs'),
      env: { ...this.runnerEnvironment(), TOOLBOX_PERSIST_REPORTS: '1' },
      onEvent: (rawEvent: unknown) => {
        const event = parseDesktopIpcEvent('automation:event', rawEvent)
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
      onHostRequest: (action: string, payload: UnknownRecord) => action === 'execution.report'
        ? this.reportOutbox.submit(payload)
        : this.embeddedBrowserHost.request(action, payload),
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
      const tool = asRecord(rawTool)
      if (!tool.id) throw new Error('工具启动数据不完整')
      // Keep the original single-Runner boundary while binding evidence to one
      // launch request. Auth reset must not release a still-pending start.
      if (this.singleStartInFlight || this.singleRunActive) {
        throw Object.assign(new Error('当前任务尚未结束，请先停止或等待结束。'), { code: 'RUN_ALREADY_ACTIVE' })
      }
      this.singleStartInFlight = true
      const pending = { owner: event.sender, generation: this.artifacts.begin(event.sender) }
      this.pendingArtifactOwner = pending
      try {
        const result = await this.getRunner().start({
          ...tool,
          browserMode: this.embeddedBrowserHost.isReady() ? 'embedded-cdp' : 'playwright',
        })
        this.artifacts.registerRun(pending.owner, pending.generation, asRecord(result).runId)
        return result
      } finally {
        this.singleStartInFlight = false
        if (this.pendingArtifactOwner === pending) this.pendingArtifactOwner = null
      }
    })
    register('automation:preflight', async (event: IpcMainInvokeEvent, rawTool: unknown) => {
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
