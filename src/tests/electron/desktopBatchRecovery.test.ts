import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import type { DesktopBatchController as ControllerType } from '../../../electron/automation/desktop-batch-controller.cjs'
import type { TrustedHandleRegistrar } from '../../../electron/ipc/trusted-ipc.cjs'
import type { IpcMainInvokeEvent } from 'electron'
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function setup() {
  const source = resolve('dist-electron/electron/automation/desktop-batch-controller.cjs')
  const require = createRequire(source)
  const { RecoveryStore, recoveryOwnerHash } = require('./recovery-store.cjs')
  const root = mkdtempSync(join(tmpdir(), 'kst-batch-owner-')); roots.push(root)
  const recoveryStore = new RecoveryStore(root)
  let runnerEvents: { onEvent(event: Record<string, unknown>): void } | null = null
  const parsed = { importId: 'private-import', fileName: 'fixture.csv', rows: [{ itemId: 'item', sourceRow: 2, input: { private_input: 'A-private-cell' }, preview: {}, accountLabelMasked: '***' }], errors: [] }
  let currentOwner = 'owner-A'
  let parseGate: Promise<unknown> | null = null
  const readGuest = vi.fn(() => ({ id: 41, getType: () => 'webview', hostWebContents: { id: 7 } }))
  const registerBrowser = vi.fn()
  const unregisterBrowser = vi.fn()
  const openDialog = vi.fn().mockResolvedValue({ canceled: false, filePaths: ['fixture.csv'] })
  const cjs = { exports: {} }
  runInNewContext(readFileSync(source, 'utf8'), {
    require: (name: string) => {
      if (name === 'electron') return { app: { isPackaged: true }, dialog: { showOpenDialog: openDialog }, webContents: { fromId: readGuest } }
      if (name === './batch-importer.cjs') return { parseBatchFile: async () => parseGate ? await parseGate : parsed }
      if (name === './batch-coordinator.cjs') {
        const { BatchCoordinator } = require(name)
        return { BatchCoordinator: class extends BatchCoordinator {
          constructor(options: Record<string, unknown>) { super({ ...options, runnerFactory: (callbacks: { onEvent(event: Record<string, unknown>): void }) => { runnerEvents = callbacks; return { start: vi.fn().mockResolvedValue({ runId: 'fixture' }), stop: vi.fn().mockResolvedValue(undefined) } } }) }
        } }
      }
      if (name === './embedded-browser-host-manager.cjs') return { EmbeddedBrowserHostManager: class {
        register = registerBrowser; release = unregisterBrowser; releaseAll() {} isReady() { return true } size() { return 0 }
      } }
      return require(name)
    }, module: cjs, exports: cjs.exports, __dirname: resolve(source, '..'), process,
  })
  const { DesktopBatchController } = cjs.exports as { DesktopBatchController: typeof ControllerType }
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const register = ((channel, handler) => handlers.set(channel, handler as unknown as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown)) as TrustedHandleRegistrar
  const controller = new DesktopBatchController({ registerAutomationHandle: register, getWindow: () => null, runnerEnvironment: () => ({}), onActivityChanged: vi.fn(), showNotification: vi.fn(), resolveOwner: async () => recoveryOwnerHash(currentOwner), recoveryStore })
  controller.registerIpc()
  const event = { sender: { id: 7 } } as IpcMainInvokeEvent
  return { controller, invoke: async (channel: string, ...args: unknown[]) => handlers.get(channel)!(event, ...args), setOwner: (owner: string) => { currentOwner = owner }, setParseGate: (gate: Promise<unknown>) => { parseGate = gate }, runnerEvent: (value: Record<string, unknown>) => runnerEvents?.onEvent(value), parsed, readGuest, registerBrowser, unregisterBrowser, openDialog }
}

describe('main batch recovery ownership', () => {
  it('revokes a waiting-user scene locally so a new owner can create a new batch without receiving old data', async () => {
    const fixture = setup()
    await fixture.invoke('batch:select-import-file', {})
    await fixture.invoke('batch:create', { importId: 'private-import', batchId: 'old-batch', recordKind: 'live', tool: { id: 'listing', name: '上架' } })
    await fixture.invoke('batch:register-browser', 'item', 41)
    await fixture.invoke('batch:start', { itemId: 'item', tool: { id: 'listing', name: '上架', executionMode: 'live' } })
    fixture.runnerEvent({ protocolVersion: 1, eventId: 'waiting', type: 'user.action_required', action: { type: 'login' } })
    expect(await fixture.invoke('batch:get-snapshot')).toMatchObject({ items: [{ status: 'waiting_user' }] })
    fixture.setOwner('owner-B')
    await fixture.controller.revokeSession()
    expect(await fixture.invoke('batch:get-snapshot')).toEqual({ status: 'idle', items: [] })
    await fixture.invoke('batch:select-import-file', {})
    expect(await fixture.invoke('batch:create', { importId: 'private-import', batchId: 'new-owner-batch', recordKind: 'live', tool: { id: 'listing', name: '上架' } })).toMatchObject({ batchId: 'new-owner-batch' })
  })
  it('rejects select, register and unregister after an account switch before returning snapshots or touching guests', async () => {
    const fixture = setup()
    await fixture.invoke('batch:select-import-file', {})
    await fixture.invoke('batch:create', { importId: 'private-import', batchId: 'private-batch', recordKind: 'live', tool: { id: 'listing', name: '上架' } })
    fixture.setOwner('owner-B')
    await expect(fixture.invoke('batch:select-item', 'item')).rejects.toMatchObject({ code: 'RECOVERY_OWNER_MISMATCH' })
    await expect(fixture.invoke('batch:register-browser', 'item', 41)).rejects.toMatchObject({ code: 'RECOVERY_OWNER_MISMATCH' })
    await expect(fixture.invoke('batch:unregister-browser', 'item')).rejects.toMatchObject({ code: 'RECOVERY_OWNER_MISMATCH' })
    expect(fixture.readGuest).not.toHaveBeenCalled(); expect(fixture.registerBrowser).not.toHaveBeenCalled(); expect(fixture.unregisterBrowser).not.toHaveBeenCalled()
    fixture.setOwner('owner-A')
    expect(await fixture.invoke('batch:select-item', 'item')).toMatchObject({ itemId: 'item', snapshot: { batchId: 'private-batch' } })
  })
  it('binds selected and remapped private imports to the verified owner and rejects account changes while parsing', async () => {
    const fixture = setup()
    await fixture.invoke('batch:select-import-file', {})
    fixture.setOwner('owner-B')
    await expect(fixture.invoke('batch:parse-import-file', {})).rejects.toThrow('RECOVERY_OWNER_MISMATCH')
    await expect(fixture.invoke('batch:remap-import-items', { importId: 'private-import', itemIds: ['remote-item'] })).rejects.toMatchObject({ code: 'RECOVERY_OWNER_MISMATCH' })
    await expect(fixture.invoke('batch:create', { importId: 'private-import', batchId: 'new-batch', recordKind: 'live', tool: { id: 'listing' } })).rejects.toMatchObject({ code: 'RECOVERY_OWNER_MISMATCH' })
    fixture.setOwner('owner-A')
    let resolveParse!: (value: unknown) => void
    fixture.setParseGate(new Promise(resolve => { resolveParse = resolve }))
    const selecting = fixture.invoke('batch:select-import-file', {})
    await vi.waitFor(() => expect(fixture.openDialog).toHaveBeenCalledTimes(2))
    fixture.setOwner('owner-B'); resolveParse(fixture.parsed)
    await expect(selecting).rejects.toThrow('RECOVERY_OWNER_MISMATCH')
  })
})
