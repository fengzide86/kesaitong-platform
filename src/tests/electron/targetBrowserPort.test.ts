import { EventEmitter } from 'node:events'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { TemplateApiPath } from '../../../electron/automation/targets/contracts.cjs'
import type { OwnedWebContentsPort } from '../../../electron/automation/targets/webcontents-port.cjs'

const require = createRequire(import.meta.url)
const { classifyTargetSnapshot } = require(resolve('dist-electron/electron/automation/targets/v2-probe.cjs')) as typeof import('../../../electron/automation/targets/v2-probe.cjs')
const { createOwnedWebContentsPort, sanitiseTemplateResponse } = require(resolve('dist-electron/electron/automation/targets/webcontents-port.cjs')) as {
  createOwnedWebContentsPort(guest: WebContents, options: { assertOwnedSession(): void; allowedOrigins: string[]; responseTimeoutMs?: number }): OwnedWebContentsPort
  sanitiseTemplateResponse(path: TemplateApiPath, raw: unknown): Record<string, unknown>
}
function fixture(responseTimeoutMs = 100) {
  const events = new EventEmitter()
  let attached = false
  let currentUrl = 'https://fixture.invalid/ECrossAmazon/SellerShippingTemplateSetting'
  const debug = Object.assign(events, {
    isAttached: vi.fn(() => attached), attach: vi.fn(() => { attached = true }), detach: vi.fn(() => { attached = false }),
    sendCommand: vi.fn(async (method: string, _params: Record<string, unknown> = {}) => method === 'Network.getResponseBody' ? { body: JSON.stringify({ result: JSON.stringify({ Code: 0 }), jsonStr: '[]' }) } : {}),
  })
  const guest = Object.assign(new EventEmitter(), {
    debugger: debug, isDestroyed: vi.fn(() => false), getURL: () => currentUrl, reload: vi.fn(),
    executeJavaScript: vi.fn(async (source: string) => {
      const doc = document.implementation.createHTMLDocument()
      doc.body.innerHTML = '<header>亚马逊仿真系统 V2.0</header><button id="btnAddTemplate">创建新配送模板</button><div id="divAddTemplate"></div><div id="div_10001"></div><div id="div_20001"></div>'
      return new Function('document', 'location', `return ${source}`)(doc, new URL(currentUrl)) as unknown
    }),
  })
  const assertOwnedSession = vi.fn()
  const port = createOwnedWebContentsPort(guest as unknown as WebContents, { assertOwnedSession, allowedOrigins: ['https://fixture.invalid'], responseTimeoutMs })
  function emitResponse(options: { id?: string; origin?: string; method?: string; postData?: string } = {}) {
    const requestId = options.id || 'request-1'
    debug.emit('message', {}, 'Network.requestWillBeSent', { requestId, request: { method: options.method || 'POST', url: `${options.origin || 'https://fixture.invalid'}/ECrossAmazon/GetTemplateList`, postData: options.postData || 'courseId=101&shopId=202&password=must-not-be-read' } })
    debug.emit('message', {}, 'Network.responseReceived', { requestId, response: { status: 200 } })
    debug.emit('message', {}, 'Network.loadingFinished', { requestId })
  }
  return { port, guest, debug, assertOwnedSession, emitResponse, setUrl: (url: string) => { currentUrl = url },
    destroy: () => { guest.isDestroyed.mockReturnValue(true); guest.emit('destroyed') } }
}
function installDocument(test: ReturnType<typeof fixture>, html: string): Document {
  const doc = document.implementation.createHTMLDocument()
  doc.body.innerHTML = html
  for (const element of doc.querySelectorAll('*')) {
    vi.spyOn(element, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
    Object.defineProperty(element, 'scrollIntoView', { value: vi.fn() })
  }
  test.guest.executeJavaScript.mockImplementation(async source => new Function('document', 'location', 'Event', `return ${source}`)(doc, new URL(test.guest.getURL()), Event))
  return doc
}
function rect(x: number, y: number, width: number, height: number): DOMRect {
  return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height, toJSON: () => ({}) }
}
function installViewport(doc: Document, hit: Element | null, width = 1200, height = 800) {
  Object.defineProperty(doc, 'defaultView', { configurable: true, value: { innerWidth: width, innerHeight: height } })
  Object.defineProperty(doc, 'elementFromPoint', { configurable: true, value: vi.fn(() => hit) })
}
describe('main-owned target browser port', () => {
  it('strips auth, redirects and unrecognised payload fields before worker IPC', () => {
    const result = sanitiseTemplateResponse('/ECrossAmazon/GetTemplateList', { result: JSON.stringify({ Code: 0, Token: 'secret-token', Msg: 'opaque customer text', RedirectUrl: '/?paras=secret' }), jsonStr: JSON.stringify([{ DS0701: 2, DS0705: 'fixture', DS0707: 0, credentials: 'hidden' }]), secret: 'drop' })
    expect(result).toEqual({ result: { Code: 0 }, jsonStr: [{ DS0701: 2, DS0705: 'fixture', DS0707: 0 }] })
    expect(JSON.stringify(result)).not.toContain('secret')
  })
  it('retains a nonzero business code even when the error has no data blocks', () => {
    expect(sanitiseTemplateResponse('/ECrossAmazon/GetTemplateList', { result: '{"Code":12,"Token":"secret"}' })).toEqual({ result: { Code: 12 } })
  })
  it('returns only allowlisted local context, not complete paras or secrets', async () => {
    const test = fixture()
    const secret = 'courseId=101&shopId=202&companyId=303&roleCode=2&Token=fixture-secret'
    const encoded = Array.from(secret).map(char => char.charCodeAt(0)).join('|')
    test.setUrl(`https://fixture.invalid/ECrossAmazon/SellerShippingTemplateSetting?paras=${encodeURIComponent(encoded)}`)
    const snapshot = await test.port.inspect()
    expect(snapshot.context).toEqual({ courseId: '101', shopId: '202', companyId: '303', roleCode: '2' })
    expect(snapshot.context).not.toHaveProperty('accountId')
    expect(snapshot.controls).toEqual(['#btnAddTemplate', '#divAddTemplate'])
    expect(snapshot.v2Marker).toBe(true)
    expect(snapshot.templateDom).toBe(true)
    expect(JSON.stringify(snapshot)).not.toContain('fixture-secret')
    expect(JSON.stringify(snapshot)).not.toContain('paras')
    test.port.dispose()
  })
  it('keeps the list fingerprint stable when its selected template details load asynchronously', async () => {
    const test = fixture()
    const doc = installDocument(test, '<header>亚马逊仿真系统 V2.0</header><button id="btnAddTemplate">创建新配送模板</button><div id="divAddTemplate"></div>')
    const before = await test.port.inspect()
    for (const id of ['10001', '10002', '10003', '10004', '20001', '20002']) {
      const section = doc.createElement('div'); section.id = `div_${id}`; section.textContent = '异步详情'; doc.body.appendChild(section)
    }
    const after = await test.port.inspect()
    expect(after.controls).toEqual(['#btnAddTemplate', '#divAddTemplate'])
    expect(classifyTargetSnapshot(after).pageFingerprint).toBe(classifyTargetSnapshot(before).pageFingerprint)
    doc.querySelector('#btnAddTemplate')!.remove()
    const broken = await test.port.inspect()
    expect(broken.templateDom).toBe(false)
    expect(classifyTargetSnapshot(broken).pageFingerprint).not.toBe(classifyTargetSnapshot(before).pageFingerprint)
    test.port.dispose()
  })
  it('keeps course-map structure independent of template controls and editor structure sensitive to service controls', async () => {
    const test = fixture(); test.setUrl('https://fixture.invalid/ECrossAmazonHome/CourseIndexTraining_1')
    const doc = installDocument(test, '<header>亚马逊仿真系统 V2.0</header><div>Amazon 国内仓库</div><button id="btnAddTemplate">创建新配送模板</button><div id="divAddTemplate"></div><input id="templateNameInput" name="templateName"><button id="btnSubmit">保存</button><button id="btnCancel">取消</button><div id="div_10001"></div><div id="div_20001"></div>')
    expect((await test.port.inspect()).controls).toEqual([])
    test.setUrl('https://fixture.invalid/ECrossAmazon/SellerShippingTemplateSettingAdd')
    const before = await test.port.inspect()
    expect(before.controls).not.toContain('#btnAddTemplate')
    expect(before.controls).not.toContain('#divAddTemplate')
    expect(before.controls).toContain('#div_10001')
    doc.querySelector('#div_10001')!.remove()
    const after = await test.port.inspect()
    expect(after.templateDom).toBe(false)
    expect(classifyTargetSnapshot(after).pageFingerprint).not.toBe(classifyTargetSnapshot(before).pageFingerprint)
    test.port.dispose()
  })
  it.each([
    { path: 'SellerShippingTemplateSetting', html: '<button id="btnAddTemplate">创建新配送模板</button><div id="divAddTemplate"></div>', evidence: 'template-list-controls-observed' },
    { path: 'SellerShippingTemplateSettingAdd', html: '<input id="templateNameInput" name="templateName" value="private-draft"><button id="btnSubmit">保存</button><button id="btnCancel">取消</button><div id="div_10001"></div><div id="div_20001"></div>', evidence: 'template-editor-controls-observed' },
  ])('recognises $path shape without deriving V2 from the logo path or control IDs', async ({ path, html, evidence }) => {
    const test = fixture(); test.setUrl(`https://fixture.invalid/ECrossAmazon/${path}`)
    const doc = document.implementation.createHTMLDocument()
    doc.body.innerHTML = `<header style="background-image: url('/Images/Logo/24/LoginPage.png')">亚马逊仿真</header>${html}`
    test.guest.executeJavaScript.mockImplementationOnce(async source => new Function('document', 'location', `return ${source}`)(doc, new URL(test.guest.getURL())))
    const snapshot = await test.port.inspect()
    expect(snapshot.templateDom).toBe(true)
    expect(snapshot.v2Marker).toBe(false)
    expect(snapshot.v3Marker).toBe(false)
    const probe = classifyTargetSnapshot(snapshot)
    expect(probe.kind).toBe('unknown')
    expect(probe.version).toBeNull()
    expect(probe.evidence).toContain(evidence)
    expect(probe.missing).toContain('explicit-platform-version-marker')
    expect(JSON.stringify(snapshot)).not.toContain('private-draft')
    test.port.dispose()
  })
  it.each([
    '<button id="btnAddTemplate">创建新配送模板</button><div id="divAddTemplate"></div>',
    '<input id="templateNameInput" name="templateName"><button id="btnCancel">取消</button><div id="div_10001"></div><div id="div_20001"></div>',
  ])('does not accept a list or incomplete editor as the real Add-page shape', async html => {
    const test = fixture(); test.setUrl('https://fixture.invalid/ECrossAmazon/SellerShippingTemplateSettingAdd')
    const doc = document.implementation.createHTMLDocument(); doc.body.innerHTML = html
    test.guest.executeJavaScript.mockImplementationOnce(async source => new Function('document', 'location', `return ${source}`)(doc, new URL(test.guest.getURL())))
    expect((await test.port.inspect()).templateDom).toBe(false)
    test.port.dispose()
  })
  it('refuses another debugger instead of stealing a Runner session', async () => {
    const test = fixture()
    test.debug.attach()
    await expect(test.port.captureResponse('/ECrossAmazon/GetTemplateList', async () => undefined)).rejects.toMatchObject({ code: 'TARGET_BROWSER_BUSY' })
    expect(test.debug.detach).not.toHaveBeenCalled()
    test.port.dispose()
    expect(test.debug.detach).not.toHaveBeenCalled()
  })
  it('requires bounded in-memory durable capture and fails closed if the browser cannot provide it', async () => {
    const test = fixture()
    test.debug.sendCommand.mockImplementation(async method => { if (method === 'Network.configureDurableMessages') throw new Error('Method not found'); return {} })
    const action = vi.fn(async () => undefined)
    await expect(test.port.captureResponse('/ECrossAmazon/GetTemplateList', action)).rejects.toMatchObject({ code: 'TARGET_DURABLE_CAPTURE_UNAVAILABLE' })
    expect(action).not.toHaveBeenCalled()
    expect(test.debug.sendCommand).toHaveBeenCalledWith('Network.configureDurableMessages', { maxTotalBufferSize: 2000000, maxResourceBufferSize: 1000000 })
    expect(test.debug.detach).toHaveBeenCalledTimes(1)
    test.port.dispose()
  })
  it('arms before the UI action and scopes metadata without saving credentials', async () => {
    const test = fixture()
    const response = await test.port.captureResponse('/ECrossAmazon/GetTemplateList', async () => { test.emitResponse() })
    expect(response.origin).toBe('https://fixture.invalid')
    expect(response.requestFields).toEqual({ courseId: '101', shopId: '202' })
    expect(JSON.stringify(response)).not.toContain('must-not-be-read')
    test.port.dispose()
    expect(test.debug.detach).toHaveBeenCalledTimes(1)
  })
  it('retains each capture operation scope for native events instead of borrowing the latest operation', async () => {
    const test = fixture(); const context = new AsyncLocalStorage<string>()
    let expected = 'first'
    test.assertOwnedSession.mockImplementation(() => { if (context.getStore() !== expected) throw new Error('operation mismatch') })
    for (const operation of ['first', 'second']) {
      expected = operation
      let armed!: () => void
      const ready = new Promise<void>(resolve => { armed = resolve })
      const capture = context.run(operation, () => test.port.captureResponse('/ECrossAmazon/GetTemplateList', async () => { armed() }))
      await ready
      expect(context.getStore()).toBeUndefined()
      test.emitResponse({ id: operation })
      expect((await capture).httpStatus).toBe(200)
    }
    test.port.dispose()
  })
  it('reads one precisely scoped visible control and never returns attributes or HTML', async () => {
    const test = fixture()
    installDocument(test, '<section id="outside"><button>保存</button></section><section id="row"><button data-token="hidden"> 保存 </button><button>取消</button></section>')
    expect(await test.port.readControl({ css: 'button', scopeCss: '#row', exactText: '保存' })).toEqual({ tagName: 'BUTTON', text: '保存', disabled: false })
    await expect(test.port.readControl({ css: 'button', exactText: '保存' })).rejects.toThrow('TARGET_CONTROL_NOT_UNIQUE')
    await expect(test.port.readControl({ css: 'button', scopeCss: 'section', exactText: '保存' })).rejects.toThrow('TARGET_SCOPE_NOT_UNIQUE')
    test.port.dispose()
  })
  it('reads only the course and shop fields that actually exist on the observed course map', async () => {
    const test = fixture(); test.setUrl('https://fixture.invalid/ECrossAmazonHome/CourseIndexTraining_1')
    const doc = installDocument(test, '<span id="CourseName" A1001="101">课程</span><div class="IntoBack" B3101="202"> Amazon </div><div class="IntoBack" B3101="999">Amazon</div>')
    vi.mocked(doc.querySelectorAll('.IntoBack')[1]!.getClientRects).mockReturnValue([] as unknown as DOMRectList)
    expect(doc.querySelector('.CompanyName')).toBeNull(); expect(doc.querySelector('.UserName')).toBeNull()
    expect(await test.port.readCourseFields()).toEqual({ courseId: '101', shopId: '202' })
    doc.querySelector('#CourseName')!.removeAttribute('A1001')
    await expect(test.port.readCourseFields()).rejects.toMatchObject({ code: 'TARGET_CONTEXT_FIELD_INVALID' })
    test.port.dispose()
  })
  it('preserves only fixed TARGET codes across Electron generic thrown-error replacement', async () => {
    const test = fixture(); const doc = installDocument(test, '<button>取消</button>')
    // Simulate Electron: a thrown renderer error loses its original message.
    // The port must envelope its own fixed errors before this process boundary.
    test.guest.executeJavaScript.mockImplementation(async source => {
      try { return new Function('document', 'location', 'Event', `return ${source}`)(doc, new URL(test.guest.getURL()), Event) as unknown }
      catch { throw new Error('Script failed to execute, this normally means an error was thrown') }
    })
    await expect(test.port.readControl({ css: '#missing' })).rejects.toMatchObject({ code: 'TARGET_CONTROL_NOT_UNIQUE' })
    vi.spyOn(doc, 'querySelectorAll').mockImplementation(() => { throw new Error('private platform text and account-token') })
    const failure = await test.port.readControl({ css: '#missing' }).catch(error => error as Error & { code: string })
    expect(failure).toMatchObject({ code: 'TARGET_DOCUMENT_READ_FAILED' })
    expect(String(failure)).not.toContain('account-token')
    expect(String(failure)).not.toContain('private platform')
    test.port.dispose()
  })
  it('waits for an initially absent control using safely returned renderer codes', async () => {
    const test = fixture(); const doc = installDocument(test, '<button id="later">继续</button>')
    const button = doc.querySelector('#later')!
    vi.mocked(button.getClientRects).mockReturnValueOnce([] as unknown as DOMRectList)
    expect(await test.port.waitForControl({ css: '#later' })).toMatchObject({ tagName: 'BUTTON', text: '继续' })
    expect(test.guest.executeJavaScript).toHaveBeenCalledTimes(2)
    test.port.dispose()
  })
  it('waits for actual page navigation by error.code rather than translated error text', async () => {
    const test = fixture(1000); const doc = installDocument(test, '<button id="ready">配送设置</button>')
    let inspections = 0
    test.guest.executeJavaScript.mockImplementation(async source => {
      if (++inspections > 1) test.setUrl('https://fixture.invalid/ECrossAmazon/SellerAccountSetting')
      return new Function('document', 'location', 'Event', `return ${source}`)(doc, new URL(test.guest.getURL()), Event) as unknown
    })
    expect(await test.port.waitForPage({ origin: 'https://fixture.invalid', path: '/ECrossAmazon/SellerAccountSetting' }, { css: '#ready' })).toMatchObject({ path: '/ECrossAmazon/SellerAccountSetting' })
    expect(inspections).toBeGreaterThan(1)
    test.port.dispose()
  })
  it('waits for three stable hit-tested boxes then sends only one click at the final point', async () => {
    const test = fixture(1000); const doc = installDocument(test, '<button id="moving">下一步</button>')
    const button = doc.querySelector('#moving')!
    installViewport(doc, button)
    const boxes = vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(rect(200, 80, 80, 40))
    boxes.mockReturnValueOnce(rect(200, 50, 80, 40))
    await test.port.click({ css: '#moving' })
    expect(boxes).toHaveBeenCalledTimes(4)
    expect(test.debug.sendCommand.mock.calls.filter(([method]) => method === 'Input.dispatchMouseEvent')).toEqual([
      ['Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x: 240, y: 100 }],
      ['Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: 240, y: 100 }],
    ])
    expect(button.scrollIntoView).toHaveBeenCalledTimes(1)
    test.port.dispose()
  })
  it('does not click through a visible modal overlay or retry a blocked click', async () => {
    const test = fixture(); const doc = installDocument(test, '<button id="under">Amazon</button><div id="overlay">遮挡</div>')
    const button = doc.querySelector('#under')!
    installViewport(doc, doc.querySelector('#overlay'))
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(rect(100, 100, 80, 40))
    await expect(test.port.click({ css: '#under' })).rejects.toMatchObject({ code: 'TARGET_NAVIGATION_TIMEOUT' })
    expect(test.debug.sendCommand.mock.calls.some(([method]) => method === 'Input.dispatchMouseEvent')).toBe(false)
    test.port.dispose()
  })
  it('checks inner and parent iframe hit targets and converts coordinates only after frame stability', async () => {
    const test = fixture(1000); const doc = installDocument(test, '<iframe id="seller-frame"></iframe>')
    const frame = doc.querySelector('iframe')!
    const inner = document.implementation.createHTMLDocument()
    inner.body.innerHTML = '<div class="AmazonCon">亚马逊卖家后台</div>'
    const button = inner.querySelector('.AmazonCon')!
    Object.defineProperty(frame, 'contentDocument', { value: inner })
    Object.defineProperties(frame, { offsetWidth: { value: 900 }, offsetHeight: { value: 560 } })
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(rect(177, 99, 900, 560))
    vi.spyOn(button, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(rect(160, 270, 74, 110))
    Object.defineProperty(button, 'scrollIntoView', { value: vi.fn() })
    installViewport(inner, button, 900, 560); installViewport(doc, frame)
    await test.port.click({ frameCss: '#seller-frame', css: '.AmazonCon', exactText: '亚马逊卖家后台' })
    expect(inner.elementFromPoint).toHaveBeenCalledWith(197, 325)
    expect(doc.elementFromPoint).toHaveBeenCalledWith(374, 424)
    expect(test.debug.sendCommand).toHaveBeenCalledWith('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x: 374, y: 424 })
    test.port.dispose()
  })
  it('reports checkbox state and actual select values including disabled options', async () => {
    const test = fixture()
    installDocument(test, '<input id="service" type="checkbox" value="10001" checked><select id="units"><option value="1">商品</option><option value="2" selected>Lb</option><optgroup disabled><option value="3">不可用</option></optgroup></select>')
    expect(await test.port.readControl({ css: '#service' })).toMatchObject({ value: '10001', checked: true })
    expect(await test.port.readControl({ css: '#units' })).toMatchObject({ value: '2', options: [{ value: '1', text: '商品', disabled: false }, { value: '2', text: 'Lb', disabled: false }, { value: '3', text: '不可用', disabled: true }] })
    await expect(test.port.select({ css: '#units' }, '3')).rejects.toThrow('TARGET_OPTION_MISSING')
    test.port.dispose()
  })
  it('does not select ambiguous same-value options or read credentials', async () => {
    const test = fixture()
    installDocument(test, '<input id="password" type="password" value="never-returned"><input id="otp" autocomplete="one-time-code"><select id="duplicate"><option value="1">one</option><option value="1">other</option></select>')
    await expect(test.port.readControl({ css: '#password' })).rejects.toThrow('TARGET_CREDENTIAL_CONTROL_BLOCKED')
    await expect(test.port.readControl({ css: '#otp' })).rejects.toThrow('TARGET_CREDENTIAL_CONTROL_BLOCKED')
    await expect(test.port.select({ css: '#duplicate' }, '1')).rejects.toThrow('TARGET_OPTION_MISSING')
    test.port.dispose()
  })
  it('permits bounded read-only field inspection but never writing a readonly field', async () => {
    const test = fixture()
    installDocument(test, '<input id="fixed" readonly value="USD"><button id="disabled" disabled>停用</button>')
    expect(await test.port.readControl({ css: '#fixed' })).toMatchObject({ value: 'USD' })
    expect(await test.port.readControl({ css: '#disabled' })).toMatchObject({ disabled: true })
    await expect(test.port.typeAndBlur({ css: '#fixed' }, 'EUR')).rejects.toThrow('TARGET_CONTROL_DISABLED')
    test.port.dispose()
  })
  it('passes a real-style InputFI keypress check and immediately reads the accepted decimal value', async () => {
    const test = fixture(); const doc = installDocument(test, '<input id="amount" value="0">')
    const input = doc.querySelector<HTMLInputElement>('#amount')!
    input.addEventListener('keypress', event => {
      if (!/^\d$/.test(event.key) && event.key !== '.') event.preventDefault()
    })
    test.debug.sendCommand.mockImplementation(async (method, parameters) => {
      if (method === 'Input.dispatchKeyEvent') {
        if (parameters.type === 'keyDown' && parameters.key === 'Backspace') input.value = ''
        if (parameters.type === 'char') {
          const event = new KeyboardEvent('keypress', { key: String(parameters.key || ''), code: String(parameters.code || ''), bubbles: true, cancelable: true })
          if (input.dispatchEvent(event)) input.value += String(parameters.text || '')
        }
      }
      return {}
    })
    await test.port.typeAndBlur({ css: '#amount' }, '1.23')
    expect(input.value).toBe('1.23')
    expect(test.debug.sendCommand).toHaveBeenCalledWith('Input.dispatchKeyEvent', { type: 'char', key: '.', code: 'Period', windowsVirtualKeyCode: 190, text: '.', unmodifiedText: '.' })
    expect(test.debug.sendCommand.mock.calls.filter(([method, parameters]) => method === 'Input.dispatchKeyEvent' && parameters.type === 'char')).toHaveLength(4)
    test.port.dispose()
  })
  it.each(['\u0000', '\b', '\t', '\n', '\r', '\u001F', '\u007F', '\u2028', '\u2029'])('rejects an implicit-submit or control character before focus and key dispatch (%j)', async controlCharacter => {
    const test = fixture()
    await expect(test.port.typeAndBlur({ css: '#name' }, `测试${controlCharacter}名称`)).rejects.toMatchObject({ code: 'TARGET_INPUT_INVALID' })
    expect(test.guest.executeJavaScript).not.toHaveBeenCalled()
    expect(test.debug.sendCommand).not.toHaveBeenCalled()
    expect(test.debug.attach).not.toHaveBeenCalled()
    test.port.dispose()
  })
  it('fails immediately if the platform rejects typing without exposing field content or retrying', async () => {
    const test = fixture(); installDocument(test, '<input id="amount" value="0">')
    const failure = await test.port.typeAndBlur({ css: '#amount' }, '1.23').catch(error => error as Error & { code: string })
    expect(failure).toMatchObject({ code: 'TARGET_INPUT_NOT_ACCEPTED' })
    expect(String(failure)).not.toContain('1.23')
    expect(test.debug.sendCommand.mock.calls.filter(([method, parameters]) => method === 'Input.dispatchKeyEvent' && parameters.type === 'char')).toHaveLength(4)
    test.port.dispose()
  })
  it.each(['pricePerOrder', 'unitPrice', 'templateName'])('normalises blur formatting only for audited amount control %s', async name => {
    const test = fixture(); const doc = installDocument(test, `<input name="${name}" value="0">`)
    const input = doc.querySelector<HTMLInputElement>('input')!
    test.debug.sendCommand.mockImplementation(async (method, parameters) => {
      if (method === 'Input.dispatchKeyEvent') {
        if (parameters.type === 'keyDown' && parameters.key === 'Backspace') input.value = ''
        if (parameters.type === 'char') input.value += String(parameters.text || '')
        if (parameters.type === 'keyDown' && parameters.key === 'Tab') input.value = String(Number(input.value))
      }
      return {}
    })
    const operation = test.port.typeAndBlur({ css: `input[name="${name}"]` }, '1.20')
    if (name === 'templateName') await expect(operation).rejects.toMatchObject({ code: 'TARGET_INPUT_NOT_ACCEPTED' })
    else await expect(operation).resolves.toBeUndefined()
    expect(input.value).toBe('1.2')
    test.port.dispose()
  })
  it('preserves each Unicode character and space in key events without inventing physical key codes', async () => {
    const test = fixture(); const doc = installDocument(test, '<input id="name" value="旧名">')
    const input = doc.querySelector<HTMLInputElement>('#name')!
    test.debug.sendCommand.mockImplementation(async (method, parameters) => {
      if (method === 'Input.dispatchKeyEvent' && parameters.type === 'keyDown' && parameters.key === 'Backspace') input.value = ''
      if (method === 'Input.dispatchKeyEvent' && parameters.type === 'char') input.value += String(parameters.text || '')
      return {}
    })
    await test.port.typeAndBlur({ css: '#name' }, '模板 B')
    expect(input.value).toBe('模板 B')
    expect(test.debug.sendCommand).toHaveBeenCalledWith('Input.dispatchKeyEvent', { type: 'char', key: '模', text: '模', unmodifiedText: '模' })
    expect(test.debug.sendCommand).toHaveBeenCalledWith('Input.dispatchKeyEvent', { type: 'char', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ', unmodifiedText: ' ' })
    test.port.dispose()
  })
  it('rejects oversized values instead of returning an unbounded page payload', async () => {
    const test = fixture()
    installDocument(test, `<input id="large" value="${'a'.repeat(1001)}">`)
    await expect(test.port.readControl({ css: '#large' })).rejects.toThrow('TARGET_CONTROL_TOO_LARGE')
    test.port.dispose()
  })
  it('enumerates visible rule labels but targets one row by its own unique region text', async () => {
    const test = fixture()
    installDocument(test, '<table><tbody id="tbody_10001"><tr><td class="region">美国大陆</td><td><input class="price" value="3"></td></tr><tr><td class="region">阿拉斯加</td><td><input class="price" value="4"></td></tr></tbody></table>')
    expect((await test.port.readControls({ scopeCss: '#tbody_10001', css: '.region' })).map(row => row.text)).toEqual(['美国大陆', '阿拉斯加'])
    expect(await test.port.readControl({ scopeCss: '#tbody_10001 tr', scopeMatch: { css: '.region', exactText: '阿拉斯加' }, css: '.price' })).toMatchObject({ value: '4' })
    await expect(test.port.readControl({ scopeCss: '#tbody_10001 tr', scopeMatch: { css: '.region', exactText: '缺失' }, css: '.price' })).rejects.toThrow('TARGET_SCOPE_NOT_UNIQUE')
    test.port.dispose()
  })
  it('matches detail capture by the actual request template ID, not a competing automatic default load', async () => {
    const test = fixture()
    test.debug.sendCommand.mockImplementation(async (method, params) => method === 'Network.getResponseBody' ? { body: JSON.stringify({ result: '{"Code":0}', jsonStr1: '[{"DS0701":42,"DS0705":"same-object","DS0708":"0"}]', jsonStr2: '[]', jsonStr3: '[]' }), requestId: params.requestId } : {})
    const exchange = await test.port.captureResponse('/ECrossAmazon/GetFeightRelationList', async () => {
      for (const id of ['1', '42']) {
        test.debug.emit('message', {}, 'Network.requestWillBeSent', { requestId: id, request: { method: 'POST', url: 'https://fixture.invalid/ECrossAmazon/GetFeightRelationList', postData: `courseId=101&shopId=202&ds0701=${id}` } })
        test.debug.emit('message', {}, 'Network.responseReceived', { requestId: id, response: { status: 200 } })
        test.debug.emit('message', {}, 'Network.loadingFinished', { requestId: id })
      }
    }, { templateId: 42 })
    expect(exchange.requestFields.ds0701).toBe('42')
    expect(test.debug.sendCommand).not.toHaveBeenCalledWith('Network.getResponseBody', { requestId: '1' })
    await expect(test.port.captureResponse('/ECrossAmazon/SaveTemplate', async () => undefined, { templateId: 42 })).rejects.toMatchObject({ code: 'TARGET_CAPTURE_INVALID' })
    test.port.dispose()
  })
  it.each([{ method: 'GET' }, { origin: 'https://other.invalid' }])('ignores wrong method/origin: %j', async mismatch => {
    const test = fixture()
    await expect(test.port.captureResponse('/ECrossAmazon/GetTemplateList', async () => { test.emitResponse(mismatch) })).rejects.toMatchObject({ code: 'TARGET_RESPONSE_TIMEOUT' })
    expect(test.debug.sendCommand).not.toHaveBeenCalledWith('Network.getResponseBody', expect.anything())
    test.port.dispose()
  })
  it('checks host session ownership before any document inspection', async () => {
    const test = fixture()
    test.assertOwnedSession.mockImplementation(() => { throw new Error('session revoked') })
    await expect(test.port.inspect()).rejects.toThrow('session revoked')
    expect(test.guest.executeJavaScript).not.toHaveBeenCalled()
    test.port.dispose()
  })
  it('detects a visible password control in a same-origin login iframe without reading its value', async () => {
    const test = fixture()
    const doc = document.implementation.createHTMLDocument()
    const frame = doc.createElement('iframe')
    doc.body.appendChild(frame)
    const login = document.implementation.createHTMLDocument()
    const password = login.createElement('input'); password.type = 'password'
    Object.defineProperty(password, 'value', { get() { throw new Error('credential value must never be read') } })
    login.body.appendChild(password)
    vi.spyOn(frame, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
    vi.spyOn(password, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
    Object.defineProperty(frame, 'contentDocument', { value: login })
    test.guest.executeJavaScript.mockImplementationOnce(async source => new Function('document', 'location', `return ${source}`)(doc, new URL(test.guest.getURL())))
    const snapshot = await test.port.inspect()
    expect(snapshot.loginVisible).toBe(true)
    expect(snapshot).not.toHaveProperty('password')
    expect(JSON.stringify(snapshot)).not.toContain('input')
    test.port.dispose()
  })
  it('does not classify hidden or inaccessible login frames by reading through their boundary', async () => {
    const test = fixture()
    const doc = document.implementation.createHTMLDocument()
    const hidden = doc.createElement('iframe'); doc.body.appendChild(hidden)
    Object.defineProperty(hidden, 'contentDocument', { get() { throw new Error('hidden frame should not be inspected') } })
    const foreign = doc.createElement('iframe'); doc.body.appendChild(foreign)
    vi.spyOn(foreign, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
    Object.defineProperty(foreign, 'contentDocument', { get() { throw new DOMException('foreign frame', 'SecurityError') } })
    test.guest.executeJavaScript.mockImplementationOnce(async source => new Function('document', 'location', `return ${source}`)(doc, new URL(test.guest.getURL())))
    expect((await test.port.inspect()).loginVisible).toBe(false)
    test.port.dispose()
  })
  it('does not reuse a page that has left the configured exact origin', async () => {
    const test = fixture()
    test.setUrl('https://fixture.invalid.evil.test/ECrossAmazon/SellerShippingTemplateSetting')
    await expect(test.port.inspect()).rejects.toMatchObject({ code: 'TARGET_ORIGIN_BLOCKED' })
    test.port.dispose()
  })
  it('dispose rejects waiting responses and detaches only its own attachment', async () => {
    const test = fixture()
    const waiting = test.port.captureResponse('/ECrossAmazon/GetTemplateList', async () => { test.port.dispose() })
    await expect(waiting).rejects.toMatchObject({ code: 'TARGET_SESSION_CLOSED' })
    expect(test.debug.detach).toHaveBeenCalledTimes(1)
  })
  it('settles a hung readonly native evaluation on disposal and ignores a late native answer', async () => {
    const test = fixture(); let nativeResolve!: (value: unknown) => void
    test.guest.executeJavaScript.mockImplementation(() => new Promise(resolve => { nativeResolve = resolve }))
    const result = test.port.inspect(); const observed = expect(result).rejects.toMatchObject({ code: 'TARGET_SESSION_CLOSED' })
    test.port.dispose(); await observed
    nativeResolve({ ownedResult: true, ok: true, value: { forbidden: 'late' } })
    await Promise.resolve()
    expect(test.guest.executeJavaScript).toHaveBeenCalledTimes(1)
    expect(test.guest.listenerCount('destroyed')).toBe(0)
  })
  it('settles a hanging Network attach on destroy without starting the action', async () => {
    const test = fixture(); const action = vi.fn(async () => undefined)
    test.debug.sendCommand.mockImplementation(async method => method === 'Network.enable' ? await new Promise(() => undefined) : {})
    const result = test.port.captureResponse('/ECrossAmazon/GetTemplateList', action)
    const observed = expect(result).rejects.toMatchObject({ code: 'TARGET_SESSION_CLOSED' })
    test.destroy(); await observed
    expect(action).not.toHaveBeenCalled()
    expect(test.debug.sendCommand).toHaveBeenCalledTimes(1)
  })
  it('keeps an already-dispatched input fenced on live dispose, then settles on actual destruction', async () => {
    const test = fixture(); installDocument(test, '<input id="name">')
    let started!: () => void; const inputStarted = new Promise<void>(resolve => { started = resolve })
    let lateResolve!: (value: object) => void
    test.debug.sendCommand.mockImplementation(async (method) => {
      if (method === 'Input.dispatchKeyEvent') { started(); return await new Promise(resolve => { lateResolve = resolve }) }
      return {}
    })
    const result = test.port.typeAndBlur({ css: '#name' }, 'test')
    let settled = false; void result.then(() => { settled = true }, () => { settled = true })
    await inputStarted; test.port.dispose()
    await Promise.resolve(); await Promise.resolve()
    expect(settled).toBe(false)
    expect(test.guest.listenerCount('destroyed')).toBe(1)
    test.destroy(); await expect(result).rejects.toMatchObject({ code: 'TARGET_SESSION_CLOSED' })
    lateResolve({}); await Promise.resolve(); await Promise.resolve()
    expect(test.debug.sendCommand.mock.calls.filter(([method]) => method === 'Input.dispatchKeyEvent')).toHaveLength(1)
    expect(test.guest.listenerCount('destroyed')).toBe(0)
  })
  it('keeps a queued renderer field mutation fenced until destruction', async () => {
    const test = fixture()
    test.guest.executeJavaScript.mockImplementation(async () => await new Promise(() => undefined))
    const result = test.port.select({ css: '#units' }, '2')
    let settled = false; void result.catch(() => { settled = true })
    test.port.dispose(); await Promise.resolve(); expect(settled).toBe(false)
    test.destroy(); await expect(result).rejects.toMatchObject({ code: 'TARGET_SESSION_CLOSED' })
    expect(test.guest.executeJavaScript).toHaveBeenCalledTimes(1)
  })
  it('settles a destroyed window while a captured response body is stuck in native CDP', async () => {
    const test = fixture(); let started!: () => void; const bodyStarted = new Promise<void>(resolve => { started = resolve })
    test.debug.sendCommand.mockImplementation(async method => {
      if (method === 'Network.getResponseBody') { started(); return await new Promise(() => undefined) }
      return {}
    })
    const result = test.port.captureResponse('/ECrossAmazon/GetTemplateList', async () => { test.emitResponse() })
    const observed = expect(result).rejects.toMatchObject({ code: 'TARGET_SESSION_CLOSED' })
    await bodyStarted; test.destroy(); await observed
    expect(test.debug.listenerCount('message')).toBe(0)
  })
})
