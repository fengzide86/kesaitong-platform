/** Native Electron acceptance: three real isolated WebContentsViews, real IPC,
 * local-only policy fixtures. No external accounts or real submissions. */
import { app, BrowserWindow, ipcMain, protocol, webContents, WebContentsView, type Session, type WebContents } from 'electron'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DesktopAutomationController } from '../automation/desktop-automation-controller.cjs'
import { createTrustedIpcRegistrar } from '../ipc/trusted-ipc.cjs'

const artifactRoot = mkdtempSync(join(tmpdir(), 'kst-native-scenes-evidence-'))
const profileRoot = mkdtempSync(join(tmpdir(), 'kst-native-scenes-profile-'))
app.setPath('userData', profileRoot)
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
app.on('window-all-closed', () => undefined)
let window: BrowserWindow | null = null
let controller: DesktopAutomationController | null = null
let server: Server | null = null
let finishing = false
const report: Record<string, unknown> = { kind: 'real-electron-loopback-fixture', realExternalWebsite: false, realPlatformSubmission: false, checks: [] }
const checks = report.checks as string[]
const timeout = setTimeout(() => { console.error('Native scenes smoke timed out'); void finish(2) }, 90_000)

const page = `<!doctype html><meta charset="utf-8"><title>KST native account isolation fixture</title>
<style>body{margin:0;padding:60px;background:#eef3fa;color:#19324b;font:18px "Segoe UI","Microsoft Yahei",sans-serif}main{background:white;border:1px solid #dbe5f0;border-radius:18px;padding:38px;max-width:850px}h1{font-size:30px}strong{color:#2461b9}pre{line-height:1.8;background:#f4f7fb;padding:22px;border-radius:12px}small{color:#61738c}</style>
<main><small>LOCAL LOOPBACK FIXTURE · REAL ELECTRON WEB CONTENTS VIEW</small><h1>独立账号现场</h1><p>当前账号：<strong id="account"></strong></p><pre id="state"></pre><p>这是真实 Chromium Cookie / localStorage，不是接口模拟结果。</p></main>
<script>function renderAccount(){document.getElementById('account').textContent=localStorage.getItem('account')||'未登录';document.getElementById('state').textContent=JSON.stringify({cookie:document.cookie,localStorage:localStorage.getItem('account'),origin:location.origin},null,2)}renderAccount()</script>`

async function startFixture(): Promise<string> {
  return new Promise((resolve, reject) => {
    server = createServer((req, res) => {
      const address = server!.address()
      if (!address || typeof address === 'string') { res.writeHead(503).end(); return }
      const origin = `http://127.0.0.1:${address.port}`
      if (req.url?.startsWith('/api/')) {
        if (req.headers.authorization !== 'Bearer isolated-smoke-staff') { res.writeHead(401).end(); return }
        res.setHeader('content-type', 'application/json')
        if (req.url === '/api/scenarios/me') res.end(JSON.stringify({ success: true, data: {
          schemaVersion: 1, principal: { kind: 'staff', id: '10001' }, revision: 'smoke-v1', status: 'active', mode: 'training',
          entryUrl: `${origin}/scene`, allowedOrigins: [origin], maxScenes: 6, checkedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 300_000).toISOString(), refreshAfterSeconds: 30,
        } }))
        else if (req.url === '/api/scenarios/staff/launch-grant') res.end(JSON.stringify({ success: true, data: { fixture: true } }))
        else res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(page)
    })
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server!.address()
      if (!address || typeof address === 'string') reject(new Error('Fixture address unavailable'))
      else resolve(`http://127.0.0.1:${address.port}`)
    })
  })
}

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  assert(window)
  return window.webContents.executeJavaScript(`window.localScenesSmoke.invoke(${JSON.stringify(channel)},...${JSON.stringify(args)})`, true)
}

async function state(contents: WebContents): Promise<{ cookie: string; account: string | null }> {
  return contents.executeJavaScript('({cookie:document.cookie,account:localStorage.getItem("account")})', false)
}

async function snapshot(contents: WebContents, name: string): Promise<string> {
  // Hidden native views may suspend rAF; never wait indefinitely for compositor.
  await contents.executeJavaScript('new Promise(resolve => {setTimeout(resolve,200);requestAnimationFrame(() => requestAnimationFrame(resolve))})')
  const image = await contents.capturePage(undefined, { stayHidden: true, stayAwake: true })
  assert(!image.isEmpty(), 'Native screenshot must not be empty')
  const file = join(artifactRoot, name)
  writeFileSync(file, image.toPNG())
  return file
}

async function assertDenied(channel: string, args: unknown[], pattern: RegExp): Promise<void> {
  await assert.rejects(() => invoke(channel, ...args), pattern)
}

