import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { probeObservationSchema, runPlanSchema } from '../../../src/shared/ipc/target-contract.js'
import type { BrowserSnapshot, TargetBrowserPort, TargetControlState, TemplateExchange, V2TemplateUiBinding } from './contracts.cjs'
import { TEMPLATE_API_PATHS, targetError } from './contracts.cjs'
import { targetHash } from './profile-policy.cjs'
import { resolveUiBinding } from './ui-bindings.cjs'
import { createV2Template } from './v2-template.cjs'

const id = z.string().min(1).max(128)
const control = z.object({ css: z.string().min(1).max(500), frameCss: z.string().min(1).max(500).optional(), framePath: z.string().startsWith('/').max(500).optional(),
  scopeCss: z.string().min(1).max(500).optional(), scopeMatch: z.object({ css: z.string().min(1).max(500), exactText: z.string().min(1).max(2000) }).strict().optional(),
  exactText: z.string().min(1).max(500).optional() }).strict()
const empty = z.object({}).strict()
export const targetControlStateSchema = z.object({
  tagName: z.string().min(1).max(30), text: z.string().max(2000), disabled: z.boolean(),
  value: z.string().max(1000).optional(), checked: z.boolean().optional(),
  options: z.array(z.object({ value: z.string().max(1000), text: z.string().max(2000), disabled: z.boolean() }).strict()).max(300).optional(),
}).strict()
export const targetVerificationSchema = z.object({
  templateId: z.number().int().positive(), name: z.string().min(1).max(100), ruleCount: z.number().int().min(1).max(12),
  verification: z.literal('same-object-list-and-details'), evidence: z.array(z.object({
    method: z.literal('POST'), path: z.enum(TEMPLATE_API_PATHS), httpStatus: z.number().int().min(200).max(299), code: z.literal(0),
  }).strict()).length(3),
}).strict()
export const targetRpcSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('inspect'), payload: empty }).strict(),
  z.object({ action: z.literal('readControl'), payload: z.object({ control }).strict() }).strict(),
  z.object({ action: z.literal('readControls'), payload: z.object({ control }).strict() }).strict(),
  z.object({ action: z.literal('waitForControl'), payload: z.object({ control }).strict() }).strict(),
  z.object({ action: z.literal('reload'), payload: empty }).strict(),
  z.object({ action: z.literal('click'), payload: z.object({ control }).strict() }).strict(),
  z.object({ action: z.literal('typeAndBlur'), payload: z.object({ control, value: z.string().max(1000) }).strict() }).strict(),
  z.object({ action: z.literal('select'), payload: z.object({ control, value: z.string().max(1000) }).strict() }).strict(),
  z.object({ action: z.literal('capture.begin'), payload: z.object({ captureId: id, path: z.enum(TEMPLATE_API_PATHS), match: z.object({ templateId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict().optional() }).strict() }).strict(),
  z.object({ action: z.literal('capture.finish'), payload: z.object({ captureId: id }).strict() }).strict(),
  z.object({ action: z.literal('capture.abort'), payload: z.object({ captureId: id }).strict() }).strict(),
  z.object({ action: z.literal('journal.beforeMutation'), payload: empty }).strict(),
  z.object({ action: z.literal('journal.verified'), payload: z.object({ receipt: targetVerificationSchema }).strict() }).strict(),
])
export type TargetRpc = z.infer<typeof targetRpcSchema>
export const targetRunRequestSchema = z.object({
  type: z.literal('run'), runId: id, plan: runPlanSchema, probe: probeObservationSchema,
  browserKind: z.enum(['owned-webcontents', 'fixture']),
}).strict()
export type TargetRunRequest = z.infer<typeof targetRunRequestSchema>
const errorSchema = z.object({ code: z.string().regex(/^TARGET_[A-Z0-9_]{1,80}$/), message: z.string().min(1).max(500) }).strict()
const rpcResultSchema = z.object({ type: z.literal('rpc-result'), runId: id, id, ok: z.boolean(), value: z.unknown().optional(), error: errorSchema.optional() }).strict()
export const targetWorkerMessageSchema = z.union([
  z.object({ type: z.literal('rpc'), runId: id, id, request: targetRpcSchema }).strict(),
  z.object({ type: z.literal('complete'), runId: id, ok: z.literal(true), receipt: targetVerificationSchema }).strict(),
  z.object({ type: z.literal('complete'), runId: id, ok: z.literal(false), error: errorSchema }).strict(),
])
export type TargetWorkerMessage = z.infer<typeof targetWorkerMessageSchema>
export function serialiseTargetError(error: unknown): { code: string; message: string } {
  const candidate = error as { code?: unknown; message?: unknown } | null
  const known = typeof candidate?.code === 'string' && /^TARGET_[A-Z0-9_]{1,80}$/.test(candidate.code)
  return { code: known ? String(candidate!.code) : 'TARGET_RUNNER_FAILED',
    message: known && typeof candidate?.message === 'string' ? candidate.message.slice(0, 500) : '目标任务中断，请核对本机记录和平台状态，勿重复提交。' }
}

/** Only local tests inject a binding resolver. The executable below never does. */
export class TargetRunnerWorker {
  private active: TargetRunRequest | null = null
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
  private disposed = false
  constructor(private readonly send: (message: TargetWorkerMessage) => void,
    private readonly bindingResolver: (adapterVersion: string) => V2TemplateUiBinding | undefined = resolveUiBinding,
    private readonly rpcTimeoutMs = 30000) {}

