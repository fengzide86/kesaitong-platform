import {
  app,
  BrowserWindow,
  dialog,
  shell,
  type Event,
  type MessageBoxReturnValue,
  type WebContents,
  type WebPreferences,
} from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { installEditContextMenu } from './edit-context-menu.cjs'

import type { DesktopActivityState } from '../automation/desktop-automation-controller.cjs'
import {
  isAllowedMainFrameUrl,
  isAllowedWebviewPartition,
  isAllowedWebviewUrl,
} from '../security/navigation-policy.js'

interface MainWindowOptions {
  applicationName: string
  controlApiBase: string
  deviceId: string
  deviceName: string
  automationEnabled: boolean
  mayOpenExternalUrl: (url: string) => boolean
  getActivityState: () => DesktopActivityState
  cancelActiveWork: () => Promise<void>
  approveWebview?: (partition: string | undefined, preferences: WebPreferences) => boolean
  webviewAttached?: (guest: WebContents) => void
  onClosed: () => void
}

/** Applies the same navigation policy to every webview created by Electron. */
export function installWebContentsNavigationPolicy(
  mayOpenExternalUrl: (url: string) => boolean,
): void {
  app.on('web-contents-created', (_event: Event, contents: WebContents) => {
    if (contents.getType() !== 'webview') return
    const keepWebviewOnHttps = (event: Event, url: string): void => {
      if (!isAllowedWebviewUrl(url)) event.preventDefault()
    }
    contents.on('will-navigate', keepWebviewOnHttps)
    contents.on('will-redirect', keepWebviewOnHttps)
    contents.setWindowOpenHandler(({ url }) => {
      if (mayOpenExternalUrl(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
  })
}

/** Creates and secures the primary renderer window. */
export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  let allowWindowClose = false
  const isDev = process.env.NODE_ENV === 'development'
    || !existsSync(join(app.getAppPath(), 'dist'))
  const windowIconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(app.getAppPath(), 'build', 'icon.ico')

  const window = new BrowserWindow({
    title: options.applicationName,
    icon: windowIconPath,
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: options.automationEnabled,
      preload: join(__dirname, '..', 'preload.cjs'),
      additionalArguments: [
        `--toolbox-control-api-base=${options.controlApiBase}`,
        `--toolbox-device-id=${options.deviceId}`,
        `--toolbox-device-name=${encodeURIComponent(options.deviceName)}`,
        `--toolbox-automation-enabled=${options.automationEnabled ? 'true' : 'false'}`,
      ],
    },
    frame: true,
    show: false,
    backgroundColor: '#0F172A',
  })

  if (isDev) {
    const startRoute = process.env.TOOLBOX_START_ROUTE === '/admin/login' ? '#/admin/login' : ''
    const developmentUrl = `http://localhost:3000/${startRoute}`
    console.log(`[Dev] 连接 Vite 开发服务器 ${developmentUrl}`)
    void window.loadURL(developmentUrl)
    if (process.env.TOOLBOX_OPEN_DEVTOOLS === '1') {
      window.webContents.openDevTools({ mode: 'detach' })
    }
  } else {
    void window.loadURL('app://toolbox/index.html')
  }

  const keepMainWindowOnApp = (event: Event, url: string): void => {
    if (!isAllowedMainFrameUrl(url, !app.isPackaged)) event.preventDefault()
  }
  window.webContents.on('will-navigate', keepMainWindowOnApp)
  window.webContents.on('will-redirect', keepMainWindowOnApp)
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (options.mayOpenExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (
      !options.automationEnabled
      || !isAllowedWebviewUrl(params.src || 'about:blank')
      || Boolean(params.preload)
      || !(options.approveWebview ? options.approveWebview(params.partition, webPreferences) : isAllowedWebviewPartition(params.partition))
    ) {
      event.preventDefault()
      return
    }
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.nodeIntegrationInSubFrames = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    webPreferences.allowRunningInsecureContent = false
  })
  window.webContents.on('did-attach-webview', (_event, guest) => options.webviewAttached?.(guest))
  installEditContextMenu(window)

  window.once('ready-to-show', () => window.show())
  window.webContents.on('did-finish-load', () => {
    const apiBase = JSON.stringify(options.controlApiBase)
    window.webContents.executeJavaScript(`
      localStorage.setItem('toolbox_control_api_base', ${apiBase});
      localStorage.setItem('toolbox_api_base', ${apiBase});
    `).catch(() => undefined)
  })

  window.on('closed', options.onClosed)
  window.on('close', (event: Event) => {
    const activity = options.getActivityState()
    if (allowWindowClose || (!activity.batchActive && !activity.singleRunActive && !activity.demoActive)) return
    event.preventDefault()
    void dialog.showMessageBox(window, {
      type: 'warning',
      title: activity.batchActive ? '结束当前批次？' : '结束当前操作？',
      message: activity.batchActive
        ? '仍有账号正在处理或等待操作。关闭后浏览器现场会被清理，不能从通用检查点继续。'
        : '当前自动操作仍在进行。关闭后会安全停止本次操作。',
      buttons: ['继续使用', '结束并关闭'],
      defaultId: 0,
      cancelId: 0,
    }).then(async (result: MessageBoxReturnValue) => {
      if (result.response !== 1) return
      allowWindowClose = true
      await options.cancelActiveWork()
      window.close()
    })
  })

  return window
}
