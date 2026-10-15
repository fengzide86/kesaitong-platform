import { z } from 'zod'
import { scenarioOrigin } from './scenario-contract.js'

export const TOOLKIT_API_VERSION = 1 as const
export const TOOL_PHASES = ['detect', 'read', 'plan', 'execute', 'verify', 'reconcile'] as const
export const toolDescriptorSchema = z.object({
  schemaVersion: z.literal(TOOLKIT_API_VERSION), id: z.string().regex(/^[a-z][a-z0-9.-]+$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/), capability: z.string().min(1).max(128),
  effect: z.enum(['calculation', 'read', 'write']),
  supportedModes: z.array(z.enum(['training', 'competition', 'local'])).min(1).max(3),
  phases: z.tuple([z.literal('detect'), z.literal('read'), z.literal('plan'), z.literal('execute'), z.literal('verify'), z.literal('reconcile')]),
}).strict()
export type ToolDescriptor = z.infer<typeof toolDescriptorSchema>
const platformContextSchema = z.object({
  schemaVersion: z.literal(1), principal: z.object({ kind: z.enum(['customer', 'staff']), id: z.string().min(1).max(128) }).strict(),
  siteOrigin: z.string().refine(value => { try { return scenarioOrigin(value) === value } catch { return false } }), accountSlot: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  localAccountRef: z.string().regex(/^[a-f0-9]{64}$/), projectRef: z.string().min(1).max(128),
  mode: z.enum(['training', 'competition']), policyRevision: z.string().min(1).max(128),
}).strict()
// A local calculator has no external login/website/course. Keep that absence
// explicit instead of fabricating a hash that pretends to be account evidence.
const calculationContextSchema = z.object({
  schemaVersion: z.literal(1), principal: z.object({ kind: z.literal('local'), id: z.string().min(1).max(128) }).strict(),
  siteOrigin: z.null(), accountSlot: z.null(), localAccountRef: z.null(), projectRef: z.null(),
  mode: z.literal('local'), policyRevision: z.string().min(1).max(128),
}).strict()
export const runtimeContextSchema = z.union([platformContextSchema, calculationContextSchema])
export type RuntimeContext = z.infer<typeof runtimeContextSchema>
export type RuntimeResult<R> = { status: 'verified'; result: R } | { status: 'needs_review'; operationId: string }
