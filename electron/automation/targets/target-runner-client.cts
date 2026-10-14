import { fork, type ChildProcess } from 'node:child_process'
import { AsyncResource } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { RunPlan, ProbeObservation } from '../../../src/shared/ipc/target-contract.js'
import type { TargetBrowserPort, TargetControl, TemplateExchange, HostTemplateJournal, TemplateVerification } from './contracts.cjs'
import { targetError } from './contracts.cjs'
import { resolveReadOnlyControls, resolveReadableControls, sameTargetControl, isCompiledTargetControl, isCompiledSubmitControl } from './ui-bindings.cjs'
import { targetRunRequestSchema, targetWorkerMessageSchema, serialiseTargetError, targetVerificationSchema, targetControlStateSchema, type TargetRpc } from './target-runner.cjs'

interface ClientOptions {
  scriptPath?: string; timeoutMs?: number; drainTimeoutMs?: number; forkFn?: typeof fork
  /** Test injection is ignored for real WebContents; no environment/IPC override exists. */
  fixtureReadOnlyControls?: readonly TargetControl[]
  fixtureReadableControls?: readonly TargetControl[]
  fixtureSubmitControls?: readonly TargetControl[]
}
interface Capture { finish: () => void; abort: (error: Error) => void; promise: Promise<TemplateExchange> }
interface ActiveRun {
  id: string; child: ChildProcess; plan: RunPlan; browser: TargetBrowserPort; journal: HostTemplateJournal
  captures: Map<string, Capture>; operations: Set<Promise<void>>; requests: Set<string>; timer: NodeJS.Timeout
  resolve: (receipt: TemplateVerification) => void; reject: (error: Error) => void; finishing: boolean
  mutationRecorded: boolean; verified: TemplateVerification | null
  readOnlyControls: readonly TargetControl[]; drain: Promise<void> | null; journalling: boolean
  readableControls: readonly TargetControl[]
  submitRequested: boolean; submissionRecorded: boolean
}

/** Owns only the child process. The main controller retains browser and lease. */
export class TargetRunnerClient {
  private active: ActiveRun | null = null
  private disposed = false
  constructor(private readonly options: ClientOptions = {}) {}
  get isDraining(): boolean { return !!this.active?.finishing }
  whenDrained(): Promise<void> { return this.active?.drain || Promise.resolve() }

  run(plan: RunPlan, probe: ProbeObservation, ports: { browser: TargetBrowserPort; journal: HostTemplateJournal }): Promise<TemplateVerification> {
    if (this.disposed) return Promise.reject(targetError('TARGET_RUNNER_CLOSED', 'Runner 已关闭。'))
    if (this.active) return Promise.reject(targetError('TARGET_RUNNER_BUSY', '另一个目标任务尚未结束。'))
    const id = randomUUID()
    const request = targetRunRequestSchema.parse({ type: 'run', runId: id, plan, probe, browserKind: ports.browser.kind })
    return new Promise((resolve, reject) => {
      let child: ChildProcess
      try {
        child = (this.options.forkFn || fork)(this.options.scriptPath || join(__dirname, 'target-runner.cjs'), [], {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        })
      } catch { reject(targetError('TARGET_RUNNER_START_FAILED', '执行进程启动失败。')); return }
      const active: ActiveRun = { id, child, plan: request.plan, ...ports, captures: new Map(), operations: new Set(), requests: new Set(),
        resolve, reject, finishing: false, mutationRecorded: false, verified: null, submitRequested: false, submissionRecorded: false,
        readOnlyControls: ports.browser.kind === 'fixture' && this.options.fixtureReadOnlyControls ? this.options.fixtureReadOnlyControls : resolveReadOnlyControls(request.plan.adapterVersion),
        readableControls: ports.browser.kind === 'fixture' && this.options.fixtureReadableControls ? this.options.fixtureReadableControls : resolveReadableControls(request.plan.adapterVersion),
        drain: null, journalling: false,
        timer: setTimeout(() => { void this.finish(active, undefined, targetError('TARGET_RUNNER_TIMEOUT', '执行超时，平台结果需核对。')) }, this.options.timeoutMs || 120000) }
      this.active = active
      // Native IPC callbacks belong to the child-process resource, not reliably
      // to this controller operation's AsyncLocalStorage lease/epoch. Preserve
      // the run context; an in-process queueMicrotask fixture hides this loss.
      child.on('message', AsyncResource.bind(raw => this.message(active, raw)))
      child.once('error', AsyncResource.bind(() => { void this.finish(active, undefined, targetError('TARGET_RUNNER_INTERRUPTED', '执行进程异常，结果需核对。')) }))
      child.once('exit', AsyncResource.bind(() => { void this.finish(active, undefined, targetError('TARGET_RUNNER_INTERRUPTED', '执行进程退出，结果需核对。')) }))
      child.once('disconnect', AsyncResource.bind(() => { void this.finish(active, undefined, targetError('TARGET_RUNNER_INTERRUPTED', '执行进程连接中断，结果需核对。')) }))
      try { child.send?.(request) } catch { void this.finish(active, undefined, targetError('TARGET_RUNNER_START_FAILED', '无法发送执行计划。')) }
    })
  }

