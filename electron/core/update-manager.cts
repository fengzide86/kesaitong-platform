import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { app, autoUpdater as nativeAutoUpdater } from 'electron'
import { readFileSync, rmSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CancellationToken, NsisUpdater, autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import { assertTrustedSender } from '../ipc/sender-guard.js'
import { normalizeUpdateErrorCode, type StableUpdateErrorCode } from './update-errors.js'
import { verifyUpdateInstaller } from './update-installer-integrity.cjs'

type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'cancelling'
  | 'downloaded'
  | 'restart_deferred'
  | 'installing'
  | 'cancelled'
  | 'error'

interface UpdateSnapshot {
  supported: boolean
  status: UpdateStatus
  currentVersion: string
  availableVersion?: string
  releaseDate?: string
  releaseNotes: string[]
  downloadBytes?: number
  percent?: number
  transferredBytes?: number
  totalBytes?: number
  bytesPerSecond?: number
  downloadPhase?: 'preparing' | 'transferring' | 'finalizing'
  lastProgressAt?: string
  downloadStalled?: boolean
  canRetryDownload?: boolean
  canRetryInstall?: boolean
  promptSuppressedUntil?: string
  errorCode?: string
  canRestart: boolean
  lastCheckedAt?: string
}

interface UpdateDeferRequest { phase?: 'download' | 'install' }
interface UpdatePreferences { version?: string; promptSuppressedUntil?: string }
const DAY_MS = 24 * 60 * 60 * 1000
const CHECK_TIMEOUT_MS = 20000
const DOWNLOAD_STALL_MS = 30000
const DOWNLOAD_MONITOR_MS = 5000
const INSTALL_PREPARE_TIMEOUT_MS = 20000
const INSTALL_LAUNCH_TIMEOUT_MS = 15000

interface DownloadAttempt {
  token: CancellationToken
  lastByteAt: number
  lastTransferred: number
  downloadedInfo?: UpdateInfo
  monitor?: ReturnType<typeof setTimeout>
}

interface UpdateManagerOptions {
  ipcMain: IpcMain
  getWindow: () => BrowserWindow | null | undefined
  hasActiveWork: () => boolean
  beforeInstall: () => void | Promise<void>
  updater?: typeof autoUpdater
  createUpdater?: () => typeof autoUpdater
  verifyInstaller?: typeof verifyUpdateInstaller
}

const CHANNELS = {
  getState: 'updates:get-state',
  check: 'updates:check',
  startDownload: 'updates:start-download',
  cancelDownload: 'updates:cancel-download',
  install: 'updates:install',
  defer: 'updates:defer',
  state: 'updates:state',
} as const

function normalizeReleaseNotes(notes: UpdateInfo['releaseNotes']): string[] {
  if (typeof notes === 'string') {
    return notes.split(/\r?\n/).map(line => line.replace(/^[-*]\s*/, '').trim()).filter(Boolean)
  }
  if (!Array.isArray(notes)) return []
  return notes
    .flatMap(note => typeof note.note === 'string' ? note.note.split(/\r?\n/) : [])
    .map(line => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
}

export class UpdateManager {
  private readonly ipcMain: IpcMain
  private readonly getWindow: () => BrowserWindow | null | undefined
  private readonly hasActiveWork: () => boolean
  private readonly beforeInstall: () => void | Promise<void>
  private updater: typeof autoUpdater
  private readonly createUpdater: () => typeof autoUpdater
  private readonly verifyInstaller: typeof verifyUpdateInstaller
  private detachUpdaterEvents: () => void = () => {}
  private updaterNeedsReset = false
  private downloadedInstaller: { path: string; sha512: string } | null = null
  private checking: Promise<UpdateSnapshot> | null = null
  private downloadAttempt: DownloadAttempt | null = null
  private downloadReady = false
  private installLaunchTimer?: ReturnType<typeof setTimeout>
  private installGeneration = 0
  private updateInfo: UpdateInfo | null = null
  private manualCheckRequested = false
  private preferences: UpdatePreferences
  private cleanupPromise: Promise<void> | null = null
  private installOnQuitApproved = false
  private installPreparing = false
  private checkGeneration = 0
  private activeCheckGeneration = 0
  private acceptCheckEvents = false
  private snapshot: UpdateSnapshot

  constructor(options: UpdateManagerOptions) {
    this.ipcMain = options.ipcMain
    this.getWindow = options.getWindow
    this.hasActiveWork = options.hasActiveWork
    this.beforeInstall = options.beforeInstall
    this.updater = options.updater ?? autoUpdater
    // Windows NSIS is the current distribution target. Recovery replaces the
    // public updater instance instead of changing its protected install flags.
    this.createUpdater = options.createUpdater ?? (() => new NsisUpdater())
    this.verifyInstaller = options.verifyInstaller ?? verifyUpdateInstaller
    this.preferences = this.readPreferences()
    this.snapshot = {
      supported: app.isPackaged,
      status: 'idle',
      currentVersion: app.getVersion(),
      releaseNotes: [],
      canRestart: false,
    }
    if (this.snapshot.supported) {
      this.updater.autoDownload = false
      // Downloading an update is not consent to install it. Installation only
      // starts after an explicit immediate-restart or install-on-exit action.
      this.updater.autoInstallOnAppQuit = false
      this.bindUpdaterEvents()
      nativeAutoUpdater.on('before-quit-for-update', () => {
        if (this.installLaunchTimer) clearTimeout(this.installLaunchTimer)
      })
    }
    this.registerIpc()
  }

  getState(): UpdateSnapshot {
    return { ...this.snapshot, releaseNotes: [...this.snapshot.releaseNotes] }
  }

  shouldInstallOnQuit(): boolean {
    return this.installOnQuitApproved && ['downloaded', 'restart_deferred'].includes(this.snapshot.status)
  }

  isInstalling(): boolean {
    return this.installPreparing || this.snapshot.status === 'installing'
  }

  async check(options: { manual?: boolean } = {}): Promise<UpdateSnapshot> {
    if (!this.snapshot.supported) return this.getState()
    if (this.checking) return this.checking
    if (this.downloadAttempt || this.downloadReady || this.isInstalling()) return this.getState()
    if (this.updaterNeedsReset) {
      try {
        const replacement = this.createUpdater()
        this.detachUpdaterEvents()
        this.updater = replacement
        this.updater.autoDownload = false
        this.updater.autoInstallOnAppQuit = false
        this.bindUpdaterEvents()
        this.updaterNeedsReset = false
        this.updateInfo = null
      } catch (error) {
        this.setState({ status: 'error', errorCode: normalizeUpdateErrorCode(error, 'CHECK_FAILED'), canRetryDownload: false })
        return this.getState()
      }
    }

    this.manualCheckRequested = Boolean(options.manual)
    const generation = ++this.checkGeneration
    this.activeCheckGeneration = generation
    this.acceptCheckEvents = true
    if (options.manual) this.clearPromptSuppression()
    this.setState({ status: 'checking', errorCode: undefined, canRetryDownload: false, canRetryInstall: false })
    let timeout: ReturnType<typeof setTimeout> | undefined
    const checkPromise = Promise.resolve().then(() => this.updater.checkForUpdates())
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(Object.assign(new Error('更新检查超时'), { code: 'UPDATE_CHECK_TIMEOUT' })), CHECK_TIMEOUT_MS)
    })
    this.checking = Promise.race([checkPromise, timeoutPromise])
      .then(() => {
        if (this.activeCheckGeneration !== generation) return this.getState()
        if (this.snapshot.status === 'checking') {
          this.setState({ status: 'idle', errorCode: undefined, lastCheckedAt: new Date().toISOString() })
        }
        return this.getState()
      })
      .catch((error: unknown) => {
        if (this.activeCheckGeneration !== generation) return this.getState()
        this.acceptCheckEvents = false
        if (options.manual) this.setState({ status: 'error', errorCode: normalizeUpdateErrorCode(error, 'CHECK_FAILED') })
        else {
          console.warn('[Update] Automatic update check failed:', error)
          this.setState({ status: 'idle', errorCode: undefined, lastCheckedAt: new Date().toISOString() })
        }
        return this.getState()
      })
      .finally(() => {
        if (timeout) clearTimeout(timeout)
        if (this.activeCheckGeneration === generation) {
          this.activeCheckGeneration = 0
          this.acceptCheckEvents = false
        }
        this.checking = null
        this.manualCheckRequested = false
      })
    return this.checking
  }

  async startDownload(): Promise<UpdateSnapshot> {
    if (this.updaterNeedsReset) {
      const requestedVersion = this.snapshot.availableVersion
      await this.check({ manual: true })
      // A replacement/newly published version requires a fresh download choice.
      if (this.snapshot.status !== 'available' || this.snapshot.availableVersion !== requestedVersion) return this.getState()
    }
    // A cancelled updater promise still owns its transport until it settles.
    // Do not replace its token or reuse that promise as a new download attempt.
    if (this.downloadAttempt || this.downloadReady || this.isInstalling()) return this.getState()
    if (!this.updateInfo || !['available', 'cancelled', 'error'].includes(this.snapshot.status)) return this.getState()
    const attempt: DownloadAttempt = { token: new CancellationToken(), lastByteAt: Date.now(), lastTransferred: 0 }
    this.downloadAttempt = attempt
    const isCurrent = () => this.downloadAttempt === attempt && !attempt.token.cancelled
    const onProgress = (progress: ProgressInfo) => {
      if (!isCurrent() || this.snapshot.status !== 'downloading' || attempt.downloadedInfo) return
      const values = [progress.percent, progress.transferred, progress.total, progress.bytesPerSecond]
      if (values.some(value => !Number.isFinite(value) || value < 0)) return
      // Multi-range progress may reset at a group boundary. It is still a new
      // byte event; do not mistake that reset for a stalled connection.
      if (progress.transferred !== attempt.lastTransferred) {
        attempt.lastByteAt = Date.now()
        attempt.lastTransferred = progress.transferred
      }
      this.setState({
        downloadPhase: 'transferring',
        percent: Math.max(0, Math.min(100, Math.round(progress.percent * 10) / 10)),
        transferredBytes: progress.transferred, totalBytes: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
        lastProgressAt: new Date(attempt.lastByteAt).toISOString(),
        downloadStalled: Date.now() - attempt.lastByteAt >= DOWNLOAD_STALL_MS,
      })
    }
    const onDownloaded = (info: UpdateInfo) => {
      if (!isCurrent() || info.version !== this.updateInfo?.version) return
      attempt.downloadedInfo = info
      // 100% transfer is not proof that the updater has finished its validation
      // and cache writes. Only the real lifecycle event enters this phase.
      this.setState({ downloadPhase: 'finalizing', downloadStalled: false, bytesPerSecond: undefined })
    }
    this.updater.on('download-progress', onProgress)
    this.updater.on('update-downloaded', onDownloaded)
    this.setState({
      status: 'downloading', percent: 0, transferredBytes: 0, totalBytes: undefined,
      downloadPhase: 'preparing', bytesPerSecond: undefined, lastProgressAt: undefined,
      downloadStalled: false, canRetryDownload: false, canRetryInstall: false,
      promptSuppressedUntil: undefined, errorCode: undefined, canRestart: false,
    })
    const monitor = () => {
      if (!isCurrent() || this.snapshot.status !== 'downloading') return
      if (!attempt.downloadedInfo && Date.now() - attempt.lastByteAt >= DOWNLOAD_STALL_MS) {
        this.setState({ downloadStalled: true, bytesPerSecond: 0 })
      }
      attempt.monitor = setTimeout(monitor, DOWNLOAD_MONITOR_MS)
      attempt.monitor.unref?.()
    }
    attempt.monitor = setTimeout(monitor, DOWNLOAD_MONITOR_MS)
    attempt.monitor.unref?.()
    try {
      const paths = await this.updater.downloadUpdate(attempt.token)
      if (attempt.token.cancelled) {
        this.setState({ status: 'cancelled', canRetryDownload: true, errorCode: undefined })
      } else if (!attempt.downloadedInfo || !paths[0]) {
        throw new Error('Updater completed without a confirmed downloaded update')
      } else {
        const installerInfo = attempt.downloadedInfo.files.find(file => new URL(file.url, 'https://update.invalid/').pathname.toLowerCase().endsWith('.exe'))
        const sha512 = installerInfo?.sha512 ?? attempt.downloadedInfo.sha512
        if (!sha512) throw new Error('Downloaded installer has no verification digest')
        this.downloadedInstaller = { path: paths[0], sha512 }
        this.downloadReady = true
        this.installOnQuitApproved = false
        this.updateInfo = attempt.downloadedInfo
        const canRestart = !this.hasActiveWork()
        this.setState({
          status: canRestart ? 'downloaded' : 'restart_deferred',
          availableVersion: this.updateInfo.version, releaseDate: this.updateInfo.releaseDate,
          releaseNotes: normalizeReleaseNotes(this.updateInfo.releaseNotes),
          downloadBytes: this.updateInfo.files.find(file => typeof file.size === 'number')?.size,
          percent: 100, promptSuppressedUntil: undefined, errorCode: undefined, canRestart,
        })
      }
    } catch (error: unknown) {
      if (attempt.token.cancelled) {
        this.setState({ status: 'cancelled', errorCode: undefined, canRetryDownload: true })
      } else {
        this.setState({ status: 'error', errorCode: normalizeUpdateErrorCode(error, 'DOWNLOAD_FAILED'), canRetryDownload: true })
      }
    } finally {
      if (attempt.monitor) clearTimeout(attempt.monitor)
      this.updater.removeListener('download-progress', onProgress)
      this.updater.removeListener('update-downloaded', onDownloaded)
      if (this.downloadAttempt === attempt) this.downloadAttempt = null
      this.setState({ downloadPhase: undefined, downloadStalled: false, bytesPerSecond: undefined })
    }
    return this.getState()
  }

  cancelDownload(): UpdateSnapshot {
    if (this.downloadAttempt && this.snapshot.status === 'downloading') {
      this.setState({ status: 'cancelling', errorCode: undefined, canRetryDownload: false, downloadStalled: false, bytesPerSecond: undefined })
      this.downloadAttempt.token.cancel()
    }
    return this.getState()
  }

  defer(request: UpdateDeferRequest = {}): UpdateSnapshot {
    if (request.phase === 'download' && this.snapshot.availableVersion) {
      const promptSuppressedUntil = new Date(Date.now() + DAY_MS).toISOString()
      this.preferences = { version: this.snapshot.availableVersion, promptSuppressedUntil }
      this.writePreferences()
      this.setState({ promptSuppressedUntil })
    }
    if (request.phase === 'install' && this.snapshot.status === 'downloaded') {
      this.installOnQuitApproved = true
      this.setState({ status: 'restart_deferred', canRestart: !this.hasActiveWork() })
    }
    return this.getState()
  }

  async install(): Promise<UpdateSnapshot> {
    if (!this.downloadReady || !(['downloaded', 'restart_deferred'].includes(this.snapshot.status)
      || (this.snapshot.status === 'error' && this.snapshot.canRetryInstall))) return this.getState()
    if (this.installPreparing) return this.getState()
    if (this.hasActiveWork()) {
      this.setState({ status: 'restart_deferred', canRestart: false, errorCode: 'INSTALL_BUSY' })
      return this.getState()
    }
    this.installPreparing = true
    this.setState({ status: 'restart_deferred', canRestart: false, errorCode: undefined, canRetryInstall: false, canRetryDownload: false })
    try {
      if (!this.downloadedInstaller) throw Object.assign(new Error('Missing cached installer'), { code: 'INSTALLER_MISSING' })
      await this.verifyInstaller(this.downloadedInstaller.path, this.downloadedInstaller.sha512)
    } catch (error) {
      this.installPreparing = false
      this.invalidateInstaller(error)
      return this.getState()
    }
    let prepareTimeout: ReturnType<typeof setTimeout> | undefined
    try {
      if (this.hasActiveWork()) throw Object.assign(new Error('Work started during installer verification'), { code: 'INSTALL_BUSY' })
      await Promise.race([
        this.prepareForInstall(),
        new Promise<never>((_resolve, reject) => {
          prepareTimeout = setTimeout(() => reject(Object.assign(new Error('Install preparation timed out'), { code: 'INSTALL_QUIESCE_TIMEOUT' })), INSTALL_PREPARE_TIMEOUT_MS)
        }),
      ])
      if (this.hasActiveWork()) {
        throw Object.assign(new Error('Application work remained active after cleanup'), { code: 'INSTALL_BUSY' })
      }
    } catch (error) {
      this.installPreparing = false
      const errorCode = normalizeUpdateErrorCode(error, 'INSTALL_QUIESCE_FAILED')
      this.setState({
        status: errorCode === 'INSTALL_BUSY' ? 'restart_deferred' : 'error',
        canRestart: false,
        errorCode,
        canRetryInstall: true,
      })
      return this.getState()
    } finally {
      if (prepareTimeout) clearTimeout(prepareTimeout)
    }
    this.installPreparing = false
    this.setState({ status: 'installing', canRestart: false, errorCode: undefined })
    this.installOnQuitApproved = false
    const generation = ++this.installGeneration
    setImmediate(() => {
      if (generation !== this.installGeneration || this.snapshot.status !== 'installing') return
      this.installLaunchTimer = setTimeout(() => {
        if (generation === this.installGeneration && this.snapshot.status === 'installing') {
          this.installFailed(Object.assign(new Error('Installer did not initiate application exit'), { code: 'INSTALL_LAUNCH_TIMEOUT' }))
        }
      }, INSTALL_LAUNCH_TIMEOUT_MS)
      this.installLaunchTimer.unref?.()
      try {
        this.updater.quitAndInstall(false, true)
      } catch (error) {
        this.installFailed(error)
      }
    })
    return this.getState()
  }

  activityChanged(): void {
    if (this.installPreparing) return
    if (!['downloaded', 'restart_deferred'].includes(this.snapshot.status)) return
    const canRestart = !this.hasActiveWork()
    this.setState({ status: canRestart ? 'downloaded' : 'restart_deferred', canRestart, errorCode: undefined })
  }

  private bindUpdaterEvents(): void {
    const updater = this.updater
    const onAvailable = (info: UpdateInfo) => {
      if (this.updater !== updater || !this.acceptCheckEvents) return
      this.installOnQuitApproved = false
      this.updateInfo = info
      const promptSuppressedUntil = this.suppressionFor(info.version)
      this.setState({
        status: 'available',
        availableVersion: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: normalizeReleaseNotes(info.releaseNotes),
        downloadBytes: info.files.find(file => typeof file.size === 'number')?.size,
        promptSuppressedUntil,
        canRestart: false,
        lastCheckedAt: new Date().toISOString(),
        canRetryDownload: false, canRetryInstall: false,
      })
    }
    const onNotAvailable = () => {
      if (this.updater !== updater || !this.acceptCheckEvents) return
      this.installOnQuitApproved = false
      this.updateInfo = null
      this.setState({
        status: 'idle', availableVersion: undefined, releaseDate: undefined, releaseNotes: [],
        downloadBytes: undefined, promptSuppressedUntil: undefined, canRestart: false,
        lastCheckedAt: new Date().toISOString(),
      })
    }
    const onError = (error: Error) => {
      if (this.updater !== updater) return
      if (this.snapshot.status === 'installing') {
        this.installFailed(error)
        return
      }
      // A transient error can precede a successful updater fallback. The actual
      // download promise and confirmed event, not this broadcast, decide result.
      if (this.downloadAttempt) return
      if (['cancelled', 'downloaded', 'restart_deferred'].includes(this.snapshot.status)) return
      if (this.snapshot.status === 'checking' && !this.acceptCheckEvents) return
      if (this.snapshot.status === 'checking' && !this.manualCheckRequested) {
        this.setState({ status: 'idle', errorCode: undefined, canRestart: false, lastCheckedAt: new Date().toISOString() })
      } else {
        const fallback: StableUpdateErrorCode = this.snapshot.status === 'downloading' ? 'DOWNLOAD_FAILED' : 'UPDATE_ERROR'
        this.setState({ status: 'error', errorCode: normalizeUpdateErrorCode(error, fallback), canRestart: false })
      }
    }
    updater.on('update-available', onAvailable)
    updater.on('update-not-available', onNotAvailable)
    updater.on('error', onError)
    this.detachUpdaterEvents = () => {
      updater.removeListener('update-available', onAvailable)
      updater.removeListener('update-not-available', onNotAvailable)
      updater.removeListener('error', onError)
      // Ignore a pending native transport error from this retired instance.
      updater.on('error', () => {})
    }
  }

  private installFailed(error: unknown): void {
    if (this.installLaunchTimer) clearTimeout(this.installLaunchTimer)
    this.installGeneration += 1
    this.installOnQuitApproved = false
    this.invalidateInstaller(error, 'INSTALL_LAUNCH_FAILED')
  }

  private invalidateInstaller(error: unknown, fallback: StableUpdateErrorCode = 'UPDATE_ERROR'): void {
    this.downloadReady = false
    this.downloadedInstaller = null
    this.installOnQuitApproved = false
    this.updaterNeedsReset = true
    this.setState({
      status: 'error', canRestart: false, canRetryInstall: false, canRetryDownload: true,
      errorCode: normalizeUpdateErrorCode(error, fallback),
    })
  }

  private registerIpc(): void {
    const register = (channel: string, handler: (event: IpcMainInvokeEvent, request?: UpdateDeferRequest) => UpdateSnapshot | Promise<UpdateSnapshot>) => {
      this.ipcMain.handle(channel, (event: IpcMainInvokeEvent, request?: UpdateDeferRequest) => {
        assertTrustedSender(event, this.getWindow, !app.isPackaged)
        return handler(event, request)
      })
    }
    register(CHANNELS.getState, () => this.getState())
    register(CHANNELS.check, () => this.check({ manual: true }))
    register(CHANNELS.startDownload, () => this.startDownload())
    register(CHANNELS.cancelDownload, () => this.cancelDownload())
    register(CHANNELS.install, () => this.install())
    register(CHANNELS.defer, (_event, request) => this.defer(request))
  }

  private setState(patch: Partial<UpdateSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    const window = this.getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(CHANNELS.state, this.getState())
  }

  private prepareForInstall(): Promise<void> {
    if (!this.cleanupPromise) {
      this.cleanupPromise = Promise.resolve().then(() => this.beforeInstall()).catch(error => {
        this.cleanupPromise = null
        throw error
      })
    }
    return this.cleanupPromise
  }

  private preferencesPath(): string {
    return join(app.getPath('userData'), 'update-preferences.json')
  }

  private readPreferences(): UpdatePreferences {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.preferencesPath(), 'utf8'))
      return parsed && typeof parsed === 'object' ? parsed as UpdatePreferences : {}
    } catch {
      return {}
    }
  }

  private writePreferences(): void {
    try {
      const target = this.preferencesPath()
      const temp = `${target}.tmp`
      writeFileSync(temp, JSON.stringify(this.preferences), 'utf8')
      rmSync(target, { force: true })
      renameSync(temp, target)
    } catch (error) {
      console.warn('[Update] Could not persist prompt preference:', error)
    }
  }

  private clearPromptSuppression(): void {
    if (!this.preferences.version && !this.preferences.promptSuppressedUntil) return
    this.preferences = {}
    this.writePreferences()
    this.setState({ promptSuppressedUntil: undefined })
  }

  private suppressionFor(version: string): string | undefined {
    if (this.preferences.version !== version || !this.preferences.promptSuppressedUntil) return undefined
    return Date.parse(this.preferences.promptSuppressedUntil) > Date.now()
      ? this.preferences.promptSuppressedUntil
      : undefined
  }
}
