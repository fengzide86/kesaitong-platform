import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'

// Deliberately whitelist control-plane receipts. Never persist input, page text,
// screenshots, browser credentials or arbitrary Runner result objects here.
const receiptSchema = z.object({
  token: z.string().min(1).max(16384),
  run_id: z.string().min(1).max(200),
  status: z.enum(['succeeded', 'failed']),
  error_code: z.string().max(100).nullable(),
  adapter_version: z.string().max(100).nullable(),
  page_fingerprint: z.string().max(256).nullable(),
  page_changed: z.boolean(),
  completed_steps: z.number().int().min(0).max(10000),
})
const entrySchema = z.object({
  id: z.string(), createdAt: z.number(), blocked: z.boolean().default(false), receipt: receiptSchema,
})
const reservationSchema = z.object({ id: z.string(), createdAt: z.number() })
const stateSchema = z.object({ version: z.literal(1), entries: z.array(entrySchema).max(200), reservations: z.array(reservationSchema).max(200).default([]) }).refine(state => state.entries.length + state.reservations.length <= 200)
type Entry = z.infer<typeof entrySchema>
interface ReportResult { executionId?: number; warning?: string }
interface OutboxOptions {
  directory: string
  apiBase: string
  version: string
  codec: { isEncryptionAvailable(): boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string }
  request?: typeof fetch
  now?: () => number
}

/** A durable, encrypted receipt queue. Retrying it never starts a Runner. */
export class ExecutionReportOutbox {
  private readonly options: OutboxOptions
  private readonly target: string
  private entries: Entry[] | null = null
  private reservations: Array<z.infer<typeof reservationSchema>> = []
  private work: Promise<void> = Promise.resolve()
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(options: OutboxOptions) {
    this.options = options
    const scope = createHash('sha256').update(options.apiBase).digest('hex').slice(0, 24)
    this.target = path.join(options.directory, `execution-receipts-${scope}.bin`)
  }

  start(): void {
    if (this.timer) return
    void this.flush()
    this.timer = setInterval(() => { void this.flush() }, 30000)
    this.timer.unref?.()
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  async drain(): Promise<void> { await this.work }

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.work.then(action)
    this.work = next.then(() => undefined, () => undefined)
    return next
  }

  private load(): Entry[] {
    if (!this.options.codec.isEncryptionAvailable()) throw new Error('本机安全存储不可用，无法保存待同步记录')
    if (this.entries) return this.entries
    // A corrupt/unreadable file must not be overwritten with an empty queue.
    const stored = fs.existsSync(this.target)
      ? stateSchema.parse(JSON.parse(this.options.codec.decryptString(fs.readFileSync(this.target))))
      : { entries: [], reservations: [] }
    this.entries = stored.entries
    this.reservations = stored.reservations
    return this.entries
  }

  private save(entries: Entry[], reservations = this.reservations): void {
    const bytes = this.options.codec.encryptString(JSON.stringify({ version: 1, entries, reservations }))
    fs.mkdirSync(this.options.directory, { recursive: true })
    const temporary = `${this.target}.tmp`
    let descriptor: number | undefined
    try {
      descriptor = fs.openSync(temporary, 'w', 0o600)
      fs.writeFileSync(descriptor, bytes)
      fs.fsyncSync(descriptor)
      fs.closeSync(descriptor); descriptor = undefined
      fs.renameSync(temporary, this.target)
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor)
      try { fs.unlinkSync(temporary) } catch { /* renamed or failed to create */ }
    }
    this.entries = entries
    this.reservations = reservations
  }

  /** Reserve durably before launching, not after the external write. A crashed
   * reservation stays unavailable until reviewed; it is never a made-up receipt. */
  reserve(token: unknown): Promise<string> {
    const validated = receiptSchema.shape.token.parse(token)
    return this.serialize(async () => {
      const entries = this.load()
      const id = createHash('sha256').update(validated).digest('hex')
      if (this.reservations.some(row => row.id === id) || entries.some(row => row.receipt.token === validated)) throw new Error('RECEIPT_ALREADY_RESERVED: 原尝试已有待核对回执，请勿重复执行')
      if (entries.length + this.reservations.length >= 200) throw new Error('待同步记录已满，请先联网同步后再执行新任务；未完成预留需联系支持核对')
      this.save(entries, [...this.reservations, { id, createdAt: (this.options.now || Date.now)() }])
      return id
    })
  }

  releaseReservation(id: string): Promise<void> {
    return this.serialize(async () => { this.save(this.load(), this.reservations.filter(row => row.id !== id)) })
  }

  submit(rawReceipt: unknown, reservationId?: string): Promise<ReportResult> {
    const receipt = receiptSchema.parse(rawReceipt)
    return this.serialize(async () => {
      const entries = this.load()
      const id = createHash('sha256').update(`${receipt.token}\0${receipt.run_id}`).digest('hex')
      let entry = entries.find(item => item.id === id)
      if (!entry) {
        const reserved = reservationId && this.reservations.some(row => row.id === reservationId)
        if (reservationId && (!reserved || createHash('sha256').update(receipt.token).digest('hex') !== reservationId)) throw new Error('RECEIPT_RESERVATION_MISMATCH: 回执不属于本次执行预留')
        if (!reserved && entries.length + this.reservations.length >= 200) throw new Error('待同步记录已满，请先联网同步后再执行新任务')
        entry = { id, receipt, createdAt: (this.options.now || Date.now)(), blocked: false }
        this.save([...entries, entry], this.reservations.filter(row => row.id !== reservationId))
      }
      return this.deliver(entry)
    })
  }

  flush(): Promise<void> {
    return this.serialize(async () => {
      for (const entry of [...this.load()]) {
        if (entry.blocked) continue
        const result = await this.deliver(entry)
        // Stop at a transient network failure; don't queue N timeout requests.
        if (result.warning && !entry.blocked) break
      }
    }).catch(() => { /* Keep the encrypted file intact; next submission reports storage errors. */ })
  }

  private async deliver(entry: Entry): Promise<ReportResult> {
    if (entry.blocked) return { warning: '执行记录暂无法同步，回执已保留，请联系支持；不要重复执行任务' }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    try {
      const response = await (this.options.request || fetch)(`${this.options.apiBase}/api/executions/report`, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Toolbox-Version': this.options.version },
        body: JSON.stringify(entry.receipt),
      })
      const body = await response.json() as { success?: boolean; data?: { execution_id?: number; duplicate?: boolean } }
      // A lost response can leave the server in `reported` while the client
      // retries the exact same receipt.  The server deliberately accepts this
      // idempotent replay; an execution id is useful but is not required to
      // prove that this particular local receipt has already been committed.
      const acceptedDuplicate = response.ok && body.success === true && body.data?.duplicate === true
      if (!response.ok || body.success !== true || (!Number.isInteger(body.data?.execution_id) && !acceptedDuplicate)) {
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) {
          entry.blocked = true
          this.save([...this.load()])
          return { warning: '执行记录暂无法同步，回执已保留，请联系支持；不要重复执行任务' }
        }
        return { warning: '任务结果已保存在本机，联网后自动补传记录；无需重新执行' }
      }
      this.save(this.load().filter(item => item.id !== entry.id))
      const executionId = body.data?.execution_id
      return { ...(Number.isInteger(executionId) ? { executionId } : {}) }
    } catch {
      return { warning: '任务结果已保存在本机，联网后自动补传记录；无需重新执行' }
    } finally {
      clearTimeout(timer)
    }
  }
}
