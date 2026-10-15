import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, relative, isAbsolute } from 'node:path'
import type { DesktopAutomationController as ControllerType } from '../../../electron/automation/desktop-automation-controller.cjs'
import type { CredentialManager as CredentialsType } from '../../../electron/core/credential-manager.cjs'
import type { IpcMain, IpcMainInvokeEvent, BrowserWindow, WebContents } from 'electron'

const require = createRequire(import.meta.url)
const { createTrustedIpcRegistrar } = require(resolve('dist-electron/electron/ipc/trusted-ipc.cjs')) as typeof import('../../../electron/ipc/trusted-ipc.cjs')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64')
const roots: string[] = []
const controllers: ControllerType[] = []

function loadCjs<T>(fileName: string, mocks: Record<string, unknown>): T {
  const modules = new Map<string, { exports: unknown }>()
  const load = (filePath: string): unknown => {
    if (modules.has(filePath)) return modules.get(filePath)!.exports
    const localRequire = createRequire(filePath)
    const module = { exports: {} }; modules.set(filePath, module)
    const resolver = (name: string): unknown => Object.hasOwn(mocks, name) ? mocks[name]
      : name.startsWith('.') && name.endsWith('.cjs') ? load(localRequire.resolve(name)) : localRequire(name)
    // Keep real policy/session dependencies on the fixture Electron API and
    // in the same realm as the production schemas.
    new Function('require', 'module', 'exports', '__dirname', 'console', readFileSync(filePath, 'utf8'))(
      resolver, module, module.exports, resolve(filePath, '..'), { ...console, error: vi.fn() })
    return module.exports
  }
  return load(resolve('dist-electron', fileName)) as T
}

