import { z } from 'zod'

export const SCENARIO_CONTRACT_VERSION = 1 as const
export const SCENARIO_REFRESH_MS = 30_000

/** Exact origin comparison only; never a startsWith(host) check. */
export function scenarioOrigin(raw: string): string {
  // URL parsing strips control characters; reject them before normalization.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0020\\]/u.test(raw)) throw new Error('SCENARIO_URL_INVALID')
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('SCENARIO_URL_INVALID')
  return url.origin
}

const originSchema = z.string().max(300).refine(raw => {
  try { return scenarioOrigin(raw) === raw } catch { return false }
}, '必须使用规范化的完整 origin')
export const scenarioPolicySchema = z.object({
  schemaVersion: z.literal(SCENARIO_CONTRACT_VERSION),
  principal: z.object({ kind: z.enum(['customer', 'staff']), id: z.string().min(1).max(128) }).strict(),
  revision: z.string().min(1).max(128), status: z.enum(['unassigned', 'active', 'blocked']),
  mode: z.enum(['training', 'competition']), entryUrl: z.string().url().nullable(),
  allowedOrigins: z.array(originSchema).max(12), maxScenes: z.number().int().min(1).max(10),
  checkedAt: z.string().datetime(), expiresAt: z.string().datetime().nullable(), refreshAfterSeconds: z.literal(30),
}).strict().superRefine((value, ctx) => {
  if (value.principal.kind === 'customer' && value.maxScenes !== 1) ctx.addIssue({ code: 'custom', message: '客户仅允许一个现场' })
  if (value.status === 'unassigned' && (value.mode !== 'training' || value.principal.kind !== 'customer')) ctx.addIssue({ code: 'custom', message: '旧实训兼容仅限未指派客户' })
  if (value.status === 'active' && (!value.allowedOrigins.length || !value.expiresAt)) ctx.addIssue({ code: 'custom', message: '已启用策略缺少边界' })
})
export type ScenarioPolicy = z.infer<typeof scenarioPolicySchema>

export function scenarioAllows(policy: ScenarioPolicy, raw: string, now = Date.now()): boolean {
  if (policy.status === 'blocked' || (policy.expiresAt && Date.parse(policy.expiresAt) <= now)) return false
  try {
    const origin = scenarioOrigin(raw)
    return policy.status === 'unassigned' || policy.allowedOrigins.includes(origin)
  } catch { return false }
}

export const sceneOpenSchema = z.object({
  accountSlot: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), label: z.string().trim().min(1).max(60),
  entryUrl: z.string().url().max(2048),
}).strict()
export const sceneBoundsSchema = z.object({
  x: z.number().int().min(0).max(20000), y: z.number().int().min(0).max(20000),
  width: z.number().int().min(0).max(20000), height: z.number().int().min(0).max(20000),
}).strict()
export const sceneIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
export const sceneSummarySchema = z.object({
  id: sceneIdSchema, label: z.string(), origin: originSchema,
  status: z.enum(['ready', 'policy_blocked']), selected: z.boolean(),
}).strict()
export interface LocalScenesBridge {
  policy(): Promise<ScenarioPolicy>
  list(): Promise<z.infer<typeof sceneSummarySchema>[]>
  open(input: z.infer<typeof sceneOpenSchema>): Promise<z.infer<typeof sceneSummarySchema>[]>
  select(id: string): Promise<void>
  close(id: string): Promise<void>
  bounds(value: z.infer<typeof sceneBoundsSchema>): Promise<void>
  hide(): Promise<void>
}
