import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { runInNewContext } from 'node:vm'
import type { DesktopAutomationController as ControllerType } from '../../../electron/automation/desktop-automation-controller.cjs'
import type { CredentialManager as CredentialsType } from '../../../electron/core/credential-manager.cjs'
import type { IpcMain, IpcMainInvokeEvent, BrowserWindow, WebContents } from 'electron'

const require = createRequire(import.meta.url)
const { createTrustedIpcRegistrar } = require(resolve('dist-electron/electron/ipc/trusted-ipc.cjs')) as typeof import('../../../electron/ipc/trusted-ipc.cjs')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64')
const roots: string[] = []
const controllers: ControllerType[] = []

function loadCjs<T>(fileName: string, mocks: Record<string, unknown>): T {
  const filePath = resolve('dist-electron', fileName)
  const localRequire = createRequire(filePath)
  const module = { exports: {} }
  runInNewContext(readFileSync(filePath, 'utf8'), {
    require: (name: string) => Object.hasOwn(mocks, name) ? mocks[name] : localRequire(name),
    module, exports: module.exports, __dirname: resolve(filePath, '..'), process,
    console: { ...console, error: vi.fn() }, Buffer, setTimeout, clearTimeout,
  })
  return module.exports as T
}

function setup(options: { encryptionAvailable?: boolean; clearFails?: boolean; deferStart?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'kst-artifact-ipc-'))
  roots.push(root)
  const directory = join(root, 'automation-artifacts')
  mkdirSync(directory)
  writeFileSync(join(directory, 'run_1.png'), png)
  const owner = Object.assign(new EventEmitter(), {
    id: 17, isDestroyed: () => false, getURL: () => 'app://toolbox/index.html', send: vi.fn(),
  }) as unknown as EventEmitter & WebContents
  const window = { webContents: owner, isDestroyed: () => false } as BrowserWindow
  const event = { sender: owner, senderFrame: { url: owner.getURL() } } as IpcMainInvokeEvent
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const ipcMain = {
    handle: (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => handlers.set(channel, handler),
    on: vi.fn(), removeHandler: vi.fn(),
  } as unknown as IpcMain
  const registrar = createTrustedIpcRegistrar({ ipcMain, getWindow: () => window,
    automationEnabled: true, allowDevelopmentOrigin: false, errorMessage: () => 'safe error' })
  let resolveStart!: (value: { runId: string }) => void
  const startGate = new Promise<{ runId: string }>(resolve => { resolveStart = resolve })
  const start = vi.fn(async (callbacks: { onEvent: (event: Record<string, unknown>) => void }) => {
    callbacks.onEvent({ protocolVersion: 1, eventId: 'evt_1', type: 'run.started', runId: 'run_1' })
    callbacks.onEvent({ protocolVersion: 1, eventId: 'evt_2', type: 'artifact.created', runId: 'run_1',
      artifact: { type: 'screenshot', path: join(directory, 'run_1.png') } })
    return options.deferStart ? startGate : { runId: 'run_1' }
  })
  const electron = {
    app: { getPath: () => root, getVersion: () => 'test', isPackaged: true },
    safeStorage: { isEncryptionAvailable: () => options.encryptionAvailable !== false, encryptString: (value: string) => Buffer.from(value) },
    shell: {}, net: {}, webContents: {},
  }
  const { DesktopAutomationController } = loadCjs<{ DesktopAutomationController: typeof ControllerType }>('electron/automation/desktop-automation-controller.cjs', {
    electron,
    './embedded-browser-host.cjs': { EmbeddedBrowserHost: class { isReady() { return false } release() {} } },
    './desktop-batch-controller.cjs': { DesktopBatchController: class { registerIpc() {} async cleanup() {} } },
    './execution-report-outbox.cjs': { ExecutionReportOutbox: class { start() {} dispose() {} } },
    './runner-client.cjs': { RunnerClient: class {
      constructor(private callbacks: { onEvent: (event: Record<string, unknown>) => void }) {}
      start() { return start(this.callbacks) }
      async preflight() { return { canStart: false } }
      async stop() {}
    } },
  })
  const controller = new DesktopAutomationController({ automationEnabled: true, controlApiBase: 'https://control.invalid',
    runtimeRoot: root, getWindow: () => window, getDefaultFreightWorkbookPath: () => 'unused',
    registerTrustedHandle: registrar.handle, registerAutomationHandle: registrar.automationHandle,
    registerTrustedOn: registrar.on, mayOpenExternalUrl: () => false, onActivityChanged: vi.fn(), showNotification: vi.fn(),
  })
  controllers.push(controller)
  controller.registerIpc()
  const fsMock = options.clearFails ? {
    existsSync: () => true, unlinkSync: () => { throw new Error('PRIVATE_LOCAL_PATH') },
  } : require('node:fs')
  const { CredentialManager } = loadCjs<{ CredentialManager: typeof CredentialsType }>('electron/core/credential-manager.cjs', {
    electron, 'node:fs': fsMock,
  })
  const sessionChanged = vi.fn((ownerId: number) => controller.resetArtifactsForOwner(ownerId))
  const credentials = new CredentialManager({ ipcMain, getWindow: () => window, onSessionChanged: sessionChanged })
  credentials.register()
  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error('Missing test IPC handler')
    return handler(event, ...args)
  }
  return { controller, owner, event, handlers, invoke, sessionChanged, start, resolveStart }
}

afterEach(async () => {
  for (const controller of controllers.splice(0)) await controller.cleanup()
  for (const root of roots.splice(0)) {
    const suffix = relative(resolve(tmpdir()), resolve(root))
    if (!suffix || suffix.startsWith('..') || isAbsolute(suffix) || !suffix.startsWith('kst-artifact-ipc-')) throw new Error('Unsafe test cleanup')
    rmSync(root, { recursive: true, force: true })
  }
})

