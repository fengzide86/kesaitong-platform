import { app, dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { arch, homedir, hostname, platform } from 'node:os'
import { join } from 'node:path'

import { DesktopAutomationController } from './automation/desktop-automation-controller.cjs'
import { BackendProcessManager } from './core/backend-process-manager.cjs'
import { ApplicationLifecycleCoordinator } from './core/application-lifecycle.cjs'
import { CredentialManager } from './core/credential-manager.cjs'
import {
  createMainWindow,
  installWebContentsNavigationPolicy,
} from './core/main-window.cjs'
import { NotificationManager } from './core/notification-manager.cjs'
import { registerAppProtocol, registerAppScheme } from './core/app-protocol.cjs'
import { resolveRuntimeConfig } from './core/runtime-config.cjs'
import { UpdateManager } from './core/update-manager.cjs'
import { DesktopFreightController } from './freight/desktop-freight-controller.cjs'
import { createTrustedIpcRegistrar } from './ipc/trusted-ipc.cjs'
import { isAllowedExternalUrl } from './security/navigation-policy.js'

const packageMetadata = require('../../package.json') as {
  build?: { productName?: string; appId?: string }
  toolbox?: { distribution?: string; automationRuntime?: boolean; controlApiUrl?: string }
}

type UpdateManagerLike = Pick<
  UpdateManager,
  'activityChanged' | 'check' | 'install' | 'isInstalling' | 'shouldInstallOnQuit'
>

const APPLICATION_NAME = packageMetadata.build?.productName || '课赛通 KST'
const WINDOWS_APP_USER_MODEL_ID = packageMetadata.build?.appId || 'com.amazon.toolbox'

app.setName(APPLICATION_NAME)
if (process.platform === 'win32') app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID)
process.env.TOOLBOX_CLIENT_VERSION = app.getVersion()

let mainWindow: BrowserWindow | null = null
let updateManager: UpdateManagerLike | null = null

function errorMessage(error: unknown, fallback = '未知错误'): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function stableDeviceIdentity(): { deviceId: string; deviceName: string } {
  const source = [hostname(), homedir(), platform(), arch()].join('|')
  const digest = createHash('sha256').update(source).digest('hex').slice(0, 20).toUpperCase()
  return { deviceId: `DEV-${digest}`, deviceName: hostname() || 'Windows 设备' }
}

function configureRuntimeRoot(): string {
  const preferredRoot = process.env.TOOLBOX_RUNTIME_DIR || 'D:\\AmazonToolboxData'
  try {
    mkdirSync(preferredRoot, { recursive: true })
    app.setPath('userData', preferredRoot)
    app.setPath('sessionData', join(preferredRoot, 'session-data'))
    return preferredRoot
  } catch (error) {
    console.warn('[Runtime] Unable to use preferred data directory:', errorMessage(error))
    return app.getPath('userData')
  }
}

const DEVICE_IDENTITY = stableDeviceIdentity()
const RUNTIME_ROOT = configureRuntimeRoot()
const INTERNAL_PRODUCTION = app.isPackaged && packageMetadata.toolbox?.distribution === 'internal'
const AUTOMATION_RUNTIME_ENABLED = packageMetadata.toolbox?.automationRuntime === true
  || process.env.TOOLBOX_AUTOMATION_ENABLED === 'true'
const runtimeConfig = resolveRuntimeConfig(process.env, packageMetadata) as {
  controlApiBase: string
  useBundledBackend: boolean
}
const CONTROL_API_BASE = runtimeConfig.controlApiBase
const USE_BUNDLED_BACKEND = runtimeConfig.useBundledBackend

if (INTERNAL_PRODUCTION && USE_BUNDLED_BACKEND) {
  throw new Error('Internal production builds cannot start a bundled backend')
}

function mayOpenExternalUrl(url: string): boolean {
  return isAllowedExternalUrl(url, INTERNAL_PRODUCTION)
}

registerAppScheme()
installWebContentsNavigationPolicy(mayOpenExternalUrl)

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
}