function setup(options: { encryptionAvailable?: boolean; clearFails?: boolean; deferStart?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'kst-artifact-ipc-'))
  roots.push(root)
  const directory = join(root, 'automation-artifacts')
  mkdirSync(directory)
  writeFileSync(join(directory, 'run_1.png'), png)
  const owner = Object.assign(new EventEmitter(), {
    id: 17, isDestroyed: () => false, getURL: () => 'app://toolbox/index.html', send: vi.fn(), executeJavaScript: vi.fn().mockResolvedValue('fixture-token'),
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
  const start = vi.fn(async (callbacks: { onEvent: (event: Record<string, unknown>) => void; onHostRequest: (action: string, payload: Record<string, unknown>) => Promise<unknown> }) => {
    callbacks.onEvent({ protocolVersion: 1, eventId: 'evt_1', type: 'run.started', runId: 'run_1' })
    callbacks.onEvent({ protocolVersion: 1, eventId: 'evt_2', type: 'artifact.created', runId: 'run_1',
      artifact: { type: 'screenshot', path: join(directory, 'run_1.png') } })
    return options.deferStart ? startGate : { runId: 'run_1' }
  })
  const sessions = new Map<string, { clearStorageData: () => Promise<void> }>()
  const electron = {
    app: { getPath: () => root, getVersion: () => 'test', isPackaged: true },
    safeStorage: { isEncryptionAvailable: () => options.encryptionAvailable !== false, encryptString: (value: string) => Buffer.from(value) },
    session: { fromPartition: (partition: string) => {
      if (!sessions.has(partition)) sessions.set(partition, { clearStorageData: vi.fn(async () => {}) })
      return sessions.get(partition)!
    } },
    shell: {}, net: { fetch: vi.fn(async (url: string) => {
      if (url.endsWith('/api/auth/me')) return { ok: true, json: async () => ({ success: true, data: { role: 'user', user_id: 1, device_id: 'fixture-device' } }) }
      if (url.endsWith('/api/scenarios/me')) return { ok: true, json: async () => ({ success: true, data: {
        schemaVersion: 1, principal: { kind: 'customer', id: '1' }, revision: 'fixture-unassigned', status: 'unassigned', mode: 'training',
        entryUrl: null, allowedOrigins: [], maxScenes: 1, checkedAt: new Date().toISOString(), expiresAt: null, refreshAfterSeconds: 30,
      } }) }
      if (url.endsWith('/api/tools')) return { ok: true, json: async () => [{ id: 'tool_1', single_input_schema: [] }, { id: 'tool_2', single_input_schema: [] }] }
      throw new Error(`Unexpected fixture request: ${url}`)
    }) }, webContents: {},
  }
  const { DesktopAutomationController } = loadCjs<{ DesktopAutomationController: typeof ControllerType }>('electron/automation/desktop-automation-controller.cjs', {
    electron,
    './embedded-browser-host.cjs': { EmbeddedBrowserHost: class { isReady() { return false } release() {} } },
    './desktop-batch-controller.cjs': { DesktopBatchController: class { registerIpc() {} isActive() { return false } async cleanup() {} async revokeSession() {} async cancelActiveForWindowClose() {} } },
    './execution-report-outbox.cjs': { ExecutionReportOutbox: class { start() {} dispose() {} async drain() {} async reserve() { return 'fixture-reservation' } async releaseReservation() {} } },
    './runner-client.cjs': { RunnerClient: class {
      constructor(private callbacks: { onEvent: (event: Record<string, unknown>) => void; onHostRequest: (action: string, payload: Record<string, unknown>) => Promise<unknown> }) {}
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
    if (['automation:start', 'automation:preflight'].includes(channel) && args[0] && typeof args[0] === 'object') args[0] = {
      executionMode: 'live', targetUrl: 'https://fixture.test/tool', ...args[0],
    }
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
  it('session revoke interrupts old execution without deleting its evidence and rejects late old Runner requests', async () => {
    const { invoke, start } = setup()
    await invoke('automation:start', { id: 'tool_1', executionContext: { input: { sku: 'old' } } })
    const old = start.mock.calls[0]![0]
    await old.onHostRequest('recovery.before-mutation', {})
    await invoke('recovery:revoke-session')
    await expect(old.onHostRequest('recovery.before-mutation', {})).rejects.toThrow('SESSION_REVOKED')
    old.onEvent({ protocolVersion: 1, eventId: 'late', type: 'run.completed', runId: 'run_1' })
    const records = await invoke('recovery:list', {}) as Array<{ id: string }>
    expect(records[0]).toMatchObject({ classification: 'needs_review', executionStatus: 'interrupted' })
    expect(await invoke('recovery:read-evidence', records[0]!.id)).toMatchObject({ status: 'available' })
    await invoke('automation:start', { id: 'tool_1', executionContext: { input: { sku: 'new-unrelated' } } })
    expect(start).toHaveBeenCalledTimes(2)
    expect(() => invoke('recovery:revoke-session', { owner: 'injected' })).toThrow()
  })
  it('main IPC persists mutation ACK, blocks blind retry, and separates manual completion from Runner status', async () => {
    const { invoke, start, handlers, event } = setup()
    const input = { sku: 'same-object', password: 'never-persist' }
    await invoke('automation:start', { id: 'tool_1', executionContext: { input } })
    const runner = start.mock.calls[0]![0]
    await runner.onHostRequest('recovery.before-mutation', {})
    runner.onEvent({ protocolVersion: 1, eventId: 'failed', type: 'run.failed', runId: 'run_1', error: { code: 'TIMEOUT' } })
    const records = await invoke('recovery:list', {}) as Array<{ id: string; revision: number; classification: string; executionStatus: string }>
    expect(records[0]).toMatchObject({ classification: 'needs_review', executionStatus: 'failed' })
    expect(JSON.stringify(records)).not.toMatch(/never-persist|same-object|inputHash|owner/)
    await expect(invoke('automation:start', { id: 'tool_1', executionContext: { input } })).rejects.toThrow(/核对/)
    expect(start).toHaveBeenCalledOnce()
    const reviewed = await invoke('recovery:review', { id: records[0]!.id, revision: records[0]!.revision, conclusion: 'completed' })
    expect(reviewed).toMatchObject({ classification: 'manual_completed', executionStatus: 'failed', retryAllowed: false })
    await expect(invoke('automation:start', { id: 'tool_1', executionContext: { input } })).rejects.toThrow(/已完成/)
    expect(await invoke('recovery:read-evidence', records[0]!.id)).toMatchObject({ status: 'available' })
    expect(() => handlers.get('recovery:review')!({ ...event, sender: { id: 999 } } as IpcMainInvokeEvent, { id: records[0]!.id, revision: 1, conclusion: 'not_completed' })).toThrow('active toolbox window')
  })
  it('manual not-completed enables a new local attempt but stale or repeated review cannot requeue it', async () => {
    const { invoke, start } = setup()
    const tool = { id: 'tool_1', executionContext: { input: { sku: 'one' } } }
    await invoke('automation:start', tool)
    start.mock.calls[0]![0].onEvent({ protocolVersion: 1, eventId: 'failed', type: 'run.failed', runId: 'run_1', error: { code: 'RUNNER_PROCESS_INTERRUPTED' } })
    const records = await invoke('recovery:list', {}) as Array<{ id: string; revision: number; attemptId: string }>
    await invoke('recovery:review', { id: records[0]!.id, revision: records[0]!.revision, conclusion: 'not_completed' })
    await invoke('automation:start', tool)
    expect(start).toHaveBeenCalledTimes(2)
    await expect(invoke('recovery:review', { id: records[0]!.id, revision: records[0]!.revision, conclusion: 'not_completed' })).rejects.toThrow(/变化/)
    const next = await invoke('recovery:list', {}) as Array<{ attemptId: string }>
    expect(next).toHaveLength(1)
    expect(next[0]!.attemptId).not.toBe(records[0]!.attemptId)
  })
  it('packaged IPC rejects legacy demo and untyped starts, even without a customer UI', async () => {
    const { handlers, event, start } = setup()
    await expect(handlers.get('automation:start')!(event, { id: 'old-demo', executionMode: 'demo' })).rejects.toThrow('LEGACY_DEMO_DISABLED')
    await expect(handlers.get('automation:start')!(event, { id: 'old-default' })).rejects.toThrow('LEGACY_DEMO_DISABLED')
    expect(start).not.toHaveBeenCalled()
  })
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

  it('preflight cannot interrupt a live execution or clear its evidence', async () => {
    const { invoke } = setup()
    await invoke('automation:start', { id: 'tool_1' })
    await expect(invoke('automation:preflight', { id: 'tool_1' })).rejects.toThrow('RUN_ALREADY_ACTIVE')
    expect(await invoke('artifacts:read', { runId: 'run_1', kind: 'screenshot' })).toMatchObject({ status: 'available' })
  })

  it('connects credential invalidation in the real application composition', () => {
    const application = readFileSync(resolve('electron/desktop-application.cts'), 'utf8')
    expect(application).toContain('onSessionChanged: ownerId => automationController.resetArtifactsForOwner(ownerId)')
  })
})
