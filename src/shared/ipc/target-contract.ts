import { z } from 'zod'

export const TARGET_RUNNER_API_VERSION = 2 as const
export const TARGET_TEMPLATE_CAPABILITY = 'template.create.v1' as const
export const TARGET_ADAPTER_VERSION = 'bjysoft-v2-template.1' as const
export const TARGET_PROFILE_LIMITS = { name: 100, entryUrl: 2048, routeOrigin: 300, routePathPrefix: 300, rawOpenUrl: 8192 } as const
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
export const targetEditionSchema = z.enum(['v2', 'v3', 'unknown'])
export const targetRouteSchema = z.object({
  origin: z.string().url().min(8).max(TARGET_PROFILE_LIMITS.routeOrigin), pathPrefix: z.string().startsWith('/').max(TARGET_PROFILE_LIMITS.routePathPrefix),
  role: z.enum(['entry', 'login', 'business']),
}).strict()
export const targetEvidenceSchema = z.object({
  edition: targetEditionSchema, pageFingerprint: hash.nullable(),
  markers: z.array(z.enum(['amazon-v2', 'amazon-v3', 'seller-shipping-template', 'course-index'])).max(4),
  source: z.enum(['client-observed', 'admin-verified']),
  pageFingerprints: z.object({ courseMap: hash.nullable().optional(), templateList: hash.nullable().optional(), templateEditor: hash.nullable().optional() }).strict().nullable().optional(),
}).strict()
export const targetExecutionScopeSchema = z.object({
  scenario: z.literal('training'), stage: z.literal('not_applicable'), courseRef: hash,
  source: z.literal('admin-verified'), evidenceRef: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/),
}).strict()
export const targetProfileSchema = z.object({
  schemaVersion: z.literal(1), id, revision: z.number().int().positive(), name: z.string().min(1).max(TARGET_PROFILE_LIMITS.name),
  providerId: z.literal('bjysoft'), productKey: z.literal('amazon'), edition: targetEditionSchema,
  entryUrl: z.string().url().max(TARGET_PROFILE_LIMITS.entryUrl), allowedRoutes: z.array(targetRouteSchema).max(24),
  reviewStatus: z.enum(['pending', 'approved', 'rejected', 'disabled']),
  capabilities: z.array(z.literal(TARGET_TEMPLATE_CAPABILITY)).max(1),
  adapterVersion: z.string().max(128).nullable(), evidence: targetEvidenceSchema,
  executionScopes: z.array(targetExecutionScopeSchema).max(32).optional(),
}).passthrough()
export type TargetProfile = z.infer<typeof targetProfileSchema>
export type TargetRoute = z.infer<typeof targetRouteSchema>
export const signedTargetProfileSchema = z.object({
  profile: targetProfileSchema, signature: z.string().max(1024).nullable(), signingKeyId: z.string().max(128).nullable(),
}).strict()
export type SignedTargetProfile = z.infer<typeof signedTargetProfileSchema>

