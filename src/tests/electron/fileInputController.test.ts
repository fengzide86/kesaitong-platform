import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, rm, unlink, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { resolve } from 'node:path'
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import type { FileInputController as ControllerType } from '../../../electron/automation/file-input-controller.cjs'
const mocks = { dialog: vi.fn(), unreadable: false }
const compiled = resolve('dist-electron/electron/automation/file-input-controller.cjs')
const localRequire = createRequire(compiled)
const fs = localRequire('node:fs/promises') as typeof import('node:fs/promises')
const cjsModule = { exports: {} }
runInNewContext(readFileSync(compiled, 'utf8'), {
  require: (name: string) => name === 'electron' ? { dialog: { showOpenDialog: mocks.dialog } }
    : name === 'node:fs/promises' ? { ...fs, open: (...args: Parameters<typeof fs.open>) => mocks.unreadable ? Promise.reject(new Error('EACCES')) : fs.open(...args) }
      : localRequire(name),
  module: cjsModule, exports: cjsModule.exports,
})
const { FileInputController } = cjsModule.exports as { FileInputController: typeof ControllerType }
const { createTrustedIpcRegistrar } = localRequire(resolve('dist-electron/electron/ipc/trusted-ipc.cjs')) as typeof import('../../../electron/ipc/trusted-ipc.cjs')
import { parseDesktopIpcArgs } from '@/shared/ipc/desktop-contract'

describe('native local input files', () => {
  let directory: string
  let file: string
  let controller: ControllerType
  let sender: WebContents
  let invoke: (channel: string, request?: unknown, owner?: WebContents) => Promise<unknown>
  beforeEach(async () => {
    mocks.unreadable = false
    mocks.dialog.mockReset()
    directory = await mkdtemp(join(tmpdir(), 'kst-file-input-'))
    file = join(directory, '中文 任务资料.csv')
    await writeFile(file, 'sample', 'utf8')
    sender = { id: 1, isDestroyed: () => false, once: vi.fn(), getURL: () => 'app://toolbox/index.html' } as unknown as WebContents
    const window = { isDestroyed: () => false, webContents: sender } as unknown as BrowserWindow
    controller = new FileInputController(() => window)
    const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
    const ipcMain = { handle: (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => handlers.set(channel, handler), on: vi.fn() } as unknown as IpcMain
    const registrar = createTrustedIpcRegistrar({ ipcMain, getWindow: () => window, allowDevelopmentOrigin: false, automationEnabled: true, errorMessage: () => 'safe error' })
    controller.register(registrar.automationHandle)
    invoke = async (channel, request, owner = sender) => handlers.get(channel)!({ sender: owner, senderFrame: { url: owner.getURL() } } as IpcMainInvokeEvent, ...(request === undefined ? [] : [request]))
  })
  afterEach(async () => { mocks.unreadable = false; await rm(directory, { recursive: true, force: true }) })
  it('returns only actual native selection and preserves Chinese/spaced paths', async () => {
    mocks.dialog.mockResolvedValue({ canceled: false, filePaths: [file] })
    expect(await invoke('files:select-input', { label: '商品资料' })).toEqual({ filePath: file, fileName: basename(file) })
    expect(await invoke('files:validate-input', { paths: [file] })).toEqual({ valid: true, issues: [] })
    expect(mocks.dialog.mock.calls[0]?.[1]).toEqual({ title: '选择商品资料', properties: ['openFile'] })
  })
  it('cancel does not revoke an existing selection', async () => {
    mocks.dialog.mockResolvedValueOnce({ canceled: false, filePaths: [file] }).mockResolvedValueOnce({ canceled: true, filePaths: [] })
    await invoke('files:select-input', { label: '资料' })
    expect(await invoke('files:select-input', { label: '资料' })).toBeNull()
    expect(await invoke('files:validate-input', { paths: [file] })).toEqual({ valid: true, issues: [] })
  })
  it('uses content identity across renamed files and checks changes again before mutation', async () => {
    mocks.dialog.mockResolvedValue({ canceled: false, filePaths: [file] })
    await invoke('files:select-input', { label: '资料' })
    const first = await controller.snapshot(sender, { document: file, account: 'fixture' }, { document: file })
    const copy = join(directory, '改名副本.csv')
    await copyFile(file, copy)
    mocks.dialog.mockResolvedValue({ canceled: false, filePaths: [copy] })
    await invoke('files:select-input', { label: '资料' })
    const second = await controller.snapshot(sender, { document: copy, account: 'fixture' }, { document: copy })
    expect(second.input).toEqual(first.input)
    expect(JSON.stringify(first.input)).not.toContain(directory)
    await writeFile(file, 'modified')
    await expect(controller.validateSnapshot(sender, first)).rejects.toThrow('LOCAL_FILE_CHANGED')
    expect(await controller.validate(sender, [file])).toMatchObject({ valid: false })
    mocks.dialog.mockResolvedValue({ canceled: false, filePaths: [file] })
    await invoke('files:select-input', { label: '资料' })
    expect((await controller.snapshot(sender, { document: file }, { document: file })).input.document).not.toEqual(first.input.document)
    // Reselecting must not rewrite the already-running attempt's fingerprint.
    await expect(controller.validateSnapshot(sender, first)).rejects.toThrow('LOCAL_FILE_CHANGED')
  })
  it('revalidates deletion and read failures before launch', async () => {
    mocks.dialog.mockResolvedValue({ canceled: false, filePaths: [file] })
    await invoke('files:select-input', { label: '资料' })
    mocks.unreadable = true
    expect(await invoke('files:validate-input', { paths: [file] })).toMatchObject({ valid: false })
    mocks.unreadable = false
    await unlink(file)
    expect(await invoke('files:validate-input', { paths: [file] })).toMatchObject({ valid: false })
  })
  it('rejects arbitrary paths, another renderer, and selections after auth clearing', async () => {
    expect(await invoke('files:validate-input', { paths: [file] })).toMatchObject({ valid: false })
    mocks.dialog.mockResolvedValue({ canceled: false, filePaths: [file] })
    await invoke('files:select-input', { label: '资料' })
    const other = { id: 2, getURL: () => 'app://toolbox/index.html' } as WebContents
    await expect(invoke('files:validate-input', { paths: [file] }, other)).rejects.toThrow('active toolbox window')
    vi.spyOn(sender, 'getURL').mockReturnValueOnce('https://untrusted.invalid/')
    await expect(invoke('files:select-input', { label: '资料' })).rejects.toThrow('not trusted')
    await invoke('files:clear-input')
    expect(await invoke('files:validate-input', { paths: [file] })).toMatchObject({ valid: false })
  })
  it('does not return unreadable native selections; contract refuses renderer path injection', async () => {
    mocks.dialog.mockResolvedValue({ canceled: false, filePaths: [directory] })
    await expect(invoke('files:select-input', { label: '资料' })).rejects.toThrow('无法读取')
    expect(() => parseDesktopIpcArgs('files:select-input', [{ label: '资料', filePath: file }])).toThrow()
    expect(() => parseDesktopIpcArgs('files:validate-input', [{ paths: [null] }])).toThrow()
  })
})
