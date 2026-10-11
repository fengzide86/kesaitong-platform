import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, existsSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { recoveryRecordSchema, type RecoveryRecord } from '../../src/shared/ipc/recovery-contract.js'

type Input = Record<string, unknown>
interface StoredRecord extends Omit<RecoveryRecord, 'retryAllowed'> {
  owner: string; inputHash: string; mutationStarted: boolean; consumedBy: string | null
}
const error = (code: string, message: string) => Object.assign(new Error(message), { code })
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
  return value
}
export function recoveryInputHash(input: Input): string { return createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex') }
export function recoveryOwnerHash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
function safeOrigin(url: unknown): string | null {
  try { const parsed = new URL(String(url)); return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.origin : null } catch { return null }
}
const retryable = (row: StoredRecord) => row.executionStatus !== 'running' && !row.consumedBy && ['not_submitted', 'manual_not_completed'].includes(row.classification)

/** Local metadata only. No imported cells, credentials, URLs with parameters or tokens. */
export class RecoveryStore {
  private readonly filePath: string
  private records: StoredRecord[] = []
  private unavailable: string | null = null
  constructor(directory: string) {
    this.filePath = join(directory, 'ledger-v1.json')
    try { mkdirSync(directory, { recursive: true }) } catch {
      this.unavailable = '本机恢复账本无法初始化，已禁用执行和恢复；登录与求助仍可使用。'
      return
    }
    if (existsSync(this.filePath)) {
      try {
        const loaded = JSON.parse(readFileSync(this.filePath, 'utf8')) as { version: number; records: StoredRecord[] }
        if (loaded.version !== 1 || !Array.isArray(loaded.records)) throw new Error('Unsupported ledger')
        for (const record of loaded.records) {
          recoveryRecordSchema.parse({ ...record, retryAllowed: false })
          if (!/^[a-f0-9]{64}$/.test(record.owner) || !/^[a-f0-9]{64}$/.test(record.inputHash) || typeof record.mutationStarted !== 'boolean') throw new Error('Invalid ledger')
          if (record.consumedBy !== null && (typeof record.consumedBy !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(record.consumedBy))) throw new Error('Invalid consumption marker')
        }
        this.records = loaded.records
      } catch { this.unavailable = '本机恢复账本损坏，已禁止执行；请保留文件并联系支持。'; return }
      const interrupted = this.records.filter(row => row.executionStatus === 'running')
      if (interrupted.length) {
        try { this.save(this.records.map(row => row.executionStatus === 'running' ? { ...row, executionStatus: 'interrupted', classification: 'needs_review', revision: row.revision + 1, updatedAt: new Date().toISOString(), errorCode: 'PROCESS_INTERRUPTED' } : row)) }
        catch { this.unavailable = '本机中断状态无法保存，已禁用执行和恢复；请保留文件并联系支持。' }
      }
    }
  }
  private save(next: StoredRecord[]): void {
    this.assertAvailable()
    const temporary = `${this.filePath}.${randomUUID()}.tmp`
    let descriptor: number | undefined
    try {
      descriptor = openSync(temporary, 'wx', 0o600)
      writeFileSync(descriptor, JSON.stringify({ version: 1, records: next }), 'utf8')
      fsyncSync(descriptor); closeSync(descriptor); descriptor = undefined
      renameSync(temporary, this.filePath)
      this.records = next
    } catch {
      throw error('RECOVERY_SAVE_FAILED', '无法原子保存本机恢复标记，已停止执行；请检查磁盘空间和权限。')
    } finally {
      if (descriptor !== undefined) closeSync(descriptor)
      try { unlinkSync(temporary) } catch { /* already renamed */ }
    }
  }
  private require(owner: string, id: string): StoredRecord {
    this.assertAvailable()
    const row = this.records.find(record => record.id === id && record.owner === owner)
    if (!row) throw error('RECOVERY_NOT_FOUND', '当前授权没有这条本机恢复记录。')
    return row
  }
  private public(row: StoredRecord): RecoveryRecord {
    const { owner: _owner, inputHash: _hash, mutationStarted: _mutation, consumedBy: _consumed, ...rest } = row
    return recoveryRecordSchema.parse({ ...rest, retryAllowed: retryable(row) })
  }
  private assertAvailable(): void { if (this.unavailable) throw error('RECOVERY_UNAVAILABLE', this.unavailable) }
  list(owner: string, batchId?: string): RecoveryRecord[] { this.assertAvailable(); return this.records.filter(row => row.owner === owner && !row.consumedBy && (!batchId || row.batchId === batchId)).map(row => this.public(row)) }
  queue(owner: string, tool: Input, inputs: Array<{ input: Input; batchId: string; itemId: string; originalRow?: number; retryOf?: string }>): RecoveryRecord[] {
    this.assertAvailable()
    const toolId = String(tool.id)
    const grant = (tool.launchGrant || {}) as Input
    const toolVersion = String(grant.toolVersion || tool.version || tool.tool_version || '1.0.0')
    const rows: StoredRecord[] = []
    const consumed = new Map<string, string>()
    for (const entry of inputs) {
      const inputHash = recoveryInputHash(entry.input)
      const prior = [...this.records, ...rows].filter(row => row.owner === owner && row.toolId === toolId && row.inputHash === inputHash).at(-1)
      if (prior && (!retryable(prior) || (prior.executionStatus === 'queued' && entry.retryOf !== prior.id))) throw error('RECOVERY_REVIEW_REQUIRED', '原文件有已完成、未核对或仍在排队的相同输入，已阻止重复建立批次。')
      if (entry.retryOf && entry.retryOf !== prior?.id) throw error('RECOVERY_INPUT_CHANGED', '原文件与恢复记录不匹配，请重新选择。')
      if (prior && prior.toolVersion !== toolVersion) throw error('RECOVERY_VERSION_CHANGED', '工具版本已变化，不能自动恢复；请联系支持确认。')
      rows.push({ id: randomUUID(), owner, inputHash, toolId, toolVersion, attemptId: randomUUID(), batchId: entry.batchId, itemId: entry.itemId,
        originalRow: entry.originalRow || null, classification: 'not_submitted', executionStatus: 'queued', revision: 1, updatedAt: new Date().toISOString(), errorCode: null,
        runId: null, targetOrigin: safeOrigin(tool.targetUrl || tool.target_url), mutationStarted: false, consumedBy: null })
      if (prior) consumed.set(prior.id, rows.at(-1)!.id)
    }
    this.save([...this.records.map(row => consumed.has(row.id) ? { ...row, consumedBy: consumed.get(row.id)! } : row), ...rows])
    return rows.map(row => this.public(row))
  }
  begin(owner: string, tool: Input, input: Input, options: { batchId?: string; itemId?: string; originalRow?: number; retryOf?: string; legacyInput?: Input } = {}): RecoveryRecord {
    this.assertAvailable()
    const inputHash = recoveryInputHash(input)
    const toolId = String(tool.id)
    const grant = (tool.launchGrant || {}) as Input
    const toolVersion = String(grant.toolVersion || tool.version || tool.tool_version || '1.0.0')
    // A pre-upgrade path-only record must not silently become a fresh attempt.
    const legacyHash = options.legacyInput ? recoveryInputHash(options.legacyInput) : null
    const prior = this.records.filter(row => row.owner === owner && row.toolId === toolId && (row.inputHash === inputHash || row.inputHash === legacyHash)).at(-1)
    if (prior?.executionStatus === 'queued' && options.retryOf !== prior.id) throw error('RECOVERY_REVIEW_REQUIRED', '相同输入仍在原批次排队，不能从其它入口重复执行。')
    if (prior && !retryable(prior)) throw error('RECOVERY_REVIEW_REQUIRED', prior.classification === 'verified' || prior.classification === 'manual_completed' ? '相同输入已有已完成记录，已阻止重复执行。' : '相同输入的结果尚待核对，请先核对平台状态。')
    if (options.retryOf && prior?.id !== options.retryOf) throw error('RECOVERY_INPUT_CHANGED', '原始输入与恢复记录不匹配，请重新选择原文件。')
    if (prior && prior.toolVersion !== toolVersion) throw error('RECOVERY_VERSION_CHANGED', '工具版本已变化，不能自动恢复；请联系支持确认。')
    const row: StoredRecord = {
      id: randomUUID(), owner, inputHash, toolId, toolVersion, attemptId: randomUUID(), batchId: options.batchId || null,
      itemId: options.itemId || null, originalRow: options.originalRow || null, classification: 'not_submitted', executionStatus: 'running',
      revision: 1, updatedAt: new Date().toISOString(), errorCode: null, runId: null, targetOrigin: safeOrigin(tool.targetUrl || tool.target_url), mutationStarted: false, consumedBy: null,
    }
    this.save([...this.records.map(candidate => prior?.id === candidate.id ? { ...candidate, consumedBy: row.id } : candidate), row])
    return this.public(row)
  }
  mutation(owner: string, id: string): void {
    const row = this.require(owner, id)
    if (row.executionStatus !== 'running') throw error('RECOVERY_RUN_ENDED', '该执行已经结束，不能继续提交。')
    this.save(this.records.map(record => record.id === id ? { ...record, mutationStarted: true, classification: 'needs_review', revision: record.revision + 1, updatedAt: new Date().toISOString() } : record))
  }
  observe(owner: string, id: string, event: Input): void {
    const row = this.require(owner, id)
    const type = String(event.type)
    if (!['run.started', 'run.completed', 'run.failed', 'run.cancelled', 'run.interrupted'].includes(type)) return
    // A terminal record is immutable to late Runner messages.
    if (row.executionStatus !== 'running' && !(row.executionStatus === 'queued' && ['run.failed', 'run.cancelled', 'run.interrupted'].includes(type))) return
    const next = { ...row, revision: row.revision + 1, updatedAt: new Date().toISOString() }
    if (type === 'run.started') next.runId = typeof event.runId === 'string' ? event.runId : null
    else {
      next.executionStatus = type === 'run.completed' ? 'completed' : type === 'run.cancelled' ? 'cancelled' : type === 'run.interrupted' ? 'interrupted' : 'failed'
      const detail = (event.error || {}) as Input
      next.classification = row.executionStatus === 'queued' ? 'not_submitted' : type === 'run.completed' ? 'verified' : type === 'run.interrupted' || detail.code === 'RUNNER_PROCESS_INTERRUPTED' || row.mutationStarted ? 'needs_review' : 'not_submitted'
      next.errorCode = typeof detail.code === 'string' && /^[A-Z0-9_:-]{1,128}$/.test(detail.code) ? detail.code : null
    }
    this.save(this.records.map(record => record.id === id ? next : record))
  }
  review(owner: string, id: string, revision: number, conclusion: 'completed' | 'not_completed'): RecoveryRecord {
    const row = this.require(owner, id)
    if (['queued', 'running'].includes(row.executionStatus) || row.classification === 'verified' || row.revision !== revision || row.consumedBy) throw error('RECOVERY_REVIEW_CONFLICT', '记录已经变化或仍在执行，请刷新后核对。')
    const next = { ...row, classification: conclusion === 'completed' ? 'manual_completed' as const : 'manual_not_completed' as const, revision: row.revision + 1, updatedAt: new Date().toISOString() }
    this.save(this.records.map(record => record.id === id ? next : record))
    return this.public(next)
  }
  matchRetry(owner: string, batchId: string, row: { sourceRow?: number; input: Input }, toolId: string, toolVersion: string): string | null {
    this.assertAvailable()
    const record = this.records.filter(candidate => candidate.owner === owner && candidate.batchId === batchId && candidate.originalRow === row.sourceRow).at(-1)
    if (!record) throw error('RECOVERY_ROW_MISMATCH', '原文件行号与本机恢复记录不匹配。')
    if (record.inputHash !== recoveryInputHash(row.input) || record.toolId !== toolId || record.toolVersion !== toolVersion) throw error('RECOVERY_INPUT_CHANGED', '原文件内容或工具版本已变化，不能恢复。')
    return retryable(record) ? record.id : null
  }
  origin(owner: string, id: string): string | null { return this.require(owner, id).targetOrigin }
  csv(owner: string, batchId?: string): { count: number; content: string } {
    const rows = this.list(owner, batchId).filter(row => !['verified', 'manual_completed'].includes(row.classification) && row.executionStatus !== 'running')
    const cell = (value: string) => `"${(/^\s*[=+@-]/.test(value) ? `'${value}` : value).replace(/"/g, '""')}"`
    const labels = { not_submitted: '确定未提交', needs_review: '结果待核对', manual_not_completed: '人工核对未完成', verified: '', manual_completed: '' }
    return { count: rows.length, content: '\uFEFF' + [['原表行号', '恢复分类', '错误码', '可重试', '记录时间'], ...rows.map(row => [String(row.originalRow || '单条任务'), labels[row.classification], row.errorCode || '—', row.retryAllowed ? '是' : '否', row.updatedAt])].map(row => row.map(cell).join(',')).join('\r\n') }
  }
}
