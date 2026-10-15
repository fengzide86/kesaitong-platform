import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { DesktopAutomationController } from '../../../electron/automation/desktop-automation-controller.cjs'

type Data = Record<string, unknown>
type Callbacks = { env: NodeJS.ProcessEnv; onEvent(event: Data): void; onHostRequest(action: string, payload: Data): Promise<unknown> }
const require = createRequire(import.meta.url)
const cleanups: Array<() => Promise<void>> = []
const codec = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s, 'utf8'), decryptString: (b: Buffer) => b.toString('utf8') }
function gate() { let open!: () => void; const promise = new Promise<void>(r => { open = r }); return { promise, open } }

/** Real compiled IPC/controllers/coordinator/ledger/outbox. Only Electron,
 * external I/O and the child Runner/browser side effects are replaced. */
function fixture(blockAt?: string) {
  const root = mkdtempSync(join(tmpdir(), 'kst-hardening-'))
  const hold = gate()
  const reached = gate()
  let blocked = false
  const pause = async (stage: string) => { if (!blocked && stage === blockAt) { blocked = true; reached.open(); await hold.promise } }
  let userId = 1
  let competition = false
  const sender = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false, getURL: () => 'app://toolbox/index.html', send: vi.fn(), executeJavaScript: async () => `verified-fixture-token-${userId}` })
  const window = { webContents: sender, isDestroyed: () => false }
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const runners: FakeRunner[] = []
  const browserCalls: string[] = []
  const reportRequest = vi.fn<typeof fetch>().mockRejectedValue(new Error('isolated offline fixture'))
  class FakeRunner {
    active = false
    constructor(readonly callbacks: Callbacks) { runners.push(this) }
    async start() { this.active = true; this.event('run.started'); await pause('runner-start'); return { runId: `run-${runners.indexOf(this)}` } }
    async stop() { this.active = false }
    async completeUserAction() { this.active = true }
    async resume() { this.active = true }
    async pause() {}
    async preflight() { return { canStart: true } }
    event(type: string) {
      if (['run.completed', 'run.failed', 'run.cancelled', 'user.action_required'].includes(type)) this.active = false
      this.callbacks.onEvent({ protocolVersion: 1, eventId: `evt-${Date.now()}-${type}`, type, runId: `run-${runners.indexOf(this)}`, ...(type === 'user.action_required' ? { action: { type: 'login', title: 'fixture login' } } : {}) })
    }
  }
  const sessions = new Map<string, object>()
  const guests = new Map<number, object>()
  const targetWindows: TargetWindow[] = []
  class TargetWindow extends EventEmitter {
    destroyed = false
    url = 'about:blank'
    webContents = Object.assign(new EventEmitter(), { id: 1000 + targetWindows.length, getURL: () => this.url, isDestroyed: () => this.destroyed, setWindowOpenHandler: vi.fn() })
    constructor(readonly configuration: { webPreferences: { partition: string } }) { super(); targetWindows.push(this) }
    loadURL = vi.fn(async (url: string) => { this.url = url; await pause('target-load') })
    show = vi.fn(); focus = vi.fn(); isDestroyed = () => this.destroyed
    destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('closed') } }
  }
  const electron = {
    app: Object.assign(new EventEmitter(), { isPackaged: true, getPath: () => root, getVersion: () => 'test' }), safeStorage: codec, shell: { openExternal: vi.fn(async () => {}) }, BrowserWindow: TargetWindow,
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ['fixture.csv'] }) },
    session: { fromPartition: (partition: string) => { if (!sessions.has(partition)) sessions.set(partition, Object.assign(new EventEmitter(), { clearStorageData: vi.fn(async () => {}), setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() })); return sessions.get(partition)! } },
    webContents: { fromId: (id: number) => guests.get(id) || ({ id, getType: () => 'webview', hostWebContents: sender }) },
    net: { fetch: async (url: string) => {
      if (url.endsWith('/api/auth/me')) { await pause('auth'); return { ok: true, json: async () => ({ success: true, data: { role: 'user', user_id: userId, device_id: 'device' } }) } }
      if (url.endsWith('/api/scenarios/me')) return { ok: true, json: async () => ({ success: true, data: { schemaVersion: 1, principal: { kind: 'customer', id: String(userId) }, revision: competition ? 'competition' : 'none', status: competition ? 'active' : 'unassigned', mode: competition ? 'competition' : 'training', entryUrl: competition ? 'https://www.idtrade.cn/User/Contest' : null, allowedOrigins: competition ? ['https://www.idtrade.cn'] : [], maxScenes: 1, checkedAt: new Date().toISOString(), expiresAt: competition ? new Date(Date.now() + 3600000).toISOString() : null, refreshAfterSeconds: 30 } }) }
      if (url.endsWith('/api/tools')) { await pause('catalog'); return { ok: true, json: async () => [{ id: 'single_tool', single_input_schema: [] }] } }
      throw new Error(`Unexpected fixture request: ${url}`)
    } },
  }
  const { ExecutionReportOutbox } = require(resolve('dist-electron/electron/automation/execution-report-outbox.cjs'))
  let reportOutbox!: { reserve(token: string): Promise<string> }
  class Outbox extends ExecutionReportOutbox {
    constructor(options: Data) { super({ ...options, request: reportRequest }); if (!options.reportPath) reportOutbox = { reserve: token => this.reserve(token) } }
    async reserve(token: unknown) { const id = await super.reserve(token); await pause('reservation'); return id }
  }
  class Host {
    ready = false
    register() { this.ready = true }
    release() { this.ready = false }
    isReady() { return this.ready }
    request(action: string) { browserCalls.push(action); return { performed: true } }
  }
  class HostManager {
    hosts = new Map<string, Host>()
    register(id: string) { const host = new Host(); host.register(); this.hosts.set(id, host) }
    release(id: string) { this.hosts.delete(id) }
    releaseAll() { this.hosts.clear() }
    isReady(id: string) { return this.hosts.has(id) }
    size() { return this.hosts.size }
    request(id: string, action: string) { return this.hosts.get(id)!.request(action) }
  }
  const mocks: Record<string, unknown> = {
    'electron': electron, 'runner-client.cjs': { RunnerClient: FakeRunner },
    'embedded-browser-host.cjs': { EmbeddedBrowserHost: Host }, 'embedded-browser-host-manager.cjs': { EmbeddedBrowserHostManager: HostManager },
    'execution-report-outbox.cjs': { ExecutionReportOutbox: Outbox },
    // The real target lifecycle is exercised; native page inspection is not
    // relevant to the account ownership and navigation-surface assertions.
    'webcontents-port.cjs': { createOwnedWebContentsPort: () => ({ kind: 'fixture', inspect: vi.fn(), dispose: vi.fn() }) },
    'batch-importer.cjs': { parseBatchFile: async () => ({ importId: 'import', fileName: 'fixture.csv', rows: [{ itemId: 'item', sourceRow: 2, input: { account: 'batch-fixture' }, preview: {}, accountLabelMasked: '***' }], errors: [] }) },
  }
  const modules = new Map<string, { exports: unknown }>()
  function load(file: string): unknown {
    const full = resolve(file)
    if (modules.has(full)) return modules.get(full)!.exports
    const module = { exports: {} }; modules.set(full, module)
    const localRequire = createRequire(full)
    const resolver = (name: string) => {
      const base = name.split('/').at(-1)!
      if (Object.hasOwn(mocks, name)) return mocks[name]
      if (Object.hasOwn(mocks, base)) return mocks[base]
      return name.startsWith('.') && name.endsWith('.cjs') ? load(localRequire.resolve(name)) : localRequire(name)
    }
    // Same realm as Zod: do not make test data look like cross-realm objects.
    new Function('require', 'module', 'exports', '__dirname', readFileSync(full, 'utf8'))(resolver, module, module.exports, dirname(full))
    return module.exports
  }
  const { createTrustedIpcRegistrar } = require(resolve('dist-electron/electron/ipc/trusted-ipc.cjs'))
  const registrar = createTrustedIpcRegistrar({ ipcMain: { handle: (name: string, handler: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(name, handler), on: vi.fn() }, getWindow: () => window, allowDevelopmentOrigin: false, automationEnabled: true, errorMessage: () => 'fixture error' })
  const { DesktopAutomationController: Controller } = load(resolve('dist-electron/electron/automation/desktop-automation-controller.cjs')) as { DesktopAutomationController: typeof DesktopAutomationController }
  const controller = new Controller({ automationEnabled: true, controlApiBase: 'https://control.invalid', runtimeRoot: root, getWindow: () => window as never, getDefaultFreightWorkbookPath: () => '', registerTrustedHandle: registrar.handle, registerAutomationHandle: registrar.automationHandle, registerTrustedOn: registrar.on, mayOpenExternalUrl: url => url === 'https://www.idtrade.cn', onActivityChanged: vi.fn(), showNotification: vi.fn() })
  controller.registerIpc()
  const invoke = async (name: string, ...args: unknown[]) => handlers.get(name)!({ sender, senderFrame: { url: sender.getURL() } }, ...args)
  const single = () => invoke('automation:start', { id: 'single_tool', name: 'fixture', targetUrl: 'https://fixture.test/tool', executionMode: 'live', launchGrant: { token: 'single-grant' }, executionContext: { input: { account: 'single-fixture' } } })
  const batch = async () => {
    await invoke('batch:select-import-file', {})
    await invoke('batch:create', { importId: 'import', batchId: 'batch', recordKind: 'live', tool: { id: 'batch_tool', name: 'fixture' } })
    await invoke('batch:register-browser', 'item', 3)
  }
  const startBatch = () => invoke('batch:start', { itemId: 'item', tool: { id: 'batch_tool', name: 'fixture', executionMode: 'live', launchGrant: { token: 'batch-grant' } } })
  cleanups.push(async () => { hold.open(); await controller.cleanup(); rmSync(root, { recursive: true, force: true }) })
  const guest = (partition: string, id: number, attach = true) => {
    let destroyed = false
    const created = Object.assign(new EventEmitter(), { id, hostWebContents: sender, session: electron.session.fromPartition(partition),
      getType: () => 'webview', isDestroyed: () => destroyed, close: vi.fn(() => { destroyed = true }) })
    guests.set(id, created)
    if (attach) controller.browserSessions.attached(created as never)
    return created
  }
  return { controller, single, batch, startBatch, invoke, hold, reached, runners, browserCalls, reportRequest, reportOutbox, root, electron, load, guest, sender, sessions, targetWindows, setCompetition: () => { competition = true }, changeOwner: (id: number) => { userId = id } }
}
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })

