import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getApiBase } from '@/shared/api/base'
import { installerPathFromManifest, resolveDesktopInstallerUrl } from '@/runtime/desktop-download'
import { resolveRuntimeCapabilities } from '@/runtime/capabilities'

describe('web runtime capabilities', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined })
  })

  it('keeps demo and browser file features available while rejecting live runners', () => {
    const capabilities = resolveRuntimeCapabilities(undefined)
    expect(capabilities).toMatchObject({
      kind: 'web',
      singleDemo: true,
      singleLive: false,
      batchDemo: true,
      batchLive: false,
      freightWorkbook: true,
      freightQuote: true,
    })
  })

  it('only enables live capabilities exposed by the desktop bridge', () => {
    const capabilities = resolveRuntimeCapabilities({
      automation: {} as never,
      batch: {} as never,
      freight: {} as never,
    })
    expect(capabilities).toMatchObject({ kind: 'desktop', singleLive: true, batchLive: true, freightWorkbook: true })
  })

  it('uses the browser origin for local renderer API tests', () => {
    expect(getApiBase()).toBe(window.location.origin)
  })
})

describe('desktop download discovery', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('reads the installer path from electron-updater latest.yml', async () => {
    const manifest = 'version: 1.8.5\npath: KST Setup 1.8.5.exe\nsha512: abc\n'
    expect(installerPathFromManifest(manifest)).toBe('KST Setup 1.8.5.exe')
    const request = vi.fn().mockResolvedValue(new Response(manifest, { status: 200 }))
    await expect(resolveDesktopInstallerUrl(request, 'https://kst.example')).resolves.toBe(
      'https://kst.example/updates/KST%20Setup%201.8.5.exe',
    )
    expect(request).toHaveBeenCalledWith(expect.stringContaining('/updates/latest.yml?t='), {
      cache: 'no-store', signal: expect.any(AbortSignal),
    })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects unsafe or non-installer manifest paths', () => {
    expect(() => installerPathFromManifest('path: ../setup.exe')).toThrow('无效')
    expect(() => installerPathFromManifest('path: latest.yml')).toThrow('不可用')
  })

  it('times out a stalled request after 15 seconds and releases its timer', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>(() => undefined))
    const result = resolveDesktopInstallerUrl(request, 'https://kst.example')
    const failure = expect(result).rejects.toThrow('读取桌面安装包信息超时，请检查网络后重试')
    const signal = request.mock.calls[0]?.[1]?.signal
    await vi.advanceTimersByTimeAsync(14_999)
    expect(signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await failure
    expect(signal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the same deadline for a stalled response body', async () => {
    const response = new Response('path: KST Setup 1.8.6.exe')
    const readBody = vi.spyOn(response, 'text').mockImplementation(() => new Promise<string>(() => undefined))
    const request = vi.fn<typeof fetch>().mockResolvedValue(response)
    const result = resolveDesktopInstallerUrl(request, 'https://kst.example')
    const failure = expect(result).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(14_999)
    expect(readBody).toHaveBeenCalledOnce()
    expect(request.mock.calls[0]?.[1]?.signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await failure
    expect(request.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses a fresh cancellation signal and succeeds when retried after a timeout', async () => {
    const request = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => new Promise<Response>(() => undefined))
      .mockResolvedValueOnce(new Response('path: KST Setup 1.8.6.exe'))
    const first = resolveDesktopInstallerUrl(request, 'https://kst.example')
    const firstFailure = expect(first).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(15_000)
    await firstFailure
    await expect(resolveDesktopInstallerUrl(request, 'https://kst.example')).resolves.toBe(
      'https://kst.example/updates/KST%20Setup%201.8.6.exe',
    )
    const firstSignal = request.mock.calls[0]?.[1]?.signal
    const retrySignal = request.mock.calls[1]?.[1]?.signal
    expect(firstSignal).not.toBe(retrySignal)
    expect(firstSignal?.aborted).toBe(true)
    expect(retrySignal?.aborted).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(retrySignal?.aborted).toBe(false)
  })

  it('clears the timeout and preserves a normal network failure', async () => {
    const networkError = new TypeError('Failed to fetch')
    const request = vi.fn<typeof fetch>().mockRejectedValue(networkError)
    await expect(resolveDesktopInstallerUrl(request, 'https://kst.example')).rejects.toBe(networkError)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(request.mock.calls[0]?.[1]?.signal?.aborted).toBe(false)
  })

  it('clears the timeout when the server or manifest is invalid', async () => {
    const unavailable = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }))
    await expect(resolveDesktopInstallerUrl(unavailable, 'https://kst.example')).rejects.toThrow('暂时无法读取')
    expect(vi.getTimerCount()).toBe(0)
    const invalid = vi.fn<typeof fetch>().mockResolvedValue(new Response('path: ../bad.exe'))
    await expect(resolveDesktopInstallerUrl(invalid, 'https://kst.example')).rejects.toThrow('地址无效')
    expect(vi.getTimerCount()).toBe(0)
  })
})
