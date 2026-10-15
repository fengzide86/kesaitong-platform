import { app, BrowserWindow, net, session, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { z } from 'zod'
import { signedTargetProfileSchema, TARGET_RUNNER_API_VERSION, type OperationReceipt, type ProbeObservation, type RunPlan, type RunPlanPreview, type SignedTargetProfile, type TargetOpenRequest, type TargetPreflightRequest } from '../../../src/shared/ipc/target-contract.js'
import type { TrustedHandleRegistrar } from '../../ipc/trusted-ipc.cjs'
import type { ExecutionLease, ExecutionPermit } from '../execution-lease.cjs'
import type { ExecutionReportOutbox } from '../execution-report-outbox.cjs'
import { TargetOperationJournal } from './operation-journal.cjs'
import { checkedUrl, redactedUrl, routeAllowed, targetError, targetHash, verifyTargetProfile } from './profile-policy.cjs'
import { buildTargetPlan, assertPlanContext, TEMPLATE_RECIPE } from './run-plan.cjs'
import { probeContext } from './v2-probe.cjs'
import { createOwnedWebContentsPort, type OwnedWebContentsPort } from './webcontents-port.cjs'
import { OwnedNavigationScope } from './navigation-scope.cjs'
import { validateLocalContext, assertVerifiedPageContext, type VerifiedLocalContext, type LocalLoginEvidence } from './verified-context.cjs'
import { reconcileV2Template } from './v2-template.cjs'
import { resolveUiBinding } from './ui-bindings.cjs'
import { TargetRunnerClient } from './target-runner-client.cjs'
import type { TargetBrowserPort, BrowserSnapshot } from './contracts.cjs'

const { verifyToolManifest } = require('../manifest-verifier.cjs') as { verifyToolManifest(tool: unknown, key: string): { verified: boolean } }
export type TargetSessionOwner = { owner: string; token: string; kind?: 'customer' | 'staff'; deviceId?: string; accountSlot?: string }
type SessionOwner = TargetSessionOwner
export type TargetWindow = Pick<BrowserWindow, 'webContents' | 'isDestroyed' | 'show' | 'focus' | 'destroy' | 'loadURL'> & {
  on(event: 'focus' | 'closed', listener: () => void): unknown
}
interface Options {
  register: TrustedHandleRegistrar; lease: ExecutionLease; reports: ExecutionReportOutbox
  resolveSession(sender: WebContents): Promise<SessionOwner>
  directory: string; apiBase: string; publicKeyB64: string; signingKeyId: string
  assertScenario?(url: string, mode?: 'training' | 'competition'): void
  scenarioAllows?(url: string): boolean
  borrowedWindow?(owner: SessionOwner): TargetWindow | undefined
  createBorrowedWindow?(owner: SessionOwner): TargetWindow
  beforeCustomerOpen?(): void
  staffReports?: ExecutionReportOutbox
}
interface Site {
  owner: string; key: string; epoch: number; active: TargetWindow; windows: Set<TargetWindow>
  signed: SignedTargetProfile | null; initialOrigin: string; port?: TargetBrowserPort; portOrigin?: string
  entryUrl: string; profileId?: string
  navigation: OwnedNavigationScope; navigationBusy: boolean
  loginEvidence?: LocalLoginEvidence; verifiedContext?: VerifiedLocalContext
  courseContext?: { courseId: string; companyId: string; shopId: string; userId: string }
  verifiedRole?: string
  loginFailure?: string
  clearSession?: () => Promise<void>
}
interface PendingPlan { owner: string; siteEpoch: number; plan: RunPlan; expected: ProbeObservation; toolId: string | number; enabled: boolean }
interface OperationScope { permit: ExecutionPermit; epoch: number; drain?: Promise<void> }
const envelope = z.object({ success: z.literal(true), data: z.unknown() })
const grantSchema = z.object({ launch_data: z.object({
  token: z.string().min(1).max(16384), tool_id: z.union([z.string(), z.number()]), platform_key: z.literal('amazon'),
  script_key: z.string(), tool_version: z.string(), runner_api_version: z.literal(2),
  signature_required: z.literal(true), tool_signature: z.string().min(1), signing_key_id: z.string(),
  tool_manifest: z.object({ schemaVersion: z.literal(2), targetProfileId: z.string(), targetProfileRevision: z.number(), requiredCapability: z.string() }).passthrough(),
  target_profile: signedTargetProfileSchema,
}) })

/** All entry points are trusted IPC. The renderer never chooses a debug target,
 * imports a script, supplies a signature, or instructs the browser directly. */
export class TargetExecutionController {
  private site: Site | null = null
  private epoch = 0
  private plans = new Map<string, PendingPlan>()
  private store?: TargetOperationJournal
  private runner: TargetRunnerClient | null = null
  private readonly operations = new AsyncLocalStorage<OperationScope>()
  private readonly configuredSessions = new WeakSet<Electron.Session>()
  private readonly windowLoads = new WeakMap<TargetWindow, Promise<void>>()
  constructor(private readonly options: Options) {}
  private journal(): TargetOperationJournal { return this.store ??= new TargetOperationJournal(this.options.directory) }
  openAssignedUrl(sender: WebContents, entryUrl: string, expectedOwner?: string): Promise<void> {
    return this.exclusive(sender, owner => {
      if (expectedOwner && owner.owner !== expectedOwner) throw targetError('TARGET_SESSION_REVOKED', '恢复记录所属账号已经变化')
      return this.open(owner, { entryUrl })
    })
  }
  register(): void {
    const on = this.options.register
    on('targets:open', (event, request: TargetOpenRequest) => this.exclusive(event.sender, owner => this.open(owner, request)))
    on('targets:refresh', event => this.exclusive(event.sender, async owner => {
      const site = this.requireSite(owner.owner)
      this.plans.clear()
      await this.open(owner, { entryUrl: site.entryUrl, profileId: site.profileId }, true)
    }))
    on('targets:detect', event => this.exclusive(event.sender, async owner => {
      const site = this.requireSite(owner.owner)
      if (checkedUrl(site.active.webContents.getURL()).pathname === '/ECrossAmazonHome/CourseIndexTraining_1') {
        // An explicit fresh detection may select another course for the same
        // logged-in user. Rebuild proof; never force the previous course onto it.
        site.verifiedContext = undefined; site.courseContext = undefined; site.verifiedRole = undefined
      }
      const snapshot = await this.port(owner.owner).inspect()
      if (snapshot.path === '/ECrossAmazonHome/CourseIndexTraining_1') await this.collectCourseIdentity(owner.owner)
      return probeContext(this.port(owner.owner))
    }))
    on('targets:preflight', (event, request: TargetPreflightRequest) => this.exclusive(event.sender, owner => this.preflight(owner, request)))
    on('targets:execute', (event, request: { planId: string }) => this.exclusive(event.sender, owner => this.execute(owner, request.planId)))
    on('targets:reconcile', (event, request: { operationId: string }) => this.exclusive(event.sender, owner => this.reconcile(owner, request.operationId)))
    on('targets:list-receipts', async event => this.journal().list((await this.options.resolveSession(event.sender)).owner))
    on('targets:close', async event => { const owner = await this.options.resolveSession(event.sender); if (this.site?.owner === owner.owner) this.close() })
  }
  private async exclusive<T>(sender: WebContents, action: (owner: SessionOwner) => Promise<T>): Promise<T> {
    const permit = this.options.lease.acquire()
    const scope: OperationScope = { permit, epoch: this.epoch }
    try {
      // A revoked operation can still finish a network wait while a new owner
      // starts another operation. Its continuation must never borrow that
      // newer operation's permit or epoch.
      return await this.operations.run(scope, async () => {
        const owner = await this.options.resolveSession(sender)
        this.assertOperation()
        return action(owner)
      })
    } finally {
      // The worker may return a bounded timeout while a host-side browser
      // action is still settling. Return to the UI, but keep the shared lease
      // until that operation is actually drained. A rejected drain fails closed.
      if (scope.drain) void scope.drain.then(() => permit.release(), () => undefined)
      else permit.release()
    }
  }
  private assertOperation(): OperationScope {
    const scope = this.operations.getStore()
    scope?.permit.assert()
    if (!scope || scope.epoch !== this.epoch) throw targetError('TARGET_SESSION_REVOKED', '平台操作准备期间会话已关闭或变更，请重新打开')
    return scope
  }
  private async api(token: string, path: string, body?: unknown): Promise<unknown> {
    this.assertOperation()
    const response = await net.fetch(`${this.options.apiBase}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Toolbox-Version': app.getVersion() },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw targetError('TARGET_CONTROL_REJECTED', `控制面拒绝本次请求（HTTP ${response.status}），未自动重试`)
    const raw = await response.text()
    this.assertOperation()
    if (raw.length > 2_000_000) throw targetError('TARGET_CONTROL_INVALID', '控制面响应超出范围')
    try { return envelope.parse(JSON.parse(raw)).data } catch { throw targetError('TARGET_CONTROL_INVALID', '控制面响应不符合当前合同') }
  }
  private async profile(token: string, id: string, discoveryOnly = false): Promise<SignedTargetProfile> {
    const all = z.array(signedTargetProfileSchema).parse(await this.api(token, '/api/tools/target-profiles'))
    const match = all.filter(row => row.profile.id === id)
    if (match.length !== 1) throw targetError('TARGET_PROFILE_NOT_FOUND', '入口未发布或已撤回，请刷新入口列表')
    if (discoveryOnly && match[0]!.profile.reviewStatus === 'pending') return match[0]!
    const signed = verifyTargetProfile(match[0], this.options.publicKeyB64, !discoveryOnly)
    if (signed.signingKeyId !== this.options.signingKeyId) throw targetError('TARGET_KEY_UNKNOWN', '此入口签名密钥不受当前客户端支持')
    return signed
  }
  private async open(owner: SessionOwner, request: TargetOpenRequest, forceRefresh = false): Promise<void> {
    this.options.assertScenario?.(request.entryUrl)
    const url = checkedUrl(request.entryUrl)
    const metadata = request.profileId ? await this.profile(owner.token, request.profileId, true) : null
    if (metadata?.profile.reviewStatus === 'pending' && redactedUrl(request.entryUrl) !== metadata.profile.entryUrl) throw targetError('TARGET_ROUTE_BLOCKED', '待审核入口与输入网址不一致')
    const signed = metadata?.profile.reviewStatus === 'approved' ? metadata : null
    if (signed && !routeAllowed(url.href, signed.profile)) throw targetError('TARGET_ROUTE_BLOCKED', '网址不在选中入口的已审核范围内')
    // Before approval there is no profile id to distinguish two entry points
    // on the same deployment origin. Include the redacted path so opening
    // /User/LoginPage24 and /User/Welcome6 cannot silently reuse the wrong
    // discovery window. Approved profiles keep the stable profile id because
    // their reviewed route policy is the identity boundary.
    const targetIdentity = signed?.profile.id || redactedUrl(url.href)
    const key = targetHash([owner.owner, targetIdentity])
    if (!forceRefresh && this.site?.owner === owner.owner && this.site.key === key && !this.site.active.isDestroyed()
      && targetHash(this.site.signed?.profile || null) === targetHash(signed?.profile || null)) {
      this.site.active.show(); this.site.active.focus()
      return // Reuse the existing login. Never reload to another course implicitly.
    }
    const operation = this.assertOperation()
    this.close()
    if (owner.kind !== 'staff') this.options.beforeCustomerOpen?.()
    const epoch = ++this.epoch
    operation.epoch = epoch // This replacement was initiated by this owned open operation.
    // Approval changes the page policy, not the user's platform account. Keep
    // the same in-memory login when discovery becomes an approved profile,
    // while different control accounts and exact entry origins stay isolated.
    const partition = `kst-target-${targetHash([owner.owner, url.origin, randomUUID()])}`
    const browserSession = session.fromPartition(partition)
    if (!this.configuredSessions.has(browserSession)) {
      browserSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
      browserSession.setPermissionCheckHandler(() => false)
      browserSession.on('will-download', event => event.preventDefault())
      this.configuredSessions.add(browserSession)
    }
    const mayNavigate = (raw: string): boolean => {
      try { checkedUrl(raw); return (this.options.scenarioAllows?.(raw) ?? true) && (!signed || routeAllowed(raw, signed.profile)) } catch { return false }
    }
    const handlePopup = (win: TargetWindow, details: Electron.HandlerDetails): Electron.WindowOpenHandlerResponse => {
      if (!mayNavigate(details.url) || this.site?.epoch !== epoch) return { action: 'deny' }
      const site = this.site
      if (site.navigation.active) {
        site.navigation.offer({ openerWebContentsId: win.webContents.id, referrerUrl: details.referrer?.url || '', url: details.url }, () => {
          const child = createWindow(details.url); site.windows.add(child)
          return { webContentsId: child.webContents.id, value: child, ready: this.windowLoads.get(child)!, currentUrl: () => child.webContents.getURL(), dispose: () => { if (!child.isDestroyed()) child.destroy() } }
        })
      } else if (!site.navigationBusy && !this.runner) {
        const child = createWindow(details.url); this.site.windows.add(child)
        this.site.port?.dispose(); this.site.port = undefined; this.site.active = child
        void this.watchLogin(site, child).catch(() => { site.loginFailure = 'TARGET_LOGIN_OBSERVER_UNAVAILABLE' })
      }
      return { action: 'deny' }
    }
    const createWindow = (target: string): TargetWindow => {
      const win = owner.kind === 'staff' && this.options.createBorrowedWindow ? this.options.createBorrowedWindow(owner) : new BrowserWindow({ title: '课赛通 · 受控平台现场', width: 1280, height: 860, minWidth: 800, minHeight: 600, autoHideMenuBar: true,
        webPreferences: { partition, sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true, devTools: false, navigateOnDragDrop: false } })
      // Before review this is a user-operated, isolated discovery window. No
      // business executor can run here. Approved windows enforce exact routes.
      win.webContents.on('will-navigate', (event, targetUrl) => {
        if (!mayNavigate(targetUrl)) event.preventDefault()
        else if (/\/(?:User\/(?:Login|login)|Account\/Logout)/i.test(new URL(targetUrl).pathname) && this.site?.epoch === epoch) {
          this.site.loginEvidence = undefined; this.site.verifiedContext = undefined; this.site.courseContext = undefined; this.site.verifiedRole = undefined; this.plans.clear()
        }
      })
      win.webContents.on('will-redirect', (event, targetUrl) => { if (!mayNavigate(targetUrl)) event.preventDefault() })
      win.webContents.on('will-frame-navigate', event => { if (!mayNavigate(event.url)) event.preventDefault() })
      win.webContents.on('will-attach-webview', event => event.preventDefault())
      win.webContents.setWindowOpenHandler(details => handlePopup(win, details))
      win.on('focus', () => { if (this.site?.epoch === epoch && this.site.active !== win && !this.runner && !this.site.navigationBusy) {
        this.site.port?.dispose(); this.site.port = undefined; this.site.active = win
        const site = this.site; void this.watchLogin(site, win).catch(() => { site.loginFailure = 'TARGET_LOGIN_OBSERVER_UNAVAILABLE' })
      } })
      win.on('closed', () => {
        if (this.site?.epoch !== epoch) return
        this.site.windows.delete(win)
        if (this.site.active === win) this.close()
      })
      // Navigation failures are reported by detect; never echo credential-bearing URL.
      const loaded = win.loadURL(target)
      this.windowLoads.set(win, loaded)
      void loaded.catch(() => undefined)
      return win
    }
    const borrowed = this.options.borrowedWindow?.(owner)
    if (borrowed && (signed ? !routeAllowed(borrowed.webContents.getURL(), signed.profile) : checkedUrl(borrowed.webContents.getURL()).origin !== url.origin)) throw targetError('TARGET_SCENE_MISMATCH', '当前账号现场与选中工具入口不属于同一审核范围')
    const active = borrowed || createWindow(url.href)
    if (borrowed) {
      if (forceRefresh) {
        await borrowed.webContents.session.clearStorageData()
        this.assertOperation()
        await borrowed.loadURL(url.href)
      }
      this.windowLoads.set(borrowed, Promise.resolve())
      borrowed.webContents.setWindowOpenHandler(details => handlePopup(borrowed, details))
    }
    this.site = { owner: owner.owner, key, epoch, active, windows: new Set([active]), signed, initialOrigin: url.origin, entryUrl: signed?.profile.entryUrl || url.href, profileId: request.profileId,
      navigation: new OwnedNavigationScope(() => { this.assertOperation(); if (this.site?.epoch !== epoch) throw targetError('TARGET_CONTEXT_CHANGED', '窗口切换期间现场已变更') }), navigationBusy: false,
      ...(!borrowed ? { clearSession: () => browserSession.clearStorageData() } : {}) }
    const site = this.site
    await this.windowLoads.get(active)
    this.assertOperation()
    await this.watchLogin(site, active)
    this.assertOperation()
  }
  private async watchLogin(site: Site, active: TargetWindow): Promise<void> {
    await this.windowLoads.get(active)
    if (this.site !== site || site.active !== active || active.isDestroyed()) return
    const observerPort = this.port(site.owner, true) as OwnedWebContentsPort
    if (observerPort.kind === 'owned-webcontents') await observerPort.observeLogin({ siteEpoch: site.epoch,
      isAllowedOrigin: origin => {
        if (site.signed) return site.signed.profile.allowedRoutes.some(route => route.origin === origin && (route.role === 'login' || route.role === 'business'))
        // For a new URL only origins actually present in the user's owned
        // window/frame tree qualify. No vendor subdomain wildcard is trusted.
        return active.webContents.mainFrame.framesInSubtree.some(frame => { try { return checkedUrl(frame.url).origin === origin } catch { return false } })
      },
      assertOwned: () => { if (this.site !== site || site.active !== active || active.isDestroyed()) throw targetError('TARGET_CONTEXT_CHANGED', '登录窗口已经不属于当前现场') },
      onAttempt: () => { site.loginEvidence = undefined; site.verifiedContext = undefined; site.courseContext = undefined; site.verifiedRole = undefined; site.loginFailure = undefined; this.plans.clear(); this.runner?.cancel() },
      onSuccess: evidence => { site.loginEvidence = evidence; site.loginFailure = undefined },
      onFailure: code => { site.loginEvidence = undefined; site.verifiedContext = undefined; site.loginFailure = code },
    })
  }
  private requireSite(owner: string): Site {
    this.assertOperation()
    if (!this.site || this.site.owner !== owner || this.site.active.isDestroyed()) throw targetError('TARGET_SESSION_REQUIRED', '请先打开本账号的平台现场并完成登录')
    return this.site
  }
  private port(owner: string, passive = false): TargetBrowserPort {
    const site = passive ? this.site : this.requireSite(owner)
    if (!site || site.owner !== owner || site.active.isDestroyed()) throw targetError('TARGET_SESSION_REQUIRED', '目标现场已关闭')
    const active = site.active
    const current = checkedUrl(active.webContents.getURL())
    // Discovery permits the user's normal login/course redirects. A port bound
    // to an earlier origin must not make the next read-only detection fail,
    // nor silently widen a previously approved write-capable port.
    if (!site.signed && site.port && site.portOrigin !== current.origin) {
      site.port.dispose(); site.port = undefined; site.portOrigin = undefined
    }
    if (!site.port) {
      const ownedPort = createOwnedWebContentsPort(active.webContents, {
        allowedOrigins: site.signed ? site.signed.profile.allowedRoutes.map(r => r.origin) : [current.origin],
        assertOwnedSession: () => {
          this.assertOperation()
          this.options.assertScenario?.(active.webContents.getURL())
          if (this.site !== site || site.active !== active || active.isDestroyed()) throw targetError('TARGET_CONTEXT_CHANGED', '平台会话已变化')
          if (site.signed && !routeAllowed(active.webContents.getURL(), site.signed.profile)) throw targetError('TARGET_ROUTE_BLOCKED', '页面已离开审核范围')
        },
      })
      const inspect = ownedPort.inspect.bind(ownedPort)
      ownedPort.inspect = async () => {
        const snapshot = await inspect()
        if (snapshot.loginVisible) { site.verifiedContext = undefined; site.courseContext = undefined; site.verifiedRole = undefined; return snapshot }
        if (site.verifiedContext) {
          const context = snapshot.courseDom ? { ...site.courseContext, ...await ownedPort.readCourseFields() } : snapshot.context
          assertVerifiedPageContext(site.verifiedContext, { origin: snapshot.origin, siteEpoch: site.epoch, ...context })
          if (site.verifiedRole && snapshot.context.roleCode && snapshot.context.roleCode !== site.verifiedRole) throw targetError('TARGET_CONTEXT_CHANGED', '页面角色与已接管现场不一致')
          snapshot.context = { ...snapshot.context, ...context }
          snapshot.verifiedContext = site.verifiedContext
        }
        return snapshot
      }
      site.port = ownedPort
      site.portOrigin = current.origin
    }
    return site.port
  }
  /** The parameterised profile lookup alone is not who-am-I. Bind it to this
   * epoch's successful login, the map response and the readonly profile field. */
  private async collectCourseIdentity(owner: string): Promise<void> {
    const site = this.requireSite(owner)
    if (!site.loginEvidence) throw targetError(site.loginFailure || 'TARGET_LOGIN_EVIDENCE_REQUIRED', '当前窗口未取得完整的成功登录证据；请刷新重新登录后再选择课程并识别')
    site.verifiedContext = undefined; site.courseContext = undefined; site.verifiedRole = undefined
    const browser = this.port(owner) as OwnedWebContentsPort
    const origin = checkedUrl(site.active.webContents.getURL()).origin
    site.navigationBusy = true
    try {
      const map = await browser.captureLocalContext('map', () => browser.reload())
      await browser.waitForPage({ origin, path: '/ECrossAmazonHome/CourseIndexTraining_1' }, { css: 'div.IntoBack', exactText: 'Amazon' })
      // Native DOM exposes only course/shop. Company and user belong to the
      // captured GetPage response, not nonexistent .CompanyName/.UserName nodes.
      const course = { ...await browser.readCourseFields(), companyId: map.record.B3001 || '', userId: map.record.A0902 || '' }
      const logoHash = await browser.readLogoAssetHash()
      await browser.click({ css: '.user-select .dk-selected' })
      const profile = { css: 'span[onclick="updatePersonalView()"]' }
      await browser.waitForControl(profile)
      const identity = await browser.captureLocalContext('identity', () => browser.click(profile))
      await browser.waitForPage({ origin, path: '/ECrossCommon/CourseUpdatePersonalProfile' }, { css: 'input#A0103' })
      const identityField = await browser.readIdentityField()
      const proof = validateLocalContext({ map, identity, identityField, logoHash, origin, siteEpoch: site.epoch, loginEvidence: site.loginEvidence })
      assertVerifiedPageContext(proof, { origin, siteEpoch: site.epoch, ...course })
      await browser.back()
      await browser.waitForPage({ origin, path: '/ECrossAmazonHome/CourseIndexTraining_1' }, { css: 'div.IntoBack', exactText: 'Amazon' })
      // Back/forward cache may correctly restore the map without another XHR.
      // A bounded explicit read-only reload gives us a new server readback.
      const returned = await browser.captureLocalContext('map', () => browser.reload())
      await browser.waitForPage({ origin, path: '/ECrossAmazonHome/CourseIndexTraining_1' }, { css: 'div.IntoBack', exactText: 'Amazon' })
      const after = { ...await browser.readCourseFields(), companyId: returned.record.B3001 || '', userId: returned.record.A0902 || '' }
      if (returned.httpStatus !== 200 || returned.code !== 0 || returned.request.courseId !== map.request.courseId
        || JSON.stringify(returned.record) !== JSON.stringify(map.record)) throw targetError('TARGET_CONTEXT_CHANGED', '返回课程页后课程或账号上下文发生变化')
      assertVerifiedPageContext(proof, { origin, siteEpoch: site.epoch, ...after })
      this.assertOperation()
      site.verifiedContext = proof; site.courseContext = after
    } finally { site.navigationBusy = false }
  }
  /** Compiled, read-only navigation observed on the current V2 course map.
   * No first-page fallback, synthetic API call or business save is performed. */
  private async navigateTemplateList(owner: string, course: BrowserSnapshot['context']): Promise<void> {
    const site = this.requireSite(owner)
    const origin = checkedUrl(site.active.webContents.getURL()).origin
    if (!course.courseId || !course.shopId || !course.companyId) throw targetError('TARGET_CONTEXT_INCOMPLETE', '课程与店铺尚未从课程首页响应核验，不能接管其他窗口')
    const page = (): OwnedWebContentsPort => this.port(owner) as OwnedWebContentsPort
    site.navigationBusy = true
    try {
      let current = await page().inspect()
      if (current.path === '/ECrossAmazonHome/CourseIndexTraining_1') {
        await page().click({ css: 'div.IntoBack', exactText: 'Amazon' })
        const seller = { frameCss: 'iframe[src*="CompanySellerAmazonIndex"]', css: 'div.divbtn03.AmazonCon', exactText: '亚马逊卖家后台' }
        await page().waitForControl(seller)
        const oldPort = page(); const source = await oldPort.resolveNavigationSource(seller)
        const handoff = await site.navigation.run<TargetWindow>(source, { origin, path: '/ECrossAmazon/SellerIndex' }, () => oldPort.click(seller), async child => {
          const probePort = createOwnedWebContentsPort(child.webContents, { allowedOrigins: [origin], assertOwnedSession: () => {
            this.assertOperation()
            if (this.site !== site || !site.windows.has(child) || child.isDestroyed()) throw targetError('TARGET_CONTEXT_CHANGED', '关联窗口已失效')
            if (site.signed && !routeAllowed(child.webContents.getURL(), site.signed.profile)) throw targetError('TARGET_ROUTE_BLOCKED', '卖家窗口离开审核范围')
          } })
          try {
            const observed = await probePort.waitForPage({ origin, path: '/ECrossAmazon/SellerIndex' }, { css: 'a.sc-menu-trigger', exactText: '设置' })
            for (const key of ['courseId', 'shopId', 'companyId'] as const) if (observed.context[key] !== course[key]) throw targetError('TARGET_CONTEXT_CHANGED', '新卖家窗口不是本次核验的课程和店铺')
            if (!observed.context.roleCode || (course.roleCode && course.roleCode !== observed.context.roleCode)) throw targetError('TARGET_CONTEXT_CHANGED', '新卖家窗口角色不一致')
            site.verifiedRole = observed.context.roleCode
          } finally { probePort.dispose() }
        })
        this.assertOperation()
        oldPort.dispose(); site.port = undefined; site.portOrigin = undefined; site.active = handoff.target
        current = await page().inspect()
      }
      if (current.path === '/ECrossAmazon/SellerIndex') {
        await page().click({ css: 'a.sc-menu-trigger', exactText: '设置' })
        current = await page().waitForPage({ origin, path: '/ECrossAmazon/SellerAccountSetting' }, { css: 'a.urlDetail', exactText: '配送设置' })
      }
      if (current.path === '/ECrossAmazon/SellerAccountSetting') {
        await page().click({ css: 'a.urlDetail', exactText: '配送设置' })
        current = await page().waitForPage({ origin, path: '/ECrossAmazon/SellerShippingTemplateSetting' }, { css: '#btnAddTemplate' })
      }
      if (current.path !== '/ECrossAmazon/SellerShippingTemplateSetting' || !current.templateDom) throw targetError('TARGET_NAVIGATION_EVIDENCE_MISSING', '当前页面没有已核验的配送模板只读入口链路')
      for (const key of ['courseId', 'shopId', 'companyId'] as const) if (current.context[key] !== course[key]) throw targetError('TARGET_CONTEXT_CHANGED', '模板列表与原课程店铺不一致')
    } finally { site.navigation.cancel(); site.navigationBusy = false }
  }
  private async preflight(owner: SessionOwner, request: TargetPreflightRequest): Promise<RunPlanPreview> {
    this.options.assertScenario?.(this.requireSite(owner.owner).active.webContents.getURL(), request.scenario)
    const profile = await this.profile(owner.token, request.profileId)
    const site = this.requireSite(owner.owner)
    if (site.signed?.profile.id !== profile.profile.id || site.signed.profile.revision !== profile.profile.revision) throw targetError('TARGET_SESSION_PROFILE_MISMATCH', '请从已审核入口重新打开受控现场，再预检')
    const initial = await this.port(owner.owner).inspect()
    if (initial.path === '/ECrossCommon/CourseIndexTrainingCourse') throw targetError('TARGET_NAVIGATION_EVIDENCE_MISSING', '请手动选择本次课程，进入课程地图后再识别')
    if (initial.path === '/ECrossAmazonHome/CourseIndexTraining_1') {
      if (!site.verifiedContext || !site.courseContext) await this.collectCourseIdentity(owner.owner)
      const mapProbe = await probeContext(this.port(owner.owner))
      if (profile.profile.evidence.pageFingerprints?.courseMap !== mapProbe.pageFingerprint) throw targetError('TARGET_STRUCTURE_CHANGED', '课程地图结构与本入口的独立验收指纹不一致')
      await this.navigateTemplateList(owner.owner, site.courseContext!)
    }
    const expected = await probeContext(this.port(owner.owner))
    const plan = buildTargetPlan(request, profile.profile, expected)
    const blockers: string[] = []
    if (plan.context.scenario === 'competition') blockers.push('当前练习/正式阶段仅为手动选择，尚无平台阶段证据；不能在比赛场景执行或恢复模板任务。')
    const binding = resolveUiBinding(plan.adapterVersion)
    if (!binding) blockers.push('已取得部分配送模板现场控件，但完整绑定与业务验收尚未完成；需补齐国家、币种、保存链路与同对象回读，当前不能创建真实模板。')
    else {
      try { binding.assertSupportedInput?.(request.input) }
      catch (error) { blockers.push(error instanceof Error ? error.message.slice(0, 300) : '模板输入不属于当前已验收范围。') }
    }
    const enabled = blockers.length === 0
    this.plans.clear()
    this.plans.set(plan.id, { owner: owner.owner, siteEpoch: site.epoch, plan, expected, toolId: request.toolId, enabled })
    return { plan, canExecute: enabled, blockers, steps: [...TEMPLATE_RECIPE.steps] }
  }
  private async execute(owner: SessionOwner, planId: string): Promise<OperationReceipt> {
    const pending = this.plans.get(planId)
    this.plans.delete(planId) // One scope confirmation permits one attempt only.
    if (!pending || pending.owner !== owner.owner || pending.siteEpoch !== this.site?.epoch) throw targetError('TARGET_PLAN_INVALID', '计划已失效或不属于当前现场，请重新预检')
    const { plan, expected, toolId } = pending
    if (plan.context.scenario === 'competition') throw targetError('TARGET_STAGE_UNVERIFIED', '当前比赛阶段尚未从真实平台核验，手动选择不能作为提交权限')
    if (!pending.enabled || !resolveUiBinding(plan.adapterVersion)) throw targetError('TARGET_UI_EVIDENCE_MISSING', '当前客户端未包含经过现场验收的模板定位，未申请执行授权，也未提交业务')
    // Reject a known or unknown outcome before consuming a one-time grant.
    // The journal check is read-only; begin() repeats it after verification
    // before any browser mutation to preserve the durable race guard.
    this.journal().assertAvailable(owner.owner, plan)
    const signed = await this.profile(owner.token, plan.context.profileId)
    assertPlanContext(plan, signed.profile, await probeContext(this.port(owner.owner)))
    const params = new URLSearchParams({ platform_key: 'amazon', execution_mode: 'single', idempotency_key: randomUUID(),
      target_profile_id: signed.profile.id, target_profile_revision: String(signed.profile.revision), client_runner_api_version: String(TARGET_RUNNER_API_VERSION), course_ref: plan.context.courseRef })
    const staff = owner.kind === 'staff'
    const grantPath = staff ? '/api/scenarios/staff/tool-grants' : `/api/tools/${encodeURIComponent(String(toolId))}/launch-grant?${params}`
    const grantRequest = staff ? { tool_id: String(toolId), target_profile_id: signed.profile.id, target_profile_revision: signed.profile.revision,
      device_id: owner.deviceId, account_slot: owner.accountSlot, attempt_id: plan.id, context_hash: plan.contextHash, input_hash: plan.inputHash } : {}
    const grant = grantSchema.parse(await this.api(owner.token, grantPath, grantRequest)).launch_data
    const grantProfile = verifyTargetProfile(grant.target_profile, this.options.publicKeyB64)
    const manifest = grant.tool_manifest
    if (String(grant.tool_id) !== String(toolId) || grant.signing_key_id !== this.options.signingKeyId || targetHash(grantProfile.profile) !== targetHash(signed.profile)
      || manifest.targetProfileId !== plan.context.profileId || manifest.targetProfileRevision !== plan.context.profileRevision || manifest.requiredCapability !== plan.capability) throw targetError('TARGET_GRANT_MISMATCH', '启动授权与本次入口、能力或版本不匹配')
    if (!verifyToolManifest({ id: grant.tool_id, launchGrant: { signatureRequired: true, toolManifest: manifest, toolSignature: grant.tool_signature, scriptKey: grant.script_key, toolVersion: grant.tool_version, runnerApiVersion: 2, signingKeyId: grant.signing_key_id } }, this.options.publicKeyB64).verified) throw targetError('TARGET_SIGNATURE_INVALID', '工具清单签名未通过')
    const reports = staff ? this.options.staffReports : this.options.reports
    if (!reports) throw targetError('TARGET_STAFF_REPORTS_REQUIRED', '管理员执行回执通道尚未配置')
    const reservation = await reports.reserve(grant.token)
    let receipt: OperationReceipt | null = null
    let outcome: OperationReceipt | null = null
    let runner: TargetRunnerClient | null = null
    let grantConsumed = false
    let releaseHostFence: (() => void) | undefined
    let executionFinished = false
    const assertRunnerActive = (): void => {
      this.assertOperation()
      if (executionFinished || runner?.isDraining) throw targetError('TARGET_RUNNER_CANCELLED', '本次执行已停止，迟到的页面回调不能再改写操作状态')
    }
    try {
      const consumed = z.object({ valid: z.literal(true), tool_id: z.union([z.string(), z.number()]), platform_key: z.literal('amazon'), target_profile_id: z.string(), target_profile_revision: z.number(), required_capability: z.string(),
        principal_kind: z.string().optional(), device_id: z.string().optional(), account_slot: z.string().optional(), context_hash: z.string().optional(), input_hash: z.string().optional(),
      }).parse(await this.api(owner.token, staff ? '/api/scenarios/staff/tool-grants/verify' : '/api/tools/launch-grant/verify', { token: grant.token }))
      grantConsumed = true
      if (String(consumed.tool_id) !== String(toolId) || consumed.target_profile_id !== plan.context.profileId || consumed.target_profile_revision !== plan.context.profileRevision || consumed.required_capability !== plan.capability) throw targetError('TARGET_GRANT_MISMATCH', '已消费授权与当前任务不一致')
      if (staff && (consumed.principal_kind !== 'staff' || consumed.device_id !== owner.deviceId || consumed.account_slot !== owner.accountSlot || consumed.context_hash !== plan.contextHash || consumed.input_hash !== plan.inputHash)) throw targetError('TARGET_GRANT_MISMATCH', '管理员授权与当前设备、账号槽位或计划不一致')
      assertPlanContext(plan, signed.profile, await probeContext(this.port(owner.owner)))
      receipt = this.journal().begin(owner.owner, plan)
      const id = receipt.id
      runner = new TargetRunnerClient()
      this.runner = runner
      this.options.lease.fenceUntil(new Promise<void>(resolve => { releaseHostFence = resolve }))
      await runner.run(plan, expected, { browser: this.port(owner.owner), journal: {
        beforeMutation: async () => {
          assertRunnerActive()
          const currentProfile = await this.profile(owner.token, plan.context.profileId)
          assertPlanContext(plan, currentProfile.profile, await probeContext(this.port(owner.owner)))
          assertRunnerActive()
          receipt = this.journal().transition(owner.owner, id, { status: 'prepared', checks: ['draft-edit-authorised-no-submit'] })
        },
        beforeSubmit: async () => {
          assertRunnerActive()
          const currentProfile = await this.profile(owner.token, plan.context.profileId)
          assertPlanContext(plan, currentProfile.profile, await probeContext(this.port(owner.owner)))
          assertRunnerActive()
          if (receipt?.status !== 'prepared') throw targetError('TARGET_SUBMIT_ALREADY_ATTEMPTED', '本次任务已越过准备状态，不能重复提交')
          receipt = this.journal().transition(owner.owner, id, { status: 'submitting', checks: ['submit-boundary-durably-recorded'] })
        },
        verified: async proof => {
          assertRunnerActive()
          if (receipt?.status !== 'submitting') throw targetError('TARGET_VERIFY_PROOF_REQUIRED', '没有本次真实提交标记，不能记录执行成功')
          receipt = this.journal().transition(owner.owner, id, { status: 'verified', objectRef: String(proof.templateId), errorCode: null,
            checks: ['same-object-list-and-details', `rules:${proof.ruleCount}`, ...proof.evidence.map(e => `${e.method} ${e.path} ${e.httpStatus} Code${e.code}`)] })
        },
      } })
      return outcome = this.journal().get(owner.owner, id).receipt
    } catch (error) {
      if (receipt?.status === 'verified') {
        outcome = structuredClone(receipt)
        outcome.checks.push('runner-completion-interrupted-after-verification')
        return outcome
      }
      if (receipt) {
        const code = safeErrorCode(error)
        receipt = this.journal().transition(owner.owner, receipt.id, { status: receipt.status === 'prepared' ? 'not_submitted' : 'needs_review', errorCode: code })
        return outcome = structuredClone(receipt)
      }
      throw error
    } finally {
      executionFinished = true
      const operation = this.operations.getStore()
      runner?.dispose()
      if (runner) {
        const drain = runner.whenDrained()
        if (operation) operation.drain = drain
        void drain.then(() => releaseHostFence?.(), () => undefined)
      }
      if (this.runner === runner) this.runner = null
      // A failed report never changes the durable business outcome or masks
      // the original failure. Network failures retain an encrypted receipt;
      // storage failures retain the reservation, not an imaginary queued report.
      try {
        if (grantConsumed) {
          const reported = await reports.submit({ token: grant.token, run_id: receipt?.id || plan.id, status: receipt?.status === 'verified' ? 'succeeded' : 'failed',
            error_code: receipt?.errorCode || (receipt?.status === 'verified' ? null : 'TARGET_ATTEMPT_NOT_COMPLETED'), adapter_version: plan.adapterVersion,
            page_fingerprint: expected.pageFingerprint, page_changed: false, completed_steps: receipt?.status === 'verified' ? TEMPLATE_RECIPE.steps.length : 0 }, reservation)
          if (reported?.warning && outcome) outcome.checks.push('pending-control-report')
        }
      } catch { if (outcome) outcome.checks.push('pending-control-report-storage') }
    }
  }
  private async reconcile(owner: SessionOwner, id: string): Promise<OperationReceipt> {
    const entry = this.journal().get(owner.owner, id)
    if (entry.receipt.status === 'verified' || entry.receipt.status === 'not_submitted') return entry.receipt
    if (entry.plan.context.scenario === 'competition') throw targetError('TARGET_STAGE_UNVERIFIED', '尚未核实当前练习/正式阶段，不能把本次回读绑定到历史比赛任务')
    const profile = await this.profile(owner.token, entry.plan.context.profileId)
    const site = this.requireSite(owner.owner)
    if (site.signed?.profile.id !== profile.profile.id || site.signed.profile.revision !== profile.profile.revision) throw targetError('TARGET_SESSION_PROFILE_MISMATCH', '请从原记录的已审核入口重新打开受控现场，再读取原对象状态')
    if (profile.profile.revision !== entry.plan.context.profileRevision) throw targetError('TARGET_REVISION_CHANGED', '原记录的入口审核版本已变更，不能直接套用新的定位读取旧对象')
    const initial = await this.port(owner.owner).inspect()
    if (initial.path === '/ECrossCommon/CourseIndexTrainingCourse') throw targetError('TARGET_NAVIGATION_EVIDENCE_MISSING', '请手动选择原记录的课程，进入课程地图后再读取原对象状态')
    if (initial.path === '/ECrossAmazonHome/CourseIndexTraining_1') {
      // Recovery is a standalone read-only journey, not a side-effect of a new
      // preflight. Establish identity before following any seller navigation.
      if (!site.verifiedContext || !site.courseContext) await this.collectCourseIdentity(owner.owner)
      const mapProbe = await probeContext(this.port(owner.owner))
      if (!mapProbe.evidence.includes('verified-local-identity') || mapProbe.version !== 'v2' || mapProbe.kind !== 'matched'
        || mapProbe.localAccountRef !== entry.plan.context.localAccountRef || mapProbe.courseRef !== entry.plan.context.courseRef || mapProbe.shopRef !== entry.plan.context.shopRef) throw targetError('TARGET_CONTEXT_CHANGED', '当前登录账号、课程或店铺与原记录不同，未进入其他业务现场')
      if (!routeAllowed(`${mapProbe.origin}${mapProbe.path}`, profile.profile, 'business') || profile.profile.evidence.pageFingerprints?.courseMap !== mapProbe.pageFingerprint) throw targetError('TARGET_STRUCTURE_CHANGED', '课程地图不在原入口已审核范围或结构已变化，未继续导航')
      await this.navigateTemplateList(owner.owner, site.courseContext!)
    }
    const port = this.port(owner.owner)
    const expected = await probeContext(port)
    // A readback may happen after the original ten-minute execution window.
    assertPlanContext({ ...entry.plan, expiresAt: new Date(Date.now() + 60_000).toISOString() }, profile.profile, expected)
    const result = await reconcileV2Template(port, expected, entry.plan.input, resolveUiBinding(entry.plan.adapterVersion), entry.receipt.objectRef ? Number(entry.receipt.objectRef) : undefined)
    this.assertOperation()
    if (result.status === 'not_found') return this.journal().transition(owner.owner, id, { status: 'needs_review', errorCode: 'TARGET_OBJECT_NOT_FOUND', checks: ['read-only-object-not-found-is-not-proof-of-no-submit'] })
    const proof = result.receipt
    // The original grant token is intentionally not persisted in the journal.
    // Reconciliation uses the current authenticated user session instead, so
    // recovery after restart can repair the control-plane result safely.
    await this.api(owner.token, owner.kind === 'staff' ? '/api/scenarios/staff/reconcile' : '/api/executions/reconcile', {
      run_id: entry.receipt.id, status: 'succeeded', verification: proof.verification,
      object_ref: String(proof.templateId), adapter_version: entry.plan.adapterVersion,
      page_fingerprint: expected.pageFingerprint, completed_steps: TEMPLATE_RECIPE.steps.length,
      ...(owner.kind === 'staff' ? { device_id: owner.deviceId, account_slot: owner.accountSlot,
        context_hash: entry.plan.contextHash, input_hash: entry.plan.inputHash } : {}),
    })
    return this.journal().transition(owner.owner, id, { status: 'verified', objectRef: String(proof.templateId), errorCode: null, checks: ['read-only-reconciliation', proof.verification, `rules:${proof.ruleCount}`, 'control-report-reconciled'] })
  }
  close(): void {
    ++this.epoch
    const site = this.site; this.site = null; this.plans.clear()
    this.runner?.cancel()
    site?.navigation.cancel()
    site?.port?.dispose()
    for (const win of site?.windows || []) if (!win.isDestroyed()) win.destroy()
    void site?.clearSession?.().catch(() => undefined)
  }
  dispose(): void { this.close(); this.runner?.dispose(); this.runner = null }
}
function safeErrorCode(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : ''
  return typeof code === 'string' && /^[A-Z0-9_]{1,100}$/.test(code) ? code : 'TARGET_EXECUTION_INTERRUPTED'
}
