import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, rmdirSync, symlinkSync, linkSync } from 'node:fs'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative, isAbsolute } from 'node:path'
import type { WebContents } from 'electron'
import type { LocalArtifactService as ServiceType } from '../../../electron/automation/local-artifact-service.cjs'
import { localArtifactReadResultSchema } from '../../shared/ipc/artifact-contract'

const require = createRequire(import.meta.url)
const { LocalArtifactService } = require(resolve('dist-electron/electron/automation/local-artifact-service.cjs')) as { LocalArtifactService: typeof ServiceType }
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64')
const roots: string[] = []
const services: ServiceType[] = []

function owner(id = 1) {
  const emitter = new EventEmitter() as EventEmitter & { id: number; isDestroyed: () => boolean; destroy: () => void }
  let destroyed = false
  emitter.id = id
  emitter.isDestroyed = () => destroyed
  emitter.destroy = () => { destroyed = true; emitter.emit('destroyed') }
  return emitter as typeof emitter & WebContents
}
function setup(options: { maxScreenshotBytes?: number; maxDiagnosticBytes?: number } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'kst-artifact-test-'))
  roots.push(root)
  const directory = join(root, 'automation-artifacts')
  mkdirSync(directory)
  mkdirSync(join(directory, 'page-scans'))
  const service = new LocalArtifactService({ directory, ...options })
  services.push(service)
  const window = owner()
  const generation = service.begin(window)
  service.registerRun(window, generation, 'run_1')
  const observe = (type: string, payload: Record<string, unknown> = {}, runId = 'run_1') => service.observe({ type, runId, ...payload })
  const screenshot = (content = png, target = join(directory, 'run_1.png')) => {
    writeFileSync(target, content)
    observe('artifact.created', { artifact: { type: 'screenshot', path: target } })
    return target
  }
  return { root, directory, service, window, generation, observe, screenshot }
}
const readScreenshot = (service: ServiceType, window: WebContents, runId = 'run_1') => service.read(window, { runId, kind: 'screenshot' })

afterEach(() => {
  vi.restoreAllMocks()
  for (const service of services.splice(0)) service.clear()
  for (const root of roots.splice(0)) {
    const suffix = relative(resolve(tmpdir()), resolve(root))
    if (!suffix || suffix.startsWith('..') || isAbsolute(suffix) || !suffix.startsWith('kst-artifact-test-')) throw new Error('Unsafe test cleanup target')
    rmSync(root, { recursive: true, force: true })
  }
})

