import { AsyncLocalStorage } from 'node:async_hooks'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
const require = createRequire(import.meta.url)
const { parseLocalContext, captureLocalContext } = require(resolve('dist-electron/electron/automation/targets/local-context-capture.cjs')) as typeof import('../../../electron/automation/targets/local-context-capture.cjs')
const rawMap = { result: '{"Code":0}', jsonStr: JSON.stringify([{ A1001: 11, B3001: 22, B3101: 33, A0902: 44, privateField: 'drop' }]) }
describe('local-only independent course/account capture', () => {
  it('normalises only audited map IDs and drops raw unrelated data', () => {
    expect(parseLocalContext('map', 'https://fixture.invalid', 200, 'courseId=11&Token=drop', rawMap)).toEqual({
      origin: 'https://fixture.invalid', path: '/ECrossAmazonHome/GetPage', httpStatus: 200, code: 0, request: { courseId: '11' }, record: { A1001: '11', B3001: '22', B3101: '33', A0902: '44' },
    })
  })
  it('excludes names, email, phone, identity card, photos and password from profile evidence', () => {
    const row = { LoginName: '12345678', StudentNo: '12345678', Email: 'private', Phone: 'private', RealName: 'private', Sex: 'private', IDCard: 'private', HeadSculpture: 'private', password: 'private' }
    const result = parseLocalContext('identity', 'https://fixture.invalid', 200, 'userId=44&loginType=24&secret=private', { result: '{"Code":0}', jsonStr: JSON.stringify([row]) })
    expect(result.record).toEqual({ LoginName: '12345678', StudentNo: '12345678' })
    expect(JSON.stringify(result)).not.toContain('private')
  })
  it('leaves duplicate and nonnumeric request identifiers absent so validation cannot accept ambiguity', () => {
    expect(parseLocalContext('map', 'https://fixture.invalid', 200, 'courseId=11&courseId=12', rawMap).request).toEqual({})
    expect(parseLocalContext('identity', 'https://fixture.invalid', 200, 'userId=foo&loginType=24', { result: '{"Code":0}', jsonStr: '[{"LoginName":"not-a-student","StudentNo":"123"}]' }).record).toEqual({ StudentNo: '123' })
  })
  it('rejects nonunique response objects but preserves business failure without treating it as identity evidence', () => {
    expect(() => parseLocalContext('map', 'https://fixture.invalid', 200, 'courseId=11', { ...rawMap, jsonStr: '[]' })).toThrow()
    expect(parseLocalContext('map', 'https://fixture.invalid', 200, 'courseId=11', { result: '{"Code":12}' })).toMatchObject({ code: 12, record: {} })
  })
  it('scopes native capture to its arming operation and never sends a guessed API request', async () => {
    const context = new AsyncLocalStorage<string>(); const events = new EventEmitter()
    const sendCommand = vi.fn(async () => ({ body: JSON.stringify(rawMap) }))
    const guest = { debugger: Object.assign(events, { sendCommand }) } as unknown as WebContents
    let armed!: () => void; const ready = new Promise<void>(resolve => { armed = resolve })
    const capture = context.run('owner-A', () => captureLocalContext(guest, 'map', 'https://fixture.invalid', () => { if (context.getStore() !== 'owner-A') throw new Error('scope lost') }, async () => { armed() }))
    await ready
    events.emit('message', {}, 'Network.requestWillBeSent', { requestId: '1', request: { method: 'POST', url: 'https://fixture.invalid/ECrossAmazonHome/GetPage', postData: 'courseId=11' } })
    events.emit('message', {}, 'Network.responseReceived', { requestId: '1', response: { status: 200 } })
    events.emit('message', {}, 'Network.loadingFinished', { requestId: '1' })
    expect((await capture).record.A1001).toBe('11')
    expect(sendCommand).toHaveBeenCalledExactlyOnceWith('Network.getResponseBody', { requestId: '1' })
    expect(events.listenerCount('message')).toBe(0)
  })
  it('rejects multiple matching requests instead of accepting whichever response finishes first', async () => {
    const events = new EventEmitter(); const guest = { debugger: events } as unknown as WebContents
    const capture = captureLocalContext(guest, 'map', 'https://fixture.invalid', () => undefined, async () => {
      for (const id of ['1', '2']) events.emit('message', {}, 'Network.requestWillBeSent', { requestId: id, request: { method: 'POST', url: 'https://fixture.invalid/ECrossAmazonHome/GetPage', postData: 'courseId=11' } })
    })
    await expect(capture).rejects.toMatchObject({ code: 'TARGET_IDENTITY_AMBIGUOUS' })
    expect(events.listenerCount('message')).toBe(0)
  })
  it('releases its listener immediately when the owned port lifetime ends', async () => {
    const events = new EventEmitter(); const guest = { debugger: events } as unknown as WebContents
    const lifetime = new AbortController()
    const capture = captureLocalContext(guest, 'map', 'https://fixture.invalid', () => undefined, async () => undefined, 30000, lifetime.signal)
    const result = expect(capture).rejects.toMatchObject({ code: 'TARGET_SESSION_CLOSED' })
    lifetime.abort(); await result
    expect(events.listenerCount('message')).toBe(0)
  })
  it('does not start a page action for an already-ended lifetime', async () => {
    const events = new EventEmitter(); const guest = { debugger: events } as unknown as WebContents
    const lifetime = new AbortController(); lifetime.abort()
    const action = vi.fn(async () => undefined)
    await expect(captureLocalContext(guest, 'identity', 'https://fixture.invalid', () => undefined, action, 30000, lifetime.signal)).rejects.toMatchObject({ code: 'TARGET_SESSION_CLOSED' })
    expect(action).not.toHaveBeenCalled()
    expect(events.listenerCount('message')).toBe(0)
  })
})
