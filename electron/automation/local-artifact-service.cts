import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import type { WebContents } from 'electron'
import {
  localArtifactReadRequestSchema,
  localArtifactReadResultSchema,
  type LocalArtifactDiagnosticSummary,
  type LocalArtifactKind,
  type LocalArtifactReadRequest,
  type LocalArtifactReadResult,
  type LocalArtifactUnavailableCode,
} from '../../src/shared/ipc/artifact-contract.js'

type Owner = Pick<WebContents, 'id' | 'isDestroyed' | 'on' | 'once' | 'removeListener'>
type RecordValue = Record<string, unknown>
type EvidenceType = 'screenshot' | 'page-scan' | 'network-evidence'
interface RunEvidence {
  runId: string
  paths: Partial<Record<EvidenceType, string>>
  summary: LocalArtifactDiagnosticSummary
}
interface OwnerSession {
  owner: Owner
  generation: number
  run?: RunEvidence
  destroyed: () => void
  navigation: (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => void
}

const messages: Record<LocalArtifactUnavailableCode, string> = {
  NOT_AVAILABLE: '本次任务证据不可用，请查看当前任务状态。',
  NO_EVIDENCE: '本次任务尚未生成可读取的本机证据。',
  FORBIDDEN_PATH: '本机证据位置未通过安全校验。',
  MISSING: '本机证据文件已不存在。',
  TOO_LARGE: '本机证据超过安全查看大小限制。',
  INVALID_CONTENT: '本机证据格式无效，无法安全显示。',
  READ_FAILED: '本机证据读取失败，请稍后重试。',
  SESSION_CHANGED: '任务或授权状态已切换，请查看当前任务。',
}

function object(value: unknown): RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}
}
function failure(code: LocalArtifactUnavailableCode): Error & { code: LocalArtifactUnavailableCode } {
  return Object.assign(new Error(messages[code]), { code })
}
function unavailable(kind: LocalArtifactKind, code: LocalArtifactUnavailableCode): LocalArtifactReadResult {
  return { status: 'unavailable', kind, code, message: messages[code] }
}
function normalized(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}
function boundedCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1_000_000, Math.max(0, Math.floor(value))) : 0
}

// Check PNG structure and every CRC before forwarding a bounded data URL.
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let crc = index
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  return crc >>> 0
})
function validPng(bytes: Buffer): boolean {
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false
  let offset = 8
  let hasData = false
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    if (length > bytes.length - offset - 12) return false
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    if (!/^[A-Za-z]{4}$/.test(type)) return false
    if (offset === 8) {
      if (type !== 'IHDR' || length !== 13) return false
      const width = bytes.readUInt32BE(offset + 8)
      const height = bytes.readUInt32BE(offset + 12)
      if (!width || !height || width > 32_768 || height > 32_768 || width * height > 100_000_000) return false
    } else if (type === 'IHDR') return false
    let crc = 0xffffffff
    for (let index = offset + 4; index < offset + 8 + length; index++) {
      crc = (crcTable[(crc ^ bytes[index]!) & 255]! ^ (crc >>> 8)) >>> 0
    }
    if (((crc ^ 0xffffffff) >>> 0) !== bytes.readUInt32BE(offset + 8 + length)) return false
    if (type === 'IDAT') hasData = true
    offset += length + 12
    if (type === 'IEND') return length === 0 && hasData && offset === bytes.length
  }
  return false
}

/** Current-window/current-task evidence only: never discover old files by name. */
export class LocalArtifactService {
  private readonly directory: string
  private readonly owners = new Map<number, OwnerSession>()
  private readonly maxScreenshotBytes: number
  private readonly maxDiagnosticBytes: number

  constructor(options: { directory: string; maxScreenshotBytes?: number; maxDiagnosticBytes?: number }) {
    this.directory = path.resolve(options.directory)
    this.maxScreenshotBytes = Math.min(options.maxScreenshotBytes ?? 8_388_608, 8_388_608)
    this.maxDiagnosticBytes = Math.min(options.maxDiagnosticBytes ?? 1_048_576, 1_048_576)
  }

  begin(owner: Owner): number {
    let session = this.owners.get(owner.id)
    if (session && session.owner !== owner) {
      this.removeSession(session)
      session = undefined
    }
    if (!session) {
      const destroyed = () => {
        const current = this.owners.get(owner.id)
        if (current?.owner === owner) this.removeSession(current)
      }
      const navigation = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => {
        if (mainFrame && !inPlace && this.owners.get(owner.id)?.owner === owner) this.reset(owner.id)
      }
      session = { owner, generation: 0, destroyed, navigation }
      this.owners.set(owner.id, session)
      owner.once('destroyed', destroyed)
      owner.on('did-start-navigation', navigation)
    }
    session.generation++
    delete session.run
    return session.generation
  }

