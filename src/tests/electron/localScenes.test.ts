import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LocalScenesController } from '../../../electron/automation/local-scenes-controller.cjs'
import type { TrustedHandleRegistrar } from '../../../electron/ipc/trusted-ipc.cjs'
import type { ScenarioPolicy } from '../../shared/ipc/scenario-contract'

const controllers: LocalScenesController[] = []
afterEach(() => { for (const controller of controllers.splice(0)) controller.dispose() })
function setup() {
  const source = resolve('dist-electron/electron/automation/local-scenes-controller.cjs')
  const require = createRequire(source)
  let active = false
  let token = 'staff-A'
  let policy: ScenarioPolicy = { schemaVersion: 1, principal: { kind: 'staff', id: 'A' }, revision: '1', status: 'active', mode: 'training', entryUrl: null,
    allowedOrigins: ['https://fixture.test'], maxScenes: 6, checkedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(), refreshAfterSeconds: 30 }
  const sender = { isDestroyed: () => false, executeJavaScript: async () => token }
  const window = { webContents: sender, isDestroyed: () => false, getContentBounds: () => ({ width: 1400, height: 900 }), contentView: { addChildView: vi.fn(), removeChildView: vi.fn() } }
  const sessions = new Map<string, EventEmitter & { clearStorageData: ReturnType<typeof vi.fn>; webRequest: { onBeforeRequest: ReturnType<typeof vi.fn> } }>()
  const fromPartition = (partition: string) => {
    if (!sessions.has(partition)) sessions.set(partition, Object.assign(new EventEmitter(), { clearStorageData: vi.fn(async () => {}), setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), webRequest: { onBeforeRequest: vi.fn() } }))
    return sessions.get(partition)!
  }
  const views: View[] = []
  class View {
    url = 'about:blank'; dead = false
    webContents: EventEmitter & { id: number; session: object; isDestroyed(): boolean; getURL(): string; loadURL: ReturnType<typeof vi.fn>; setWindowOpenHandler: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> }
    setBounds = vi.fn()
    constructor(readonly options: { webPreferences: { session: object } }) {
      this.webContents = Object.assign(new EventEmitter(), { id: views.length + 10, session: options.webPreferences.session, isDestroyed: () => this.dead, getURL: () => this.url,
        loadURL: vi.fn(async (url: string) => { this.url = url }), setWindowOpenHandler: vi.fn(), stop: vi.fn(), focus: vi.fn(), close: vi.fn(() => { this.dead = true; this.webContents.emit('destroyed') }) })
      views.push(this)
    }
  }
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ success: true, data: policy }) }))
  const module = { exports: {} }
  new Function('require', 'module', 'exports', readFileSync(source, 'utf8'))((name: string) => name === 'electron' ? { app: { getVersion: () => 'test' }, session: { fromPartition }, WebContentsView: View, net: { fetch } } : require(name), module, module.exports)
  const Constructor = (module.exports as { LocalScenesController: typeof LocalScenesController }).LocalScenesController
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
  const register = ((name, handler) => handlers.set(name, handler as never)) as TrustedHandleRegistrar
  const controller = new Constructor({ register, getWindow: () => window as never, apiBase: 'https://control.test', deviceId: () => 'device-A', hasActiveWork: () => active })
  controllers.push(controller); controller.register()
  const invokeAs = (from: unknown, name: string, ...args: unknown[]) => handlers.get(`scenes:${name}`)!({ sender: from }, ...args)
  const invoke = (name: string, ...args: unknown[]) => invokeAs(sender, name, ...args)
  const open = (slot: string) => invoke('open', { accountSlot: slot, label: slot, entryUrl: 'https://fixture.test/login' })
  return { controller, invoke, invokeAs, open, views, sessions, fetch, setActive: (value: boolean) => { active = value }, setPolicy: (value: Partial<ScenarioPolicy>) => { policy = { ...policy, ...value } }, setToken: (value: string) => { token = value } }
}

