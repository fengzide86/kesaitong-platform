import { z } from 'zod'
import type { LocalArtifactReadResult } from './artifact-contract.js'

export const recoveryClassificationSchema = z.enum(['not_submitted', 'verified', 'needs_review', 'manual_completed', 'manual_not_completed'])
export type RecoveryClassification = z.infer<typeof recoveryClassificationSchema>
export const recoveryLabels: Record<RecoveryClassification, string> = {
  not_submitted: '确定未提交', verified: '执行核验通过', needs_review: '结果待核对',
  manual_completed: '人工核对已完成', manual_not_completed: '人工核对未完成',
}
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/)
export const recoveryRecordSchema = z.object({
  id, batchId: id.nullable(), itemId: id.nullable(), originalRow: z.number().int().positive().nullable(),
  toolId: z.string().max(128), toolVersion: z.string().max(128), attemptId: id,
  classification: recoveryClassificationSchema, executionStatus: z.enum(['queued', 'running', 'failed', 'cancelled', 'completed', 'interrupted']),
  revision: z.number().int().positive(), updatedAt: z.string(), errorCode: z.string().max(128).nullable(),
  retryAllowed: z.boolean(), targetOrigin: z.string().nullable(), runId: id.nullable(),
})
export type RecoveryRecord = z.infer<typeof recoveryRecordSchema>
export const recoveryQuerySchema = z.object({ batchId: id.optional() }).strict()
export const recoveryReviewSchema = z.object({ id, revision: z.number().int().positive(), conclusion: z.enum(['completed', 'not_completed']) }).strict()
export const recoveryPrepareSchema = z.object({ batchId: id, importId: id, toolId: z.string().min(1).max(128), toolVersion: z.string().min(1).max(128) }).strict()
export type RecoveryQuery = z.infer<typeof recoveryQuerySchema>
export type RecoveryReview = z.infer<typeof recoveryReviewSchema>
export type RecoveryPrepare = z.infer<typeof recoveryPrepareSchema>

export interface RecoveryBridge {
  list(query?: RecoveryQuery): Promise<RecoveryRecord[]>
  review(request: RecoveryReview): Promise<RecoveryRecord>
  openPlatform(id: string): Promise<void>
  readEvidence(id: string): Promise<LocalArtifactReadResult>
  prepare(request: RecoveryPrepare): Promise<{ importId: string; validCount: number; rows: Array<{ itemId: string; sourceRow?: number; preview: Record<string, unknown> }>; errors: Array<{ message: string }> }>
  export(query?: RecoveryQuery): Promise<{ count: number; fileName: string } | null>
}