  private message(active: ActiveRun, raw: unknown): void {
    if (this.active !== active || active.finishing) return
    const parsed = targetWorkerMessageSchema.safeParse(raw)
    if (!parsed.success || parsed.data.runId !== active.id) {
      void this.finish(active, undefined, targetError('TARGET_RUNNER_PROTOCOL_INVALID', '执行进程消息不符合约定，已停止。')); return
    }
    const message = parsed.data
    if (message.type === 'complete') {
      if (message.ok === false) { void this.finish(active, undefined, targetError(message.error.code, message.error.message)); return }
      if (!active.verified || JSON.stringify(active.verified) !== JSON.stringify(message.receipt)) {
        void this.finish(active, undefined, targetError('TARGET_VERIFY_PROOF_REQUIRED', '没有已持久保存的同对象核验结果。')); return
      }
      void this.finish(active, message.receipt); return
    }
    if (active.requests.has(message.id) || active.requests.size >= 1000) {
      void this.finish(active, undefined, targetError('TARGET_RUNNER_PROTOCOL_INVALID', '执行请求重复或超过本次任务范围。')); return
    }
    active.requests.add(message.id)
    const operation = (async () => {
      try {
        const value = await this.dispatch(active, message.request)
        if (!active.finishing && active.child.connected) active.child.send?.({ type: 'rpc-result', runId: active.id, id: message.id, ok: true, value })
      } catch (error) {
        if (!active.finishing && active.child.connected) active.child.send?.({ type: 'rpc-result', runId: active.id, id: message.id, ok: false, error: serialiseTargetError(error) })
      }
    })()
    active.operations.add(operation)
    void operation.finally(() => active.operations.delete(operation)).catch(() => undefined)
  }

