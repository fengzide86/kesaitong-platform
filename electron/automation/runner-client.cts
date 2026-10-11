import { fork, type ChildProcess } from 'node:child_process'
import {
  hostResponseSchema,
  runnerCommandNameSchema,
  runnerCommandSchema,
  runnerPreflightResultSchema,
  runnerProtocolError,
  runnerToHostMessageSchema,
  type HostRequest,
  type RunnerCommandName,
  type RunnerEvent,
  type RunnerPreflightResult,
} from '../../src/shared/ipc/automation-contract.js'

type UnknownRecord = Record<string, unknown>
type ForkRunner = typeof fork

interface PendingCommand {
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  timer: NodeJS.Timeout
}

interface RunnerClientOptions {
  scriptPath: string
  env?: NodeJS.ProcessEnv
  onEvent?: (event: RunnerEvent) => void
  onHostRequest?: ((action: string, payload: UnknownRecord) => Promise<unknown> | unknown) | null
  forkFn?: ForkRunner
  timeoutMs?: number
}

function errorDetails(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : 'BROWSER_HOST_ERROR'
    return { code, message: error.message }
  }
  return { code: 'BROWSER_HOST_ERROR', message: 'Browser host request failed' }
}

export class RunnerClient {
  private readonly scriptPath: string
  private readonly env: NodeJS.ProcessEnv
  private readonly onEvent: (event: RunnerEvent) => void
  private readonly onHostRequest: RunnerClientOptions['onHostRequest']
  private readonly forkFn: ForkRunner
  private readonly timeoutMs: number
  private child: ChildProcess | null = null
  private readonly pending = new Map<string, PendingCommand>()
  private sequence = 0
  private runActive = false

  constructor({ scriptPath, env = {}, onEvent = () => undefined, onHostRequest = null, forkFn = fork, timeoutMs = 45000 }: RunnerClientOptions) {
    this.scriptPath = scriptPath
    this.env = env
    this.onEvent = onEvent
    this.onHostRequest = onHostRequest
    this.forkFn = forkFn
    this.timeoutMs = timeoutMs
  }

  private ensureStarted(): void {
    if (this.child?.connected) return
    const options = {
      env: { ...process.env, ...this.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    } as Parameters<ForkRunner>[2]
    const child = this.forkFn(this.scriptPath, [], options)
    this.child = child
    child.on('message', message => this.handleMessage(message))
    child.on('exit', (code, signal) => this.handleExit(code, signal))
    child.on('error', error => this.handleExit(null, null, error))
    child.stdout?.on('data', data => console.log('[AutomationRunner]', String(data).trim()))
    child.stderr?.on('data', data => console.error('[AutomationRunner]', String(data).trim()))
  }

  private handleMessage(rawMessage: unknown): void {
    const parsed = runnerToHostMessageSchema.safeParse(rawMessage)
    if (!parsed.success) {
      const id = rawMessage && typeof rawMessage === 'object' && 'id' in rawMessage && typeof rawMessage.id === 'string'
        ? rawMessage.id
        : null
      const pending = id ? this.pending.get(id) : undefined
      if (pending) {
        clearTimeout(pending.timer)
        this.pending.delete(id as string)
        pending.reject(runnerProtocolError())
      }
      return
    }
    const message = parsed.data
    if (message.type === 'event') {
      if (message.event.type === 'run.started') this.runActive = true
      if (['run.completed', 'run.failed', 'run.cancelled'].includes(message.event.type)) this.runActive = false
      this.onEvent(message.event)
      return
    }
    if (message.type === 'host-request') {
      void this.handleHostRequest(message)
      return
    }
    if (message.type !== 'response') return
    const pending = this.pending.get(message.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(message.id)
    if (message.ok) pending.resolve(message.data)
    else pending.reject(Object.assign(new Error(message.error?.message || 'Runner command failed'), message.error))
  }

  private async handleHostRequest(message: HostRequest): Promise<void> {
    const child = this.child
    if (!child?.connected) return
    try {
      if (!this.onHostRequest) throw Object.assign(new Error('Browser host is unavailable'), { code: 'BROWSER_HOST_UNAVAILABLE' })
      const data = await this.onHostRequest(message.action, message.payload)
      child.send?.(hostResponseSchema.parse({ type: 'host-response', id: message.id, ok: true, data }))
    } catch (error) {
      child.send?.(hostResponseSchema.parse({ type: 'host-response', id: message.id, ok: false, error: errorDetails(error) }))
    }
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null, error?: Error): void {
    const message = error?.message || `Runner exited (code=${code}, signal=${signal || 'none'})`
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(message))
    }
    this.pending.clear()
    this.child = null
    if (this.runActive) {
      this.runActive = false
      this.onEvent({ protocolVersion: 1, eventId: `runner_exit_${Date.now()}`, type: 'run.failed', timestamp: Date.now(), error: { code: 'RUNNER_PROCESS_INTERRUPTED', message: '执行进程意外退出，平台结果待核对；请勿重复提交。' } })
    }
  }

  command(command: RunnerCommandName, payload: UnknownRecord = {}): Promise<unknown> {
    const commandResult = runnerCommandNameSchema.safeParse(command)
    if (!commandResult.success) return Promise.reject(runnerProtocolError('Unknown runner command'))
    this.ensureStarted()
    this.sequence += 1
    const id = `cmd_${Date.now()}_${this.sequence}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Runner command timed out: ${command}`))
      }, this.timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.child?.send?.(runnerCommandSchema.parse({ type: 'command', id, command, payload }))
    })
  }

  start(tool: UnknownRecord): Promise<unknown> { return this.command('start', { tool }) }
  async preflight(tool: UnknownRecord): Promise<RunnerPreflightResult> {
    return runnerPreflightResultSchema.parse(await this.command('preflight', { tool }))
  }
  pause(): Promise<unknown> { return this.command('pause') }
  resume(): Promise<unknown> { return this.command('resume') }
  completeUserAction(): Promise<unknown> { return this.command('complete-user-action') }
  cancel(): Promise<unknown> { return this.command('cancel') }

  async stop(): Promise<void> {
    if (!this.child) return
    const child = this.child
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        this.command('shutdown'),
        new Promise<void>(resolve => { timer = setTimeout(resolve, 2000) }),
      ])
    } catch { /* Runner may already be gone. */ }
    finally { if (timer) clearTimeout(timer) }
    if (child.connected) child.disconnect()
    if (child.exitCode === null && child.signalCode === null) child.kill()
    await new Promise<void>((resolve, reject) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve()
        return
      }
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        clearTimeout(exitTimer)
        child.removeListener('exit', finish)
        resolve()
      }
      const exitTimer = setTimeout(() => {
        if (settled) return
        settled = true
        child.removeListener('exit', finish)
        reject(Object.assign(new Error('Runner process cleanup timed out'), { code: 'INSTALL_BUSY' }))
      }, 2000)
      child.once('exit', finish)
    })
    if (this.child === child) this.child = null
  }
}