async function clearedCookies(browserSession: Session, origin: string): Promise<void> {
  const deadline = Date.now() + 5_000
  while ((await browserSession.cookies.get({ url: origin })).length) {
    if (Date.now() >= deadline) throw new Error('Closed native session retained cookies')
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

async function finish(code: number): Promise<void> {
  if (finishing) return
  finishing = true
  clearTimeout(timeout)
  try { await controller?.cleanup() } catch (error) { report.cleanupError = String(error); code = 1 }
  window?.destroy()
  for (const contents of webContents.getAllWebContents()) if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false })
  server?.closeAllConnections()
  await new Promise<void>(resolve => server?.close(() => resolve()) || resolve())
  report.exitCode = code
  report.artifactRoot = artifactRoot
  writeFileSync(join(artifactRoot, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  app.exit(code)
}

app.whenReady().then(async () => {
  try {
    const origin = await startFixture()
    protocol.handle('app', () => new Response('<!doctype html><meta charset="utf-8"><title>KST native scenes smoke</title><body style="background:#eaf0f8;font-family:sans-serif"><h2>本机账号现场实机验收</h2><p>三个独立 Chromium Session · loopback only</p></body>', { headers: { 'content-type': 'text/html; charset=utf-8' } }))
    window = new BrowserWindow({ width: 1180, height: 800, show: false, webPreferences: {
      preload: join(__dirname, 'local-scenes-smoke-preload.cjs'), contextIsolation: true, nodeIntegration: false,
      sandbox: true, webSecurity: true, backgroundThrottling: false,
    } })
    const registrar = createTrustedIpcRegistrar({ ipcMain, getWindow: () => window, allowDevelopmentOrigin: false, automationEnabled: true,
      errorMessage: error => error instanceof Error ? error.message : String(error) })
    controller = new DesktopAutomationController({ automationEnabled: true, controlApiBase: origin,
      runtimeRoot: join(__dirname, '..'), deviceId: 'isolated-native-smoke', getWindow: () => window,
      getDefaultFreightWorkbookPath: () => '', registerTrustedHandle: registrar.handle,
      registerAutomationHandle: registrar.automationHandle, registerTrustedOn: registrar.on,
      mayOpenExternalUrl: () => false, onActivityChanged: () => undefined, showNotification: () => undefined,
    })
    controller.registerIpc()
    await window.loadURL('app://toolbox/native-scenes-smoke')
    // Native WebContentsView capture needs an allocated compositor surface.
    // Show without stealing keyboard focus; this is a visible local smoke only.
    window.showInactive()
    await window.webContents.executeJavaScript('sessionStorage.setItem("toolbox_token","isolated-smoke-staff")')
    await invoke('scenes:bounds', { x: 20, y: 90, width: 1120, height: 630 })
    const scenes: { slot: string; contents: WebContents }[] = []
    for (const slot of ['account-a', 'account-b', 'account-c']) {
      const before = new Set(webContents.getAllWebContents().map(item => item.id))
      await invoke('scenes:open', { accountSlot: slot, label: slot.toUpperCase(), entryUrl: `${origin}/scene` })
      const contents = webContents.getAllWebContents().find(item => !before.has(item.id) && item.getURL() === `${origin}/scene`)
      assert(contents, 'A real native view must be created')
      assert.deepEqual(await state(contents), { cookie: '', account: null })
      await contents.executeJavaScript(`document.cookie=${JSON.stringify(`kst-smoke-account=${slot}; path=/`)};localStorage.setItem('account',${JSON.stringify(slot)});renderAccount()`)
      scenes.push({ slot, contents })
    }
    assert.equal(new Set(scenes.map(item => item.contents.session)).size, 3)
    assert.equal((await invoke('scenes:list') as unknown[]).length, 3)
    checks.push('three simultaneously live native WebContentsViews have separate Chromium sessions')
    const captures: string[] = []
    for (const scene of [...scenes].reverse()) {
      await invoke('scenes:select', scene.slot)
      const current = await state(scene.contents)
      assert.equal(current.account, scene.slot)
      assert.equal(current.cookie, `kst-smoke-account=${scene.slot}`)
      captures.push(await snapshot(scene.contents, `${scene.slot}.png`))
    }
    checks.push('switching across all three slots preserves only that slot Cookie and localStorage')
    // Exercise the production controller's shared lease through real IPC.
    // No fake worker-success event is emitted; this is a gate check, not a submission.
    const permit = controller.toolExecutionLease().acquire()
    assert(controller.hasActiveWork())
    await assertDenied('automation:start', [{ id: 'local-smoke-no-submit', executionMode: 'live' }], /已有任务|RUN_ALREADY_ACTIVE/)
    await assertDenied('scenes:select', ['account-b'], /任务正在执行/)
    await assertDenied('scenes:close', ['account-a'], /任务尚未结束/)
    permit.release()
    checks.push('real IPC rejects second execution, scene switching and closing while shared execution lease is occupied')
    const first = scenes[0]!
    const oldSession = first.contents.session
    await invoke('scenes:close', first.slot)
    assert(first.contents.isDestroyed())
    await clearedCookies(oldSession, origin)
    const probe = new WebContentsView({ webPreferences: { session: oldSession, sandbox: true, contextIsolation: true, nodeIntegration: false } })
    await probe.webContents.loadURL(`${origin}/scene`)
    assert.deepEqual(await state(probe.webContents), { cookie: '', account: null })
    probe.webContents.close({ waitForBeforeUnload: false })
    await invoke('scenes:open', { accountSlot: first.slot, label: 'REOPENED / 未登录', entryUrl: `${origin}/scene` })
    const reopened = webContents.getAllWebContents().find(item => item.getURL() === `${origin}/scene` && !scenes.some(scene => scene.contents.id === item.id))
    assert(reopened)
    assert.notEqual(reopened.session, oldSession)
    assert.deepEqual(await state(reopened), { cookie: '', account: null })
    captures.push(await snapshot(reopened, 'reopened-cleared.png'))
    for (const scene of scenes.slice(1)) assert.equal((await state(scene.contents)).account, scene.slot)
    checks.push('close destroys old view, clears its Cookie and localStorage, reopening gets fresh session without affecting other slots')
    report.electron = process.versions.electron
    report.chromium = process.versions.chrome
    report.nativeViews = scenes.map(scene => ({ slot: scene.slot, webContentsId: scene.contents.id }))
    report.screenshots = captures
    report.runnerGate = { realIpc: true, productionSharedLease: true, platformScriptExecuted: false }
    await finish(0)
  } catch (error) {
    report.error = error instanceof Error ? { message: error.message, stack: error.stack } : String(error)
    await finish(1)
  }
}).catch(error => { report.error = String(error); void finish(1) })
