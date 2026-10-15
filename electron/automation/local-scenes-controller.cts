import { app, net, session, WebContentsView, type BrowserWindow, type WebContents } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { sceneOpenSchema, type ScenarioPolicy } from '../../src/shared/ipc/scenario-contract.js'
import type { TrustedHandleRegistrar } from '../ipc/trusted-ipc.cjs'
import { ScenarioPolicyClient } from './scenario-policy-client.cjs'
import type { TargetWindow } from './targets/target-controller.cjs'

type Scene = { id: string; label: string; origin: string; owner: string; view: WebContentsView; views: Set<WebContentsView>; partition: string; blocked: boolean }
interface Options {
  register: TrustedHandleRegistrar
  getWindow(): BrowserWindow | null | undefined
  apiBase: string
  deviceId(): string
  hasActiveWork(): boolean
}

/** Local only: views, Cookies and files never leave this computer. Running tools
 * requires the independent, server-consumed staff grant in TargetController. */
export class LocalScenesController {
  private scenes = new Map<string, Scene>()
  private selected: string | null = null
  private owner: string | null = null
  private ownerToken: string | null = null
  private visible = false
  private bounds = { x: 0, y: 0, width: 0, height: 0 }
  private readonly policy: ScenarioPolicyClient
  constructor(private readonly options: Options) {
    this.policy = new ScenarioPolicyClient(token => this.api(token, '/api/scenarios/me'), () => this.block())
  }

