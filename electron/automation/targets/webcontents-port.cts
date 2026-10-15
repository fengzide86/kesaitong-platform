import type { WebContents } from 'electron'
import { AsyncResource } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { TEMPLATE_API_PATHS, targetError } from './contracts.cjs'
import type { BrowserSnapshot, TargetBrowserPort, TargetControl, TargetControlState, TemplateApiPath, TemplateExchange } from './contracts.cjs'
import type { NavigationDestination, NavigationSource } from './navigation-scope.cjs'
import { captureLocalContext, type LocalContextExchange, type LocalContextKind } from './local-context-capture.cjs'
import { observeOwnedLogin } from './login-observer.cjs'
import { normaliseMoney } from './v2-template.cjs'

/** Fixed application-owned read program. It never returns full URL, body text or input values. */
const SNAPSHOT_PROGRAM = `(() => {
  const url = new URL(location.href);
  const body = document.body?.innerText || '';
  let decoded = url.searchParams.get('paras') || '';
  if (decoded.length > 32768) decoded = '';
  if (/^\\d+(?:\\|\\d+)*$/.test(decoded)) {
    const codes = decoded.split('|').map(Number);
    decoded = codes.every(n => Number.isInteger(n) && n >= 0 && n <= 65535) ? String.fromCharCode(...codes) : '';
  }
  const query = new URLSearchParams(decoded);
  const context = {};
  for (const key of ['courseId', 'shopId', 'companyId', 'roleCode']) {
    const values = query.getAll(key);
    if (values.length === 1 && /^\\d{1,18}$/.test(values[0])) context[key] = values[0];
  }
  // 2026-10-12 read-only school observation: list/dialog and a separate Add
  // page have distinct controls. Presence is shape evidence, not a V2 marker
  // or permission to click. No executable UI binding is installed here.
  const templateListPage = /\\/ECrossAmazon\\/SellerShippingTemplateSetting$/.test(url.pathname);
  const templateEditorPage = /\\/ECrossAmazon\\/SellerShippingTemplateSettingAdd$/.test(url.pathname);
  // A list renders its selected template's service details asynchronously.
  // Those divs describe business data, not the list's stable page structure.
  // Only the editor owns service controls as structural fingerprint evidence.
  const pageControls = templateListPage ? ['#btnAddTemplate', '#divAddTemplate']
    : templateEditorPage ? ['#templateNameInput', 'input[name="templateName"]', '#btnSubmit', '#btnCancel',
      '#div_10001', '#div_10002', '#div_10003', '#div_10004', '#div_20001', '#div_20002'] : [];
  const controls = pageControls.filter(selector => document.querySelector(selector));
  const has = selector => controls.includes(selector);
  const templateListDom = templateListPage && has('#btnAddTemplate') && has('#divAddTemplate');
  const templateEditorDom = templateEditorPage
    && has('#templateNameInput') && has('input[name="templateName"]') && has('#btnSubmit') && has('#btnCancel')
    && controls.filter(selector => /^#div_(?:1000[1-4]|2000[12])$/.test(selector)).length >= 2;
  const visible = element => Boolean(element && element.getClientRects().length);
  // Same-origin visible login frames are common on teaching gateways. Only
  // inspect control type/visibility: never read a value, frame URL or account.
  let inspectedFrames = 0;
  const visiblePassword = (doc, depth = 0) => {
    if (Array.from(doc.querySelectorAll('input[type="password"]')).some(visible)) return true;
    if (depth >= 4) return false;
    for (const frame of doc.querySelectorAll('iframe,frame')) {
      if (!visible(frame) || ++inspectedFrames > 32) continue;
      try { if (frame.contentDocument && visiblePassword(frame.contentDocument, depth + 1)) return true; }
      catch { /* Cross-origin frames remain inaccessible; do not bypass the browser boundary. */ }
    }
    return false;
  };
  return {
    origin: url.origin, path: url.pathname,
    v2Marker: /亚马逊.{0,20}(?:仿真|模拟)[\\s\\S]{0,20}V\\s*2(?:\\.0)?/i.test(body),
    v3Marker: /亚马逊.{0,20}(?:仿真|模拟)[\\s\\S]{0,20}V\\s*3(?:\\.0)?/i.test(body),
    amazonMarker: /亚马逊(?:仿真|模拟|卖家)|亚马逊.{0,6}(?:仿真|模拟)/.test(body),
    amazonRoute: /^\\/ECrossAmazon(?:Home)?\\//.test(url.pathname),
    loginVisible: visiblePassword(document),
    templateDom: templateListDom || templateEditorDom,
    courseDom: /\\/ECrossAmazonHome\\/CourseIndex/.test(url.pathname) && /国内仓库/.test(body) && /Amazon|亚马逊卖家/.test(body),
    context, controls
  };
})()`

