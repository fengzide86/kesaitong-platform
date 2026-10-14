/** Process-wide execution ownership. Waiting-user sessions keep their browsers,
 * but must reacquire this permit before the Runner can act again. */
export interface ExecutionPermit { assert(): void; release(): void }

export class ExecutionLease {
  private current: symbol | null = null
  private draining = new Set<symbol>()
  private closed = false
  private listeners = new Set<() => void>()
  constructor(private readonly changed: () => void = () => {}) {}
  get busy(): boolean { return this.current !== null || this.draining.size > 0 }
  acquire(): ExecutionPermit {
    if (this.closed) throw new Error('EXECUTION_CLOSED: 执行服务正在关闭，请重新打开软件。')
    if (this.busy) throw Object.assign(new Error('已有任务正在准备、执行或退出，请等待结束后重试。'), { code: 'RUN_ALREADY_ACTIVE' })
    const token = Symbol('execution')
    this.current = token
    this.changed()
    return {
      assert: () => {
        if (this.closed || this.current !== token) throw new Error('EXECUTION_REVOKED: 原执行许可已失效，已禁止继续操作。')
      },
      release: () => {
        if (this.current !== token) return
        this.current = null
        this.changed()
        this.notifyAvailable()
      },
    }
  }
  /** Revoking ownership must not let another Runner overlap an unfinished host
   * action. This fence survives invalidate(); only a proven drain releases it. */
  fenceUntil(drain: Promise<void>): void {
    const fence = Symbol('host-drain')
    this.draining.add(fence)
    this.changed()
    void drain.then(() => {
      this.draining.delete(fence)
      this.changed()
      this.notifyAvailable()
    }, () => { /* An unproven drain remains fail-closed. */ })
  }
  private notifyAvailable(): void {
    queueMicrotask(() => { if (!this.closed && !this.busy) for (const listener of this.listeners) listener() })
  }
  onAvailable(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  invalidate(): void { this.current = null; this.changed() }
  close(): void { this.closed = true; this.invalidate(); this.listeners.clear() }
}
