import { existsSync, mkdirSync, openSync, closeSync, fsyncSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { operationReceiptSchema, runPlanSchema, type RunPlan, type OperationReceipt } from '../../../src/shared/ipc/target-contract.js'
import { targetError, targetHash } from './profile-policy.cjs'

interface Entry { owner: string; operationKey: string; plan: RunPlan; receipt: OperationReceipt }
/** Separate versioned store for business receipts; never upgrades old click checkpoints. */
export class TargetOperationJournal {
  private entries: Entry[] = []
  private readonly file: string
  constructor(private readonly directory: string) {
    this.file = join(directory, 'target-operations-v1.json')
    if (!existsSync(this.file)) return
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as { schemaVersion?: number; entries?: Entry[] }
      if (data.schemaVersion !== 1 || !Array.isArray(data.entries)) throw new Error('format')
      this.entries = data.entries.map(row => {
        if (typeof row.owner !== 'string' || typeof row.operationKey !== 'string') throw new Error('owner')
        const receipt = operationReceiptSchema.parse(row.receipt)
        // A previous process did not finish the durable lifecycle. Do not turn
        // an interrupted preparation into permission to replay business UI.
        if (receipt.status === 'prepared' || receipt.status === 'submitting') {
          receipt.status = 'needs_review'; receipt.errorCode = 'TARGET_PROCESS_INTERRUPTED'
        }
        return { owner: row.owner, operationKey: row.operationKey, plan: runPlanSchema.parse(row.plan), receipt }
      })
    } catch { throw targetError('TARGET_JOURNAL_INVALID', '本机操作记录损坏，已阻止执行；请保留原文件联系支持') }
  }
  private save(next: Entry[]): void {
    mkdirSync(this.directory, { recursive: true })
    const temp = join(this.directory, `journal-${randomUUID()}.tmp`)
    const fd = openSync(temp, 'wx', 0o600)
    try { writeFileSync(fd, JSON.stringify({ schemaVersion: 1, entries: next })); fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(temp, this.file)
    this.entries = next
  }
  list(owner: string): OperationReceipt[] { return this.entries.filter(e => e.owner === owner).map(e => structuredClone(e.receipt)) }
  private operationKey(plan: RunPlan): string {
    const { courseRef, shopRef, localAccountRef, role } = plan.context
    return targetHash({ context: { courseRef, shopRef, localAccountRef, role }, capability: plan.capability, name: plan.input.name })
  }
  /** Check duplicate/unknown protection without creating a new receipt. */
  assertAvailable(owner: string, plan: RunPlan): void {
    const operationKey = this.operationKey(plan)
    const prior = [...this.entries].reverse().find(e => e.owner === owner && e.operationKey === operationKey)
    if (prior && prior.receipt.status !== 'not_submitted') throw targetError('TARGET_DUPLICATE_OR_UNKNOWN', '同一现场的同名模板已执行或结果待核对，请先核对原记录')
  }
  get(owner: string, id: string): Entry {
    const row = this.entries.find(e => e.owner === owner && e.receipt.id === id)
    if (!row) throw targetError('TARGET_OPERATION_NOT_FOUND', '找不到本账号的操作记录')
    return structuredClone(row)
  }
  begin(owner: string, plan: RunPlan): OperationReceipt {
    // A new profile revision is not a new business object. Never let a config
    // upgrade reset the duplicate/unknown-outcome protection.
    // Aliases and declared stages partition records, not the actual business
    // object. An unresolved write must block even if the user changes a label.
    const operationKey = this.operationKey(plan)
    this.assertAvailable(owner, plan)
    const receipt: OperationReceipt = { id: randomUUID(), planId: plan.id, profileId: plan.context.profileId, profileRevision: plan.context.profileRevision,
      contextHash: plan.contextHash, inputHash: plan.inputHash, adapterVersion: plan.adapterVersion, recipeVersion: plan.recipeVersion,
      stage: plan.context.stage, status: 'prepared', objectRef: null, errorCode: null, checks: [], updatedAt: new Date().toISOString() }
    this.save([...this.entries, { owner, operationKey, plan: structuredClone(plan), receipt }])
    return receipt
  }
  transition(owner: string, id: string, next: Pick<OperationReceipt, 'status'> & Partial<Pick<OperationReceipt, 'objectRef' | 'errorCode' | 'checks'>>): OperationReceipt {
    const entry = this.get(owner, id)
    if (entry.receipt.status === 'verified') throw targetError('TARGET_RECEIPT_FINAL', '已核验成功的记录不可覆盖')
    if (next.status === 'verified' && (!next.objectRef || !next.checks?.length)) throw targetError('TARGET_VERIFY_PROOF_REQUIRED', '缺少同对象回读证据')
    if (next.status === 'not_submitted' && ['submitting', 'needs_review'].includes(entry.receipt.status)) throw targetError('TARGET_RESULT_UNKNOWN', '提交后不能仅凭失败将状态改为未提交')
    const receipt = operationReceiptSchema.parse({ ...entry.receipt, ...next, updatedAt: new Date().toISOString() })
    this.save(this.entries.map(e => e.receipt.id === id && e.owner === owner ? { ...e, receipt } : e))
    return receipt
  }
}