describe('current-task local artifact safety', () => {
  it('reads an actual registered PNG as a typed local data URL', async () => {
    const { service, window, screenshot } = setup()
    screenshot()
    const result = localArtifactReadResultSchema.parse(await readScreenshot(service, window))
    expect(result).toEqual({ status: 'available', kind: 'screenshot', dataUrl: `data:image/png;base64,${png.toString('base64')}` })
  })

  it('projects page/network files to counts and safe Runner metadata, never raw data', async () => {
    const { service, window, directory, observe } = setup()
    const scan = join(directory, 'page-scans', 'tool.123.json')
    const network = join(directory, 'run_1.network.json')
    writeFileSync(scan, JSON.stringify({ schemaVersion: 1, page: {
      controls: [{ value: 'PRIVATE_PASSWORD', text: 'PRIVATE_ORDER' }], forms: [{}], headings: ['PRIVATE_CUSTOMER'],
    }, cookie: 'PRIVATE_COOKIE' }))
    writeFileSync(network, JSON.stringify({ enabled: true, dropped: 2, records: [
      { event: 'response', url: 'https://private.test/?token=PRIVATE_TOKEN', body: 'PRIVATE_BODY' },
      { event: 'failed', cookie: 'PRIVATE_COOKIE', headers: { Authorization: 'PRIVATE_TOKEN' } },
    ] }))
    observe('artifact.created', { artifact: { type: 'page-scan', path: scan, fingerprint: 'a'.repeat(64), changed: true } })
    observe('artifact.created', { artifact: { type: 'network-evidence', path: network } })
    observe('run.completed', { result: { reportWarning: 'PRIVATE_REPORT_WARNING' } })
    observe('run.failed', { error: { code: 'PAGE_CHANGED', message: 'PRIVATE_ERROR' } })
    const result = localArtifactReadResultSchema.parse(await service.read(window, { runId: 'run_1', kind: 'diagnostic' }))
    expect(result).toEqual({ status: 'available', kind: 'diagnostic', summary: {
      runStatus: 'failed', errorCode: 'PAGE_CHANGED', pageFingerprint: 'a'.repeat(64), pageChanged: true,
      pageScan: { controlCount: 1, formCount: 1, headingCount: 1 },
      network: { recordCount: 2, dropped: 2, responseCount: 1, failureCount: 1 },
    } })
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|private\.test|automation-artifacts|page-scans|headers|cookie/)
  })

  it('never discovers files from historical/unknown tasks or another window', async () => {
    const { service, window, screenshot } = setup()
    screenshot()
    expect(await readScreenshot(service, owner(2))).toMatchObject({ code: 'NOT_AVAILABLE' })
    expect(await readScreenshot(service, owner(1))).toMatchObject({ code: 'NOT_AVAILABLE' })
    expect(await readScreenshot(service, window, 'old_run')).toMatchObject({ code: 'NOT_AVAILABLE' })
  })

  it('returns no-evidence for fingerprint-only, cancelled or preflight states', async () => {
    const { service, window, observe } = setup()
    observe('run.cancelled', { result: { pageFingerprint: 'a'.repeat(64) } })
    expect(await readScreenshot(service, window)).toMatchObject({ code: 'NO_EVIDENCE' })
    expect(await service.read(window, { runId: 'run_1', kind: 'diagnostic' })).toMatchObject({ code: 'NO_EVIDENCE' })
    expect(await service.read(window, { runId: 'preflight', kind: 'diagnostic' })).toMatchObject({ code: 'NOT_AVAILABLE' })
  })

  it('new tasks revoke old references, even if the previous files still exist', async () => {
    const { service, window, screenshot, generation } = setup()
    screenshot()
    const next = service.begin(window)
    service.registerRun(window, generation, 'run_1')
    service.registerRun(window, next, 'run_2')
    expect(await readScreenshot(service, window)).toMatchObject({ code: 'NOT_AVAILABLE' })
    expect(await readScreenshot(service, window, 'run_2')).toMatchObject({ code: 'NO_EVIDENCE' })
  })

  it.each(['reset', 'destroyed', 'navigation'] as const)('%s revokes a task and late registration cannot revive it', async action => {
    const { service, window, screenshot, generation } = setup()
    screenshot()
    if (action === 'reset') service.reset(window.id)
    if (action === 'destroyed') window.destroy()
    if (action === 'navigation') window.emit('did-start-navigation', {}, 'app://toolbox/login', false, true)
    service.registerRun(window, generation, 'run_1')
    expect(await readScreenshot(service, window)).toMatchObject({ code: 'NOT_AVAILABLE' })
  })

  it('same-page navigation does not discard the current task', async () => {
    const { service, window, screenshot } = setup()
    screenshot()
    window.emit('did-start-navigation', {}, 'app://toolbox/#/user/tools', true, true)
    expect(await readScreenshot(service, window)).toMatchObject({ status: 'available' })
  })

  it.each(['reset', 'new-task', 'destroyed', 'navigation'] as const)('does not return bytes when %s occurs during the awaited read', async action => {
    const { service, window, screenshot } = setup()
    screenshot()
    const original = fs.open.bind(fs)
    let entered!: () => void
    let release!: () => void
    const reading = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await original(...args)
      entered()
      await gate
      return handle
    })
    const result = readScreenshot(service, window)
    await reading
    if (action === 'reset') service.reset(window.id)
    if (action === 'new-task') service.registerRun(window, service.begin(window), 'run_2')
    if (action === 'destroyed') window.destroy()
    if (action === 'navigation') window.emit('did-start-navigation', {}, 'app://toolbox/login', false, true)
    release()
    expect(await result).toMatchObject({ status: 'unavailable', code: 'SESSION_CHANGED' })
  })

  it.each(['outside', 'other-task', 'relative'] as const)('rejects %s paths without returning an absolute path', async type => {
    const { root, directory, service, window, observe } = setup()
    const target = type === 'outside' ? join(root, 'private.png') : type === 'other-task' ? join(directory, 'other_run.png') : 'run_1.png'
    if (type !== 'relative') writeFileSync(target, png)
    observe('artifact.created', { artifact: { type: 'screenshot', path: target } })
    const result = await readScreenshot(service, window)
    expect(result).toMatchObject({ status: 'unavailable', code: 'FORBIDDEN_PATH' })
    expect(JSON.stringify(result)).not.toContain(root)
  })

  it('rejects a real Windows junction / directory symlink in the evidence tree', async () => {
    const { root, directory, service, window, observe } = setup()
    rmdirSync(join(directory, 'page-scans'))
    const outside = join(root, 'private-diagnostics')
    mkdirSync(outside)
    writeFileSync(join(outside, 'tool.123.json'), JSON.stringify({ schemaVersion: 1, page: { controls: [], forms: [], headings: [] } }))
    symlinkSync(outside, join(directory, 'page-scans'), process.platform === 'win32' ? 'junction' : 'dir')
    observe('artifact.created', { artifact: { type: 'page-scan', path: join(directory, 'page-scans', 'tool.123.json') } })
    expect(await service.read(window, { runId: 'run_1', kind: 'diagnostic' })).toMatchObject({ code: 'FORBIDDEN_PATH' })
  })

  it('rejects file symlinks (using an lstat reparse fixture if Windows forbids creation)', async () => {
    const { root, directory, service, window, observe } = setup()
    const outside = join(root, 'private.png')
    const target = join(directory, 'run_1.png')
    writeFileSync(outside, png)
    try { symlinkSync(outside, target, 'file') } catch (error) {
      if (!['EPERM', 'EACCES'].includes(String((error as NodeJS.ErrnoException).code))) throw error
      const original = fs.lstat.bind(fs)
      vi.spyOn(fs, 'lstat').mockImplementation(async (...args) => {
        const stat = await original(args[0] === target ? outside : args[0])
        if (args[0] === target) stat.isSymbolicLink = () => true
        return stat
      })
    }
    observe('artifact.created', { artifact: { type: 'screenshot', path: target } })
    expect(await readScreenshot(service, window)).toMatchObject({ code: 'FORBIDDEN_PATH' })
  })

  it('rejects hard links to files outside the controlled task evidence', async () => {
    const { root, directory, service, window, observe } = setup()
    const outside = join(root, 'private.png')
    writeFileSync(outside, png)
    const target = join(directory, 'run_1.png')
    linkSync(outside, target)
    observe('artifact.created', { artifact: { type: 'screenshot', path: target } })
    expect(await readScreenshot(service, window)).toMatchObject({ code: 'FORBIDDEN_PATH' })
  })

  it('rejects oversized evidence before returning its bytes', async () => {
    const { service, window, screenshot } = setup({ maxScreenshotBytes: 32 })
    screenshot()
    expect(await readScreenshot(service, window)).toMatchObject({ code: 'TOO_LARGE' })
  })

  it('applies a separate size limit to diagnostic JSON', async () => {
    const { service, window, directory, observe } = setup({ maxDiagnosticBytes: 16 })
    const scan = join(directory, 'page-scans', 'tool.123.json')
    writeFileSync(scan, JSON.stringify({ schemaVersion: 1, page: { controls: [], forms: [], headings: [] } }))
    observe('artifact.created', { artifact: { type: 'page-scan', path: scan } })
    expect(await service.read(window, { runId: 'run_1', kind: 'diagnostic' })).toMatchObject({ code: 'TOO_LARGE' })
  })

  it('returns a fixed read-failure message, not filesystem exception data', async () => {
    const { service, window, screenshot } = setup()
    screenshot()
    vi.spyOn(fs, 'open').mockRejectedValue(Object.assign(new Error('PRIVATE_PATH_AND_TOKEN'), { code: 'EACCES' }))
    const result = await readScreenshot(service, window)
    expect(result).toMatchObject({ code: 'READ_FAILED' })
    expect(JSON.stringify(result)).not.toContain('PRIVATE_')
  })

  it.each(['wrong-magic', 'invalid-crc', 'trailing-data'] as const)('rejects %s PNG contents', async type => {
    const { service, window, screenshot } = setup()
    const invalid = Buffer.from(png)
    if (type === 'wrong-magic') invalid[0] = 0
    if (type === 'invalid-crc') invalid[30] = invalid[30]! ^ 1
    screenshot(type === 'trailing-data' ? Buffer.concat([png, Buffer.from('private')]) : invalid)
    expect(await readScreenshot(service, window)).toMatchObject({ code: 'INVALID_CONTENT' })
  })

  it('reports missing / malformed diagnostic files without raw exception text', async () => {
    const { root, directory, service, window, observe } = setup()
    const target = join(directory, 'run_1.png')
    observe('artifact.created', { artifact: { type: 'screenshot', path: target } })
    expect(await readScreenshot(service, window)).toMatchObject({ code: 'MISSING' })
    const scan = join(directory, 'page-scans', 'tool.123.json')
    writeFileSync(scan, 'PRIVATE_INVALID_JSON')
    observe('artifact.created', { artifact: { type: 'page-scan', path: scan } })
    const result = await service.read(window, { runId: 'run_1', kind: 'diagnostic' })
    expect(result).toMatchObject({ code: 'INVALID_CONTENT' })
    expect(JSON.stringify(result)).not.toMatch(new RegExp(`PRIVATE_|${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  })

  it('does not accept a renderer path, unknown evidence type or traversal run ID', async () => {
    const { service, window } = setup()
    await expect(service.read(window, { runId: 'run_1', kind: 'screenshot', path: '/private' } as never)).rejects.toThrow()
    await expect(service.read(window, { runId: '../run_1', kind: 'screenshot' })).rejects.toThrow()
    await expect(service.read(window, { runId: 'run_1', kind: 'arbitrary-file' } as never)).rejects.toThrow()
  })
})