  registerRun(owner: Owner, generation: number, runId: unknown): void {
    const session = this.owners.get(owner.id)
    if (!session || session.owner !== owner || owner.isDestroyed() || session.generation !== generation) return
    if (typeof runId !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(runId)) return
    if (!session.run || session.run.runId !== runId) session.run = { runId, paths: {}, summary: { runStatus: 'running' } }
  }

  reset(ownerId: number): void {
    const session = this.owners.get(ownerId)
    if (!session) return
    session.generation++
    delete session.run
  }

  clear(): void {
    for (const session of this.owners.values()) this.removeSession(session)
  }

  private removeSession(session: OwnerSession): void {
    session.generation++
    delete session.run
    session.owner.removeListener('destroyed', session.destroyed)
    session.owner.removeListener('did-start-navigation', session.navigation)
    this.owners.delete(session.owner.id)
  }

  observe(rawEvent: unknown): void {
    const event = object(rawEvent)
    for (const session of this.owners.values()) {
      const run = session.run
      if (!run || event.runId !== run.runId || session.owner.isDestroyed()) continue
      const states: Record<string, LocalArtifactDiagnosticSummary['runStatus']> = {
        'run.started': 'running', 'run.paused': 'paused', 'run.resumed': 'running',
        'user.action_required': 'waiting_user', 'user.action_completed': 'running',
        'run.completed': 'completed', 'run.failed': 'failed', 'run.cancelled': 'cancelled',
      }
      const nextState = typeof event.type === 'string' ? states[event.type] : undefined
      if (nextState) run.summary.runStatus = nextState
      const code = object(event.error).code
      if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code)) run.summary.errorCode = code
      const artifact = object(event.artifact)
      const type = artifact.type
      if (event.type === 'artifact.created' && ['screenshot', 'page-scan', 'network-evidence'].includes(String(type)) && typeof artifact.path === 'string') {
        run.paths[type as EvidenceType] = artifact.path
      }
      const result = object(event.result)
      for (const [key, evidenceType] of [['screenshot', 'screenshot'], ['scanReport', 'page-scan'], ['networkEvidencePath', 'network-evidence']] as const) {
        if (event.type === 'run.completed' && typeof result[key] === 'string') run.paths[evidenceType] = result[key]
      }
      const fingerprint = result.pageFingerprint ?? artifact.fingerprint
      if (typeof fingerprint === 'string' && /^[a-f0-9]{64}$/.test(fingerprint)) run.summary.pageFingerprint = fingerprint
      const changed = result.pageChanged ?? artifact.changed
      if (typeof changed === 'boolean') run.summary.pageChanged = changed
      // A report warning alone does not prove a receipt was saved for retry.
      if (typeof result.recordPending === 'boolean') run.summary.recordPending = result.recordPending
    }
  }

  async read(owner: Owner, rawRequest: LocalArtifactReadRequest): Promise<LocalArtifactReadResult> {
    const request = localArtifactReadRequestSchema.parse(rawRequest)
    const session = this.owners.get(owner.id)
    const run = session?.run
    if (!session || session.owner !== owner || owner.isDestroyed() || !run || run.runId !== request.runId) return unavailable(request.kind, 'NOT_AVAILABLE')
    const generation = session.generation
    const current = () => this.owners.get(owner.id) === session && session.generation === generation && session.run === run && !owner.isDestroyed()
    try {
      let result: LocalArtifactReadResult
      if (request.kind === 'screenshot') {
        const target = run.paths.screenshot
        if (!target) return unavailable(request.kind, 'NO_EVIDENCE')
        const bytes = await this.readControlledFile(target, run.runId, 'screenshot', this.maxScreenshotBytes)
        if (!current()) return unavailable(request.kind, 'SESSION_CHANGED')
        if (!validPng(bytes)) throw failure('INVALID_CONTENT')
        result = { status: 'available', kind: 'screenshot', dataUrl: `data:image/png;base64,${bytes.toString('base64')}` }
      } else {
        const summary: LocalArtifactDiagnosticSummary = { ...run.summary }
        const evidenceTypes = (['page-scan', 'network-evidence'] as const).filter(type => run.paths[type])
        if (!evidenceTypes.length) return unavailable(request.kind, 'NO_EVIDENCE')
        for (const type of evidenceTypes) {
          const bytes = await this.readControlledFile(run.paths[type]!, run.runId, type, this.maxDiagnosticBytes)
          if (!current()) return unavailable(request.kind, 'SESSION_CHANGED')
          let data: RecordValue
          try { data = object(JSON.parse(bytes.toString('utf8'))) } catch { throw failure('INVALID_CONTENT') }
          if (type === 'page-scan') {
            const page = object(data.page)
            if (data.schemaVersion !== 1 || !Array.isArray(page.controls) || !Array.isArray(page.forms) || !Array.isArray(page.headings)) throw failure('INVALID_CONTENT')
            summary.pageScan = { controlCount: boundedCount(page.controls.length), formCount: boundedCount(page.forms.length), headingCount: boundedCount(page.headings.length) }
          } else {
            if (!Array.isArray(data.records) || typeof data.enabled !== 'boolean') throw failure('INVALID_CONTENT')
            summary.network = {
              recordCount: boundedCount(data.records.length), dropped: boundedCount(data.dropped),
              responseCount: boundedCount(data.records.filter(value => object(value).event === 'response').length),
              failureCount: boundedCount(data.records.filter(value => object(value).event === 'failed').length),
            }
          }
        }
        result = { status: 'available', kind: 'diagnostic', summary }
      }
      if (!current()) return unavailable(request.kind, 'SESSION_CHANGED')
      return localArtifactReadResultSchema.parse(result)
    } catch (error) {
      if (!current()) return unavailable(request.kind, 'SESSION_CHANGED')
      const code = object(error).code
      if (code === 'ENOENT') return unavailable(request.kind, 'MISSING')
      if (typeof code === 'string' && Object.hasOwn(messages, code)) return unavailable(request.kind, code as LocalArtifactUnavailableCode)
      return unavailable(request.kind, 'READ_FAILED')
    }
  }

  private async readControlledFile(target: string, runId: string, type: EvidenceType, limit: number): Promise<Buffer> {
    const resolved = path.resolve(target)
    const relative = path.relative(this.directory, resolved)
    if (!path.isAbsolute(target) || !relative || relative.startsWith('..') || path.isAbsolute(relative)) throw failure('FORBIDDEN_PATH')
    const expected = type === 'screenshot' ? path.join(this.directory, `${runId}.png`)
      : type === 'network-evidence' ? path.join(this.directory, `${runId}.network.json`) : null
    if (expected && normalized(resolved) !== normalized(expected)) throw failure('FORBIDDEN_PATH')
    if (type === 'page-scan' && (normalized(path.dirname(resolved)) !== normalized(path.join(this.directory, 'page-scans')) || !/^[A-Za-z0-9._-]+\.\d+\.json$/.test(path.basename(resolved)))) throw failure('FORBIDDEN_PATH')
    // lstat also rejects Windows junctions. Check root and each path component.
    let component = resolved
    while (true) {
      const stat = await fs.lstat(component)
      if (stat.isSymbolicLink() || (component === resolved && (!stat.isFile() || stat.nlink !== 1))) throw failure('FORBIDDEN_PATH')
      if (normalized(component) === normalized(this.directory)) break
      component = path.dirname(component)
    }
    const realRoot = await fs.realpath(this.directory)
    const realTarget = await fs.realpath(resolved)
    if (normalized(realRoot) !== normalized(this.directory) || normalized(realTarget) !== normalized(resolved)) throw failure('FORBIDDEN_PATH')
    const handle = await fs.open(realTarget, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.nlink !== 1) throw failure('FORBIDDEN_PATH')
      if (stat.size > limit) throw failure('TOO_LARGE')
      const bytes = Buffer.alloc(Math.min(stat.size + 1, limit + 1))
      let length = 0
      while (length < bytes.length) {
        const read = await handle.read(bytes, length, bytes.length - length, length)
        if (!read.bytesRead) break
        length += read.bytesRead
      }
      if (length > limit) throw failure('TOO_LARGE')
      const after = await fs.lstat(resolved)
      if (after.isSymbolicLink() || after.nlink !== 1 || after.ino !== stat.ino || after.dev !== stat.dev || normalized(await fs.realpath(resolved)) !== normalized(realTarget)) throw failure('FORBIDDEN_PATH')
      if (after.size !== stat.size || length !== stat.size) throw failure('INVALID_CONTENT')
      return bytes.subarray(0, length)
    } finally { await handle.close() }
  }
}
