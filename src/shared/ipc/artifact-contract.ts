import { z } from 'zod'

export const localArtifactKindSchema = z.enum(['screenshot', 'diagnostic'])
export const localArtifactReadRequestSchema = z.object({
  runId: z.string().min(1).max(128).regex(/^[A-Za-z0-9._-]+$/),
  kind: localArtifactKindSchema,
}).strict()

export const localArtifactUnavailableCodeSchema = z.enum([
  'NOT_AVAILABLE', 'NO_EVIDENCE', 'FORBIDDEN_PATH', 'MISSING',
  'TOO_LARGE', 'INVALID_CONTENT', 'READ_FAILED', 'SESSION_CHANGED',
])

const countSchema = z.number().int().nonnegative().max(1_000_000)
export const localArtifactDiagnosticSummarySchema = z.object({
  runStatus: z.enum(['running', 'paused', 'waiting_user', 'completed', 'failed', 'cancelled']),
  errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/).optional(),
  pageFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  pageChanged: z.boolean().optional(),
  recordPending: z.boolean().optional(),
  pageScan: z.object({ controlCount: countSchema, formCount: countSchema, headingCount: countSchema }).strict().optional(),
  network: z.object({
    recordCount: countSchema, dropped: countSchema,
    responseCount: countSchema, failureCount: countSchema,
  }).strict().optional(),
}).strict()

export const localArtifactReadResultSchema = z.union([
  z.object({
    status: z.literal('available'), kind: z.literal('screenshot'),
    dataUrl: z.string().max(12_000_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/),
  }).strict(),
  z.object({
    status: z.literal('available'), kind: z.literal('diagnostic'),
    summary: localArtifactDiagnosticSummarySchema,
  }).strict(),
  z.object({
    status: z.literal('unavailable'), kind: localArtifactKindSchema,
    code: localArtifactUnavailableCodeSchema, message: z.string().min(1).max(200),
  }).strict(),
])

export type LocalArtifactKind = z.infer<typeof localArtifactKindSchema>
export type LocalArtifactReadRequest = z.infer<typeof localArtifactReadRequestSchema>
export type LocalArtifactReadResult = z.infer<typeof localArtifactReadResultSchema>
export type LocalArtifactDiagnosticSummary = z.infer<typeof localArtifactDiagnosticSummarySchema>
export type LocalArtifactUnavailableCode = z.infer<typeof localArtifactUnavailableCodeSchema>
