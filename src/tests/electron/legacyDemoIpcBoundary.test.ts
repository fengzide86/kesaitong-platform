import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import type { DesktopBatchController as ControllerType } from '../../../electron/automation/desktop-batch-controller.cjs'
import type { TrustedHandleRegistrar } from '../../../electron/ipc/trusted-ipc.cjs'
import type { IpcMainInvokeEvent } from 'electron'

function setup(packaged: boolean, internal = false) {
  const source = resolve('dist-electron/electron/automation/desktop-batch-controller.cjs')
  const require = createRequire(source)
  const calls = { storeImport: vi.fn(), create: vi.fn(), startItem: vi.fn().mockResolvedValue({ runId: 'internal-fixture' }) }
  const cjs = { exports: {} }
  runInNewContext(readFileSync(source, 'utf8'), {
    require: (name: string) => {
      if (name === 'electron') return { app: { isPackaged: packaged } }
      if (name === './batch-coordinator.cjs') return { BatchCoordinator: class { storeImport = calls.storeImport; create = calls.create; startItem = calls.startItem } }
      if (name === './embedded-browser-host-manager.cjs') return { EmbeddedBrowserHostManager: class {} }
      return require(name)
    },
    module: cjs, exports: cjs.exports, __dirname: resolve(source, '..'), process: { env: { TOOLBOX_INTERNAL_DEMO: internal ? '1' : '' } },
  })
  const { DesktopBatchController } = cjs.exports as { DesktopBatchController: typeof ControllerType }
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const register = ((channel, handler) => handlers.set(channel, handler as unknown as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown)) as TrustedHandleRegistrar
  const controller = new DesktopBatchController({ registerAutomationHandle: register, getWindow: () => null, runnerEnvironment: () => ({}), onActivityChanged: vi.fn(), showNotification: vi.fn(), resolveOwner: vi.fn().mockResolvedValue('fixture-owner'), recoveryStore: {} as ConstructorParameters<typeof DesktopBatchController>[0]['recoveryStore'] })
  controller.registerIpc()
  const invoke = async (channel: string, payload: unknown) => handlers.get(channel)!({ sender: {} } as IpcMainInvokeEvent, payload)
  return { invoke, calls }
}

describe('legacy batch demo main process boundary', () => {
  it.each([false, true])('packaged app rejects old demo even with internal flag=%s', async flag => {
    const { invoke, calls } = setup(true, flag)
    await expect(invoke('batch:store-demo-import', { rows: [{}] })).rejects.toThrow('LEGACY_DEMO_DISABLED')
    await expect(invoke('batch:create', { recordKind: 'demo' })).rejects.toThrow('LEGACY_DEMO_DISABLED')
    await expect(invoke('batch:create', {})).rejects.toThrow('LEGACY_DEMO_DISABLED')
    await expect(invoke('batch:start', { itemId: 'item', tool: { executionMode: 'demo' } })).rejects.toThrow('LEGACY_DEMO_DISABLED')
    expect(calls.storeImport).not.toHaveBeenCalled(); expect(calls.create).not.toHaveBeenCalled(); expect(calls.startItem).not.toHaveBeenCalled()
  })
  it('unpackaged app also refuses implicit demo unless explicitly in an internal fixture', async () => {
    const { invoke } = setup(false)
    await expect(invoke('batch:store-demo-import', { rows: [{}] })).rejects.toThrow('LEGACY_DEMO_DISABLED')
    const fixture = setup(false, true)
    await fixture.invoke('batch:store-demo-import', { rows: [{}] })
    expect(fixture.calls.storeImport).toHaveBeenCalledOnce()
  })
})
