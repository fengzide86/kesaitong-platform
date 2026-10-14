import type { WebContents } from 'electron'
import { localLoginAccountRef, type LocalLoginEvidence } from './verified-context.cjs'

interface Options {
  isAllowedOrigin(origin: string): boolean; siteEpoch: number
  assertOwned(): void
  onAttempt(): void
  onSuccess(evidence: LocalLoginEvidence): void
  onFailure(code: string): void
}
interface Pending { id: string; origin: string; accountRef: string; loginType: string; status?: number; codeVerified: boolean; startedAt: number }
/** Passive main-owned observer. It neither fills nor reads a password. The
 * username is hashed immediately and only an actual successful response plus
 * the observed course-map navigation can establish login evidence. */
export function observeOwnedLogin(guest: WebContents, options: Options): () => void {
  let pending: Pending | undefined; let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const fail = (code: string): void => { pending = undefined; if (timer) clearTimeout(timer); if (!disposed) options.onFailure(code) }
  const commit = (): void => {
    options.assertOwned()
    if (disposed || !pending?.codeVerified) return
    const url = new URL(guest.getURL())
    if (url.origin !== pending.origin || url.pathname !== '/ECrossAmazonHome/CourseIndexTraining_1') return
    const success: LocalLoginEvidence = { origin: pending.origin, siteEpoch: options.siteEpoch, accountRef: pending.accountRef, loginType: pending.loginType, authenticatedAt: Date.now() }
    pending = undefined; if (timer) clearTimeout(timer)
    options.onSuccess(success)
  }
  const consume = async (method: string, params: Record<string, unknown>): Promise<void> => {
    options.assertOwned()
    if (disposed) return
    const id = String(params.requestId || '')
    if (method === 'Network.requestWillBeSent') {
      const request = params.request as { url?: string; method?: string; postData?: string } | undefined
      if (request?.method !== 'POST' || !request.url) return
      const url = new URL(request.url)
      if (!options.isAllowedOrigin(url.origin) || url.pathname !== '/User/Login') return
      options.onAttempt(); pending = undefined
      if (timer) clearTimeout(timer)
      if (!request.postData || request.postData.length > 32768) return fail('TARGET_LOGIN_REQUEST_INVALID')
      const form = new URLSearchParams(request.postData)
      // Deliberately never access uPass/validateCode/deviceId values.
      const names = form.getAll('uName'); const types = form.getAll('loginType')
      if (names.length !== 1 || types.length !== 1 || !/^\d{1,18}$/.test(names[0]!) || !/^\d{1,18}$/.test(types[0]!)) return fail('TARGET_LOGIN_REQUEST_INVALID')
      pending = { id, origin: url.origin, accountRef: localLoginAccountRef(url.origin, types[0]!, names[0]!), loginType: types[0]!, codeVerified: false, startedAt: Date.now() }
      timer = setTimeout(() => fail('TARGET_LOGIN_EVIDENCE_TIMEOUT'), 30000)
    } else if (pending?.id === id && method === 'Network.responseReceived') {
      pending.status = Number((params.response as { status?: number } | undefined)?.status || 0)
    } else if (pending?.id === id && method === 'Network.loadingFailed') {
      fail('TARGET_LOGIN_RESPONSE_INTERRUPTED')
    } else if (pending?.id === id && method === 'Network.loadingFinished') {
      const attempt = pending
      const response = await guest.debugger.sendCommand('Network.getResponseBody', { requestId: id }) as { body?: string; base64Encoded?: boolean }
      options.assertOwned()
      if (disposed || pending !== attempt) return
      const raw = response.base64Encoded ? Buffer.from(response.body || '', 'base64').toString('utf8') : response.body || ''
      if (raw.length > 1_000_000) return fail('TARGET_LOGIN_RESPONSE_INVALID')
      const body = JSON.parse(raw) as { result?: unknown }
      const result = typeof body.result === 'string' ? JSON.parse(body.result) as { Code?: unknown } : body.result as { Code?: unknown }
      // No Msg/RedirectUrl/Token/modelUser is accessed or retained.
      if (attempt.status !== 200 || result?.Code !== 0) return fail('TARGET_LOGIN_REJECTED')
      attempt.codeVerified = true
      // Choosing among courses is a human step and can legitimately take
      // longer than the network timeout. Keep only the hash until the owned
      // map opens, a new login attempt occurs, or this observer is disposed.
      if (timer) clearTimeout(timer)
      commit()
    }
  }
  const onMessage = (_event: Electron.Event, method: string, params: Record<string, unknown>): void => { void consume(method, params).catch(() => fail('TARGET_LOGIN_RESPONSE_UNAVAILABLE')) }
  const onNavigate = (): void => { try { commit() } catch { fail('TARGET_LOGIN_CONTEXT_CHANGED') } }
  guest.debugger.on('message', onMessage)
  guest.on('did-navigate', onNavigate)
  return () => { disposed = true; pending = undefined; if (timer) clearTimeout(timer); guest.debugger.removeListener('message', onMessage); guest.removeListener('did-navigate', onNavigate) }
}
