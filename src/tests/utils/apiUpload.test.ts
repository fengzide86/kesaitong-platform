import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { request } from '@/utils/api'
import { stageUpdateRelease } from '@/features/updates/release-api'

class UploadXHR {
  static instances: UploadXHR[] = []
  headers: Record<string, string> = {}
  upload: { onprogress?: (event: { loaded: number; total: number; lengthComputable: boolean }) => void } = {}
  onload?: () => void
  onerror?: () => void
  onabort?: () => void
  status = 200
  statusText = 'OK'
  responseText = '{"data":{"version":"1.8.16","status":"staged","files":[]}}'
  url = ''
  method = ''
  withCredentials = false
  body?: unknown
  constructor() { UploadXHR.instances.push(this) }
  open(method: string, url: string) { this.method = method; this.url = url }
  setRequestHeader(key: string, value: string) { this.headers[key.toLowerCase()] = value }
  getAllResponseHeaders() { return 'Content-Type: application/json\r\nX-Request-ID: upload-fixture' }
  send(body: unknown) { this.body = body }
  abort() { this.onabort?.() }
}

describe('authenticated upload transport', () => {
  beforeEach(() => { UploadXHR.instances = []; vi.stubGlobal('XMLHttpRequest', UploadXHR) })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('uses actual upload bytes, trusted auth headers and shared response parsing', async () => {
    sessionStorage.setItem('toolbox_token', 'isolated-upload-token')
    const progress = vi.fn()
    const result = stageUpdateRelease([new File(['fixture'], 'fixture.exe')], '1.8.16', { onProgress: progress })
    const xhr = UploadXHR.instances[0]!
    expect(xhr.method).toBe('POST')
    expect(xhr.url).toContain('/api/updates/releases/stage')
    expect(xhr.url).not.toContain('isolated-upload-token')
    expect(xhr.headers.authorization).toBe('Bearer isolated-upload-token')
    expect(xhr.headers['content-type']).toBeUndefined()
    expect(xhr.headers['x-toolbox-version']).toBeTruthy()
    xhr.upload.onprogress?.({ loaded: 25, total: 100, lengthComputable: true })
    expect(progress).toHaveBeenCalledWith({ transferredBytes: 25, totalBytes: 100 })
    xhr.onload?.()
    expect(await result).toMatchObject({ version: '1.8.16', status: 'staged' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not impose the regular 12 second timeout on installer uploads', async () => {
    vi.useFakeTimers()
    const result = stageUpdateRelease([], '1.8.16', { onProgress: vi.fn() })
    const settled = vi.fn()
    void result.then(settled, settled)
    await vi.advanceTimersByTimeAsync(12_001)
    expect(settled).not.toHaveBeenCalled()
    UploadXHR.instances[0]!.onload?.()
    await result
  })

  it('cancels an upload without retrying or sending a second request', async () => {
    const controller = new AbortController()
    const result = stageUpdateRelease([], '1.8.16', { signal: controller.signal, onProgress: vi.fn() })
    controller.abort()
    await expect(result).rejects.toMatchObject({ kind: 'cancelled' })
    expect(UploadXHR.instances).toHaveLength(1)
  })

  it('keeps timeout and server request IDs in the existing error model', async () => {
    vi.useFakeTimers()
    const result = request('/api/updates/releases/stage', { method: 'POST', body: new FormData(), timeoutMs: 100, onUploadProgress: vi.fn() })
    const rejected = expect(result).rejects.toMatchObject({ kind: 'timeout' })
    await vi.advanceTimersByTimeAsync(101)
    await rejected
    const failed = request('/api/updates/releases/stage', { method: 'POST', body: new FormData(), onUploadProgress: vi.fn() })
    const xhr = UploadXHR.instances[1]!
    xhr.status = 409
    xhr.responseText = '{"detail":"Version already exists"}'
    xhr.onload?.()
    await expect(failed).rejects.toMatchObject({ status: 409, requestId: 'upload-fixture' })
  })

  it('settles invalid responses and synchronous send failures instead of hanging', async () => {
    const invalid = stageUpdateRelease([], '1.8.16', { onProgress: vi.fn() })
    UploadXHR.instances[0]!.status = 0
    UploadXHR.instances[0]!.onload?.()
    await expect(invalid).rejects.toMatchObject({ kind: 'network' })
    const send = vi.spyOn(UploadXHR.prototype, 'send').mockImplementationOnce(() => { throw new Error('send failed') })
    await expect(stageUpdateRelease([], '1.8.16', { onProgress: vi.fn() })).rejects.toMatchObject({ kind: 'network' })
    send.mockRestore()
  })

  it('classifies an invalid stage schema as an uncertain parse response', async () => {
    const result = stageUpdateRelease([], '1.8.16', { onProgress: vi.fn() })
    UploadXHR.instances[0]!.responseText = '{"data":{"unexpected":true}}'
    UploadXHR.instances[0]!.onload?.()
    await expect(result).rejects.toMatchObject({ kind: 'parse' })
  })

  it('isolates progress observer errors from the real upload result', async () => {
    const observer = vi.fn(() => { throw new Error('render failed') })
    const result = stageUpdateRelease([], '1.8.16', { onProgress: observer })
    const xhr = UploadXHR.instances[0]!
    expect(() => xhr.upload.onprogress?.({ loaded: 1, total: 2, lengthComputable: true })).not.toThrow()
    expect(observer).toHaveBeenCalledOnce()
    xhr.onload?.()
    await expect(result).resolves.toMatchObject({ version: '1.8.16', status: 'staged' })
  })

  it('ignores a captured late progress callback after cancellation and releases handlers', async () => {
    const controller = new AbortController()
    const observer = vi.fn()
    const result = stageUpdateRelease([], '1.8.16', { signal: controller.signal, onProgress: observer })
    const xhr = UploadXHR.instances[0]!
    const captured = xhr.upload.onprogress!
    controller.abort()
    await expect(result).rejects.toMatchObject({ kind: 'cancelled' })
    captured({ loaded: 2, total: 2, lengthComputable: true })
    expect(observer).not.toHaveBeenCalled()
    expect(xhr.upload.onprogress).toBeNull()
    expect(xhr.onload).toBeNull()
  })
})