  private async api(token: string, path: string, body?: unknown): Promise<unknown> {
    const response = await net.fetch(`${this.options.apiBase}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Toolbox-Version': app.getVersion() },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error('LOCAL_SCENE_PERMISSION_DENIED: 本机工作台未授权或权限已失效')
    const envelope = await response.json() as { success?: boolean; data?: unknown }
    if (envelope.success !== true) throw new Error('LOCAL_SCENE_PERMISSION_INVALID')
    return envelope.data
  }

  private async authorized(sender: WebContents): Promise<{ token: string; policy: ScenarioPolicy }> {
    const token = await sender.executeJavaScript('sessionStorage.getItem("toolbox_token")', false) as unknown
    if (typeof token !== 'string' || !token) throw new Error('请先登录后台账号')
    const policy = await this.policy.refresh(token)
    if (policy.principal.kind !== 'staff' || policy.status !== 'active') throw new Error('此工作台只开放给已单独授权的内部管理员')
    if (sender.isDestroyed() || sender !== this.options.getWindow()?.webContents || await sender.executeJavaScript('sessionStorage.getItem("toolbox_token")', false) !== token) throw new Error('工作台身份已变化')
    const owner = `${policy.principal.kind}:${policy.principal.id}`
    if (this.owner && this.owner !== owner) this.clearViews()
    this.owner = owner
    this.ownerToken = token
    return { token, policy }
  }

  /** Retiring local credentials is not a new run: an expired/revoked/offline
   * policy must not trap its owner in a logged-in browser. The current trusted
   * window and exact previously authenticated session still own the cleanup. */
  private async authorizeCleanup(sender: WebContents, id: string): Promise<void> {
    const scene = this.owned(id)
    if (sender.isDestroyed() || sender !== this.options.getWindow()?.webContents) throw new Error('无效工作台窗口')
    const token = await sender.executeJavaScript('sessionStorage.getItem("toolbox_token")', false) as unknown
    if (!token || token !== this.ownerToken || sender.isDestroyed() || sender !== this.options.getWindow()?.webContents
      || this.scenes.get(id) !== scene || scene.owner !== this.owner) throw new Error('账号现场不属于当前管理员')
  }

  register(): void {
    const on = this.options.register
    on('scenes:policy', async event => (await this.authorized(event.sender)).policy)
    on('scenes:list', async event => { await this.authorized(event.sender); return this.list() })
    on('scenes:open', async (event, input: unknown) => {
      const request = sceneOpenSchema.parse(input)
      const { token, policy } = await this.authorized(event.sender)
      if (this.options.hasActiveWork()) throw new Error('任务正在执行，请先结束当前任务再打开其他账号')
      this.policy.assertAllowed(request.entryUrl)
      if (this.scenes.has(request.accountSlot)) throw new Error('账号槽位已存在，请选择原现场或先关闭')
      if (this.scenes.size >= policy.maxScenes) throw new Error(`当前最多保留 ${policy.maxScenes} 个本机现场`)
      const origin = new URL(request.entryUrl).origin
      await this.api(token, '/api/scenarios/staff/launch-grant', { device_id: this.options.deviceId(), account_slot: request.accountSlot, origin })
      const current = await this.authorized(event.sender)
      if (current.policy.revision !== policy.revision) throw new Error('工作台授权已变化，请重新打开')
      if (this.options.hasActiveWork() || this.scenes.has(request.accountSlot) || this.scenes.size >= current.policy.maxScenes) throw new Error('账号现场或执行状态已变化，请刷新后重试')
      // Non-persistent partition and a fresh nonce ensure closing/recreating a
      // slot never silently adopts an old account's authenticated session.
      const partition = `kst-staff-${createHash('sha256').update(JSON.stringify([this.owner, origin, request.accountSlot, policy.mode, randomUUID()])).digest('hex')}`
      const browserSession = session.fromPartition(partition)
      browserSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
      browserSession.setPermissionCheckHandler(() => false)
      browserSession.on('will-download', event => event.preventDefault())
      const view = new WebContentsView({ webPreferences: { session: browserSession, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, devTools: false } })
      const scene: Scene = { id: request.accountSlot, label: request.label, origin, owner: this.owner!, view, views: new Set([view]), partition, blocked: false }
      const allowed = (raw: string): boolean => this.allows(scene, raw)
      this.configureView(scene, view)
      browserSession.webRequest.onBeforeRequest((details, callback) => {
        // Include iframe documents. Static resources may reside on CDNs; their
        // bytes do not grant a separate top-level/account navigation origin.
        const document = details.resourceType === 'mainFrame' || details.resourceType === 'subFrame'
        callback({ cancel: scene.blocked || (document && !allowed(details.url)) })
      })
      this.scenes.set(scene.id, scene)
      this.selected = scene.id
      this.visible = true
      this.render()
      try { await view.webContents.loadURL(request.entryUrl) }
      catch (error) { this.close(scene.id); throw error }
      return this.list()
    })
    on('scenes:select', async (event, id: string) => {
      await this.authorized(event.sender)
      if (id !== this.selected && this.options.hasActiveWork()) throw new Error('任务正在执行，请先结束当前任务再切换账号')
      this.owned(id); this.selected = id; this.visible = true; this.render()
    })
    on('scenes:close', async (event, id: string) => { await this.authorizeCleanup(event.sender, id); if (this.options.hasActiveWork()) throw new Error('任务尚未结束，请先停止再清理账号现场'); this.close(id) })
    on('scenes:bounds', async (event, bounds: typeof this.bounds) => {
      if (event.sender !== this.options.getWindow()?.webContents) throw new Error('无效工作台窗口')
      this.bounds = bounds; this.render()
    })
    on('scenes:hide', () => { this.visible = false; this.render() })
  }

  private owned(id: string): Scene {
    const scene = this.scenes.get(id)
    if (!scene || scene.owner !== this.owner) throw new Error('账号现场不存在或不属于当前管理员')
    return scene
  }
  private allows(scene: Scene, raw: string): boolean {
    return !scene.blocked && scene.owner === this.owner && this.policy.allows(raw)
  }
  private defaultPopup(scene: Scene, view: WebContentsView): void {
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (this.allows(scene, url)) void view.webContents.loadURL(url).catch(() => undefined)
      return { action: 'deny' }
    })
  }
  private configureView(scene: Scene, view: WebContentsView): void {
    view.webContents.on('will-navigate', (event, url) => { if (!this.allows(scene, url)) event.preventDefault() })
    view.webContents.on('will-redirect', (event, url) => { if (!this.allows(scene, url)) event.preventDefault() })
    view.webContents.on('will-frame-navigate', event => { if (!this.allows(scene, event.url)) event.preventDefault() })
    view.webContents.on('will-attach-webview', event => event.preventDefault())
    this.defaultPopup(scene, view)
  }
  /** Target-owned popup handoff uses another native view in this exact slot's
   * Session, never searches other accounts or creates a customer partition. */
  targetWindow(accountSlot: string, create = false): TargetWindow {
    const scene = this.owned(accountSlot)
    if (this.selected !== accountSlot || scene.blocked) throw new Error('当前管理员现场已变化')
    const view = create ? new WebContentsView({ webPreferences: { session: session.fromPartition(scene.partition), nodeIntegration: false,
      contextIsolation: true, sandbox: true, webSecurity: true, devTools: false } }) : scene.view
    if (create) { scene.views.add(view); this.configureView(scene, view) }
    const show = () => { if (view.webContents.isDestroyed() || scene.blocked) return; scene.view = view; this.render(); view.webContents.focus() }
    return {
      webContents: view.webContents, isDestroyed: () => view.webContents.isDestroyed(), show, focus: show,
      loadURL: async url => { if (!this.allows(scene, url)) throw new Error('管理员现场站点未获批准'); await view.webContents.loadURL(url); show() },
      on: (event, listener) => event === 'closed' ? view.webContents.on('destroyed', listener) : view.webContents.on('focus', listener),
      destroy: () => {
        if (!create) { this.defaultPopup(scene, view); return }
        this.options.getWindow()?.contentView.removeChildView(view)
        scene.views.delete(view)
        view.webContents.close({ waitForBeforeUnload: false })
        if (scene.view === view) { const previous = [...scene.views].find(item => !item.webContents.isDestroyed()); if (previous) scene.view = previous }
        this.render()
      },
    }
  }
  selectedScene(): { accountSlot: string; owner: string; webContents: WebContents } {
    if (!this.selected) throw new Error('请先选择本机账号现场')
    const scene = this.owned(this.selected)
    if (scene.blocked || scene.view.webContents.isDestroyed()) throw new Error('账号现场已失效，请重新打开')
    return { accountSlot: scene.id, owner: scene.owner, webContents: scene.view.webContents }
  }
  private list() { return [...this.scenes.values()].map(scene => ({ id: scene.id, label: scene.label, origin: scene.origin, status: scene.blocked ? 'policy_blocked' as const : 'ready' as const, selected: this.selected === scene.id })) }
  private render(): void {
    const window = this.options.getWindow()
    if (!window || window.isDestroyed()) return
    const area = window.getContentBounds()
    const bounds = { x: Math.min(this.bounds.x, area.width), y: Math.min(this.bounds.y, area.height),
      width: Math.max(0, Math.min(this.bounds.width, area.width - this.bounds.x)), height: Math.max(0, Math.min(this.bounds.height, area.height - this.bounds.y)) }
    for (const scene of this.scenes.values()) {
      const show = this.visible && scene.id === this.selected && !scene.blocked && bounds.width > 0 && bounds.height > 0
      for (const view of scene.views) window.contentView.removeChildView(view)
      if (show) { window.contentView.addChildView(scene.view); scene.view.setBounds(bounds) }
    }
  }
  private block(): void {
    for (const scene of this.scenes.values()) { scene.blocked = true; for (const view of scene.views) view.webContents.stop() }
    this.render()
  }
  private close(id: string): void {
    const scene = this.owned(id)
    for (const view of scene.views) {
      this.options.getWindow()?.contentView.removeChildView(view)
      view.webContents.close({ waitForBeforeUnload: false })
    }
    void session.fromPartition(scene.partition).clearStorageData().catch(() => undefined)
    this.scenes.delete(id)
    if (this.selected === id) this.selected = this.scenes.keys().next().value ?? null
    this.render()
  }
  private clearViews(): void { for (const id of [...this.scenes.keys()]) this.close(id) }
  dispose(): void { this.clearViews(); this.owner = null; this.ownerToken = null; this.policy.reset() }
}
