import { generateCacheKey, getCache, setCache } from '../cache'
import { authService } from '../auth'
import { toolboxVersionHeaders } from '@/shared/api/client-metadata'
import { getApiBase } from '@/shared/api/base'
import {
  recordConnectionFailure,
  recordConnectionSuccess,
} from '@/features/connectivity/state'

const CACHE_ENABLED = true
const CACHE_TTL = 5 * 60 * 1000
const CACHE_PATTERNS = [
  /\/api\/plans$/,
  /\/api\/tools$/,
  /\/api\/tools\/categories$/,
  /\/api\/settings$/,
  /\/api\/logs\/tools/,
]
const DEFAULT_TIMEOUT_MS = 12_000

export type ApiQueryValue = string | number | boolean | null | undefined
export type ApiQueryParams = Record<string, ApiQueryValue>
export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'business' | 'validation' | 'parse' | 'cancelled'
export type ApiRetryPolicy = 'none' | 'safe-read' | 'background'
type ApiBody = unknown
type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export interface ApiRequestOptions extends Omit<RequestInit, 'body' | 'headers'> {
  body?: ApiBody
  headers?: HeadersInit
  timeoutMs?: number
  retry?: ApiRetryPolicy
  trackConnection?: boolean
}

export interface ApiGetOptions extends Pick<ApiRequestOptions, 'signal' | 'timeoutMs' | 'retry' | 'trackConnection'> {
  cache?: boolean
  responseMode?: 'data' | 'raw'
}

export class ApiError extends Error {
  readonly status: number
  readonly data: unknown
  readonly kind: ApiErrorKind
  readonly errorCode: number | string | null
  readonly requestId: string | null
  readonly retryable: boolean

  constructor(
    message: string,
    options: {
      status?: number
      data?: unknown
      kind?: ApiErrorKind
      errorCode?: number | string | null
      requestId?: string | null
      retryable?: boolean
    } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = options.status ?? 0
    this.data = options.data ?? null
    this.kind = options.kind ?? 'http'
    this.errorCode = options.errorCode ?? null
    this.requestId = options.requestId ?? null
    this.retryable = options.retryable ?? false
  }
}

export const API_BASE = getApiBase()
const pendingRequests = new Map<string, Promise<JsonValue>>()
const activeControllers = new Set<AbortController>()
const delay = (milliseconds: number): Promise<void> => new Promise(resolve => setTimeout(resolve, milliseconds))

function shouldCache(url: string): boolean {
  return CACHE_ENABLED && CACHE_PATTERNS.some(pattern => pattern.test(url))
}

function getAuthToken(): string | null {
  try {
    return authService.getAuth()?.token
      || sessionStorage.getItem('toolbox_token')
      || localStorage.getItem('toolbox_token')
  } catch {
    return null
  }
}

