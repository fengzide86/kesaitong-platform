import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { DesktopFreightController } from '../../../electron/freight/desktop-freight-controller.cjs'
import type { FreightRatePack } from '../../shared/freight/types'
import type { TrustedHandleRegistrar } from '../../../electron/ipc/trusted-ipc.cjs'
import { quoteFreight } from '../../shared/freight/rate-engine'

const source = resolve('dist-electron/electron/freight/desktop-freight-controller.cjs')
const require = createRequire(source)
const { ExecutionLease } = require('../automation/execution-lease.cjs') as typeof import('../../../electron/automation/execution-lease.cjs')
let pack: FreightRatePack
beforeAll(async () => {
  pack = (await require('./rate-pack.cjs').parseFreightWorkbook(resolve('resources/rates/FreightTemplate_v2.xlsx'), { id: 'fixture', version: '1.0.0', exchangeRateCnyPerUsd: 7 })).pack
})

describe('actual freight IPC uses the common six-stage host', () => {
  function setup() {
    const sender = { id: 1, isDestroyed: () => false }
    const module = { exports: {} }
    new Function('require', 'module', 'exports', readFileSync(source, 'utf8'))((name: string) => name === 'electron' ? { app: { isPackaged: false, getAppPath: () => process.cwd() }, dialog: {} } : require(name), module, module.exports)
    const Constructor = (module.exports as { DesktopFreightController: typeof DesktopFreightController }).DesktopFreightController
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
    const lease = new ExecutionLease()
    const instance = new Constructor({ getExecutionLease: () => lease, getWindow: () => ({ webContents: sender }) as never,
      registerAutomationHandle: ((name, fn) => handlers.set(name, fn as never)) as TrustedHandleRegistrar })
    instance.registerIpc()
    return { lease, quote: (payload: unknown, identity = sender) => handlers.get('freight:quote')!({ sender: identity }, payload) }
  }
  it('returns the unchanged, independently recomputed freight result', async () => {
    const test = setup(); const request = { country: 'US', actualWeightKg: 0.5, dimensionsCm: { length: 20, width: 15, height: 8 } }
    expect(await test.quote({ pack, request })).toEqual(quoteFreight(pack, request))
    expect(test.lease.busy).toBe(false)
  })
  it('will not overlap the main single Runner or accept another renderer', async () => {
    const test = setup(); const permit = test.lease.acquire()
    await expect(test.quote({ pack, request: { country: 'US', actualWeightKg: 1 } })).rejects.toMatchObject({ code: 'RUN_ALREADY_ACTIVE' })
    permit.release()
    await expect(test.quote({ pack, request: { country: 'US', actualWeightKg: 1 } }, { id: 2, isDestroyed: () => false })).rejects.toThrow('上下文已失效')
  })
})