describe('local artifact actual IPC wiring', () => {
  it('registers trusted read/clear handlers and binds Runner evidence to the invoking window', async () => {
    const { invoke, start } = setup()
    await invoke('automation:start', { id: 'tool_1' })
    expect(start).toHaveBeenCalledOnce()
    expect(await invoke('artifacts:read', { runId: 'run_1', kind: 'screenshot' })).toEqual({
      status: 'available', kind: 'screenshot', dataUrl: `data:image/png;base64,${png.toString('base64')}`,
    })
    await invoke('artifacts:clear')
    expect(await invoke('artifacts:read', { runId: 'run_1', kind: 'screenshot' })).toMatchObject({ code: 'NOT_AVAILABLE' })
    expect(start).toHaveBeenCalledOnce()
  })

  it('rejects untrusted origins/windows and path-shaped requests before file access', async () => {
    const { handlers, event, invoke } = setup()
    await invoke('automation:start', { id: 'tool_1' })
    const read = handlers.get('artifacts:read')!
    expect(() => read({ ...event, sender: { id: 999 } } as IpcMainInvokeEvent, { runId: 'run_1', kind: 'screenshot' })).toThrow('active toolbox window')
    expect(() => read({ ...event, senderFrame: { url: 'https://untrusted.invalid/' } } as IpcMainInvokeEvent, { runId: 'run_1', kind: 'screenshot' })).toThrow('not trusted')
    expect(() => invoke('artifacts:read', { runId: 'run_1', kind: 'screenshot', path: '/private' })).toThrow()
  })

  it.each(['save', 'clear'] as const)('%s revokes evidence even when the credential operation fails', async action => {
    const { invoke, sessionChanged, owner } = setup({ encryptionAvailable: false, clearFails: true })
    await invoke('automation:start', { id: 'tool_1' })
    expect(await invoke('artifacts:read', { runId: 'run_1', kind: 'screenshot' })).toMatchObject({ status: 'available' })
    const result = action === 'save' ? invoke('credential-save-user-code', 'FIXTURE-CODE') : invoke('credential-clear-user-code')
    expect(result).toBe(false)
    expect(sessionChanged).toHaveBeenCalledWith(owner.id)
    expect(await invoke('artifacts:read', { runId: 'run_1', kind: 'screenshot' })).toMatchObject({ code: 'NOT_AVAILABLE' })
  })

  it('session reset during launch cannot re-register stale evidence on the launch response', async () => {
    const { invoke, resolveStart } = setup({ deferStart: true, encryptionAvailable: false })
    const starting = invoke('automation:start', { id: 'tool_1' })
    expect(await invoke('artifacts:read', { runId: 'run_1', kind: 'screenshot' })).toMatchObject({ code: 'NOT_AVAILABLE' })
    invoke('credential-save-user-code', 'NEW-FIXTURE-CODE')
    resolveStart({ runId: 'run_1' })
    await starting
    expect(await invoke('artifacts:read', { runId: 'run_1', kind: 'screenshot' })).toMatchObject({ code: 'NOT_AVAILABLE' })
  })

  it('rejects overlapping starts before they can revoke the first launch evidence', async () => {
    const { invoke, resolveStart, start } = setup({ deferStart: true })
    const starting = invoke('automation:start', { id: 'tool_1' })
    await expect(invoke('automation:start', { id: 'tool_2' })).rejects.toMatchObject({ code: 'RUN_ALREADY_ACTIVE' })
    resolveStart({ runId: 'run_1' })
    await starting
    expect(start).toHaveBeenCalledOnce()
    expect(await invoke('artifacts:read', { runId: 'run_1', kind: 'screenshot' })).toMatchObject({ status: 'available' })
  })

  it('rejects another start while the single task remains active without clearing its evidence', async () => {
    const { invoke, start } = setup()
    await invoke('automation:start', { id: 'tool_1' })
    await expect(invoke('automation:start', { id: 'tool_2' })).rejects.toMatchObject({ code: 'RUN_ALREADY_ACTIVE' })
    expect(start).toHaveBeenCalledOnce()
    expect(await invoke('artifacts:read', { runId: 'run_1', kind: 'screenshot' })).toMatchObject({ status: 'available' })
  })

  it('credential reset cannot release the pending-start lock', async () => {
    const { invoke, resolveStart, start } = setup({ deferStart: true, encryptionAvailable: false })
    const starting = invoke('automation:start', { id: 'tool_1' })
    invoke('credential-save-user-code', 'NEW-FIXTURE-CODE')
    await expect(invoke('automation:start', { id: 'tool_2' })).rejects.toMatchObject({ code: 'RUN_ALREADY_ACTIVE' })
    resolveStart({ runId: 'run_1' })
    await starting
    expect(start).toHaveBeenCalledOnce()
    expect(await invoke('artifacts:read', { runId: 'run_1', kind: 'screenshot' })).toMatchObject({ code: 'NOT_AVAILABLE' })
  })

  it('preflight clears prior execution evidence without creating fake run IDs', async () => {
    const { invoke } = setup()
    await invoke('automation:start', { id: 'tool_1' })
    await invoke('automation:preflight', { id: 'tool_1' })
    expect(await invoke('artifacts:read', { runId: 'run_1', kind: 'screenshot' })).toMatchObject({ code: 'NOT_AVAILABLE' })
  })

  it('connects credential invalidation in the real application composition', () => {
    const application = readFileSync(resolve('electron/desktop-application.cts'), 'utf8')
    expect(application).toContain('onSessionChanged: ownerId => automationController.resetArtifactsForOwner(ownerId)')
  })
})
