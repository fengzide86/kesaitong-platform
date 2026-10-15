import { scenarioAllows, scenarioPolicySchema, SCENARIO_REFRESH_MS, type ScenarioPolicy } from '../../src/shared/ipc/scenario-contract.js'

/** Authenticated main-process policy cache. Network errors never lift a rule. */
export class ScenarioPolicyClient {
  private policy: ScenarioPolicy | null = null
  private token: string | null = null
  private verifiedAt = 0
  private generation = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private inFlight: Promise<ScenarioPolicy> | null = null
  constructor(private readonly load: (token: string) => Promise<unknown>, private readonly onInvalidated: () => void) {}

  current(): ScenarioPolicy {
    if (!this.policy || Date.now() - this.verifiedAt >= SCENARIO_REFRESH_MS + 5_000) throw new Error('SCENARIO_POLICY_STALE: 场景策略需要重新验证')
    if (this.policy.status === 'blocked' || (this.policy.expiresAt && Date.parse(this.policy.expiresAt) <= Date.now())) throw new Error('SCENARIO_POLICY_BLOCKED: 当前场景已停用或到期')
    return this.policy
  }

  allows(raw: string): boolean {
    try { return scenarioAllows(this.current(), raw) } catch { return false }
  }

  assertAllowed(raw: string): void {
    if (!this.allows(raw)) throw new Error('SCENARIO_ROUTE_BLOCKED: 当前网站不在有效场景范围内')
  }

  async refresh(token: string): Promise<ScenarioPolicy> {
    if (this.token !== token) {
      this.reset()
      this.token = token
    }
    if (this.inFlight) return this.inFlight
    const generation = this.generation
    const pending = this.load(token).then(raw => {
      if (generation !== this.generation || this.token !== token) throw new Error('SCENARIO_SESSION_CHANGED')
      const next = scenarioPolicySchema.parse(raw)
      const changed = this.policy && (next.revision !== this.policy.revision || next.principal.id !== this.policy.principal.id || next.principal.kind !== this.policy.principal.kind)
      this.policy = next
      this.verifiedAt = Date.now()
      if (changed || next.status === 'blocked') this.onInvalidated()
      if (!this.timer) {
        this.timer = setInterval(() => { void this.refresh(token).catch(() => undefined) }, SCENARIO_REFRESH_MS)
        this.timer.unref?.()
      }
      return this.current()
    }).catch(error => {
      if (generation === this.generation) {
        this.verifiedAt = 0
        this.onInvalidated()
      }
      throw error
    }).finally(() => { if (this.inFlight === pending) this.inFlight = null })
    this.inFlight = pending
    return pending
  }

  reset(): void {
    this.generation += 1
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.policy = null
    this.verifiedAt = 0
    this.token = null
    this.inFlight = null
  }
}