describe('administrator native account scenes', () => {
  it('opens at least three isolated accounts with six default and ten maximum from policy', async () => {
    const test = setup()
    for (const slot of ['one', 'two', 'three']) await test.open(slot)
    expect(new Set(test.views.map(view => view.webContents.session)).size).toBe(3)
    expect(test.sessions.size).toBe(3)
    for (const slot of ['four', 'five', 'six']) await test.open(slot)
    await expect(test.open('seven')).rejects.toThrow('6')
    test.setPolicy({ revision: '2', maxScenes: 10 }); await test.invoke('policy')
    for (const slot of ['seven', 'eight', 'nine', 'ten']) await test.open(slot)
    await expect(test.open('eleven')).rejects.toThrow('10')
  })
  it('refuses to switch/open/clear during a runner and cleans only the retired account', async () => {
    const test = setup(); await test.open('one'); await test.open('two')
    test.setActive(true)
    await expect(test.invoke('select', 'one')).rejects.toThrow('任务')
    await expect(test.open('three')).rejects.toThrow('任务')
    await expect(test.invoke('close', 'two')).rejects.toThrow('任务')
    test.setActive(false); await test.invoke('close', 'one')
    expect(test.views[0]!.webContents.close).toHaveBeenCalledOnce()
    expect(test.views[1]!.webContents.close).not.toHaveBeenCalled()
    expect([...test.sessions.values()][0]!.clearStorageData).toHaveBeenCalledOnce()
    await test.open('one')
    expect(test.views[2]!.webContents.session).not.toBe(test.views[0]!.webContents.session)
  })
  it('blocks redirect, iframe and popup escape and invalidates all views on policy change', async () => {
    const test = setup(); await test.open('one')
    const view = test.views[0]!
    for (const eventName of ['will-navigate', 'will-redirect']) {
      const event = { preventDefault: vi.fn() }; view.webContents.emit(eventName, event, 'https://fixture.test.evil.test')
      expect(event.preventDefault).toHaveBeenCalledOnce()
    }
    const event = { url: 'https://fixture.test:444/frame', preventDefault: vi.fn() }; view.webContents.emit('will-frame-navigate', event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    const popup = view.webContents.setWindowOpenHandler.mock.calls.at(-1)![0]
    popup({ url: 'https://evil.test' }); expect(view.webContents.loadURL).toHaveBeenCalledTimes(1)
    test.setPolicy({ revision: '2' }); await test.invoke('policy')
    expect(view.webContents.stop).toHaveBeenCalled()
    expect(await test.invoke('list')).toEqual([expect.objectContaining({ status: 'policy_blocked' })])
  })
  it.each(['revoked', 'expired', 'offline'])('allows the scene owner to clear credentials after policy is %s', async reason => {
    const test = setup(); await test.open('one')
    if (reason === 'revoked') test.setPolicy({ status: 'blocked' })
    if (reason === 'expired') test.setPolicy({ expiresAt: new Date(Date.now() - 1000).toISOString() })
    if (reason === 'offline') test.fetch.mockRejectedValue(new Error('offline'))
    await expect(test.invoke('policy')).rejects.toThrow()
    const requests = test.fetch.mock.calls.length
    await test.invoke('close', 'one')
    expect(test.fetch).toHaveBeenCalledTimes(requests)
    expect(test.views[0]!.webContents.close).toHaveBeenCalledOnce()
    expect([...test.sessions.values()][0]!.clearStorageData).toHaveBeenCalledOnce()
    expect(() => test.controller.selectedScene()).toThrow('请先选择')
  })
  it('does not let another window or changed login clean the old owner scene', async () => {
    const test = setup(); await test.open('one')
    await expect(test.invokeAs({ isDestroyed: () => false, executeJavaScript: async () => 'staff-A' }, 'close', 'one')).rejects.toThrow('窗口')
    test.setToken('staff-B')
    await expect(test.invoke('close', 'one')).rejects.toThrow('不属于')
    expect(test.views[0]!.webContents.close).not.toHaveBeenCalled()
    expect([...test.sessions.values()][0]!.clearStorageData).not.toHaveBeenCalled()
  })
  it('creates child views only inside the selected staff account session for target handoff', async () => {
    const test = setup(); await test.open('one')
    const child = test.controller.targetWindow('one', true)
    expect(child.webContents.session).toBe(test.views[0]!.webContents.session)
    await child.loadURL('https://fixture.test/seller')
    expect(test.controller.selectedScene().webContents).toBe(child.webContents)
    await expect(child.loadURL('https://evil.test')).rejects.toThrow('批准')
    child.destroy()
    expect(test.controller.selectedScene().webContents).toBe(test.views[0]!.webContents)
    expect(test.views[0]!.webContents.close).not.toHaveBeenCalled()
  })
})