describe('R03/R25 shared execution ownership through real trusted IPC', () => {
  it.each(['auth', 'catalog', 'reservation', 'runner-start'])('cleanup invalidates a start suspended at %s', async stage => {
    const f = fixture(stage)
    const result = f.single().then(() => 'started', (e: Error) => e.message)
    await f.reached.promise
    expect(f.controller.hasActiveWork()).toBe(true)
    await f.controller.cleanup()
    f.hold.open()
    expect(await result).toContain('SESSION_REVOKED')
    expect(f.runners.filter(r => r.active)).toHaveLength(0)
    if (stage !== 'runner-start') expect(f.runners).toHaveLength(0)
    await expect(f.single()).rejects.toThrow('SESSION_REVOKED')
  })
  it.each(['single-first', 'batch-first', 'simultaneous'])('only one mode starts: %s', async order => {
    const f = fixture()
    await f.batch()
    if (order === 'single-first') { await f.single(); await expect(f.startBatch()).rejects.toThrow('已有任务') }
    else if (order === 'batch-first') { await f.startBatch(); await expect(f.single()).rejects.toThrow('已有任务') }
    else expect((await Promise.allSettled([f.single(), f.startBatch()])).filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(f.runners.filter(r => r.active)).toHaveLength(1)
    await f.runners[0]!.callbacks.onHostRequest('recovery.before-mutation', {})
    await f.runners[0]!.callbacks.onHostRequest('browser.action', { action: { kind: 'click' } })
    expect(f.browserCalls).toHaveLength(1)
  })
  it('cancel during preparation rejects the old launch without stopping an unrelated batch later', async () => {
    const f = fixture('auth')
    const pending = f.single().then(() => 'started', (e: Error) => e.message)
    await f.reached.promise
    await f.invoke('automation:cancel')
    await expect(f.single()).rejects.toThrow('尚未结束')
    f.hold.open()
    expect(await pending).toContain('SESSION_REVOKED')
    expect(f.runners).toHaveLength(0)
    await f.batch(); await f.startBatch()
    expect(f.runners.filter(r => r.active)).toHaveLength(1)
  })
  it('a waiting single cannot resume alongside batch; terminal late events cannot resurrect it', async () => {
    const f = fixture()
    await f.batch(); await f.single()
    const single = f.runners[0]!
    single.event('user.action_required')
    await f.startBatch()
    await expect(f.invoke('automation:complete-user-action')).rejects.toThrow('已有任务')
    expect(single.active).toBe(false)
    f.runners[1]!.event('run.completed')
    await Promise.resolve(); await Promise.resolve()
    await f.invoke('automation:complete-user-action')
    expect(single.active).toBe(true)
    single.event('run.completed')
    single.event('run.started')
    await expect(single.callbacks.onHostRequest('browser.action', {})).rejects.toThrow('SESSION_REVOKED')
    expect(f.controller.hasActiveWork()).toBe(false)
  })
  it('waiting batch retains its browser, cannot act, and resumes only after the single lease is released', async () => {
    const f = fixture()
    await f.batch(); await f.startBatch()
    const batch = f.runners[0]!
    batch.event('user.action_required')
    await f.single()
    await expect(batch.callbacks.onHostRequest('browser.action', {})).rejects.toThrow('执行许可')
    await f.invoke('batch:complete-user-action', 'item')
    expect(batch.active).toBe(false)
    await f.invoke('automation:cancel')
    await Promise.resolve(); await Promise.resolve()
    expect(batch.active).toBe(true)
    expect(f.runners.filter(r => r.active)).toHaveLength(1)
    // Delayed completion of the old single attempt cannot revive or own a browser.
    const old = f.runners[1]!
    old.event('run.started')
    await expect(old.callbacks.onHostRequest('browser.action', {})).rejects.toThrow('SESSION_REVOKED')
    expect(f.controller.activityState().singleRunActive).toBe(true) // the shared batch lease remains busy
  })
})

describe('R07 batch execution receipt persistence', () => {
  it('R06 rejects actual single and batch starts before Runner creation when all 200 slots are reserved', async () => {
    const f = fixture()
    await Promise.all(Array.from({ length: 200 }, (_, i) => f.reportOutbox.reserve(`held-${i}`)))
    await expect(f.single()).rejects.toThrow('已满')
    await f.batch()
    await expect(f.startBatch()).rejects.toThrow('已满')
    expect(f.runners).toHaveLength(0)
    expect(f.browserCalls).toHaveLength(0)
  })
  it('batch host uses the shared durable outbox; restart resends one receipt, never business work', async () => {
    const f = fixture()
    await f.batch(); await f.startBatch()
    const runner = f.runners[0]!
    expect(runner.callbacks.env.TOOLBOX_PERSIST_REPORTS).toBe('1')
    await runner.callbacks.onHostRequest('recovery.before-mutation', {})
    const receipt = { token: 'batch-grant', run_id: 'run-0', status: 'succeeded', error_code: null, adapter_version: 'test', page_fingerprint: null, page_changed: false, completed_steps: 3 }
    expect(await runner.callbacks.onHostRequest('execution.report', { ...receipt, input: 'never-store', password: 'never-store' })).toMatchObject({ warning: expect.stringContaining('本机') })
    runner.event('run.completed')
    const file = join(f.root, 'pending-records', readdirSync(join(f.root, 'pending-records'))[0]!)
    expect(readFileSync(file, 'utf8')).not.toContain('never-store')
    const { ExecutionReportOutbox } = require(resolve('dist-electron/electron/automation/execution-report-outbox.cjs'))
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { execution_id: 42 } })))
    const recovered = new ExecutionReportOutbox({ directory: join(f.root, 'pending-records'), apiBase: 'https://control.invalid', version: 'test', codec, request: send })
    await recovered.flush(); await recovered.flush()
    expect(send).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(send.mock.calls[0]![1]!.body))).toEqual(receipt)
    expect(f.runners).toHaveLength(1)
  })
  it('batch in-flight reservation cannot launch a process after cancellation', async () => {
    const f = fixture('reservation')
    await f.batch()
    const pending = f.startBatch().then(() => 'started', (e: Error) => e.message)
    await f.reached.promise
    await f.invoke('batch:cancel', 'cancelled')
    f.hold.open()
    expect(await pending).toContain('原批次准备已失效')
    expect(f.runners).toHaveLength(0)
  })
})