export const probeObservationSchema = z.object({
  kind: z.enum(['matched', 'ambiguous', 'unknown', 'login_required']),
  platformFamily: z.literal('bjy-amazon').nullable(), version: z.enum(['v2', 'v3']).nullable(),
  origin: z.string().max(2048), path: z.string().max(512), pageFingerprint: hash,
  courseRef: hash.nullable(), shopRef: hash.nullable(), role: z.string().max(64).nullable(),
  localAccountRef: hash.nullable(), evidence: z.array(z.string().max(100)).max(24),
  missing: z.array(z.string().max(160)).max(24),
}).strict()
export type ProbeObservation = z.infer<typeof probeObservationSchema>
const money = z.string().regex(/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/)
const hasForbiddenTemplateNameCharacter = (value: string): boolean => Array.from(value).some((character) => {
  const code = character.charCodeAt(0)
  return (code >= 0 && code <= 0x1f) || code === 0x7f || code === 0x2028 || code === 0x2029
})
export const templateCreateInputSchema = z.object({
  name: z.string().refine((value) => !hasForbiddenTemplateNameCharacter(value), '模板名称不能包含换行、制表或控制字符').trim().min(1).max(100), currency: z.literal('USD'), pricingMode: z.literal('weight-item'),
  rules: z.array(z.object({
    countries: z.array(z.string().trim().min(1).max(80)).min(1).max(100),
    serviceCode: z.enum(['10001', '10002', '10003', '10004', '20001', '20002']),
    transitTime: z.string().trim().min(1).max(80), perOrder: money, unitRate: money, unit: z.enum(['item', 'lb']),
  }).strict()).min(1).max(12),
}).strict()
export type TemplateCreateInput = z.infer<typeof templateCreateInputSchema>
export const operationContextSchema = z.object({
  profileId: id, profileRevision: z.number().int().positive(), edition: z.literal('v2'),
  scenario: z.enum(['training', 'competition']), stage: z.enum(['not_applicable', 'practice', 'formal']),
  courseRef: hash, shopRef: hash, localAccountRef: hash, role: z.string().min(1).max(64),
}).strict().superRefine((v, ctx) => {
  if ((v.scenario === 'training') !== (v.stage === 'not_applicable')) ctx.addIssue({ code: 'custom', message: '实训与比赛阶段不匹配' })
})
export type OperationContext = z.infer<typeof operationContextSchema>
export const targetPreflightRequestSchema = z.object({
  profileId: id, profileRevision: z.number().int().positive(), toolId: z.union([id, z.number().int().positive()]),
  scenario: z.enum(['training', 'competition']), stage: z.enum(['not_applicable', 'practice', 'formal']),
  input: templateCreateInputSchema,
}).strict()
export type TargetPreflightRequest = z.infer<typeof targetPreflightRequestSchema>
// Declarative data only. Capability implementations stay in signed client code.
// The first release intentionally supports one reviewed workflow shape.
export const recipeSchema = z.object({
  schemaVersion: z.literal(1), id: z.literal('template.create'), version: z.literal('1.0.0'),
  platformKey: z.literal('amazon'), supportedEditions: z.tuple([z.literal('v2')]),
  requiredCapability: z.literal(TARGET_TEMPLATE_CAPABILITY), adapterVersion: z.literal(TARGET_ADAPTER_VERSION),
  input: templateCreateInputSchema,
  steps: z.tuple([z.literal('read.context'), z.literal('read.templates'), z.literal('assert.unique'), z.literal('persist.intent'), z.literal('write.template'), z.literal('verify.same-object'), z.literal('persist.receipt')]),
}).strict()
export type Recipe = z.infer<typeof recipeSchema>
export const runPlanSchema = z.object({
  id, schemaVersion: z.literal(1), context: operationContextSchema, contextHash: hash, inputHash: hash,
  adapterVersion: z.literal(TARGET_ADAPTER_VERSION), recipeId: z.literal('template.create'), recipeVersion: z.literal('1.0.0'),
  rulePackVersion: z.literal('user-template-1'), capability: z.literal(TARGET_TEMPLATE_CAPABILITY),
  input: templateCreateInputSchema, createdAt: z.string().datetime(), expiresAt: z.string().datetime(),
}).strict()
export type RunPlan = z.infer<typeof runPlanSchema>
export const runPlanPreviewSchema = z.object({
  plan: runPlanSchema, canExecute: z.boolean(), blockers: z.array(z.string().max(300)), steps: z.array(z.string().max(100)),
}).strict()
export type RunPlanPreview = z.infer<typeof runPlanPreviewSchema>
export const operationReceiptSchema = z.object({
  id, planId: id, profileId: id, profileRevision: z.number().int().positive(), contextHash: hash, inputHash: hash,
  adapterVersion: z.string(), recipeVersion: z.string(), stage: z.enum(['not_applicable', 'practice', 'formal']),
  status: z.enum(['prepared', 'submitting', 'verified', 'not_submitted', 'needs_review']),
  objectRef: z.string().max(128).nullable(), errorCode: z.string().max(128).nullable(),
  checks: z.array(z.string().max(120)).max(30), updatedAt: z.string().datetime(),
}).strict()
export type OperationReceipt = z.infer<typeof operationReceiptSchema>
// Pasting a long query is allowed locally; only the credential-free entry is
// compared with the profile limit. Preserve local navigation semantics here.
export const targetOpenRequestSchema = z.object({ entryUrl: z.string().url().max(TARGET_PROFILE_LIMITS.rawOpenUrl).refine(value => {
  try { const url = new URL(value); return `${url.origin}${url.pathname}`.length <= TARGET_PROFILE_LIMITS.entryUrl }
  catch { return false }
}, '去除参数后的入口网址不能超过 2048 个字符'), profileId: id.optional() }).strict()
export type TargetOpenRequest = z.infer<typeof targetOpenRequestSchema>
export const targetExecuteRequestSchema = z.object({ planId: id }).strict()
export const targetReconcileRequestSchema = z.object({ operationId: id }).strict()
export interface TargetsBridge {
  open(request: TargetOpenRequest): Promise<void>
  refresh(): Promise<void>
  detect(): Promise<ProbeObservation>
  preflight(request: TargetPreflightRequest): Promise<RunPlanPreview>
  execute(request: { planId: string }): Promise<OperationReceipt>
  reconcile(request: { operationId: string }): Promise<OperationReceipt>
  listReceipts(): Promise<OperationReceipt[]>
  close(): Promise<void>
}
