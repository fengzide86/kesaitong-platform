import { z } from 'zod'
import { authService } from '@/utils/auth'

const key = 'toolbox_support_handoff_v1'
const contextSchema = z.object({
  tool_name: z.string().max(200),
  problem_code: z.string().max(120).nullish(),
  run_status: z.string().max(40).optional(),
  execution_mode: z.string().max(40).optional(),
  result_requires_review: z.boolean().optional(),
  record_pending: z.boolean().optional(),
})
export type SupportContext = z.infer<typeof contextSchema>
const handoffSchema = z.object({ owner: z.string(), created: z.number(), platform: z.string(), draft: z.string().max(2000) })

function owner(): string | null {
  if (authService.getRole() !== 'user' || !authService.getAuth()?.token) return null
  const user = authService.getUser()
  if (!user || (user.id == null && user.user_id == null && user.auth_code_id == null)) return null
  return JSON.stringify([user.id ?? user.user_id, user.auth_code_id, user.device_id])
}

export function prepareSupportDraft(draft: string, platform: string): void {
  sessionStorage.removeItem(key)
  const identity = owner()
  if (identity) sessionStorage.setItem(key, JSON.stringify({ owner: identity, created: Date.now(), platform, draft: draft.slice(0, 2000) }))
}

export function prepareSupportContext(input: SupportContext, platform: string): void {
  const context = contextSchema.parse(input)
  const review = context.result_requires_review === true
    || (context.execution_mode === 'live' && ['failed', 'cancelled', 'interrupted', 'inconclusive'].includes(context.run_status || ''))
  const situation = review ? '本次客户端已停止，当前平台结果待核对'
    : context.record_pending ? '本次执行记录仍待同步'
    : context.execution_mode === 'demo' ? '本次本地演示遇到问题'
    : context.execution_mode === 'preflight' ? '本次只读预检遇到问题' : '本次操作遇到问题'
  prepareSupportDraft(`${context.tool_name}${situation}${context.problem_code ? `，问题编号 ${context.problem_code}` : ''}，请帮我核对处理。`, platform)
}

/** Consume before starting any network request: connection failure cannot leak a later draft. */
export function consumeSupportDraft(platform: string): string {
  const raw = sessionStorage.getItem(key)
  sessionStorage.removeItem(key)
  localStorage.removeItem('toolbox_support_context')
  sessionStorage.removeItem('toolbox_purchase_inquiry')
  if (!raw) return ''
  try {
    const result = handoffSchema.parse(JSON.parse(raw))
    return result.owner === owner() && result.platform === platform && Date.now() - result.created < 10 * 60_000
      ? result.draft : ''
  } catch { return '' }
}
