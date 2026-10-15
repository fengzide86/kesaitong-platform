import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import type { DesktopAutomationController as ControllerType } from '../../../electron/automation/desktop-automation-controller.cjs'
import type { FileInputController as FilesType } from '../../../electron/automation/file-input-controller.cjs'

type RecordValue = Record<string, unknown>
type RunnerCallbacks = { onEvent: (event: RecordValue) => void; onHostRequest: (action: string, payload: RecordValue) => Promise<unknown> }
const roots: string[] = []
const controllers: ControllerType[] = []
const localRequire = createRequire(import.meta.url)
const { createTrustedIpcRegistrar } = localRequire(resolve('dist-electron/electron/ipc/trusted-ipc.cjs')) as typeof import('../../../electron/ipc/trusted-ipc.cjs')

function load<T>(file: string, mocks: RecordValue): T {
  const modules = new Map<string, { exports: unknown }>()
  const loadModule = (path: string): unknown => {
    if (modules.has(path)) return modules.get(path)!.exports
    const require = createRequire(path)
    const module = { exports: {} }; modules.set(path, module)
    const resolver = (name: string): unknown => Object.hasOwn(mocks, name) ? mocks[name]
      : name.startsWith('.') && name.endsWith('.cjs') ? loadModule(require.resolve(name)) : require(name)
    // Real policy/session dependencies share the mock Electron API without
    // creating cross-realm records for the production schemas.
    new Function('require', 'module', 'exports', '__dirname', readFileSync(path, 'utf8'))(
      resolver, module, module.exports, resolve(path, '..'))
    return module.exports
  }
  return loadModule(resolve('dist-electron/electron/automation', file)) as T
}

function setup(schema: RecordValue[] = [{ key: 'document', type: 'file', required: true }]) {
  const root = mkdtempSync(join(tmpdir(), 'kst-file-launch-'))
  roots.push(root)
  const file = join(root, '中文 商品资料.csv')
  writeFileSync(file, 'sample')
  let token = 'verified-token'
  let unreadable = false
  const sender = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false, getURL: () => 'app://toolbox/index.html',
    executeJavaScript: vi.fn(async () => token), send: vi.fn() }) as unknown as WebContents
  const window = { webContents: sender, isDestroyed: () => false } as BrowserWindow
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const registrar = createTrustedIpcRegistrar({
    ipcMain: { handle: (name: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => handlers.set(name, handler), on: vi.fn() } as unknown as IpcMain,
    getWindow: () => window, automationEnabled: true, allowDevelopmentOrigin: false, errorMessage: () => 'safe error',
  })
  const dialog = vi.fn(async () => ({ canceled: false, filePaths: [file] }))
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith('/api/auth/me')) return { ok: true, json: async () => ({ success: true, data: { role: 'user', user_id: 1, device_id: 'device' } }) }
    if (url.endsWith('/api/scenarios/me')) return { ok: true, json: async () => ({ success: true, data: {
      schemaVersion: 1, principal: { kind: 'customer', id: '1' }, revision: 'fixture-unassigned', status: 'unassigned', mode: 'training',
      entryUrl: null, allowedOrigins: [], maxScenes: 1, checkedAt: new Date().toISOString(), expiresAt: null, refreshAfterSeconds: 30,
    } }) }
    if (url.endsWith('/api/tools')) return { ok: true, json: async () => [{ id: 'file_tool', single_input_schema: schema }] }
    throw new Error(`Unexpected fixture request: ${url}`)
  })
  const sessions = new Map<string, { clearStorageData: () => Promise<void> }>()
  const electron = { app: { isPackaged: true, getPath: () => root, getVersion: () => 'test' }, dialog: { showOpenDialog: dialog }, net: { fetch }, safeStorage: {}, shell: {}, webContents: {},
    session: { fromPartition: (partition: string) => {
      if (!sessions.has(partition)) sessions.set(partition, { clearStorageData: vi.fn(async () => {}) })
      return sessions.get(partition)!
    } },
  }
  const fs = localRequire('node:fs/promises') as typeof import('node:fs/promises')
  const { FileInputController } = load<{ FileInputController: typeof FilesType }>('file-input-controller.cjs', { electron,
    'node:fs/promises': { ...fs, open: (...args: Parameters<typeof fs.open>) => unreadable ? Promise.reject(new Error('EACCES')) : fs.open(...args) } })
  const start = vi.fn(async () => ({ runId: 'run_1' }))
  const hostAction = vi.fn(async () => ({ performed: true }))
  let callbacks: RunnerCallbacks | null = null
  const { DesktopAutomationController } = load<{ DesktopAutomationController: typeof ControllerType }>('desktop-automation-controller.cjs', {
    electron, './file-input-controller.cjs': { FileInputController },
    './embedded-browser-host.cjs': { EmbeddedBrowserHost: class { isReady() { return true } request = hostAction; release() {} } },
    './desktop-batch-controller.cjs': { DesktopBatchController: class { registerIpc() {} isActive() { return false } async cleanup() {} async revokeSession() {} async cancelActiveForWindowClose() {} } },
    './local-artifact-service.cjs': { LocalArtifactService: class { begin() { return 1 } registerRun() {} observe() {} clear() {} } },
    './execution-report-outbox.cjs': { ExecutionReportOutbox: class { start() {} dispose() {} async drain() {} async reserve() { return 'fixture-reservation' } async releaseReservation() {} } },
    './runner-client.cjs': { RunnerClient: class { constructor(value: RunnerCallbacks) { callbacks = value } start = start; async stop() {} } },
  })
  const controller = new DesktopAutomationController({ automationEnabled: true, controlApiBase: 'https://control.invalid', runtimeRoot: root,
    getWindow: () => window, getDefaultFreightWorkbookPath: () => 'unused', registerTrustedHandle: registrar.handle,
    registerAutomationHandle: registrar.automationHandle, registerTrustedOn: registrar.on, mayOpenExternalUrl: () => false, onActivityChanged: vi.fn(), showNotification: vi.fn() })
  controllers.push(controller)
  const { recoveryOwnerHash } = localRequire(resolve('dist-electron/electron/automation/recovery-store.cjs'))
  controller.browserSessions.prepare(recoveryOwnerHash(['https://control.invalid', 1, null, 'device']), 'amazon')
  controller.registerIpc()
  const event = { sender, senderFrame: { url: sender.getURL() } } as IpcMainInvokeEvent
  const invoke = async (channel: string, request?: unknown) => handlers.get(channel)!(event, ...(request === undefined ? [] : [request]))
  const launch = (context: RecordValue = {}) => invoke('automation:start', { id: 'file_tool', executionMode: 'live', targetUrl: 'https://fixture.test/tool', executionContext: { input: { document: file }, ...context } })
  return { file, start, fetch, hostAction, invoke, launch, setUnreadable: (value: boolean) => { unreadable = value },
    changeToken: () => { token = 'another-token' }, runner: () => callbacks! }
}

