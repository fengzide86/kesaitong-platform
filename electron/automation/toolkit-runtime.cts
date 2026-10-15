import { createHash, randomUUID } from 'node:crypto'
import type { z } from 'zod'
import { runtimeContextSchema, toolDescriptorSchema, type RuntimeContext, type RuntimeResult, type ToolDescriptor } from '../../src/shared/ipc/toolkit-contract.js'
import type { ExecutionLease } from './execution-lease.cjs'

export interface ToolStages<I, D, P, R> {
  descriptor: ToolDescriptor
  input: z.ZodType<I>
  result: z.ZodType<R>
  detect(): Promise<RuntimeContext>
  read(context: RuntimeContext, input: I): Promise<D>
  plan(context: RuntimeContext, input: I, data: D): Promise<P>
  execute(context: RuntimeContext, input: I, plan: P, beforeMutation: () => Promise<void>): Promise<R>
  verify(context: RuntimeContext, input: I, plan: P, result: R): Promise<boolean>
  /** Read-only, same-object verification; never resubmit as a recovery action. */
  reconcile(context: RuntimeContext, input: I, plan: P, result?: R): Promise<R | null>
}
export interface ToolkitHost {
  lease: ExecutionLease
  authorize(context: RuntimeContext, descriptor: ToolDescriptor): Promise<void>
  saveIntent(operationId: string, context: RuntimeContext): Promise<void>
  saveResult(operationId: string, state: 'verified' | 'needs_review', result?: unknown): Promise<void>
}
type Pending<I, P, R> = { context: RuntimeContext; input: I; plan: P; createdAt: number; attempted: boolean; result?: R }
const digest = (value: RuntimeContext): string => createHash('sha256').update(JSON.stringify(runtimeContextSchema.parse(value))).digest('hex')

/** Reviewed compiled code only. This registry never evaluates remote scripts,
 * selectors, JS expressions or renderer-provided execution functions. */
export class ToolkitRuntime<I, D, P, R> {
  private plans = new Map<string, Pending<I, P, R>>()
  constructor(private readonly tool: ToolStages<I, D, P, R>, private readonly host: ToolkitHost) {
    toolDescriptorSchema.parse(tool.descriptor)
  }
  async prepare(rawInput: unknown): Promise<{ operationId: string; plan: P }> {
    const permit = this.host.lease.acquire()
    try {
      const input = this.tool.input.parse(rawInput)
      const context = runtimeContextSchema.parse(await this.tool.detect())
      await this.authorize(context)
      permit.assert()
      const data = await this.tool.read(context, input)
      const plan = await this.tool.plan(context, input, data)
      await this.sameContext(context)
      permit.assert()
      const operationId = randomUUID()
      this.plans.set(operationId, { context, input, plan, createdAt: Date.now(), attempted: false })
      return { operationId, plan }
    } finally { permit.release() }
  }
  private async authorize(context: RuntimeContext): Promise<void> {
    if (context.mode === 'local' && this.tool.descriptor.effect !== 'calculation') throw new Error('TOOL_LOCAL_WRITE_FORBIDDEN')
    if (!this.tool.descriptor.supportedModes.includes(context.mode)) throw new Error('TOOL_SCENARIO_NOT_REVIEWED')
    await this.host.authorize(context, this.tool.descriptor)
  }
  private async sameContext(expected: RuntimeContext): Promise<void> {
    const current = runtimeContextSchema.parse(await this.tool.detect())
    if (digest(expected) !== digest(current)) throw new Error('TOOL_CONTEXT_CHANGED: 账号、项目、站点或策略已变化，请重新生成计划')
    await this.authorize(current)
  }
  async execute(operationId: string): Promise<RuntimeResult<R>> {
    const pending = this.plans.get(operationId)
    if (!pending || pending.attempted || Date.now() - pending.createdAt > 600_000) throw new Error('TOOL_PLAN_INVALID')
    const permit = this.host.lease.acquire()
    let armed = false
    try {
      await this.sameContext(pending.context)
      permit.assert()
      pending.attempted = true
      const beforeMutation = async (): Promise<void> => {
        await this.sameContext(pending.context)
        permit.assert()
        if (!armed) await this.host.saveIntent(operationId, pending.context)
        armed = true
        permit.assert()
      }
      // A write adapter may only act after a durable host intent. Calling this
      // once here also protects an imperfect adapter that forgets its callback.
      if (this.tool.descriptor.effect === 'write') await beforeMutation()
      pending.result = this.tool.result.parse(await this.tool.execute(pending.context, pending.input, pending.plan, beforeMutation))
      await this.sameContext(pending.context)
      permit.assert()
      if (!await this.tool.verify(pending.context, pending.input, pending.plan, pending.result)) throw new Error('TOOL_RESULT_UNVERIFIED')
      await this.sameContext(pending.context)
      permit.assert()
      await this.host.saveResult(operationId, 'verified', pending.result)
      this.plans.delete(operationId)
      return { status: 'verified', result: pending.result }
    } catch (error) {
      if (!armed) { this.plans.delete(operationId); throw error }
      await this.host.saveResult(operationId, 'needs_review')
      return { status: 'needs_review', operationId }
    } finally { permit.release() }
  }
  async reconcile(operationId: string): Promise<RuntimeResult<R>> {
    const pending = this.plans.get(operationId)
    if (!pending?.attempted) throw new Error('TOOL_RECONCILIATION_MISSING')
    const permit = this.host.lease.acquire()
    try {
      await this.sameContext(pending.context)
      const result = await this.tool.reconcile(pending.context, pending.input, pending.plan, pending.result)
      await this.sameContext(pending.context)
      permit.assert()
      if (result === null) return { status: 'needs_review', operationId }
      const checked = this.tool.result.parse(result)
      if (!await this.tool.verify(pending.context, pending.input, pending.plan, checked)) return { status: 'needs_review', operationId }
      await this.sameContext(pending.context)
      permit.assert()
      await this.host.saveResult(operationId, 'verified', checked)
      this.plans.delete(operationId)
      return { status: 'verified', result: checked }
    } finally { permit.release() }
  }
}
