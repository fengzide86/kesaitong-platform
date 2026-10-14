import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
const require = createRequire(import.meta.url)
const { observeOwnedLogin } = require(resolve('dist-electron/electron/automation/targets/login-observer.cjs')) as typeof import('../../../electron/automation/targets/login-observer.cjs')
function setup(code = 0) {
  const events = new EventEmitter(); const wc = new EventEmitter()
  let url = 'https://fixture.invalid/User/LoginPage24'
  const sendCommand = vi.fn(async () => ({ body: JSON.stringify({ result: JSON.stringify({ Code: code, Token: 'never-retain', Msg: 'private' }), modelUser: { secret: 'drop' } }) }))
  const guest = Object.assign(wc, { getURL: () => url, debugger: Object.assign(events, { sendCommand }) }) as unknown as WebContents
  const onAttempt = vi.fn(); const onSuccess = vi.fn(); const onFailure = vi.fn(); const assertOwned = vi.fn()
  const stop = observeOwnedLogin(guest, { siteEpoch: 7, isAllowedOrigin: origin => origin === 'https://fixture.invalid', assertOwned, onAttempt, onSuccess, onFailure })
  const request = (extra: Record<string, unknown> = {}) => events.emit('message', {}, 'Network.requestWillBeSent', { requestId: 'login1', request: { method: 'POST', url: 'https://fixture.invalid/User/Login?language=cn', postData: 'uName=880001&loginType=24&uPass=never-retain&validateCode=private', ...extra } })
  const finish = () => { events.emit('message', {}, 'Network.responseReceived', { requestId: 'login1', response: { status: 200 } }); events.emit('message', {}, 'Network.loadingFinished', { requestId: 'login1' }) }
  const navigate = (path = '/ECrossAmazonHome/CourseIndexTraining_1') => { url = `https://fixture.invalid${path}`; wc.emit('did-navigate') }
  return { onAttempt, onSuccess, onFailure, assertOwned, sendCommand, events, stop, request, finish, navigate }
}
describe('successful owned login evidence', () => {
  it('binds exact POST pathname, business Code0 and owned map navigation, storing only the account hash', async () => {
    const test = setup(); test.request(); test.finish()
    await vi.waitFor(() => expect(test.sendCommand).toHaveBeenCalled())
    expect(test.onSuccess).not.toHaveBeenCalled()
    test.navigate()
    await vi.waitFor(() => expect(test.onSuccess).toHaveBeenCalledTimes(1))
    expect(test.onSuccess.mock.calls[0]![0]).toMatchObject({ origin: 'https://fixture.invalid', siteEpoch: 7, loginType: '24', accountRef: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(JSON.stringify(test.onSuccess.mock.calls)).not.toMatch(/880001|never-retain|private|Token/)
    test.stop()
  })
  it('handles navigation before response body without weakening success evidence', async () => {
    const test = setup(); test.request(); test.navigate(); expect(test.onSuccess).not.toHaveBeenCalled(); test.finish()
    await vi.waitFor(() => expect(test.onSuccess).toHaveBeenCalledTimes(1)); test.stop()
  })
  it.each([{ method: 'GET' }, { url: 'https://other.invalid/User/Login' }, { url: 'https://fixture.invalid/User/LoginElse' }])('ignores unrelated login-looking request %j', async extra => {
    const test = setup(); test.request(extra); test.finish(); test.navigate()
    await Promise.resolve(); expect(test.onSuccess).not.toHaveBeenCalled(); expect(test.onAttempt).not.toHaveBeenCalled(); test.stop()
  })
  it('does not accept HTTP200 with failed business login', async () => {
    const test = setup(12); test.request(); test.finish(); test.navigate()
    await vi.waitFor(() => expect(test.onFailure).toHaveBeenCalledWith('TARGET_LOGIN_REJECTED'))
    expect(test.onSuccess).not.toHaveBeenCalled(); test.stop()
  })
  it('fails closed if navigation destroys the response resource', async () => {
    const test = setup(); test.sendCommand.mockRejectedValueOnce(new Error('No resource with given identifier'))
    test.request(); test.finish(); test.navigate()
    await vi.waitFor(() => expect(test.onFailure).toHaveBeenCalledWith('TARGET_LOGIN_RESPONSE_UNAVAILABLE'))
    expect(test.onSuccess).not.toHaveBeenCalled(); test.stop()
  })
  it('does not accept duplicate username fields, and disposal removes all passive listeners', async () => {
    const test = setup(); test.request({ postData: 'uName=1&uName=2&loginType=24' }); test.finish(); test.navigate()
    await vi.waitFor(() => expect(test.onFailure).toHaveBeenCalledWith('TARGET_LOGIN_REQUEST_INVALID'))
    expect(test.onSuccess).not.toHaveBeenCalled(); test.stop(); expect(test.events.listenerCount('message')).toBe(0)
  })
})
