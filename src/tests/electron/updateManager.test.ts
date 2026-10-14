import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import type { UpdateInfo } from 'electron-updater'
import type { UpdateManager } from '../../../electron/core/update-manager.cjs'

const require = createRequire(import.meta.url)
const { CancellationToken } = require('builder-util-runtime')
const info = { version: '1.8.16', path: 'fixture.exe', sha512: 'fixture', files: [{ url: 'fixture.exe', size: 1000, sha512: 'fixture' }], releaseDate: '2026-10-12T06:00:00.000Z' } satisfies UpdateInfo

function gate<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

/** Loads the real compiled manager and sender guard. Only Electron/platform,
 * updater transport and preference I/O are replaced; no app can quit/install. */
function fixture(options: { busy?: boolean; packaged?: boolean; cleanup?: () => Promise<void>; verify?: () => Promise<void> } = {}) {
  const nativeUpdater = new EventEmitter()
  const handlers = new Map<string, (event: unknown, request?: unknown) => unknown>()
  const sender = { id: 7, getURL: () => 'app://toolbox/index.html', send: vi.fn() }
  const window = { isDestroyed: () => false, webContents: sender }
  const downloads: Array<{ token: { cancelled: boolean }; resolve: (paths: string[]) => void; reject: (error: unknown) => void }> = []
  let busy = options.busy ?? false
  class FakeUpdater extends EventEmitter {
    autoDownload = true
    autoInstallOnAppQuit = true
    checkForUpdates = vi.fn(async () => { this.emit('update-available', info); return {} })
    downloadUpdate = vi.fn((token: { cancelled: boolean }) => {
      const request = gate<string[]>()
      downloads.push({ token, resolve: request.resolve, reject: request.reject })
      return request.promise
    })
    quitAndInstall = vi.fn(() => { nativeUpdater.emit('before-quit-for-update') })
  }
  let updater = new FakeUpdater()
  const createdUpdaters = [updater]
  const createUpdater = vi.fn(() => { updater = new FakeUpdater(); createdUpdaters.push(updater); return updater as never })
  const cleanup = vi.fn(options.cleanup ?? (async () => {}))
  const verifyInstaller = vi.fn(options.verify ?? (async () => {}))
  const prefIO = { readFileSync: () => { throw new Error('No preferences') }, writeFileSync: vi.fn(), rmSync: vi.fn(), renameSync: vi.fn() }
  const compiled = resolve('dist-electron/electron/core/update-manager.cjs')
  const localRequire = createRequire(compiled)
  const module = { exports: {} as { UpdateManager: typeof UpdateManager } }
  const resolver = (name: string) => {
    if (name === 'electron') return { app: { isPackaged: options.packaged ?? true, getVersion: () => '1.8.15', getPath: () => 'fixture' }, autoUpdater: nativeUpdater }
    if (name === 'electron-updater') return { autoUpdater: updater, CancellationToken }
    if (name === 'node:fs') return prefIO
    return localRequire(name)
  }
  new Function('require', 'module', 'exports', readFileSync(compiled, 'utf8'))(resolver, module, module.exports)
  const manager = new module.exports.UpdateManager({
    updater: updater as never, createUpdater, verifyInstaller,
    ipcMain: { handle: (name: string, handler: (event: unknown) => unknown) => handlers.set(name, handler) } as never,
    getWindow: () => window as never, hasActiveWork: () => busy, beforeInstall: cleanup,
  })
  const event = { sender, senderFrame: { url: sender.getURL() } }
  const finish = async (operation: Promise<unknown>, index = downloads.length - 1) => {
    updater.emit('update-downloaded', info)
    downloads[index]!.resolve(['fixture.exe'])
    await operation
  }
  const ready = async () => { await manager.check(); await finish(manager.startDownload()) }
  return { manager, get updater() { return updater }, createUpdater, createdUpdaters, verifyInstaller, nativeUpdater, downloads, cleanup, prefIO, handlers, sender, event, finish, ready, setBusy: (value: boolean) => { busy = value } }
}

afterEach(() => { vi.useRealTimers() })