describe('R04 installed WebView event policy', () => {
  it('opens competition recovery inside the guarded target and preserves recovery ownership', async () => {
    const test = fixture(); test.setCompetition()
    const internals = test.controller as unknown as {
      resolveRecoveryOwner(sender: unknown): Promise<string>
      recovery: { begin(owner: string, tool: Data, input: Data): { id: string } }
    }
    const owner = await internals.resolveRecoveryOwner(test.sender)
    const record = internals.recovery.begin(owner, { id: 'tool', targetUrl: 'https://www.idtrade.cn/User/Contest' }, {})
    await test.invoke('recovery:open-platform', record.id)
    expect(test.electron.shell.openExternal).not.toHaveBeenCalled()
    expect(test.targetWindows).toHaveLength(1)
    expect(test.targetWindows[0]!.url).toBe('https://www.idtrade.cn/')
    const event = { preventDefault: vi.fn() }
    test.targetWindows[0]!.webContents.emit('will-redirect', event, 'https://outside.test/')
    expect(event.preventDefault).toHaveBeenCalledOnce()
    test.changeOwner(2)
    await expect(test.invoke('recovery:open-platform', record.id)).rejects.toThrow()
    expect(test.electron.shell.openExternal).not.toHaveBeenCalled()
    expect(test.targetWindows).toHaveLength(1)
  })
  it('does not turn recovery navigation into a public external link after logout', async () => {
    const test = fixture(); test.setCompetition()
    const internals = test.controller as unknown as {
      resolveRecoveryOwner(sender: unknown): Promise<string>
      recovery: { begin(owner: string, tool: Data, input: Data): { id: string }; origin(owner: string, id: string): string }
    }
    const owner = await internals.resolveRecoveryOwner(test.sender)
    const record = internals.recovery.begin(owner, { id: 'tool', targetUrl: 'https://www.idtrade.cn/User/Contest' }, {})
    const origin = internals.recovery.origin.bind(internals.recovery)
    vi.spyOn(internals.recovery, 'origin').mockImplementation((key, id) => {
      const url = origin(key, id)
      vi.spyOn(test.sender, 'executeJavaScript').mockResolvedValue('')
      return url
    })
    await expect(test.invoke('recovery:open-platform', record.id)).rejects.toThrow('身份已变化')
    expect(test.electron.shell.openExternal).not.toHaveBeenCalled()
    expect(test.targetWindows).toHaveLength(0)
  })
  it('competition external links stay in guarded Electron instead of escaping through OS redirects', async () => {
    const test = fixture(); test.setCompetition()
    const targets = (test.controller as unknown as { targets: { openAssignedUrl(sender: unknown, url: string): Promise<void> } }).targets
    const open = vi.spyOn(targets, 'openAssignedUrl').mockResolvedValue()
    expect(await test.controller.checkExternalNavigation(test.sender as never, 'https://www.idtrade.cn/path')).toBe(false)
    expect(open).toHaveBeenCalledWith(test.sender, 'https://www.idtrade.cn/path', undefined)
    await expect(test.controller.checkExternalNavigation(test.sender as never, 'https://www.idtrade.cn.evil.test/path')).rejects.toThrow('SCENARIO_ROUTE_BLOCKED')
    expect(open).toHaveBeenCalledOnce()
  })
  it('allows V2 login/list/detail redirects and rejects other HTTP targets', () => {
    const f = fixture()
    const { installWebContentsNavigationPolicy } = f.load(resolve('dist-electron/electron/core/main-window.cjs')) as { installWebContentsNavigationPolicy(fn: () => boolean): void }
    installWebContentsNavigationPolicy(() => false)
    const guest = Object.assign(new EventEmitter(), { getType: () => 'webview', setWindowOpenHandler: vi.fn() })
    f.electron.app.emit('web-contents-created', {}, guest)
    for (const eventName of ['will-navigate', 'will-redirect']) {
      for (const url of ['http://www.bjysoft.cn:8730/User/Welcome6', 'http://www.bjysoft.cn:8732/ECrossAmazon/SellerOrderList', 'http://www.bjysoft.cn:8732/ECrossAmazon/SellerOrderDetails']) {
        const preventDefault = vi.fn(); guest.emit(eventName, { preventDefault }, url); expect(preventDefault).not.toHaveBeenCalled()
      }
      for (const url of ['http://www.bjysoft.cn:8733/', 'http://www.bjysoft.cn.evil.invalid:8732/', 'http://bjysoft.cn:8732/', 'http://u:p@www.bjysoft.cn:8732/', 'file:///private', 'http://sellercentral.amazon.com/']) {
        const preventDefault = vi.fn(); guest.emit(eventName, { preventDefault }, url); expect(preventDefault).toHaveBeenCalledOnce()
      }
    }
  })
})