interface PendingRequest {
  origin: string
  path: TemplateApiPath
  fields: TemplateExchange['requestFields']
  responseStatus?: number
}
interface Waiter {
  path: TemplateApiPath
  match?: { templateId: number }
  pending: Map<string, PendingRequest>
  consume(method: string, parameters: Record<string, unknown>): Promise<void>
  resolve(value: TemplateExchange): void
  reject(reason: unknown): void
}
interface PortOptions { assertOwnedSession(): void; allowedOrigins: readonly string[]; responseTimeoutMs?: number }
/** Extra methods are main-only: no worker RPC or renderer IPC exposes raw frame URLs. */
export interface OwnedWebContentsPort extends TargetBrowserPort {
  resolveNavigationSource(control: TargetControl): Promise<NavigationSource>
  waitForPage(destination: NavigationDestination, control?: TargetControl): Promise<BrowserSnapshot>
  waitForControl(control: TargetControl): Promise<TargetControlState>
  captureLocalContext(kind: LocalContextKind, action: () => Promise<void>): Promise<LocalContextExchange>
  readLogoAssetHash(): Promise<string>
  readIdentityField(): Promise<{ value: string; readonly: boolean }>
  readCourseFields(): Promise<{ courseId: string; shopId: string }>
  back(): Promise<void>
  observeLogin(options: Parameters<typeof observeOwnedLogin>[1]): Promise<void>
}

/** Strip raw platform auth fields before an exchange can cross even a local worker IPC boundary. */
export function sanitiseTemplateResponse(path: TemplateApiPath, raw: unknown): Record<string, unknown> {
  const parse = (value: unknown): unknown => {
    if (typeof value !== 'string') return value
    try { return JSON.parse(value) as unknown } catch { return undefined }
  }
  const source = parse(raw)
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw targetError('TARGET_RESPONSE_INVALID', '模板响应结构无效。')
  const body = source as Record<string, unknown>
  const rawResult = parse(body.result)
  const code = rawResult && typeof rawResult === 'object' ? (rawResult as Record<string, unknown>).Code : undefined
  const output: Record<string, unknown> = { result: { Code: code } }
  function selectRows(key: string, fields: readonly string[]): void {
    const data = parse(body[key])
    if (!Array.isArray(data) || data.length > 10000) throw targetError('TARGET_RESPONSE_INVALID', '模板响应列表结构无效。')
    output[key] = data.map(row => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw targetError('TARGET_RESPONSE_INVALID', '模板响应行结构无效。')
      return Object.fromEntries(fields.filter(field => Object.hasOwn(row, field)).map(field => [field, (row as Record<string, unknown>)[field]]))
    })
  }
  // Failed business responses commonly omit data blocks. Preserve Code so the business parser classifies it.
  if (code !== 0) return output
  if (path === '/ECrossAmazon/GetTemplateList') selectRows('jsonStr', ['DS0701', 'DS0705', 'DS0707'])
  if (path === '/ECrossAmazon/GetFeightRelationList') {
    selectRows('jsonStr1', ['DS0701', 'DS0705', 'DS0708'])
    selectRows('jsonStr2', ['DS0801', 'DS0805', 'DS0810', 'DS0813', 'DS0814', 'DS0815', 'DS0816'])
    selectRows('jsonStr3', [])
  }
  return output
}