function tokenFingerprint(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function cacheIdentityScope(): string {
  const role = authService.getRole()
  const user = authService.getUser()
  const owner = user?.id ?? user?.auth_code_id ?? user?.username
  if (owner !== undefined) return `${role}:${String(owner)}`
  const token = getAuthToken()
  return `${role}:${token ? tokenFingerprint(token) : 'anonymous'}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

function unwrapData(value: unknown): unknown {
  const record = asRecord(value)
  return record && record.data !== undefined ? record.data : value
}

function errorMessage(value: unknown, fallback: string): string {
  const record = asRecord(value)
  if (typeof record?.detail === 'string') return record.detail
  if (typeof record?.message === 'string') return record.message
  return fallback
}

function errorCodeFrom(value: unknown): number | string | null {
  const errorCode = asRecord(value)?.error_code
  return typeof errorCode === 'number' || typeof errorCode === 'string' ? errorCode : null
}

function createRequestInit(options: ApiRequestOptions, token: string | null): RequestInit {
  const {
    body: requestBody,
    headers: requestHeaders,
    timeoutMs: _timeoutMs,
    retry: _retry,
    trackConnection: _trackConnection,
    signal: _signal,
    ...fetchOptions
  } = options
  const headers: Record<string, string> = toolboxVersionHeaders({ 'Content-Type': 'application/json' })
  if (token) headers.Authorization = `Bearer ${token}`
  if (requestHeaders) {
    new Headers(requestHeaders).forEach((value, key) => {
      const existing = Object.keys(headers).find(header => header.toLowerCase() === key.toLowerCase())
      if (existing) delete headers[existing]
      headers[key] = value
    })
  }

  let body: BodyInit | undefined
  if (requestBody !== undefined && requestBody !== null) {
    if (requestBody instanceof FormData) {
      body = requestBody
      delete headers['Content-Type']
    } else {
      body = JSON.stringify(requestBody)
    }
  }
  return { ...fetchOptions, headers, body }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}

function classifyFetchError(error: unknown, timedOut: boolean, externallyCancelled: boolean): ApiError {
  if (error instanceof ApiError) return error
  if (externallyCancelled || (isAbortError(error) && !timedOut)) {
    return new ApiError('请求已取消', { kind: 'cancelled' })
  }
  if (timedOut) return new ApiError('请求超时', { kind: 'timeout', retryable: true })
  return new ApiError('网络连接失败', { kind: 'network', retryable: true })
}

function maxAttempts(policy: ApiRetryPolicy): number {
  if (policy === 'background') return 3
  if (policy === 'safe-read') return 2
  return 1
}

function retryDelay(attempt: number, policy: ApiRetryPolicy): number {
  const base = policy === 'background' ? 1_000 : 450
  return base * (attempt + 1) + Math.floor(Math.random() * 250)
}

function shouldRetry(error: ApiError): boolean {
  return error.retryable
    && (error.kind === 'network' || error.kind === 'timeout' || error.status >= 500)
}

export function cancelPendingApiRequests(): void {
  for (const controller of activeControllers) controller.abort()
  activeControllers.clear()
  pendingRequests.clear()
}

if (typeof window !== 'undefined') {
  window.addEventListener('toolbox:auth-cleared', cancelPendingApiRequests)
}

export async function request<T = JsonValue>(url: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase()
  const isIdempotent = method === 'GET' || method === 'HEAD'
  const token = getAuthToken()
  const retryPolicy = options.retry ?? (isIdempotent ? 'safe-read' : 'none')
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const trackConnection = options.trackConnection !== false
  const key = `${method}:${url}:${token || 'anonymous'}`
  const existing = isIdempotent ? pendingRequests.get(key) : undefined
  if (existing) return existing as Promise<T>

  const config = createRequestInit(options, token)
  const fetchPromise = (async (): Promise<JsonValue> => {
    let lastError = new ApiError('请求失败', { kind: 'network', retryable: true })
    const attempts = maxAttempts(retryPolicy)
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController()
      activeControllers.add(controller)
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      let timedOut = false
      let removeExternalAbort: (() => void) | undefined
      try {
        if (options.signal) {
          const abortFromCaller = () => controller.abort()
          if (options.signal.aborted) abortFromCaller()
          else {
            options.signal.addEventListener('abort', abortFromCaller, { once: true })
            removeExternalAbort = () => options.signal?.removeEventListener('abort', abortFromCaller)
          }
        }
        timeoutId = setTimeout(() => {
          timedOut = true
          controller.abort()
        }, timeoutMs)
        const response = await fetch(`${getApiBase()}${url}`, { ...config, signal: controller.signal })
        if (trackConnection) recordConnectionSuccess()
        const requestId = response.headers?.get?.('X-Request-ID') || null

        let data: JsonValue
        try {
          data = await response.json()
        } catch {
          if (!response.ok) {
            throw new ApiError(`请求失败: ${response.status}`, {
              status: response.status,
              kind: 'http',
              requestId,
              retryable: response.status >= 500,
            })
          }
          throw new ApiError('服务响应格式异常', {
            status: response.status,
            kind: 'parse',
            requestId,
          })
        }

        if (!response.ok) {
          const errorCode = errorCodeFrom(data)
          const authInvalidCodes = new Set([2000, 2001, 2002, 3000, 3001, 3002])
          const shouldClearAuth = response.status === 401
            || (response.status === 403 && typeof errorCode === 'number' && authInvalidCodes.has(errorCode))
          if (shouldClearAuth && authService.getAuth()) {
            const role = authService.getRole()
            authService.clear()
            if (typeof window !== 'undefined' && !window.location.hash.includes('/login')) {
              window.location.hash = role !== 'user' ? '#/admin/login' : '#/user/login'
            }
          }
          throw new ApiError(errorMessage(data, `请求失败: ${response.status}`), {
            status: response.status,
            data,
            kind: response.status >= 500 ? 'http' : errorCode !== null ? 'business' : 'http',
            errorCode,
            requestId,
            retryable: response.status >= 500,
          })
        }
        return data
      } catch (error) {
        lastError = classifyFetchError(error, timedOut, options.signal?.aborted === true)
        if (!shouldRetry(lastError) || attempt >= attempts - 1) break
        await delay(retryDelay(attempt, retryPolicy))
      } finally {
        if (timeoutId) clearTimeout(timeoutId)
        removeExternalAbort?.()
        activeControllers.delete(controller)
      }
    }
    if (trackConnection && (lastError.kind === 'network' || lastError.kind === 'timeout')) {
      recordConnectionFailure()
    }
    throw lastError
  })()

  if (isIdempotent) {
    pendingRequests.set(key, fetchPromise)
    const cleanup = (): void => { pendingRequests.delete(key) }
    void fetchPromise.then(cleanup, cleanup)
  }
  return fetchPromise as Promise<T>
}

export function clearApiCache(url: string): void {
  Object.keys(localStorage).forEach(key => {
    if (key.startsWith('toolbox_cache_') && key.includes(url)) localStorage.removeItem(key)
  })
}

function invalidationPrefix(url: string): string {
  return url.split('/').slice(0, 3).join('/')
}

export const api = {
  async get<T = JsonValue>(url: string, params: ApiQueryParams = {}, options: ApiGetOptions = {}): Promise<T> {
    const entries = Object.entries(params)
      .filter((entry): entry is [string, Exclude<ApiQueryValue, null | undefined>] => entry[1] !== null && entry[1] !== undefined)
      .map(([key, value]) => [key, String(value)] as [string, string])
    const queryString = new URLSearchParams(entries).toString()
    const fullUrl = queryString ? `${url}?${queryString}` : url
    const requestOptions: ApiRequestOptions = {
      method: 'GET',
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      retry: options.retry,
      trackConnection: options.trackConnection,
    }

    if (options.cache !== false && shouldCache(url)) {
      const cacheKey = generateCacheKey(`${cacheIdentityScope()}:${options.responseMode ?? 'data'}:${fullUrl}`)
      const cached = getCache<T>(cacheKey)
      if (cached !== null) return cached
      const raw = await request(fullUrl, requestOptions)
      const result = (options.responseMode === 'raw' ? raw : unwrapData(raw)) as T
      setCache(cacheKey, result, CACHE_TTL)
      return result
    }
    const raw = await request(fullUrl, requestOptions)
    return (options.responseMode === 'raw' ? raw : unwrapData(raw)) as T
  },

  async post<T = JsonValue>(url: string, data: ApiBody = {}, options: Omit<ApiRequestOptions, 'method' | 'body'> = {}): Promise<T> {
    const result = await request<T>(url, { ...options, method: 'POST', body: data })
    clearApiCache(invalidationPrefix(url))
    return result
  },

  async put<T = JsonValue>(url: string, data: ApiBody = {}, options: Omit<ApiRequestOptions, 'method' | 'body'> = {}): Promise<T> {
    const result = await request<T>(url, { ...options, method: 'PUT', body: data })
    clearApiCache(invalidationPrefix(url))
    return result
  },

  async patch<T = JsonValue>(url: string, data: ApiBody = {}, options: Omit<ApiRequestOptions, 'method' | 'body'> = {}): Promise<T> {
    const result = await request(url, { ...options, method: 'PATCH', body: data })
    clearApiCache(invalidationPrefix(url))
    return unwrapData(result) as T
  },

  async delete<T = JsonValue>(url: string, options: Omit<ApiRequestOptions, 'method' | 'body'> = {}): Promise<T> {
    const result = await request<T>(url, { ...options, method: 'DELETE' })
    clearApiCache(invalidationPrefix(url))
    return result
  },
}

export { verifyAuthCode, adminLogin, checkAuthStatus, getCurrentUser } from './auth'
export { getAuthCodes, getAuthCodesPage, getAuthCode, batchGenerateAuthCodes, updateAuthCode, deleteAuthCode } from './auth-codes'
export { getPlans, getPlansAdmin, createPlan, updatePlan, enablePlan, disablePlan, archivePlan } from './plans'
export { getOrders, getOrder, getOrdersPage, exportOrders, createOrder, updateOrder, markOrderPaid, cancelOrder, refundOrder } from './orders'
export { getUsers, getUser, getUsersPage, updateUser } from './users'
export { getDevices, getMyDevices, unbindDevice, userUnbindDevice } from './devices'
export { getKnowledgeList, getKnowledgeCategories, getKnowledgeStats, getKnowledge, createKnowledge, updateKnowledge, deleteKnowledge, batchImportKnowledge, syncKnowledgeVector, testKnowledgeRetrieval } from './knowledge'
export { createChatSession, getChatSession, sendChatMessage, resolveChatSession, transferChatToHuman, rateChatSession, getChatHistory, getAIChatConfig, updateAIChatConfig, getAdminChatSessions, getAdminChatSession, getAIChatStats, debugAIChat } from './ai-chat'
export { getAnnouncements, getAnnouncementFeed, markAnnouncementRead, dismissAnnouncement, createAnnouncement, updateAnnouncement, deleteAnnouncement } from './announcements'
export { getTools, getToolCategories, updateTools, updateToolCategories, createToolLaunchGrant } from './tools'
export { getToolReleases, createToolRelease, publishToolRelease, rollbackToolRelease } from './tool-releases'
export { getFreightRateReleases, createFreightRateDraft, publishFreightRatePack, rollbackFreightRatePack, getCurrentFreightRatePack } from './freight-rates'
export { getFeedbacks, getFeedback, getFeedbacksPage, getMyFeedbacks, createFeedback, updateFeedback } from './feedback'
export { getLogs, exportLogs, getLogTools, createLog } from './logs'
export { createDemoRun, updateDemoRun, finishDemoRun, cancelDemoRun, getDemoRun, getDemoRuns, getDemoRunsPage, createDemoBatch, updateDemoBatch, updateDemoBatchItem, finishDemoBatch, getDemoBatches, getDemoBatchesPage, getDemoBatch } from './demo'
export { getExecutions, getExecutionsPage, getExecution } from './executions'
export { getStaffAccounts, createStaffAccount, updateStaffAccount, resetStaffPassword, changeStaffPassword, logoutStaff } from './staff'
export { getDashboard, getDashboardCharts, getProfit, getProfitPage, getProfitSummary, getProfitPolicy, updateProfitPolicy } from './dashboard'
export { getBusinessBootstrap, getBusinessTools, getBusinessBatches, getBusinessBatch, createBusinessBatch, updateBusinessBatch, updateBusinessBatchItem, finishBusinessBatch, getAdminActionCenter, getAdminBusinessBatch } from './business'
export { getSettings, getPublicSettings, updateSetting } from './settings'
export {
  getExpenseSummary, getExpenseCategories, createExpenseCategory, updateExpenseCategory,
  getExpenses, getExpense, createExpense, updateExpense, voidExpense, exportExpenses,
  uploadExpenseAttachment, downloadExpenseAttachment, deleteExpenseAttachment,
  getExpenseRenewals, getExpenseRenewal, createExpenseRenewal, updateExpenseRenewal,
  confirmExpenseRenewal, skipExpenseRenewal, pauseExpenseRenewal, resumeExpenseRenewal, endExpenseRenewal,
} from './expenses'
