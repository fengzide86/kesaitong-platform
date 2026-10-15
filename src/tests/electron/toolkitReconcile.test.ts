import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { RuntimeContext } from '@/shared/ipc/toolkit-contract'
import type { ToolStages, ToolkitHost } from '../../../electron/automation/toolkit-runtime.cjs'

const require = createRequire(resolve('dist-electron/electron/automation/toolkit-runtime.cjs'))
const { ToolkitRuntime } = require('./toolkit-runtime.cjs') as typeof import('../../../electron/automation/toolkit-runtime.cjs')
const { ExecutionLease } = require('./execution-lease.cjs') as typeof import('../../../electron/automation/execution-lease.cjs')

describe('reconciliation identity fence', () => {
  it.each(['reconcile', 'verify'] as const)('retains unknown result if context changes during %s', async phase => {
    const context: RuntimeContext = { schemaVersion: 1, principal: { kind: 'customer', id: 'A' }, siteOrigin: 'https://fixture.test',
      accountSlot: 'one', localAccountRef: 'a'.repeat(64), projectRef: 'project-A', mode: 'training', policyRevision: 'v1' }
    const tool: ToolStages<number, number, number, number> = {
      descriptor: { schemaVersion: 1, id: 'fixture.reconcile', version: '1.0.0', capability: 'fixture', effect: 'write',
        supportedModes: ['training'], phases: ['detect', 'read', 'plan', 'execute', 'verify', 'reconcile'] },
      input: z.number(), result: z.number(), detect: async () => ({ ...context }), read: async (_ctx, input) => input,
      plan: async (_ctx, _input, data) => data,
      execute: vi.fn(async () => { throw new Error('unknown submission result') }),
      reconcile: vi.fn(async () => { if (phase === 'reconcile') context.policyRevision = 'v2'; return 1 }),
      verify: vi.fn(async () => { if (phase === 'verify') context.projectRef = 'project-B'; return true }),
    }
    const host: ToolkitHost = { lease: new ExecutionLease(), authorize: async () => {}, saveIntent: async () => {}, saveResult: vi.fn(async () => {}) }
    const runtime = new ToolkitRuntime(tool, host)
    const { operationId } = await runtime.prepare(1)
    expect(await runtime.execute(operationId)).toEqual({ status: 'needs_review', operationId })
    await expect(runtime.reconcile(operationId)).rejects.toThrow('TOOL_CONTEXT_CHANGED')
    expect(host.saveResult).toHaveBeenCalledExactlyOnceWith(operationId, 'needs_review')
    expect(tool.execute).toHaveBeenCalledOnce()
    await expect(runtime.execute(operationId)).rejects.toThrow('TOOL_PLAN_INVALID')
    // The rejected reconciliation must release the common lease as well.
    const permit = host.lease.acquire()
    permit.release()
  })
})