describe('real UpdateManager lifecycle', () => {
  it('requires explicit download and install consent, and keeps trusted IPC guards', async () => {
    const f = fixture()
    await f.manager.check()
    expect(f.updater.autoDownload).toBe(false)
    expect(f.updater.autoInstallOnAppQuit).toBe(false)
    expect(f.updater.downloadUpdate).not.toHaveBeenCalled()
    expect(f.manager.shouldInstallOnQuit()).toBe(false)
    expect(() => f.handlers.get('updates:start-download')!({ ...f.event, sender: { ...f.sender, id: 99 } })).toThrow('active toolbox')
    expect(() => f.handlers.get('updates:install')!({ ...f.event, senderFrame: { url: 'https://untrusted.invalid/' } })).toThrow('not trusted')
    expect(f.updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('does not overlap a cancelled transport with an immediate retry', async () => {
    const f = fixture()
    await f.manager.check()
    const first = f.manager.startDownload()
    const lateProgress = f.updater.listeners('download-progress')[0]!
    const lateDownloaded = f.updater.listeners('update-downloaded')[0]!
    f.manager.cancelDownload()
    expect(f.manager.getState()).toMatchObject({ status: 'cancelling', canRetryDownload: false })
    await f.manager.startDownload()
    expect(f.updater.downloadUpdate).toHaveBeenCalledTimes(1)
    f.updater.emit('download-progress', { percent: 90, transferred: 900, total: 1000, bytesPerSecond: 100 })
    f.updater.emit('error', new Error('cancelled old transport'))
    f.downloads[0]!.reject(new Error('cancelled'))
    await first
    expect(f.manager.getState()).toMatchObject({ status: 'cancelled', canRetryDownload: true })
    const second = f.manager.startDownload()
    lateProgress({ percent: 90, transferred: 900, total: 1000, bytesPerSecond: 100 })
    lateDownloaded(info)
    expect(f.manager.getState()).toMatchObject({ status: 'downloading', percent: 0, downloadPhase: 'preparing' })
    expect(f.downloads[1]!.token.cancelled).toBe(false)
    await f.finish(second)
    expect(f.manager.getState().status).toBe('downloaded')
    expect(f.updater.listenerCount('download-progress')).toBe(0)
  })

  it('deduplicates double download clicks and ignores late checks during a download', async () => {
    const f = fixture()
    await f.manager.check()
    const first = f.manager.startDownload()
    await f.manager.startDownload()
    f.updater.emit('update-available', { ...info, version: '9.9.9' })
    await f.manager.check({ manual: true })
    expect(f.updater.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(f.updater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(f.manager.getState().availableVersion).toBe(info.version)
    await f.finish(first)
  })

  it('reports measured speed and idle bytes without inventing verification at 100%', async () => {
    vi.useFakeTimers()
    const f = fixture()
    await f.manager.check()
    const download = f.manager.startDownload()
    await vi.advanceTimersByTimeAsync(30000)
    expect(f.manager.getState()).toMatchObject({ downloadPhase: 'preparing', downloadStalled: true, bytesPerSecond: 0, percent: 0 })
    f.updater.emit('download-progress', { percent: 50, transferred: 500, total: 1000, bytesPerSecond: 200 })
    expect(f.manager.getState()).toMatchObject({ downloadPhase: 'transferring', downloadStalled: false, bytesPerSecond: 200, percent: 50 })
    const progressedAt = f.manager.getState().lastProgressAt
    await vi.advanceTimersByTimeAsync(30000)
    expect(f.manager.getState()).toMatchObject({ downloadStalled: true, bytesPerSecond: 0, lastProgressAt: progressedAt })
    f.updater.emit('download-progress', { percent: 100, transferred: 1000, total: 1000, bytesPerSecond: 150 })
    expect(f.manager.getState()).toMatchObject({ status: 'downloading', downloadPhase: 'transferring', canRestart: false })
    f.updater.emit('update-downloaded', info)
    expect(f.manager.getState()).toMatchObject({ status: 'downloading', downloadPhase: 'finalizing', canRestart: false })
    f.downloads[0]!.resolve(['fixture.exe'])
    await download
    expect(f.manager.getState()).toMatchObject({ status: 'downloaded', canRestart: true, bytesPerSecond: undefined })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not accept invalid progress or a transport finish without a downloaded event', async () => {
    const f = fixture()
    await f.manager.check()
    const download = f.manager.startDownload()
    f.updater.emit('download-progress', { percent: Number.NaN, transferred: 500, total: 1000, bytesPerSecond: 1 })
    f.updater.emit('update-downloaded', { ...info, version: 'wrong' })
    expect(f.manager.getState().percent).toBe(0)
    f.downloads[0]!.resolve([])
    await download
    expect(f.manager.getState()).toMatchObject({ status: 'error', canRetryDownload: true, canRestart: false })
  })

  it('allows a user retry after a network failure with a new token', async () => {
    const f = fixture()
    await f.manager.check()
    const first = f.manager.startDownload()
    f.downloads[0]!.reject(Object.assign(new Error('connection failed'), { code: 'ECONNRESET' }))
    await first
    expect(f.manager.getState()).toMatchObject({ status: 'error', errorCode: 'NETWORK_OFFLINE', canRetryDownload: true })
    const second = f.manager.startDownload()
    expect(f.downloads[1]!.token).not.toBe(f.downloads[0]!.token)
    await f.finish(second)
    expect(f.updater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('keeps cancellation authoritative even if completion races with token cancellation', async () => {
    const f = fixture()
    await f.manager.check()
    const download = f.manager.startDownload()
    f.updater.emit('update-downloaded', info)
    f.manager.cancelDownload()
    f.downloads[0]!.resolve(['fixture.exe'])
    await download
    expect(f.manager.getState()).toMatchObject({ status: 'cancelled', canRestart: false, canRetryDownload: true })
    await f.manager.install()
    expect(f.updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('does not treat the downloaded event as success when cache finalization fails', async () => {
    const f = fixture()
    await f.manager.check()
    const download = f.manager.startDownload()
    f.updater.emit('update-downloaded', info)
    f.updater.emit('error', Object.assign(new Error('disk write failed'), { code: 'ENOSPC' }))
    f.downloads[0]!.reject(Object.assign(new Error('disk write failed'), { code: 'ENOSPC' }))
    await download
    expect(f.manager.getState()).toMatchObject({ status: 'error', errorCode: 'DISK_FULL', canRetryDownload: true, canRestart: false })
  })

  it('accepts a confirmed successful updater fallback after a transient broadcast error', async () => {
    const f = fixture()
    await f.manager.check()
    const download = f.manager.startDownload()
    f.updater.emit('error', new Error('transient differential transport error'))
    await f.finish(download)
    expect(f.manager.getState()).toMatchObject({ status: 'downloaded', canRestart: true, errorCode: undefined })
  })

  it('ignores a late download event after failure until a new user attempt exists', async () => {
    const f = fixture()
    await f.manager.check()
    const download = f.manager.startDownload()
    f.downloads[0]!.reject(new Error('transport failed'))
    await download
    f.updater.emit('update-downloaded', info)
    f.updater.emit('download-progress', { percent: 100, transferred: 1000, total: 1000, bytesPerSecond: 100 })
    expect(f.manager.getState()).toMatchObject({ status: 'error', errorCode: 'DOWNLOAD_FAILED', canRestart: false })
  })

  it('handles a synchronous check error without leaving the manager in checking', async () => {
    const f = fixture()
    f.updater.checkForUpdates.mockImplementationOnce(() => { throw new Error('feed unavailable') })
    await f.manager.check({ manual: true })
    expect(f.manager.getState()).toMatchObject({ status: 'error', errorCode: 'FEED_INVALID' })
    await f.manager.check({ manual: true })
    expect(f.manager.getState().status).toBe('available')
  })

  it('never restarts busy work, including when work appears during cleanup', async () => {
    const f = fixture({ busy: true })
    await f.ready()
    await f.manager.install()
    expect(f.manager.getState()).toMatchObject({ status: 'restart_deferred', canRestart: false, errorCode: 'INSTALL_BUSY' })
    expect(f.cleanup).not.toHaveBeenCalled()
    f.setBusy(false)
    f.manager.activityChanged()
    f.cleanup.mockImplementation(async () => { f.setBusy(true) })
    await f.manager.install()
    expect(f.manager.getState()).toMatchObject({ status: 'restart_deferred', canRestart: false, errorCode: 'INSTALL_BUSY' })
    expect(f.updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it.each(['INSTALLER_MISSING', 'HASH_MISMATCH', 'INSTALLER_UNREADABLE'])('recovers %s without shutting down or trusting the in-memory cache', async code => {
    vi.useFakeTimers()
    const f = fixture({ verify: async () => { throw Object.assign(new Error('invalid cached file'), { code }) } })
    await f.ready()
    await f.manager.install()
    expect(f.manager.getState()).toMatchObject({ status: 'error', errorCode: code, canRetryDownload: true, canRetryInstall: false })
    expect(f.cleanup).not.toHaveBeenCalled()
    expect(f.updater.quitAndInstall).not.toHaveBeenCalled()
    const retired = f.updater
    const recovery = f.manager.startDownload()
    await vi.advanceTimersByTimeAsync(0)
    expect(f.updater).not.toBe(retired)
    expect(f.createUpdater).toHaveBeenCalledTimes(1)
    await f.finish(recovery)
    f.verifyInstaller.mockResolvedValueOnce()
    await f.manager.install()
    await vi.advanceTimersByTimeAsync(0)
    expect(f.updater.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('allows a fresh manual check after invalidating a downloaded installer', async () => {
    const f = fixture({ verify: async () => { throw Object.assign(new Error('gone'), { code: 'INSTALLER_MISSING' }) } })
    await f.ready()
    await f.manager.install()
    await f.manager.check({ manual: true })
    expect(f.manager.getState()).toMatchObject({ status: 'available', canRestart: false })
    expect(f.createUpdater).toHaveBeenCalledTimes(1)
    expect(f.updater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(f.updater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('does not automatically download a different release while recovering a cached installer', async () => {
    const f = fixture({ verify: async () => { throw Object.assign(new Error('gone'), { code: 'INSTALLER_MISSING' }) } })
    await f.ready()
    await f.manager.install()
    const recovery = f.manager.startDownload()
    f.updater.checkForUpdates.mockImplementationOnce(async () => {
      f.updater.emit('update-available', { ...info, version: '1.8.17' })
      return {}
    })
    await recovery
    expect(f.manager.getState()).toMatchObject({ status: 'available', availableVersion: '1.8.17' })
    expect(f.updater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('does not begin cleanup when work appears during installer verification', async () => {
    const pending = gate<void>()
    const f = fixture({ verify: () => pending.promise })
    await f.ready()
    const install = f.manager.install()
    f.setBusy(true)
    pending.resolve()
    await install
    expect(f.manager.getState()).toMatchObject({ status: 'restart_deferred', errorCode: 'INSTALL_BUSY' })
    expect(f.cleanup).not.toHaveBeenCalled()
    expect(f.updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('awaits cleanup and keeps restart unavailable while cleanup is pending', async () => {
    vi.useFakeTimers()
    const pending = gate<void>()
    const f = fixture({ cleanup: () => pending.promise })
    await f.ready()
    f.manager.defer({ phase: 'install' })
    expect(f.manager.shouldInstallOnQuit()).toBe(true)
    const installing = f.manager.install()
    f.manager.activityChanged()
    await f.manager.install()
    expect(f.manager.getState().canRestart).toBe(false)
    expect(f.updater.quitAndInstall).not.toHaveBeenCalled()
    pending.resolve()
    await installing
    await vi.advanceTimersByTimeAsync(0)
    expect(f.updater.quitAndInstall).toHaveBeenCalledTimes(1)
    expect(f.cleanup).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('recovers install errors through a fresh updater rather than its latched install flag', async () => {
    vi.useFakeTimers()
    const f = fixture()
    await f.ready()
    f.updater.quitAndInstall.mockImplementationOnce(() => { f.updater.emit('error', new Error('No update filepath provided')) })
    await f.manager.install()
    await vi.advanceTimersByTimeAsync(0)
    expect(f.manager.getState()).toMatchObject({ status: 'error', errorCode: 'INSTALL_LAUNCH_FAILED', canRetryInstall: false, canRetryDownload: true })
    const retired = f.updater
    await f.manager.install()
    expect(retired.quitAndInstall).toHaveBeenCalledTimes(1)
    const download = f.manager.startDownload()
    await vi.advanceTimersByTimeAsync(0)
    expect(f.updater).not.toBe(retired)
    expect(f.updater.autoDownload).toBe(false)
    expect(f.updater.autoInstallOnAppQuit).toBe(false)
    retired.emit('error', new Error('late retired installer event'))
    await f.finish(download)
    await f.manager.install()
    await vi.advanceTimersByTimeAsync(0)
    expect(f.updater.quitAndInstall).toHaveBeenCalledTimes(1)
    expect(f.cleanup).toHaveBeenCalledTimes(1)
    expect(f.manager.getState().status).toBe('installing')
  })

  it('catches a synchronous install failure and clears the launch watchdog', async () => {
    vi.useFakeTimers()
    const f = fixture()
    await f.ready()
    f.updater.quitAndInstall.mockImplementationOnce(() => { throw new Error('spawn denied') })
    await f.manager.install()
    await vi.advanceTimersByTimeAsync(0)
    expect(f.manager.getState()).toMatchObject({ status: 'error', errorCode: 'INSTALL_LAUNCH_FAILED', canRetryInstall: false, canRetryDownload: true })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('also surfaces asynchronous installer errors after the quit signal', async () => {
    vi.useFakeTimers()
    const f = fixture()
    await f.ready()
    await f.manager.install()
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
    f.updater.emit('error', new Error('asynchronous spawn failed'))
    expect(f.manager.getState()).toMatchObject({ status: 'error', errorCode: 'INSTALL_LAUNCH_FAILED', canRetryInstall: false, canRetryDownload: true })
    expect(f.manager.shouldInstallOnQuit()).toBe(false)
  })

  it('detects an install handoff without an exit signal rather than staying stuck', async () => {
    vi.useFakeTimers()
    const f = fixture()
    await f.ready()
    f.updater.quitAndInstall.mockImplementationOnce(() => {})
    await f.manager.install()
    await vi.advanceTimersByTimeAsync(15000)
    expect(f.manager.getState()).toMatchObject({ status: 'error', errorCode: 'INSTALL_LAUNCH_TIMEOUT', canRetryInstall: false, canRetryDownload: true })
  })

  it('bounds a stuck cleanup and does not run a second cleanup concurrently on retry', async () => {
    vi.useFakeTimers()
    const pending = gate<void>()
    const f = fixture({ cleanup: () => pending.promise })
    await f.ready()
    const first = f.manager.install()
    await vi.advanceTimersByTimeAsync(20000)
    await first
    expect(f.manager.getState()).toMatchObject({ status: 'error', errorCode: 'INSTALL_QUIESCE_TIMEOUT', canRetryInstall: true })
    const second = f.manager.install()
    await Promise.resolve()
    expect(f.cleanup).toHaveBeenCalledTimes(1)
    pending.resolve()
    await second
    await vi.advanceTimersByTimeAsync(0)
    expect(f.updater.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('resets a rejected cleanup before retry but never launches from its error state', async () => {
    vi.useFakeTimers()
    const f = fixture({ cleanup: async () => { throw new Error('cleanup refused') } })
    await f.ready()
    await f.manager.install()
    expect(f.manager.getState()).toMatchObject({ status: 'error', errorCode: 'INSTALL_QUIESCE_FAILED', canRetryInstall: true })
    expect(f.updater.quitAndInstall).not.toHaveBeenCalled()
    f.cleanup.mockResolvedValueOnce()
    await f.manager.install()
    await vi.advanceTimersByTimeAsync(0)
    expect(f.cleanup).toHaveBeenCalledTimes(2)
    expect(f.updater.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('does not enable update behavior in an unpackaged preview', async () => {
    const f = fixture({ packaged: false })
    await f.manager.check()
    await f.manager.startDownload()
    await f.manager.install()
    expect(f.manager.getState().supported).toBe(false)
    expect(f.updater.checkForUpdates).not.toHaveBeenCalled()
    expect(f.updater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('confirms the real dependency retains its install latch after an asynchronous spawn error', async () => {
    vi.useFakeTimers()
    const native = new EventEmitter()
    const file = require.resolve('electron-updater/out/BaseUpdater.js')
    const sourceRequire = createRequire(file)
    const loaded = { exports: {} as { BaseUpdater: { prototype: { install: (silent?: boolean, run?: boolean) => boolean; quitAndInstall: () => void } } } }
    new Function('require', 'module', 'exports', readFileSync(file, 'utf8'))(
      (name: string) => name === 'electron' ? { autoUpdater: native } : sourceRequire(name), loaded, loaded.exports,
    )
    const prototype = loaded.exports.BaseUpdater.prototype
    const instance = {
      quitAndInstallCalled: false, autoRunAppAfterInstall: true,
      _logger: { info: vi.fn(), warn: vi.fn() }, app: { quit: vi.fn() },
      installerPath: 'fixture.exe', downloadedUpdateHelper: { downloadedFileInfo: {} },
      dispatchError: vi.fn(), doInstall: vi.fn(() => true),
      install() { return prototype.install.call(this) },
    }
    prototype.quitAndInstall.call(instance)
    await vi.advanceTimersByTimeAsync(0)
    instance.dispatchError(new Error('asynchronous spawn failure'))
    expect(instance.quitAndInstallCalled).toBe(true)
    prototype.quitAndInstall.call(instance)
    expect(instance.doInstall).toHaveBeenCalledTimes(1)
    // The second call only clears the latch after refusing to install. Manager
    // recovery therefore replaces this public updater instead of retrying it.
    expect(instance.quitAndInstallCalled).toBe(false)
  })
})