  accept(raw: unknown): void {
    if (this.disposed) return
    const response = rpcResultSchema.safeParse(raw)
    if (response.success) {
      if (response.data.runId !== this.active?.runId) return
      const waiting = this.pending.get(response.data.id)
      if (!waiting) return
      clearTimeout(waiting.timer); this.pending.delete(response.data.id)
      if (response.data.ok) waiting.resolve(response.data.value)
      else waiting.reject(targetError(response.data.error?.code || 'TARGET_HOST_FAILED', response.data.error?.message || '主进程操作失败。'))
      return
    }
    const start = targetRunRequestSchema.safeParse(raw)
    if (!start.success) return
    if (this.active) {
      this.send({ type: 'complete', runId: start.data.runId, ok: false, error: { code: 'TARGET_RUNNER_BUSY', message: '同一 Runner 不能同时执行两个任务。' } })
      return
    }
    this.active = start.data
    void this.execute(start.data)
  }

  private rpc(request: TargetRpc): Promise<unknown> {
    if (!this.active || this.disposed) return Promise.reject(targetError('TARGET_RUNNER_INTERRUPTED', '执行已中断。'))
    const runId = this.active.runId
    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(targetError('TARGET_HOST_TIMEOUT', '主进程操作超时，结果需核对。')) }, this.rpcTimeoutMs)
      this.pending.set(requestId, { resolve, reject, timer })
      try { this.send({ type: 'rpc', runId, id: requestId, request }) } catch {
        clearTimeout(timer); this.pending.delete(requestId); reject(targetError('TARGET_RUNNER_INTERRUPTED', '主进程连接中断。'))
      }
    })
  }

  private async execute(request: TargetRunRequest): Promise<void> {
    try {
      const { plan, probe } = request
      if (plan.contextHash !== targetHash(plan.context) || plan.inputHash !== targetHash(plan.input)
        || Date.parse(plan.expiresAt) <= Date.now() || Date.parse(plan.createdAt) > Date.now() + 5000
        || plan.context.courseRef !== probe.courseRef || plan.context.shopRef !== probe.shopRef
        || plan.context.localAccountRef !== probe.localAccountRef || plan.context.role !== probe.role
        || probe.kind !== 'matched' || probe.version !== 'v2' || probe.missing.length) {
        throw targetError('TARGET_PLAN_MISMATCH', '计划已过期、内容改变或与当前现场不匹配。')
      }
      const binding = this.bindingResolver(plan.adapterVersion)
      if (!binding || (request.browserKind !== 'fixture' && binding.verificationLevel !== 'audited-ui')) {
        throw targetError('TARGET_UI_EVIDENCE_MISSING', '尚缺经审核的 V2 页面绑定，未执行页面动作。')
      }
      const browser: TargetBrowserPort = {
        kind: request.browserKind,
        inspect: async () => await this.rpc({ action: 'inspect', payload: {} }) as BrowserSnapshot,
        readControl: async control => targetControlStateSchema.parse(await this.rpc({ action: 'readControl', payload: { control } })) as TargetControlState,
        readControls: async control => z.array(targetControlStateSchema).max(100).parse(await this.rpc({ action: 'readControls', payload: { control } })) as TargetControlState[],
        waitForControl: async control => targetControlStateSchema.parse(await this.rpc({ action: 'waitForControl', payload: { control } })) as TargetControlState,
        click: async control => { await this.rpc({ action: 'click', payload: { control } }) },
        typeAndBlur: async (control, value) => { await this.rpc({ action: 'typeAndBlur', payload: { control, value } }) },
        select: async (control, value) => { await this.rpc({ action: 'select', payload: { control, value } }) },
        reload: async () => { await this.rpc({ action: 'reload', payload: {} }) },
        dispose: () => undefined, // Browser ownership remains in the main process.
        captureResponse: async (path, action, match) => {
          const captureId = randomUUID()
          await this.rpc({ action: 'capture.begin', payload: { captureId, path, ...(match ? { match } : {}) } })
          try {
            await action()
            return await this.rpc({ action: 'capture.finish', payload: { captureId } }) as TemplateExchange
          } catch (error) {
            await this.rpc({ action: 'capture.abort', payload: { captureId } }).catch(() => undefined)
            throw error
          }
        },
      }
      const receipt = await createV2Template(browser, probe, plan.input, {
        beforeMutation: async () => { await this.rpc({ action: 'journal.beforeMutation', payload: {} }) },
        verified: async receipt => { await this.rpc({ action: 'journal.verified', payload: { receipt } }) },
      }, binding)
      if (!this.disposed) this.send({ type: 'complete', runId: request.runId, ok: true, receipt: targetVerificationSchema.parse(receipt) })
    } catch (error) {
      if (!this.disposed) this.send({ type: 'complete', runId: request.runId, ok: false, error: serialiseTargetError(error) })
    } finally { this.active = null }
  }

  dispose(): void {
    this.disposed = true
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(targetError('TARGET_RUNNER_INTERRUPTED', '执行进程已关闭。')) }
    this.pending.clear()
  }
}

if (require.main === module) {
  const worker = new TargetRunnerWorker(message => { if (process.connected) process.send?.(message) })
  process.on('message', message => worker.accept(message))
  process.once('disconnect', () => { worker.dispose(); process.exit(0) })
}