const ipc = createTrustedIpcRegistrar({
  ipcMain,
  getWindow: () => mainWindow,
  allowDevelopmentOrigin: !app.isPackaged,
  automationEnabled: AUTOMATION_RUNTIME_ENABLED,
  errorMessage,
})

ipc.handle('open-external', async (_event: IpcMainInvokeEvent, url: unknown) => {
  if (typeof url === 'string' && mayOpenExternalUrl(url)) {
    await shell.openExternal(url)
    return { success: true }
  }
  return { success: false, message: '无效的 URL' }
})

const credentialManager = new CredentialManager({
  ipcMain, getWindow: () => mainWindow,
  onSessionChanged: ownerId => automationController.resetArtifactsForOwner(ownerId),
})
const notificationManager = new NotificationManager({
  getWindow: () => mainWindow,
  getSelectedBatchItemId: () => automationController.selectedItemId(),
})
const freightController = new DesktopFreightController({
  getWindow: () => mainWindow,
  registerAutomationHandle: ipc.automationHandle,
})
const automationController = new DesktopAutomationController({
  automationEnabled: AUTOMATION_RUNTIME_ENABLED,
  controlApiBase: CONTROL_API_BASE,
  runtimeRoot: RUNTIME_ROOT,
  getWindow: () => mainWindow,
  getDefaultFreightWorkbookPath: () => freightController.defaultWorkbookPath(),
  registerTrustedHandle: ipc.handle,
  registerAutomationHandle: ipc.automationHandle,
  registerTrustedOn: ipc.on,
  mayOpenExternalUrl,
  onActivityChanged: () => updateManager?.activityChanged(),
  showNotification: notification => notificationManager.show(notification),
})
automationController.registerIpc()
freightController.registerIpc()

const backendManager = new BackendProcessManager({
  runtimeRoot: RUNTIME_ROOT,
  resourcesPath: () => app.isPackaged
    ? process.resourcesPath
    : join(app.getAppPath(), 'electron'),
})

async function quiesceApplication(): Promise<void> {
  await Promise.all([
    backendManager.cleanup(),
    automationController.cleanup(),
  ])
}

const lifecycle = new ApplicationLifecycleCoordinator({
  cleanup: quiesceApplication,
  dispose: () => credentialManager.dispose(),
  getUpdateManager: () => updateManager,
  errorMessage,
})
lifecycle.register()

app.whenReady().then(async () => {
  console.log('[INFO] App ready')
  credentialManager.register()

  if (USE_BUNDLED_BACKEND) {
    const backendReady = await backendManager.ensure()
    if (!backendReady) {
      dialog.showErrorBox(
        '后端启动失败',
        `无法连接本地服务 ${CONTROL_API_BASE}。请查看 ${join(RUNTIME_ROOT, 'logs', 'backend-error.log')}。`,
      )
      app.quit()
      return
    }
  } else {
    console.log('[Backend] 跳过内嵌后端，控制面:', CONTROL_API_BASE)
  }

  const isDev = process.env.NODE_ENV === 'development'
    || !require('node:fs').existsSync(join(__dirname, '../../dist'))
  if (!isDev) registerAppProtocol(join(__dirname, '../../dist'))

  updateManager = new UpdateManager({
    ipcMain,
    getWindow: () => mainWindow,
    hasActiveWork: () => automationController.hasActiveWork(),
    beforeInstall: () => lifecycle.prepareForInstall(),
  })
  mainWindow = createMainWindow({
    applicationName: APPLICATION_NAME,
    controlApiBase: CONTROL_API_BASE,
    deviceId: DEVICE_IDENTITY.deviceId,
    deviceName: DEVICE_IDENTITY.deviceName,
    automationEnabled: AUTOMATION_RUNTIME_ENABLED,
    mayOpenExternalUrl,
    getActivityState: () => automationController.activityState(),
    cancelActiveWork: () => automationController.cancelActiveForWindowClose(),
    onClosed: () => {
      automationController.clearDemoActivity()
      mainWindow = null
    },
  })
  if (app.isPackaged) setTimeout(() => void updateManager?.check(), 5000)
})