describe('owner-derived single browser sessions', () => {
  it('retires legacy and target account sessions in both directions, including late legacy attachment', async () => {
    const test = fixture()
    const legacy = await test.invoke('automation:prepare-browser', 'amazon') as { partition: string }
    expect(test.controller.browserSessions.approve(legacy.partition, {})).toBe(true)
    const guest = test.guest(legacy.partition, 101)
    await test.invoke('automation:register-browser', 101)
    expect(test.controller.browserSessions.approve(legacy.partition, {})).toBe(true)
    await test.invoke('targets:open', { entryUrl: 'https://fixture.test/login' })
    expect(guest.close).toHaveBeenCalledOnce()
    expect(test.controller.browserSessions.hasGrant).toBe(false)
    expect(test.guest(legacy.partition, 102).close).toHaveBeenCalledOnce()
    expect(test.controller.browserSessions.approve(legacy.partition, {})).toBe(false)
    const target = test.targetWindows[0]!
    expect(target.isDestroyed()).toBe(false)
    const replacement = await test.invoke('automation:prepare-browser', 'amazon') as { partition: string }
    expect(target.isDestroyed()).toBe(true)
    expect(replacement.partition).not.toBe(legacy.partition)
    expect(test.sessions.get(target.configuration.webPreferences.partition)).toMatchObject({ clearStorageData: expect.any(Function) })
    const targetSession = test.sessions.get(target.configuration.webPreferences.partition) as { clearStorageData: ReturnType<typeof vi.fn> }
    expect(targetSession.clearStorageData).toHaveBeenCalledOnce()
  })
  it('does not issue a legacy account grant while a target open is still in flight', async () => {
    const test = fixture('target-load')
    const pending = test.invoke('targets:open', { entryUrl: 'https://fixture.test/login' })
    await test.reached.promise
    await expect(test.invoke('automation:prepare-browser', 'amazon')).rejects.toThrow('RUN_ALREADY_ACTIVE')
    expect(test.controller.browserSessions.hasGrant).toBe(false)
    expect(test.targetWindows.filter(window => !window.isDestroyed())).toHaveLength(1)
    test.hold.open(); await pending
  })
  it('changes verified owner, stops old work, destroys old guest and refuses its late registration', async () => {
    const f = fixture()
    const a = await f.invoke('automation:prepare-browser', 'amazon') as { partition: string }
    expect(a.partition).toMatch(/^kst-workspace-v2-[a-f0-9]{64}$/)
    expect(f.controller.browserSessions.approve(a.partition, {})).toBe(true)
    const old = f.guest(a.partition, 100)
    await f.invoke('automation:register-browser', 100)
    await f.single()
    f.changeOwner(2)
    const b = await f.invoke('automation:prepare-browser', 'amazon') as { partition: string }
    expect(b.partition).not.toBe(a.partition)
    expect(old.close).toHaveBeenCalledOnce()
    expect(f.runners.filter(r => r.active)).toHaveLength(0)
    await expect(f.invoke('automation:register-browser', 100)).rejects.toThrow('BROWSER_OWNER_CHANGED')
    expect(f.controller.browserSessions.approve(a.partition, {})).toBe(false)
    expect(f.controller.browserSessions.approve('persist:tool-workspace', {})).toBe(false)
    expect(f.controller.browserSessions.approve('persist:kst-workspace-v1-' + 'a'.repeat(64), {})).toBe(false)
  })
  it('uses fresh sessions after logout and never adopts previous account cookies', async () => {
    const f = fixture()
    const a = await f.invoke('automation:prepare-browser', 'amazon') as { partition: string }
    await f.invoke('recovery:revoke-session')
    expect(f.controller.browserSessions.approve(a.partition, {})).toBe(false)
    expect(await f.invoke('automation:prepare-browser', 'amazon')).not.toEqual(a)
    const other = await f.invoke('automation:prepare-browser', 'aliexpress') as { partition: string }
    expect(other.partition).not.toBe(a.partition)
    expect(f.controller.browserSessions.approve('batch-attempt-1', {})).toBe(true)
    const batchGuest = f.guest('batch-attempt-1', 200)
    await expect(f.invoke('automation:register-browser', 200)).rejects.toThrow('BROWSER_OWNER_CHANGED')
    expect(batchGuest.close).not.toHaveBeenCalled()
  })
  it('rejects a guest attached after revocation and a pending prepare after logout', async () => {
    const f = fixture()
    const a = await f.invoke('automation:prepare-browser', 'amazon') as { partition: string }
    f.controller.browserSessions.approve(a.partition, {})
    await f.invoke('recovery:revoke-session')
    const stale = f.guest(a.partition, 100)
    expect(stale.close).toHaveBeenCalledOnce()
    const pending = fixture('auth')
    const result = pending.invoke('automation:prepare-browser', 'amazon').catch((error: Error) => error.message)
    await pending.reached.promise
    await pending.invoke('recovery:revoke-session')
    pending.hold.open()
    expect(await result).toContain('SESSION_REVOKED')
  })
})