/** Only main passes its owned WebContents, never a renderer-supplied debug target or URL. */
export function createOwnedWebContentsPort(guest: WebContents, options: PortOptions): OwnedWebContentsPort {
  const origins = new Set(options.allowedOrigins.map(origin => new URL(origin).origin))
  let disposed = false
  let attachedByThisPort = false
  let networkReady = false
  let attaching: Promise<void> | undefined
  let disposeLogin: (() => void) | undefined
  const waiters = new Set<Waiter>()
  const lifetime = new AbortController()
  const nativePending = new Set<{ mayMutate: boolean; reject(reason: unknown): void }>()
  const closedError = () => targetError('TARGET_SESSION_CLOSED', '目标平台窗口已关闭或执行会话已释放。')
  function removeDestroyedListenerIfFinished(): void {
    if (disposed && nativePending.size === 0) guest.removeListener('destroyed', onDestroyed)
  }
  function nativeAwait<T>(start: () => Promise<T>, mayMutate = false): Promise<T> {
    if (disposed || guest.isDestroyed()) return Promise.reject(closedError())
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const finish = (success: boolean, value?: T, error?: unknown): void => {
        if (settled) return
        settled = true; nativePending.delete(pending); removeDestroyedListenerIfFinished()
        if (success) resolve(value as T); else reject(error)
      }
      const pending = { mayMutate, reject: (error: unknown) => finish(false, undefined, error) }
      nativePending.add(pending)
      // Keep a rejection handler on the underlying native promise even after
      // destruction. A late resolve/reject can neither resume input nor leak.
      try { void start().then(value => finish(true, value), error => finish(false, undefined, error)) }
      catch (error) { finish(false, undefined, error) }
    })
  }
  function disposePort(): void {
    if (!disposed) {
      disposed = true
      lifetime.abort()
      disposeLogin?.(); disposeLogin = undefined
      failWaiters(closedError())
      for (const waiter of waiters) waiter.pending.clear()
      waiters.clear()
      if (attachedByThisPort) {
        try {
          guest.debugger.removeListener('message', onMessage)
          if (!guest.isDestroyed() && guest.debugger.isAttached()) guest.debugger.detach()
        } catch { /* Native destruction may have already detached this session. Pending operations must still settle below. */ }
      }
      attachedByThisPort = false; networkReady = false
    }
    // Disposing a still-live port does not prove an already dispatched input
    // or page write cannot run. Keep those operations fenced until native
    // settlement or the actual owned WebContents destruction event.
    for (const pending of nativePending) if (!pending.mayMutate || guest.isDestroyed()) pending.reject(closedError())
    removeDestroyedListenerIfFinished()
  }
  function onDestroyed(): void {
    disposePort()
    // The destroyed event itself is authoritative, even if a test/native
    // wrapper has not yet updated isDestroyed() during event dispatch.
    for (const pending of nativePending) pending.reject(closedError())
    removeDestroyedListenerIfFinished()
  }
  guest.on('destroyed', onDestroyed)
  function assertOwned(): void {
    options.assertOwnedSession()
    if (disposed || guest.isDestroyed()) throw targetError('TARGET_SESSION_CLOSED', '目标平台窗口已关闭。')
    let url: URL
    try { url = new URL(guest.getURL()) } catch { throw targetError('TARGET_ORIGIN_BLOCKED', '目标窗口没有有效平台地址。') }
    if (!origins.has(url.origin) || url.username || url.password) throw targetError('TARGET_ORIGIN_BLOCKED', '目标窗口已离开登记的平台实例。')
  }
  async function evaluate<T>(program: string, mayMutate = false): Promise<T> {
    assertOwned()
    // Electron intentionally replaces renderer-thrown errors with a generic
    // message. Return only fixed application error codes across that boundary;
    // never leak a platform exception message or mistake a pending DOM for a
    // fatal script failure.
    const codes = ['TARGET_FRAME_NOT_UNIQUE', 'TARGET_SCOPE_NOT_UNIQUE', 'TARGET_CONTROL_NOT_UNIQUE', 'TARGET_CREDENTIAL_CONTROL_BLOCKED', 'TARGET_CONTROL_TOO_LARGE',
      'TARGET_CONTROL_DISABLED', 'TARGET_OPTION_MISSING', 'TARGET_ORIGIN_BLOCKED', 'TARGET_LOGO_NOT_UNIQUE', 'TARGET_LOGO_ASSET_MISSING',
      'TARGET_IDENTITY_PAGE_MISMATCH', 'TARGET_IDENTITY_FIELD_INVALID', 'TARGET_CONTEXT_PAGE_MISMATCH', 'TARGET_CONTEXT_FIELD_NOT_UNIQUE', 'TARGET_CONTEXT_FIELD_INVALID',
      'TARGET_CONTROL_OUTSIDE_VIEWPORT', 'TARGET_CONTROL_OCCLUDED', 'TARGET_CONTROL_GEOMETRY_INVALID']
    const wrapped = `(() => { try { return { ownedResult: true, ok: true, value: (${program}) }; }
      catch (error) { const codes = ${JSON.stringify(codes)}; const code = codes.includes(error?.message) ? error.message : 'TARGET_DOCUMENT_READ_FAILED'; return { ownedResult: true, ok: false, code }; } })()`
    const result = await nativeAwait(() => guest.executeJavaScript(wrapped, true), mayMutate) as { ownedResult?: boolean; ok?: boolean; value?: T; code?: string }
    assertOwned()
    if (!result || result.ownedResult !== true || typeof result.ok !== 'boolean') throw targetError('TARGET_DOCUMENT_READ_FAILED', '页面结构读取没有返回有效结果。')
    if (!result.ok) {
      const code = result.code && codes.includes(result.code) ? result.code : 'TARGET_DOCUMENT_READ_FAILED'
      throw targetError(code, `${code}: 当前页面控件未准备完成或与已核验结构不一致。`)
    }
    return result.value as T
  }
  async function attach(assertAccess: () => void = assertOwned): Promise<void> {
    assertAccess()
    if (disposed || guest.isDestroyed()) throw targetError('TARGET_SESSION_CLOSED', '目标平台窗口已关闭。')
    if (networkReady) return
    if (attaching) { await attaching; assertAccess(); if (disposed) throw targetError('TARGET_SESSION_CLOSED', '目标平台窗口已关闭。'); return }
    if (guest.debugger.isAttached()) throw targetError('TARGET_BROWSER_BUSY', '目标窗口已有执行器，不能争抢调试会话。')
    guest.debugger.attach('1.3')
    attachedByThisPort = true
    guest.debugger.on('message', onMessage)
    attaching = (async () => {
      try {
        await nativeAwait(() => guest.debugger.sendCommand('Network.enable', { maxTotalBufferSize: 2_000_000, maxResourceBufferSize: 1_000_000, maxPostDataSize: 32768 }))
        // Observed login iframe navigation can destroy a renderer before a
        // response body is read. Durable CDP messages retain bounded payloads
        // in browser memory (never disk), not inside the departing renderer.
        await nativeAwait(() => guest.debugger.sendCommand('Network.configureDurableMessages', { maxTotalBufferSize: 2_000_000, maxResourceBufferSize: 1_000_000 }))
        assertAccess(); if (disposed) throw targetError('TARGET_SESSION_CLOSED', '目标平台窗口已关闭。'); networkReady = true
      } catch (error) {
        guest.debugger.removeListener('message', onMessage)
        if (attachedByThisPort && !guest.isDestroyed() && guest.debugger.isAttached()) guest.debugger.detach()
        attachedByThisPort = false; networkReady = false
        if (error && typeof error === 'object' && 'code' in error) throw error
        throw targetError('TARGET_DURABLE_CAPTURE_UNAVAILABLE', '当前浏览器未能启用跨页面响应保存，不能验证登录或提交结果。')
      } finally { attaching = undefined }
    })()
    await attaching
  }
  async function command(method: string, params: Record<string, unknown>): Promise<void> {
    await attach(); assertOwned()
    await nativeAwait(() => guest.debugger.sendCommand(method, params), method.startsWith('Input.'))
    assertOwned()
  }
  function failWaiters(error: unknown): void { for (const waiter of waiters) waiter.reject(error) }
  function requestFields(postData: unknown): TemplateExchange['requestFields'] {
    if (typeof postData !== 'string' || postData.length > 1_000_000) return {}
    const form = new URLSearchParams(postData)
    let values: Record<string, unknown> = Object.fromEntries(form.entries())
    if (form.has('arrayStr')) {
      try {
        const parsed: unknown = JSON.parse(form.get('arrayStr') || '')
        if (Array.isArray(parsed) && parsed.length === 1 && parsed[0] && typeof parsed[0] === 'object') values = parsed[0] as Record<string, unknown>
      } catch { return {} }
    }
    const output: TemplateExchange['requestFields'] = {}
    for (const key of ['courseId', 'shopId', 'ds0701'] as const) {
      const value = values[key] ?? (key === 'ds0701' ? values.DS0701 : undefined)
      if (typeof value === 'string' && /^\d{1,18}$/.test(value)) output[key] = value
    }
    if (typeof values.DS0705 === 'string' && values.DS0705.length <= 100) output.templateName = values.DS0705
    return output
  }
  function onMessage(_event: Electron.Event, method: string, parameters: Record<string, unknown>): void {
    // Electron emits native events outside the async context which armed the
    // capture. Each capture owns its original operation/epoch, never the most
    // recently attached port's or currently running operation's context.
    for (const waiter of waiters) void waiter.consume(method, parameters).catch(waiter.reject)
  }
  async function consumeMessage(waiter: Waiter, method: string, parameters: Record<string, unknown>): Promise<void> {
    assertOwned()
    if (!waiters.has(waiter)) return
    const pending = waiter.pending
    const requestId = String(parameters.requestId || '')
    if (!requestId) return
    if (method === 'Network.requestWillBeSent') {
      const request = parameters.request as { url?: string; method?: string; postData?: string } | undefined
      if (!request?.url || request.method !== 'POST') return
      const url = new URL(request.url)
      if (!origins.has(url.origin) || !(TEMPLATE_API_PATHS as readonly string[]).includes(url.pathname)) return
      const path = url.pathname as TemplateApiPath
      if (waiter.path !== path) return
      const fields = requestFields(request.postData)
      if (waiter.match && fields.ds0701 !== String(waiter.match.templateId)) return
      pending.set(requestId, { origin: url.origin, path, fields })
    } else if (method === 'Network.responseReceived') {
      const request = pending.get(requestId)
      const response = parameters.response as { status?: number } | undefined
      if (request && response) request.responseStatus = response.status
    } else if (method === 'Network.loadingFinished') {
      const request = pending.get(requestId)
      if (!request) return
      pending.delete(requestId)
      const response = await nativeAwait(() => guest.debugger.sendCommand('Network.getResponseBody', { requestId })) as { body?: string; base64Encoded?: boolean }
      assertOwned()
      const raw = response.base64Encoded ? Buffer.from(response.body || '', 'base64').toString('utf8') : response.body || ''
      if (raw.length > 2_000_000) throw targetError('TARGET_RESPONSE_TOO_LARGE', '平台响应超出受控读取范围。')
      let body: unknown
      try { body = JSON.parse(raw) } catch { throw targetError('TARGET_RESPONSE_INVALID', '平台响应不是有效 JSON。') }
      const exchange: TemplateExchange = { method: 'POST', origin: request.origin, path: request.path, httpStatus: request.responseStatus || 0, body: sanitiseTemplateResponse(request.path, body), requestFields: request.fields }
      if (waiters.has(waiter)) waiter.resolve(exchange)
    } else if (method === 'Network.loadingFailed' && pending.has(requestId)) {
      pending.delete(requestId)
      waiter.reject(targetError('TARGET_RESPONSE_INTERRUPTED', '平台请求中断，提交结果需要核对。'))
    }
  }
  function controlProgram(control: TargetControl, operation: 'point' | 'scroll' | 'focus' | 'select' | 'read' | 'readMany' | 'source', value?: string): string {
    if (!control.css || control.css.length > 500 || (control.frameCss?.length || 0) > 500 || (control.scopeCss?.length || 0) > 500
      || (control.exactText?.length || 0) > 300 || (control.scopeMatch?.css.length || 0) > 500 || (control.scopeMatch?.exactText.length || 0) > 2000
      || (control.scopeMatch && !control.scopeCss) || (control.framePath && (!control.frameCss || !control.framePath.startsWith('/') || control.framePath.length > 500))) throw targetError('TARGET_CONTROL_INVALID', '控件绑定无效。')
    return `(() => {
      const control = ${JSON.stringify(control)};
      const normalise = text => String(text || '').replace(/\\s+/g, ' ').trim();
      const visible = el => Boolean(el && el.getClientRects().length);
      let doc = document;
      let frame = null;
      if (control.frameCss) {
        const frames = Array.from(document.querySelectorAll(control.frameCss)).filter(visible).filter(frame => {
          if (!control.framePath) return true;
          try { return frame.contentDocument?.location.pathname === control.framePath; } catch { return false; }
        });
        if (frames.length !== 1 || !frames[0].contentDocument) throw new Error('TARGET_FRAME_NOT_UNIQUE');
        frame = frames[0]; doc = frame.contentDocument;
      }
      let scope = doc;
      if (control.scopeCss) {
        const scopes = Array.from(doc.querySelectorAll(control.scopeCss)).filter(visible).filter(scope => {
          if (!control.scopeMatch) return true;
          const labels = Array.from(scope.querySelectorAll(control.scopeMatch.css)).filter(visible);
          return labels.length === 1 && normalise(labels[0].innerText || labels[0].textContent) === normalise(control.scopeMatch.exactText);
        });
        if (scopes.length !== 1) throw new Error('TARGET_SCOPE_NOT_UNIQUE');
        scope = scopes[0];
      }
      const matches = Array.from(scope.querySelectorAll(control.css)).filter(visible)
        .filter(el => control.exactText === undefined || normalise(el.innerText || el.textContent) === normalise(control.exactText));
      const read = el => {
        if (el.matches('input[type=password],input[autocomplete=one-time-code]')) throw new Error('TARGET_CREDENTIAL_CONTROL_BLOCKED');
        const bounded = (value, size) => { if (String(value).length > size) throw new Error('TARGET_CONTROL_TOO_LARGE'); return String(value); };
        const output = { tagName: el.tagName, text: bounded(normalise(el.innerText || el.textContent), 2000), disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true') };
        if (el.matches('input,select,textarea')) output.value = bounded(el.value, 1000);
        if (el.matches('input[type=checkbox],input[type=radio]')) output.checked = el.checked;
        if (el.tagName === 'SELECT') {
          if (el.options.length > 300) throw new Error('TARGET_CONTROL_TOO_LARGE');
          output.options = Array.from(el.options).map(option => ({ value: bounded(option.value, 1000), text: bounded(normalise(option.textContent), 300), disabled: Boolean(option.disabled || option.parentElement?.disabled) }));
        }
        return output;
      };
      if (${JSON.stringify(operation)} === 'readMany') {
        if (matches.length > 100) throw new Error('TARGET_CONTROL_TOO_LARGE');
        return matches.map(read);
      }
      if (matches.length !== 1) throw new Error('TARGET_CONTROL_NOT_UNIQUE');
      const el = matches[0];
      if (el.matches('input[type=password],input[autocomplete=one-time-code]')) throw new Error('TARGET_CREDENTIAL_CONTROL_BLOCKED');
      const disabled = Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true');
      if (${JSON.stringify(operation)} === 'source') {
        if (disabled) throw new Error('TARGET_CONTROL_DISABLED');
        const source = new URL(doc.location.href);
        if (source.origin !== location.origin || source.username || source.password) throw new Error('TARGET_ORIGIN_BLOCKED');
        return source.href;
      }
      if (${JSON.stringify(operation)} === 'read') return read(el);
      if (disabled || el.readOnly) throw new Error('TARGET_CONTROL_DISABLED');
      if (${JSON.stringify(operation)} !== 'point') {
        if (frame) frame.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      }
      if (${JSON.stringify(operation)} === 'scroll') return {};
      if (${JSON.stringify(operation)} === 'focus') { el.focus(); return {}; }
      if (${JSON.stringify(operation)} === 'select') {
        if (el.tagName !== 'SELECT' || Array.from(el.options).filter(option => option.value === ${JSON.stringify(value)} && !option.disabled && !option.parentElement?.disabled).length !== 1) throw new Error('TARGET_OPTION_MISSING');
        el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); el.blur(); return {};
      }
      const box = el.getBoundingClientRect();
      const viewport = doc => ({ width: doc.defaultView?.innerWidth || doc.documentElement.clientWidth, height: doc.defaultView?.innerHeight || doc.documentElement.clientHeight });
      const inner = viewport(doc), outer = viewport(document);
      if (![box.x, box.y, box.width, box.height, inner.width, inner.height, outer.width, outer.height].every(Number.isFinite)
        || box.width <= 0 || box.height <= 0 || inner.width <= 0 || inner.height <= 0 || outer.width <= 0 || outer.height <= 0) throw new Error('TARGET_CONTROL_GEOMETRY_INVALID');
      const left = Math.max(0, box.x), top = Math.max(0, box.y), right = Math.min(inner.width, box.right), bottom = Math.min(inner.height, box.bottom);
      if (right <= left || bottom <= top) throw new Error('TARGET_CONTROL_OUTSIDE_VIEWPORT');
      const localX = (left + right) / 2, localY = (top + bottom) / 2;
      const innerHit = doc.elementFromPoint(localX, localY);
      if (!innerHit || (innerHit !== el && !el.contains(innerHit))) throw new Error('TARGET_CONTROL_OCCLUDED');
      let x = localX, y = localY;
      const geometry = [box.x, box.y, box.width, box.height, inner.width, inner.height, outer.width, outer.height];
      if (frame) {
        const frameBox = frame.getBoundingClientRect();
        if (![frameBox.x, frameBox.y, frameBox.width, frameBox.height, frame.offsetWidth, frame.offsetHeight].every(Number.isFinite)
          || frame.offsetWidth <= 0 || frame.offsetHeight <= 0 || frameBox.width <= 0 || frameBox.height <= 0) throw new Error('TARGET_CONTROL_GEOMETRY_INVALID');
        // CSS transforms on an animating dialog also transform its iframe.
        // Convert inner CSS coordinates using the actual rendered frame scale.
        const scaleX = frameBox.width / frame.offsetWidth, scaleY = frameBox.height / frame.offsetHeight;
        x = frameBox.x + (frame.clientLeft + localX) * scaleX;
        y = frameBox.y + (frame.clientTop + localY) * scaleY;
        geometry.push(frameBox.x, frameBox.y, frameBox.width, frameBox.height, frame.offsetWidth, frame.offsetHeight, frame.clientLeft, frame.clientTop);
      }
      if (x < 0 || y < 0 || x >= outer.width || y >= outer.height) throw new Error('TARGET_CONTROL_OUTSIDE_VIEWPORT');
      const outerHit = document.elementFromPoint(x, y);
      if (frame ? outerHit !== frame : !outerHit || (outerHit !== el && !el.contains(outerHit))) throw new Error('TARGET_CONTROL_OCCLUDED');
      return { x, y, geometry };
    })()`
  }
  async function until<T>(read: () => Promise<T>, isTransient: (error: unknown) => boolean = () => false): Promise<T> {
    const deadline = Date.now() + Math.max(100, Math.min(options.responseTimeoutMs || 15000, 30000))
    while (true) {
      assertOwned()
      try { return await read() } catch (error) {
        if (!isTransient(error)) throw error
        if (Date.now() >= deadline) throw targetError('TARGET_NAVIGATION_TIMEOUT', '页面或唯一控件未在本次操作内准备完成。')
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
  }
  const hasCode = (error: unknown, codes: readonly string[]): boolean => Boolean(error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && codes.includes(error.code))
  const notReady = (error: unknown): boolean => hasCode(error, ['TARGET_CONTROL_NOT_UNIQUE', 'TARGET_FRAME_NOT_UNIQUE', 'TARGET_SCOPE_NOT_UNIQUE', 'TARGET_PAGE_NOT_READY'])
  return {
    kind: 'owned-webcontents',
    inspect: () => evaluate<BrowserSnapshot>(SNAPSHOT_PROGRAM),
    async observeLogin(loginOptions) { await attach(loginOptions.assertOwned); disposeLogin?.(); disposeLogin = observeOwnedLogin(guest, loginOptions) },
    readControl: control => evaluate<TargetControlState>(controlProgram(control, 'read')),
    readControls: control => evaluate<TargetControlState[]>(controlProgram(control, 'readMany')),
    async captureLocalContext(kind, action) {
      await attach()
      return captureLocalContext(guest, kind, new URL(guest.getURL()).origin, assertOwned, action, options.responseTimeoutMs, lifetime.signal)
    },
    async readLogoAssetHash() {
      // Only a visible, observed CSS resource may be loaded. No caller-supplied
      // asset URL, version number, or arbitrary remote fetch is accepted.
      const raw = await evaluate<string>(`(() => {
        const logos = Array.from(document.querySelectorAll('.divLogo')).filter(el => el.getClientRects().length);
        if (logos.length !== 1) throw new Error('TARGET_LOGO_NOT_UNIQUE');
        const background = getComputedStyle(logos[0]).backgroundImage;
        const match = /^url\\(["']?([^"')]+)["']?\\)$/.exec(background);
        if (!match) throw new Error('TARGET_LOGO_ASSET_MISSING');
        const url = new URL(match[1], location.href);
        if (url.origin !== location.origin || url.username || url.password) throw new Error('TARGET_ORIGIN_BLOCKED');
        return url.href;
      })()`)
      const url = new URL(raw)
      if (!origins.has(url.origin) || url.username || url.password) throw targetError('TARGET_ORIGIN_BLOCKED', '版本资源离开当前平台。')
      assertOwned()
      const response = await nativeAwait(() => guest.session.fetch(url.href, { redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(10000), lifetime.signal]) }))
      assertOwned()
      if (!response.ok || !/^image\/png(?:;|$)/i.test(response.headers.get('content-type') || '')) throw targetError('TARGET_LOGO_ASSET_INVALID', '版本图像无法核验。')
      const bytes = await nativeAwait(() => response.arrayBuffer()); assertOwned()
      if (bytes.byteLength > 2_000_000) throw targetError('TARGET_LOGO_ASSET_INVALID', '版本图像超出核验范围。')
      return createHash('sha256').update(Buffer.from(bytes)).digest('hex')
    },
    readIdentityField: () => evaluate<{ value: string; readonly: boolean }>(`(() => {
      if (location.pathname !== '/ECrossCommon/CourseUpdatePersonalProfile') throw new Error('TARGET_IDENTITY_PAGE_MISMATCH');
      const fields = Array.from(document.querySelectorAll('input#A0103')).filter(el => el.getClientRects().length);
      if (fields.length !== 1 || !fields[0].readOnly || !/^\\d{1,18}$/.test(fields[0].value)) throw new Error('TARGET_IDENTITY_FIELD_INVALID');
      return { value: fields[0].value, readonly: true };
    })()`),
    readCourseFields: () => evaluate<{ courseId: string; shopId: string }>(`(() => {
      if (location.pathname !== '/ECrossAmazonHome/CourseIndexTraining_1') throw new Error('TARGET_CONTEXT_PAGE_MISMATCH');
      const attribute = (selector, name, exactText) => {
        const matches = Array.from(document.querySelectorAll(selector)).filter(el => el.getClientRects().length && (!exactText || String(el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim() === exactText));
        if (matches.length !== 1) throw new Error('TARGET_CONTEXT_FIELD_NOT_UNIQUE');
        const value = matches[0].getAttribute(name);
        if (!/^\\d{1,18}$/.test(value || '')) throw new Error('TARGET_CONTEXT_FIELD_INVALID');
        return value;
      };
      return { courseId: attribute('#CourseName', 'A1001'), shopId: attribute('.IntoBack', 'B3101', 'Amazon') };
    })()`),
    async back() {
      assertOwned()
      if (!guest.navigationHistory.canGoBack()) throw targetError('TARGET_NAVIGATION_HISTORY_MISSING', '当前现场没有可返回的已访问课程页。')
      guest.navigationHistory.goBack()
      assertOwned()
    },
    async resolveNavigationSource(control) {
      const referrerUrl = await evaluate<string>(controlProgram(control, 'source'))
      return { webContentsId: guest.id, referrerUrl }
    },
    waitForControl: control => until(() => evaluate<TargetControlState>(controlProgram(control, 'read')), notReady),
    waitForPage: (destination, control) => until(async () => {
      const snapshot = await evaluate<BrowserSnapshot>(SNAPSHOT_PROGRAM)
      if (snapshot.loginVisible) throw targetError('TARGET_LOGIN_REQUIRED', '平台已退出登录，请重新登录后再识别。')
      if (snapshot.origin !== destination.origin || snapshot.path !== destination.path) throw targetError('TARGET_PAGE_NOT_READY', '页面跳转尚未完成。')
      if (control) await evaluate<TargetControlState>(controlProgram(control, 'read'))
      return snapshot
    }, notReady),
    async click(control) {
      // Attach first: a slow debugger handshake must not stale the last box.
      // Scroll once, then require three stable, independently hit-tested boxes.
      // Only readiness probes repeat; the actual click is never retried here.
      await attach()
      await evaluate(controlProgram(control, 'scroll'), true)
      let previous: { x: number; y: number; geometry: number[] } | undefined
      let stableSamples = 0
      const point = await until(async () => {
        let sampled: { x: number; y: number; geometry: number[] }
        try { sampled = await evaluate(controlProgram(control, 'point')) }
        catch (error) { previous = undefined; stableSamples = 0; throw error }
        if (![sampled.x, sampled.y, ...sampled.geometry].every(Number.isFinite)) throw targetError('TARGET_CONTROL_INVALID', '控件位置无效。')
        const current = [sampled.x, sampled.y, ...sampled.geometry]
        const last = previous && [previous.x, previous.y, ...previous.geometry]
        stableSamples = last && last.length === current.length && current.every((value, index) => Math.abs(value - last[index]!) <= 0.25) ? stableSamples + 1 : 1
        previous = sampled
        if (stableSamples < 3) throw targetError('TARGET_CONTROL_MOVING', '目标控件仍在布局或动画中。')
        return sampled
      }, error => notReady(error) || hasCode(error, ['TARGET_CONTROL_MOVING', 'TARGET_CONTROL_OUTSIDE_VIEWPORT', 'TARGET_CONTROL_OCCLUDED', 'TARGET_CONTROL_GEOMETRY_INVALID']))
      const coordinates = { x: point.x, y: point.y }
      await command('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...coordinates })
      await command('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...coordinates })
    },
    async typeAndBlur(control, value) {
      if (value.length > 1000) throw targetError('TARGET_INPUT_INVALID', '字段内容过长。')
      // User text must never introduce Enter/Tab or another control key before
      // the explicitly journalled submit action. Validate before even focusing.
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u001F\u007F\u2028\u2029]/.test(value)) throw targetError('TARGET_INPUT_INVALID', '字段不能包含换行、回车、制表符或其他控制字符。')
      await evaluate(controlProgram(control, 'focus'), true)
      await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
      await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
      await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
      await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
      // Preserve key/input/key-up/blur event order; fill() alone failed to update the audited form model.
      for (const character of value) {
        const physicalKey = /^\d$/.test(character) ? { code: `Digit${character}`, windowsVirtualKeyCode: character.charCodeAt(0) }
          : /^[a-z]$/i.test(character) ? { code: `Key${character.toUpperCase()}`, windowsVirtualKeyCode: character.toUpperCase().charCodeAt(0) }
            : character === '.' ? { code: 'Period', windowsVirtualKeyCode: 190 }
              : character === '-' ? { code: 'Minus', windowsVirtualKeyCode: 189 }
                : character === ' ' ? { code: 'Space', windowsVirtualKeyCode: 32 } : {}
        const key = { key: character, ...physicalKey }
        await command('Input.dispatchKeyEvent', { type: 'keyDown', ...key })
        // InputFI validates keypress.event.key, not just inserted text. A char
        // event without key is rejected by the real numeric input handler.
        await command('Input.dispatchKeyEvent', { type: 'char', ...key, text: character, unmodifiedText: character })
        await command('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
      }
      await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
      await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
      const accepted = await evaluate<TargetControlState>(controlProgram(control, 'read'))
      let matches = accepted.value === value
      // Only these two audited amount controls may normalise trailing zeroes on
      // blur. Names, identifiers and other fields always require exact text.
      if (!matches && ['input[name="pricePerOrder"]', 'input[name="unitPrice"]'].includes(control.css)) {
        try { matches = normaliseMoney(accepted.value) === normaliseMoney(value) } catch { matches = false }
      }
      if (!matches) throw targetError('TARGET_INPUT_NOT_ACCEPTED', '平台未接受本次字段输入，已停止；请核对字段校验及当前草稿，不会自动重输。')
    },
    async select(control, value) { await evaluate(controlProgram(control, 'select', value), true) },
    async captureResponse(path, action, match) {
      if (!(TEMPLATE_API_PATHS as readonly string[]).includes(path)) throw targetError('TARGET_ENDPOINT_BLOCKED', '接口未列入模板证据范围。')
      if (match && (path !== '/ECrossAmazon/GetFeightRelationList' || !Number.isSafeInteger(match.templateId) || match.templateId <= 0)) throw targetError('TARGET_CAPTURE_INVALID', '详情请求必须绑定已读取的单一模板标识。')
      await attach()
      if ([...waiters].some(waiter => waiter.path === path)) throw targetError('TARGET_CAPTURE_BUSY', '同一接口的事件采集已在进行。')
      let waiter: Waiter | undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      const result = new Promise<TemplateExchange>((resolve, reject) => {
        const created: Waiter = { path, match, pending: new Map(), resolve, reject,
          consume: AsyncResource.bind((method: string, parameters: Record<string, unknown>) => consumeMessage(created, method, parameters)),
        }
        waiter = created
        waiters.add(waiter)
        timer = setTimeout(() => reject(targetError('TARGET_RESPONSE_TIMEOUT', '未取得本次动作的响应，禁止自动重试提交。')), Math.max(100, Math.min(options.responseTimeoutMs || 20000, 30000)))
      })
      // Attach a rejection handler before awaiting the action to avoid an unhandled timeout.
      void result.catch(() => undefined)
      try { await action(); return await result } finally {
        if (timer) clearTimeout(timer)
        if (waiter) { waiters.delete(waiter); waiter.pending.clear() }
      }
    },
    async reload() { assertOwned(); guest.reload(); assertOwned() },
    dispose: disposePort,
  }
}
