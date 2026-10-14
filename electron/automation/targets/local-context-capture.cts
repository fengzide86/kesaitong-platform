import { AsyncResource } from 'node:async_hooks'
import type { WebContents } from 'electron'
import { targetError } from './contracts.cjs'

export const LOCAL_CONTEXT_PATHS = {
  map: '/ECrossAmazonHome/GetPage',
  identity: '/ECrossCommon/GetPersonalProfileInformation',
} as const
export type LocalContextKind = keyof typeof LOCAL_CONTEXT_PATHS
/** Main-process transient evidence. Never include this value in IPC/receipts. */
export interface LocalContextExchange {
  origin: string
  path: typeof LOCAL_CONTEXT_PATHS[LocalContextKind]
  httpStatus: number
  code: number
  request: { courseId?: string; userId?: string; loginType?: string }
  record: { A1001?: string; B3001?: string; B3101?: string; A0902?: string; LoginName?: string; StudentNo?: string }
}
const parse = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) as unknown } catch { return undefined }
}
const numeric = (value: unknown): string | undefined => {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value
  return typeof text === 'string' && /^\d{1,18}$/.test(text) ? text : undefined
}
export function parseLocalContext(kind: LocalContextKind, origin: string, httpStatus: number, postData: unknown, raw: unknown): LocalContextExchange {
  const source = parse(raw)
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw targetError('TARGET_IDENTITY_RESPONSE_INVALID', '平台上下文响应结构无效。')
  const body = source as Record<string, unknown>; const result = parse(body.result)
  const code = result && typeof result === 'object' ? (result as Record<string, unknown>).Code : undefined
  if (typeof code !== 'number' || !Number.isInteger(code)) throw targetError('TARGET_IDENTITY_RESPONSE_INVALID', '平台上下文结果缺少业务状态。')
  const output: LocalContextExchange = { origin, path: LOCAL_CONTEXT_PATHS[kind], httpStatus, code, request: {}, record: {} }
  if (typeof postData !== 'string' || postData.length > 32768) throw targetError('TARGET_IDENTITY_RESPONSE_INVALID', '平台上下文请求字段无效。')
  const form = new URLSearchParams(postData)
  for (const key of kind === 'map' ? ['courseId'] as const : ['userId', 'loginType'] as const) {
    const values = form.getAll(key); const value = values.length === 1 ? numeric(values[0]) : undefined
    if (value) output.request[key] = value
  }
  if (code !== 0) return output
  const rows = parse(body.jsonStr)
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') throw targetError('TARGET_IDENTITY_RESPONSE_INVALID', '上下文必须对应唯一账号或课程。')
  const row = rows[0] as Record<string, unknown>
  if (kind === 'map') for (const key of ['A1001', 'B3001', 'B3101', 'A0902'] as const) {
    const value = numeric(row[key]); if (value) output.record[key] = value
  }
  else for (const key of ['LoginName', 'StudentNo'] as const) {
    // The observed account is a student number. No name/contact/ID/photo is read.
    const value = numeric(row[key]); if (value) output.record[key] = value
  }
  return output
}

/** Observe an existing page's real UI request. This function never calls the
 * platform API or reads authentication material. Debugger ownership is held by
 * the containing browser port; this observer never attaches/detaches it. */
export async function captureLocalContext(guest: WebContents, kind: LocalContextKind, origin: string, assertOwned: () => void, action: () => Promise<void>, timeoutMs = 15000, signal?: AbortSignal): Promise<LocalContextExchange> {
  assertOwned()
  let request: { id: string; postData: unknown; httpStatus: number } | undefined
  let done = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let rejectResult!: (error: unknown) => void
  let listener!: (_event: Electron.Event, method: string, params: Record<string, unknown>) => void
  const result = new Promise<LocalContextExchange>((resolve, reject) => {
    rejectResult = reject
    timer = setTimeout(() => reject(targetError('TARGET_IDENTITY_TIMEOUT', '未取得本次页面动作的课程或身份响应。')), Math.max(100, Math.min(timeoutMs, 30000)))
    const consume = AsyncResource.bind(async (_event: Electron.Event, method: string, params: Record<string, unknown>) => {
      assertOwned()
      if (done) return
      const id = String(params.requestId || '')
      if (method === 'Network.requestWillBeSent') {
        const data = params.request as { method?: string; url?: string; postData?: unknown } | undefined
        if (data?.method !== 'POST' || !data.url) return
        const url = new URL(data.url)
        if (url.origin !== origin || url.pathname !== LOCAL_CONTEXT_PATHS[kind]) return
        if (request) throw targetError('TARGET_IDENTITY_AMBIGUOUS', '同一次上下文动作出现多个匹配请求。')
        request = { id, postData: data.postData, httpStatus: 0 }
      } else if (request?.id === id && method === 'Network.responseReceived') {
        request.httpStatus = Number((params.response as { status?: number } | undefined)?.status || 0)
      } else if (request?.id === id && method === 'Network.loadingFailed') {
        throw targetError('TARGET_IDENTITY_INTERRUPTED', '平台身份或课程读取中断。')
      } else if (request?.id === id && method === 'Network.loadingFinished') {
        const body = await guest.debugger.sendCommand('Network.getResponseBody', { requestId: id }) as { body?: string; base64Encoded?: boolean }
        assertOwned()
        if (done) return
        const raw = body.base64Encoded ? Buffer.from(body.body || '', 'base64').toString('utf8') : body.body || ''
        if (raw.length > 1_000_000) throw targetError('TARGET_IDENTITY_RESPONSE_INVALID', '平台上下文响应超出读取范围。')
        resolve(parseLocalContext(kind, origin, request.httpStatus, request.postData, raw))
      }
    })
    listener = (event, method, parameters) => { void consume(event, method, parameters).catch(reject) }
  })
  // Electron's native emitter is not guaranteed to preserve AsyncLocalStorage.
  void result.catch(() => undefined)
  const abort = () => rejectResult(targetError('TARGET_SESSION_CLOSED', '平台上下文读取会话已释放。'))
  signal?.addEventListener('abort', abort, { once: true })
  guest.debugger.on('message', listener)
  try {
    if (signal?.aborted) throw targetError('TARGET_SESSION_CLOSED', '平台上下文读取会话已释放。')
    await action(); return await result
  } catch (error) { rejectResult(error); throw error } finally {
    done = true; if (timer) clearTimeout(timer); guest.debugger.removeListener('message', listener); signal?.removeEventListener('abort', abort)
  }
}
