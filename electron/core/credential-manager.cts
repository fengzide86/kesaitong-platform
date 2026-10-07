import fs from 'node:fs'
import path from 'node:path'

import { app, safeStorage, type BrowserWindow, type IpcMain } from 'electron'

import { parseDesktopIpcArgs } from '../../src/shared/ipc/desktop-contract.js'
import { assertTrustedSender } from '../ipc/sender-guard.js'

interface CredentialManagerOptions {
  ipcMain: IpcMain
  getWindow: () => BrowserWindow | null | undefined
  onSessionChanged?: (ownerId: number) => void
}

export class CredentialManager {
  private readonly ipcMain: IpcMain
  private readonly getWindow: () => BrowserWindow | null | undefined
  private readonly onSessionChanged: (ownerId: number) => void

  constructor(options: CredentialManagerOptions) {
    this.ipcMain = options.ipcMain
    this.getWindow = options.getWindow
    this.onSessionChanged = options.onSessionChanged ?? (() => undefined)
  }

  register(): void {
    this.ipcMain.handle('credential-save-user-code', (event, ...args: unknown[]) => {
      assertTrustedSender(event, this.getWindow, !app.isPackaged)
      const [code] = parseDesktopIpcArgs('credential-save-user-code', args)
      this.onSessionChanged(event.sender.id)
      return this.save(code)
    })
    this.ipcMain.handle('credential-load-user-code', (event, ...args: unknown[]) => {
      assertTrustedSender(event, this.getWindow, !app.isPackaged)
      parseDesktopIpcArgs('credential-load-user-code', args)
      return this.load()
    })
    this.ipcMain.handle('credential-clear-user-code', (event, ...args: unknown[]) => {
      assertTrustedSender(event, this.getWindow, !app.isPackaged)
      parseDesktopIpcArgs('credential-clear-user-code', args)
      this.onSessionChanged(event.sender.id)
      return this.clear()
    })
  }

  dispose(): void {
    for (const channel of ['credential-save-user-code', 'credential-load-user-code', 'credential-clear-user-code']) {
      this.ipcMain.removeHandler(channel)
    }
  }

  private credentialPath(): string {
    return path.join(app.getPath('userData'), 'user-credential.bin')
  }

  private save(value: unknown): boolean {
    if (typeof value !== 'string' || !value.trim() || !safeStorage.isEncryptionAvailable()) return false
    const target = this.credentialPath()
    const temporary = `${target}.tmp`
    fs.writeFileSync(temporary, safeStorage.encryptString(value.trim()))
    if (fs.existsSync(target)) fs.unlinkSync(target)
    fs.renameSync(temporary, target)
    return true
  }

  private load(): string | null {
    try {
      const target = this.credentialPath()
      if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(target)) return null
      return safeStorage.decryptString(fs.readFileSync(target))
    } catch (error) {
      console.error('[CredentialManager] Unable to load credential:', error)
      return null
    }
  }

  private clear(): boolean {
    try {
      const target = this.credentialPath()
      if (fs.existsSync(target)) fs.unlinkSync(target)
      return true
    } catch (error) {
      console.error('[CredentialManager] Unable to clear credential:', error)
      return false
    }
  }
}
