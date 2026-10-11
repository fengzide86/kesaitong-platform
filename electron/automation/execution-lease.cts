/** Process-wide execution ownership. Waiting-user sessions keep their browsers,
 * but must reacquire this permit before the Runner can act again. */
export interface ExecutionPermit { assert(): void; release(): void }

export class ExecutionLease {
  private current: symbol | null = null
  private closed = false
  private listeners = new Set<() => void>()
  constructor(private readonly changed: () => void = () => {}) {}
  get busy(): boolean { return this.current !== null }
  acquire(): ExecutionPermit {
    if (this.closed) throw new Error('EXECUTION_CLOSED: 执行服务正在关闭，请重新打开软件。')
    if (this.current) throw Object.assign(new Error('已有任务正在准备或执行，请等待结束后重试。'), { code: 'RUN_ALREADY_ACTIVE' })
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
        queueMicrotask(() => { if (!this.closed && !this.current) for (const listener of this.listeners) listener() })
      },
    }
  }
  onAvailable(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  invalidate(): void { this.current = null; this.changed() }
  close(): void { this.closed = true; this.invalidate(); this.listeners.clear() }
}