afterEach(async () => {
  for (const controller of controllers.splice(0)) await controller.cleanup()
  for (const root of roots.splice(0)) {
    const suffix = relative(resolve(tmpdir()), resolve(root))
    if (!suffix.startsWith('kst-file-launch-') || suffix.startsWith('..') || isAbsolute(suffix)) throw new Error('Unsafe test cleanup')
    rmSync(root, { recursive: true, force: true })
  }
})

describe('authoritative native file launch boundary', () => {
  it.each([{ fileInputKeys: [] }, {}, { fileInputKeys: ['unrelated'] }])('does not trust renderer file keys %j', async context => {
    const test = setup()
    await expect(test.launch(context)).rejects.toThrow('LOCAL_FILE_UNREADABLE')
    expect(test.start).not.toHaveBeenCalled()
    expect(test.fetch.mock.calls.map(call => call[0])).toEqual(['https://control.invalid/api/auth/me', 'https://control.invalid/api/scenarios/me', 'https://control.invalid/api/tools'])
  })
  it('only a native selected file can start, even when keys were omitted', async () => {
    const test = setup()
    await test.invoke('files:select-input', { label: '商品资料' })
    await expect(test.launch()).resolves.toEqual({ runId: 'run_1' })
    expect(test.start).toHaveBeenCalledOnce()
  })
  it.each(['deleted', 'unreadable'])('rejects selected files that become %s via direct start IPC', async reason => {
    const test = setup()
    await test.invoke('files:select-input', { label: '商品资料' })
    if (reason === 'deleted') unlinkSync(test.file)
    else test.setUnreadable(true)
    await expect(test.launch({ fileInputKeys: [] })).rejects.toThrow('LOCAL_FILE_UNREADABLE')
    expect(test.start).not.toHaveBeenCalled()
  })
  it('rejects missing required values and unavailable/unknown catalog definitions', async () => {
    const test = setup()
    await expect(test.launch({ input: {} })).rejects.toThrow('LOCAL_FILE_REQUIRED')
    await expect(test.invoke('automation:start', { id: 'unknown', executionMode: 'live', targetUrl: 'https://fixture.test/tool' })).rejects.toThrow('TOOL_SCHEMA_UNAVAILABLE')
    expect(test.start).not.toHaveBeenCalled()
  })
  it('revalidates native selection on both standalone and embedded upload host actions', async () => {
    const test = setup()
    await test.invoke('files:select-input', { label: '商品资料' })
    await test.launch()
    const runner = test.runner()
    await expect(runner.onHostRequest('files.validate-upload', { filePath: test.file })).resolves.toEqual({ valid: true })
    await expect(runner.onHostRequest('files.validate-upload', { filePath: `${test.file}.unknown` })).rejects.toThrow('LOCAL_FILE_UNREADABLE')
    await expect(runner.onHostRequest('browser.action', { action: { kind: 'upload', inputKey: 'extra' }, input: { extra: `${test.file}.unknown` } })).rejects.toThrow('LOCAL_FILE_UNREADABLE')
    expect(test.hostAction).not.toHaveBeenCalled()
    unlinkSync(test.file)
    await expect(runner.onHostRequest('browser.action', { action: { kind: 'upload', value: test.file } })).rejects.toThrow('LOCAL_FILE_UNREADABLE')
    expect(test.hostAction).not.toHaveBeenCalled()
  })
  it('does not upload after owner/session changes', async () => {
    const test = setup()
    await test.invoke('files:select-input', { label: '商品资料' })
    await test.launch()
    test.changeToken()
    // The verified profile stays identical in this fixture; explicit selection
    // clearing models the real credential lifecycle for a new authorization.
    await test.invoke('files:clear-input')
    await expect(test.runner().onHostRequest('files.validate-upload', { filePath: test.file })).rejects.toThrow('LOCAL_FILE_UNREADABLE')
    expect(test.hostAction).not.toHaveBeenCalled()
  })
  it('changed content is rejected by the actual mutation ACK, even after native reselection', async () => {
    const test = setup()
    await test.invoke('files:select-input', { label: '商品资料' })
    await test.launch()
    writeFileSync(test.file, 'changed after launch')
    await test.invoke('files:select-input', { label: '商品资料' })
    await expect(test.runner().onHostRequest('recovery.before-mutation', {})).rejects.toThrow('LOCAL_FILE_CHANGED')
    expect(test.hostAction).not.toHaveBeenCalled()
    const rows = await test.invoke('recovery:list', {}) as Array<{ classification: string }>
    expect(rows[0]?.classification).toBe('not_submitted')
  })
})