  private async dispatch(active: ActiveRun, request: TargetRpc): Promise<unknown> {
    if (active.finishing) throw targetError('TARGET_RUNNER_CANCELLED', '任务已取消，不能继续操作。')
    const approved = (action: 'read' | 'readonly-click' | 'click' | 'type' | 'select', control: TargetControl): boolean => isCompiledTargetControl(active.plan.adapterVersion, control, action)
    const canRead = request.action === 'click' && (active.readOnlyControls.some(control => sameTargetControl(control, request.payload.control)) || approved('readonly-click', request.payload.control))
    if (['click', 'typeAndBlur', 'select'].includes(request.action) && !canRead && !active.mutationRecorded) {
      throw targetError('TARGET_MUTATION_MARKER_REQUIRED', '尚未持久保存恢复标记，禁止修改页面。')
    }
    if (active.browser.kind !== 'fixture' && (request.action === 'typeAndBlur' || request.action === 'click' || request.action === 'select')) {
      const action = request.action === 'typeAndBlur' ? 'type' : request.action
      if (!canRead && !approved(action, request.payload.control)) throw targetError('TARGET_CONTROL_NOT_APPROVED', '操作不在本工具已审核的界面绑定中。')
    }
    switch (request.action) {
      case 'inspect': return active.browser.inspect()
      case 'readControl': {
        if (!active.readableControls.some(control => sameTargetControl(control, request.payload.control)) && !approved('read', request.payload.control)) throw targetError('TARGET_CONTROL_NOT_APPROVED', '读取字段不在本工具已审核的界面绑定中。')
        return targetControlStateSchema.parse(await active.browser.readControl(request.payload.control))
      }
      case 'waitForControl': {
        if (!active.readableControls.some(control => sameTargetControl(control, request.payload.control)) && !approved('read', request.payload.control)) throw targetError('TARGET_CONTROL_NOT_APPROVED', '等待字段不在本工具已审核的界面绑定中。')
        return targetControlStateSchema.parse(await active.browser.waitForControl(request.payload.control))
      }
      case 'readControls': {
        if (!active.readableControls.some(control => sameTargetControl(control, request.payload.control)) && !approved('read', request.payload.control)) throw targetError('TARGET_CONTROL_NOT_APPROVED', '读取字段不在本工具已审核的界面绑定中。')
        const states = await active.browser.readControls(request.payload.control)
        if (!Array.isArray(states) || states.length > 100) throw targetError('TARGET_CONTROL_TOO_LARGE', '页面字段数量超过本工具读取范围。')
        return states.map(state => targetControlStateSchema.parse(state))
      }
      case 'click': {
        const isSubmit = isCompiledSubmitControl(active.plan.adapterVersion, request.payload.control)
          || (active.browser.kind === 'fixture' && this.options.fixtureSubmitControls?.some(control => sameTargetControl(control, request.payload.control)))
        if (isSubmit) {
          if (active.submitRequested || active.journalling) throw targetError('TARGET_SUBMIT_ALREADY_ATTEMPTED', '本次保存已经进入提交边界，不能重复点击。')
          active.submitRequested = true
          active.journalling = true
          try {
            // Only the main process can advance prepared -> submitting, directly
            // before the one audited business-save click. No RPC may assert it.
            await active.journal.beforeSubmit()
            active.submissionRecorded = true
            if (active.finishing) throw targetError('TARGET_RUNNER_CANCELLED', '提交标记完成前任务已经停止，未继续点击保存。')
          } finally { active.journalling = false }
        }
        return active.browser.click(request.payload.control)
      }
      case 'typeAndBlur': return active.browser.typeAndBlur(request.payload.control, request.payload.value)
      case 'select': return active.browser.select(request.payload.control, request.payload.value)
      case 'reload': return active.browser.reload()
      case 'journal.beforeMutation':
        if (active.mutationRecorded || active.journalling) throw targetError('TARGET_JOURNAL_DUPLICATE', '本次写入标记已经保存或正在保存。')
        active.journalling = true
        try { await active.journal.beforeMutation(); active.mutationRecorded = true; return { saved: true } }
        finally { active.journalling = false }
      case 'journal.verified': {
        const receipt = targetVerificationSchema.parse(request.payload.receipt)
        if (!active.mutationRecorded || !active.submissionRecorded || active.journalling || active.verified || receipt.name !== active.plan.input.name || receipt.ruleCount !== active.plan.input.rules.length) throw targetError('TARGET_VERIFY_PROOF_REQUIRED', '结果不属于本次提交计划或正在写入。')
        active.journalling = true
        try {
          await active.journal.verified(receipt)
          if (active.finishing) throw targetError('TARGET_RUNNER_CANCELLED', '核验写入期间执行已停止，不能作为 Runner 成功。')
          active.verified = receipt; return { saved: true }
        } finally { active.journalling = false }
      }
      case 'capture.begin': {
        if (request.payload.match && request.payload.path !== '/ECrossAmazon/GetFeightRelationList') throw targetError('TARGET_CAPTURE_MATCH_INVALID', '只有模板详情允许按同对象 ID 匹配请求。')
        if (active.captures.size) throw targetError('TARGET_CAPTURE_BUSY', '本任务已有未结束的响应采集。')
        let readyResolve!: () => void
        let readyReject!: (error: unknown) => void
        let finish!: () => void
        let abort!: (error: Error) => void
        const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject })
        const action = new Promise<void>((resolve, reject) => { finish = resolve; abort = reject })
        void action.catch(() => undefined)
        // The callback runs only after the real port has installed its listener.
        const promise = active.browser.captureResponse(request.payload.path, async () => { readyResolve(); await action }, request.payload.match)
        void promise.catch(readyReject)
        active.captures.set(request.payload.captureId, { finish, abort, promise })
        await ready
        return { ready: true }
      }
      case 'capture.finish': {
        const capture = active.captures.get(request.payload.captureId)
        if (!capture) throw targetError('TARGET_CAPTURE_MISSING', '不存在本次响应采集。')
        capture.finish()
        try { return await capture.promise } finally { active.captures.delete(request.payload.captureId) }
      }
      case 'capture.abort': {
        const capture = active.captures.get(request.payload.captureId)
        if (capture) {
          capture.abort(targetError('TARGET_CAPTURE_ABORTED', '页面动作失败，响应采集已关闭。'))
          await capture.promise.catch(() => undefined)
          active.captures.delete(request.payload.captureId)
        }
        return { aborted: true }
      }
    }
  }

  private async finish(active: ActiveRun, receipt?: TemplateVerification, error?: Error): Promise<void> {
    if (active.finishing) return
    active.finishing = true
    clearTimeout(active.timer)
    const interrupted = error || targetError('TARGET_CAPTURE_ABORTED', '任务已经结束。')
    for (const capture of active.captures.values()) capture.abort(interrupted)
    try { active.child.kill() } catch { /* Already disconnected. */ }
    // Retain the caller's execution lease until in-flight host operations have
    // settled. A child exit cannot make a half-finished UI mutation retryable.
    active.drain = (async () => {
      await Promise.allSettled([...active.captures.values()].map(capture => capture.promise))
      await Promise.allSettled([...active.operations])
      active.captures.clear()
      if (this.active === active) this.active = null
    })()
    let timer: NodeJS.Timeout | undefined
    const drained = await Promise.race([active.drain.then(() => true), new Promise<false>(resolve => {
      timer = setTimeout(() => resolve(false), this.options.drainTimeoutMs || 5000)
    })])
    if (timer) clearTimeout(timer)
    if (!drained) { active.reject(targetError('TARGET_HOST_DRAIN_TIMEOUT', '本机页面操作仍在退出中，执行锁保持占用；请勿重试。')); return }
    if (error) active.reject(error)
    else if (receipt) active.resolve(receipt)
    else active.reject(interrupted)
  }

  cancel(): void { if (this.active) void this.finish(this.active, undefined, targetError('TARGET_RUNNER_CANCELLED', '执行已停止，已发生的操作需按记录核对。')) }
  dispose(): void { this.disposed = true; this.cancel() }
}
