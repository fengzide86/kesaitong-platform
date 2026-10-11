import { dialog, type BrowserWindow, type WebContents } from 'electron'
import { constants } from 'node:fs'
import { access, open, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import type { TrustedHandleRegistrar } from '../ipc/trusted-ipc.cjs'
import type { FileInputSelection, FileInputSelectionRequest, FileInputValidationResult } from '../../src/shared/ipc/file-input-contract.js'

export async function readableFile(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) return false
    await access(path, constants.R_OK)
    const handle = await open(path, 'r')
    await handle.close()
    return true
  } catch { return false }
}

/** Streaming digest: no spreadsheet contents or paths leave this process. */
export async function fileContentHash(path: string): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const before = await handle.stat()
    if (!before.isFile()) throw new Error('Not a file')
    const hash = createHash('sha256')
    const buffer = Buffer.alloc(64 * 1024)
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
      if (!bytesRead) break
      hash.update(buffer.subarray(0, bytesRead))
    }
    const after = await handle.stat()
    const current = await stat(path)
    if ([after, current].some(value => value.size !== before.size || value.mtimeMs !== before.mtimeMs || value.ctimeMs !== before.ctimeMs || value.ino !== before.ino || value.dev !== before.dev)) throw new Error('File changed during read')
    return hash.digest('hex')
  } finally { await handle.close() }
}

export interface LocalFileSnapshot { files: Record<string, string>; input: Record<string, unknown> }

export class FileInputController {
  private readonly selected = new Map<number, Map<string, string>>()
  constructor(private readonly getWindow: () => BrowserWindow | null | undefined) {}

  register(register: TrustedHandleRegistrar): void {
    register('files:select-input', async (event, request: FileInputSelectionRequest): Promise<FileInputSelection | null> => {
      const window = this.getWindow()
      if (!window || window.isDestroyed()) throw new Error('当前窗口不可用')
      const result = await dialog.showOpenDialog(window, { title: `选择${request.label}`, properties: ['openFile'] })
      if (result.canceled || !result.filePaths[0]) return null
      if (event.sender.isDestroyed() || this.getWindow()?.webContents !== event.sender) throw new Error('文件选择窗口已变化，请重新选择')
      const filePath = result.filePaths[0]
      if (!await readableFile(filePath)) throw new Error('所选文件不存在或无法读取，请选择其他文件')
      const digest = await fileContentHash(filePath).catch(() => { throw new Error('所选文件无法读取或正在变化，请重新选择') })
      if (event.sender.isDestroyed() || this.getWindow()?.webContents !== event.sender) throw new Error('文件选择窗口已变化，请重新选择')
      let paths = this.selected.get(event.sender.id)
      if (!paths) {
        paths = new Map<string, string>()
        this.selected.set(event.sender.id, paths)
        event.sender.once('destroyed', () => this.clear(event.sender.id))
      }
      paths.set(filePath, digest)
      return { filePath, fileName: basename(filePath) }
    })
    register('files:validate-input', (event, request: { paths: string[] }) => this.validate(event.sender, request.paths))
    register('files:clear-input', event => this.clear(event.sender.id))
  }

  async validate(owner: WebContents, paths: string[]): Promise<FileInputValidationResult> {
    const selected = this.selected.get(owner.id)
    const issues: FileInputValidationResult['issues'] = []
    for (const filePath of new Set(paths)) {
      if (!selected?.has(filePath)) issues.push({ filePath, message: '请通过“选择文件”重新选择本机文件' })
      else if (!await readableFile(filePath)) issues.push({ filePath, message: '文件已删除、移动或无法读取，请重新选择' })
      else if (await fileContentHash(filePath).catch(() => null) !== selected.get(filePath)) issues.push({ filePath, message: '文件内容在选择后已变化，请重新选择并核对输入' })
      else if (!this.selected.get(owner.id)?.has(filePath) || owner.isDestroyed() || this.getWindow()?.webContents !== owner) issues.push({ filePath, message: '文件选择或所属窗口已变化，请重新选择' })
    }
    return { valid: issues.length === 0, issues }
  }

  async snapshot(owner: WebContents, input: Record<string, unknown>, fields: Record<string, string>): Promise<LocalFileSnapshot> {
    const result = await this.validate(owner, Object.values(fields))
    if (!result.valid) throw new Error(`LOCAL_FILE_UNREADABLE: ${result.issues[0]?.message}`)
    const identity = { ...input }
    const files: Record<string, string> = {}
    for (const [key, path] of Object.entries(fields)) {
      const digest = this.selected.get(owner.id)?.get(path)
      if (!digest) throw new Error('LOCAL_FILE_CHANGED: 文件选择已失效')
      identity[key] = { localFileSha256: digest }
      files[path] = digest
    }
    return { input: identity, files }
  }

  async validateSnapshot(owner: WebContents, snapshot: LocalFileSnapshot): Promise<void> {
    for (const [path, digest] of Object.entries(snapshot.files)) {
      if (owner.isDestroyed() || this.getWindow()?.webContents !== owner || this.selected.get(owner.id)?.get(path) !== digest || await fileContentHash(path).catch(() => null) !== digest) throw new Error('LOCAL_FILE_CHANGED: 本次执行的文件内容已变化，已禁止提交；请核对结果后重新选择。')
    }
  }

  async validateUpload(owner: WebContents, filePath: unknown): Promise<{ valid: true }> {
    if (typeof filePath !== 'string' || !filePath) throw new Error('LOCAL_FILE_REQUIRED: 请先选择要上传的本机文件')
    if (owner.isDestroyed() || this.getWindow()?.webContents !== owner) throw new Error('LOCAL_FILE_OWNER_CHANGED: 文件所属窗口已变化')
    const result = await this.validate(owner, [filePath])
    if (!result.valid) throw new Error(`LOCAL_FILE_UNREADABLE: ${result.issues[0]?.message || '本机文件无法读取'}`)
    return { valid: true }
  }

  clear(ownerId: number): void { this.selected.delete(ownerId) }
}
