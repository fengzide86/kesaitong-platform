import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { ScenarioPolicy } from '../../shared/ipc/scenario-contract'
import { scenarioAllows, scenarioOrigin, scenarioPolicySchema } from '../../shared/ipc/scenario-contract'
import type { RuntimeContext } from '../../shared/ipc/toolkit-contract'
import type { ToolStages, ToolkitHost } from '../../../electron/automation/toolkit-runtime.cjs'

const require = createRequire(resolve('dist-electron/electron/automation/scenario-policy-client.cjs'))
const { ScenarioPolicyClient } = require('./scenario-policy-client.cjs') as typeof import('../../../electron/automation/scenario-policy-client.cjs')
const { ToolkitRuntime } = require('./toolkit-runtime.cjs') as typeof import('../../../electron/automation/toolkit-runtime.cjs')
const { ExecutionLease } = require('./execution-lease.cjs') as typeof import('../../../electron/automation/execution-lease.cjs')
const clients: InstanceType<typeof ScenarioPolicyClient>[] = []
afterEach(() => { for (const client of clients.splice(0)) client.reset(); vi.useRealTimers() })

function policy(changes: Partial<ScenarioPolicy> = {}): ScenarioPolicy {
  return { schemaVersion: 1, principal: { kind: 'customer', id: 'customer-A' }, revision: 'v1', status: 'active', mode: 'competition',
    entryUrl: 'https://www.idtrade.cn/User/Contest', allowedOrigins: ['https://www.idtrade.cn'], maxScenes: 1,
    checkedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(), refreshAfterSeconds: 30, ...changes }
}

describe('authoritative scenario policy', () => {
  it('compares scheme host and port exactly and permits normal in-site paths', () => {
    expect(scenarioOrigin('https://WWW.IDTRADE.CN:443/User/Contest')).toBe('https://www.idtrade.cn')
    expect(scenarioAllows(policy(), 'https://www.idtrade.cn/any/course/path?q=1')).toBe(true)
    for (const raw of ['http://www.idtrade.cn', 'https://www.idtrade.cn:444', 'https://www.idtrade.cn.evil.test', 'https://sub.www.idtrade.cn', 'https://u:p@www.idtrade.cn', 'https://www.idtrade.cn\\@evil.test', 'javascript:alert(1)']) expect(scenarioAllows(policy(), raw)).toBe(false)
    expect(scenarioPolicySchema.safeParse(policy({ maxScenes: 6 })).success).toBe(false)
    expect(scenarioPolicySchema.safeParse(policy({ principal: { kind: 'staff', id: '1' }, status: 'unassigned' })).success).toBe(false)
  })
  it('only an explicit unassigned customer policy preserves unrestricted legacy training', async () => {
    const load = vi.fn(async () => policy({ status: 'unassigned', mode: 'training', entryUrl: null, allowedOrigins: [], expiresAt: null }))
    const invalidated = vi.fn(); const client = new ScenarioPolicyClient(load, invalidated); clients.push(client)
    expect(client.allows('https://training.test')).toBe(false)
    await client.refresh('token-A')
    expect(client.allows('https://training.test')).toBe(true)
    load.mockRejectedValueOnce(new Error('network disconnected'))
    await expect(client.refresh('token-A')).rejects.toThrow('network')
    expect(client.allows('https://training.test')).toBe(false)
    expect(invalidated).toHaveBeenCalledOnce()
  })
  it('rechecks at 30 seconds and invalidates revision changes while retaining fail-closed expiry', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-15T10:00:00Z'))
    const load = vi.fn(async () => policy()); const invalidated = vi.fn()
    const client = new ScenarioPolicyClient(load, invalidated); clients.push(client)
    await client.refresh('one')
    load.mockResolvedValueOnce(policy({ revision: 'v2', status: 'blocked' }))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(load).toHaveBeenCalledTimes(2)
    expect(invalidated).toHaveBeenCalled()
    expect(client.allows('https://www.idtrade.cn')).toBe(false)
  })
  it('an old in-flight identity cannot replace the new session policy', async () => {
    let finish!: (value: unknown) => void
    const old = new Promise<unknown>(resolve => { finish = resolve })
    const load = vi.fn((token: string) => token === 'old' ? old : Promise.resolve(policy({ principal: { kind: 'customer', id: 'B' } })))
    const client = new ScenarioPolicyClient(load, vi.fn()); clients.push(client)
    const pending = client.refresh('old'); const rejected = expect(pending).rejects.toThrow('SCENARIO_SESSION_CHANGED')
    await client.refresh('new'); finish(policy()); await rejected
    expect(client.current().principal.id).toBe('B')
  })
})

