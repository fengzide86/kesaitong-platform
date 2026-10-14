import { AsyncResource } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { targetError } from './contracts.cjs'

/** Main-process memory only. referrerUrl may contain the current platform
 * context; it must never be copied into renderer IPC, receipts or reports. */
export interface NavigationSource { webContentsId: number; referrerUrl: string }
export interface NavigationDestination { origin: string; path: string }
export interface OwnedNavigationTarget<T> {
  webContentsId: number
  value: T
  ready: Promise<void>
  currentUrl(): string
  dispose(): void
}
export interface NavigationHandoff<T> {
  actionId: string; openerWebContentsId: number; targetWebContentsId: number
  origin: string; path: string; target: T
}
export interface PopupObservation { openerWebContentsId: number; referrerUrl: string; url: string }
interface Pending {
  offer(observation: PopupObservation, create: () => OwnedNavigationTarget<unknown>): boolean
  reject(error: Error): void
}
function location(raw: string): NavigationDestination {
  let value: URL
  try { value = new URL(raw) } catch { throw targetError('TARGET_NAVIGATION_INVALID', '导航地址无效。') }
  if (!['https:', 'http:'].includes(value.protocol) || value.username || value.password) throw targetError('TARGET_NAVIGATION_INVALID', '导航地址不在受控 HTTP 范围内。')
  return { origin: value.origin, path: value.pathname }
}
function sameDocument(a: string, b: string): boolean {
  try {
    const left = new URL(a); const right = new URL(b)
    left.hash = ''; right.hash = ''
    return left.href === right.href
  } catch { return false }
}

/** Associates one newly created window with one armed click. It never searches
 * the list of existing windows or chooses a first match. Electron provides no
 * initiating frame ID in setWindowOpenHandler, so a frame-triggered action must
 * first resolve a unique same-origin frame and supply its exact local URL.
 * The observed platform may deliberately omit Referer. In that case an
 * independently checked destination context is mandatory; we do not pretend
 * that Electron provided a native frame ID. */
export class OwnedNavigationScope {
  private pending: Pending | null = null
  constructor(private readonly assertOwned: () => void, private readonly timeoutMs = 15000, private readonly settleMs = 75) {}

  run<T>(source: NavigationSource, expected: NavigationDestination, action: () => Promise<void>, verifyTarget?: (target: T) => Promise<void>): Promise<NavigationHandoff<T>> {
    this.assertOwned()
    if (this.pending) return Promise.reject(targetError('TARGET_NAVIGATION_BUSY', '本次窗口切换尚未结束。'))
    const destination = location(`${expected.origin}${expected.path}`)
    if (destination.origin !== expected.origin || destination.path !== expected.path || !Number.isInteger(source.webContentsId) || source.webContentsId <= 0) {
      return Promise.reject(targetError('TARGET_NAVIGATION_INVALID', '窗口切换上下文不完整。'))
    }
    location(source.referrerUrl)
    const actionId = randomUUID()
    return new Promise((resolve, reject) => {
      let candidate: OwnedNavigationTarget<T> | null = null
      let actionDone = false; let ready = false; let finished = false
      let settle: ReturnType<typeof setTimeout> | undefined
      const timeout = setTimeout(() => fail(targetError('TARGET_NAVIGATION_TIMEOUT', '未取得本次动作关联的新窗口，未选用其他窗口。')), Math.max(10, Math.min(this.timeoutMs, 30000)))
      const cleanup = (): void => { clearTimeout(timeout); if (settle) clearTimeout(settle); if (this.pending === pending) this.pending = null }
      const fail = (error: Error): void => {
        if (finished) return
        finished = true; cleanup()
        try { candidate?.dispose() } catch { /* Keep the original failure. */ }
        reject(error)
      }
      const complete = (): void => {
        if (finished || !candidate || !actionDone || !ready || settle) return
        settle = setTimeout(() => {
          try {
            this.assertOwned()
            const actual = location(candidate!.currentUrl())
            if (actual.origin !== expected.origin || actual.path !== expected.path) throw targetError('TARGET_NAVIGATION_MISMATCH', '新窗口最终页面与本次目标不一致。')
            finished = true; cleanup()
            resolve({ actionId, openerWebContentsId: source.webContentsId, targetWebContentsId: candidate!.webContentsId, ...actual, target: candidate!.value })
          } catch (error) { fail(error instanceof Error ? error : targetError('TARGET_NAVIGATION_FAILED', '窗口切换核验失败。')) }
        }, Math.max(0, Math.min(this.settleMs, 1000)))
      }
      const pending: Pending = {
        reject: fail,
        offer: AsyncResource.bind((observed, create) => {
          if (finished || observed.openerWebContentsId !== source.webContentsId) return false
          try {
            this.assertOwned()
            if (candidate) throw targetError('TARGET_NAVIGATION_AMBIGUOUS', '同一动作产生多个新窗口，未选择第一个。')
            const actual = location(observed.url)
            if ((observed.referrerUrl ? !sameDocument(observed.referrerUrl, source.referrerUrl) : !verifyTarget)
              || actual.origin !== expected.origin || actual.path !== expected.path) {
              throw targetError('TARGET_NAVIGATION_MISMATCH', '新窗口来源或目标与本次动作不一致。')
            }
            candidate = create() as OwnedNavigationTarget<T>
            if (!Number.isInteger(candidate.webContentsId) || candidate.webContentsId <= 0 || candidate.webContentsId === source.webContentsId) throw targetError('TARGET_NAVIGATION_NOT_NEW', '目标不是本次新建的独立窗口。')
            void candidate.ready.then(async () => {
              this.assertOwned()
              await verifyTarget?.(candidate!.value)
              this.assertOwned()
              ready = true; complete()
            }).catch(() => fail(targetError('TARGET_NAVIGATION_CONTEXT_MISMATCH', '关联的新窗口未通过加载及课程、店铺上下文核验。')))
            return true
          } catch (error) { fail(error instanceof Error ? error : targetError('TARGET_NAVIGATION_FAILED', '窗口切换失败。')); return false }
        }),
      }
      this.pending = pending
      // Install the event gate before dispatching the click.
      void Promise.resolve().then(action).then(() => { actionDone = true; complete() }, () => fail(targetError('TARGET_NAVIGATION_ACTION_FAILED', '本次导航动作失败，未接管新窗口。')))
    })
  }

  offer<T>(observation: PopupObservation, create: () => OwnedNavigationTarget<T>): boolean {
    return this.pending?.offer(observation, create) || false
  }
  cancel(): void { this.pending?.reject(targetError('TARGET_NAVIGATION_CANCELLED', '本次窗口切换已取消。')) }
  get active(): boolean { return this.pending !== null }
}