function fixture(effect: 'write' | 'calculation' = 'write') {
  const context: RuntimeContext = { schemaVersion: 1, principal: { kind: 'customer', id: 'A' }, siteOrigin: 'https://fixture.test', accountSlot: 'one',
    localAccountRef: 'a'.repeat(64), projectRef: 'course-A', mode: 'training', policyRevision: 'v1' }
  const tool: ToolStages<number, number, number, number> = {
    descriptor: { schemaVersion: 1, id: 'fixture.tool', version: '1.0.0', capability: 'fixture', effect, supportedModes: ['training'], phases: ['detect', 'read', 'plan', 'execute', 'verify', 'reconcile'] },
    input: z.number().positive(), result: z.number(), detect: vi.fn(async () => ({ ...context })), read: vi.fn(async (_ctx, input) => input),
    plan: vi.fn(async (_ctx, _input, data) => data * 2), execute: vi.fn(async (_ctx, _input, plan, before) => { if (effect === 'write') await before(); return plan }),
    verify: vi.fn(async (_ctx, _input, plan, result) => plan === result), reconcile: vi.fn(async () => null),
  }
  const host: ToolkitHost = { lease: new ExecutionLease(), authorize: vi.fn(async () => {}), saveIntent: vi.fn(async () => {}), saveResult: vi.fn(async () => {}) }
  return { context, tool, host, runtime: new ToolkitRuntime(tool, host) }
}

describe('versioned six-stage tool contract', () => {
  it('runs a calculation without any mutation intent and verifies its result', async () => {
    const test = fixture('calculation'); const prepared = await test.runtime.prepare(4)
    expect(await test.runtime.execute(prepared.operationId)).toEqual({ status: 'verified', result: 8 })
    expect(test.host.saveIntent).not.toHaveBeenCalled()
    expect(test.host.saveResult).toHaveBeenCalledWith(prepared.operationId, 'verified', 8)
    await expect(test.runtime.execute(prepared.operationId)).rejects.toThrow('TOOL_PLAN_INVALID')
  })
  it('rejects changed account, course, policy and site plans before write', async () => {
    for (const field of ['localAccountRef', 'projectRef', 'policyRevision', 'siteOrigin'] as const) {
      const test = fixture(); const prepared = await test.runtime.prepare(2)
      test.context[field] = field === 'localAccountRef' ? 'b'.repeat(64) : field === 'siteOrigin' ? 'https://changed.test' : 'changed'
      await expect(test.runtime.execute(prepared.operationId)).rejects.toThrow('TOOL_CONTEXT_CHANGED')
      expect(test.tool.execute).not.toHaveBeenCalled(); expect(test.host.saveIntent).not.toHaveBeenCalled()
    }
  })
  it('persists intent before writes and never blindly repeats an unknown result', async () => {
    const test = fixture(); const order: string[] = []
    vi.mocked(test.host.saveIntent).mockImplementation(async () => { order.push('intent') })
    vi.mocked(test.tool.execute).mockImplementation(async () => { order.push('submit'); throw new Error('result timed out') })
    const plan = await test.runtime.prepare(2)
    expect(await test.runtime.execute(plan.operationId)).toEqual({ status: 'needs_review', operationId: plan.operationId })
    expect(order).toEqual(['intent', 'submit'])
    await expect(test.runtime.execute(plan.operationId)).rejects.toThrow('TOOL_PLAN_INVALID')
    expect(await test.runtime.reconcile(plan.operationId)).toEqual({ status: 'needs_review', operationId: plan.operationId })
    vi.mocked(test.tool.reconcile).mockResolvedValueOnce(4)
    expect(await test.runtime.reconcile(plan.operationId)).toEqual({ status: 'verified', result: 4 })
    expect(test.tool.execute).toHaveBeenCalledOnce()
  })
  it('shares the one active runner lease and refuses unreviewed competition tools', async () => {
    const test = fixture(); const permit = test.host.lease.acquire()
    await expect(test.runtime.prepare(1)).rejects.toMatchObject({ code: 'RUN_ALREADY_ACTIVE' })
    permit.release(); test.context.mode = 'competition'
    await expect(test.runtime.prepare(1)).rejects.toThrow('TOOL_SCENARIO_NOT_REVIEWED')
  })
  it('does not call the adapter when durable intent persistence fails', async () => {
    const test = fixture(); const plan = await test.runtime.prepare(1)
    vi.mocked(test.host.saveIntent).mockRejectedValue(new Error('disk unavailable'))
    await expect(test.runtime.execute(plan.operationId)).rejects.toThrow('disk unavailable')
    expect(test.tool.execute).not.toHaveBeenCalled()
  })
})
