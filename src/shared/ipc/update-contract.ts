import { z } from 'zod'

export const updateStatusSchema = z.enum([
  'idle',
  'checking',
  'available',
  'downloading',
  'cancelling',
  'downloaded',
  'restart_deferred',
  'installing',
  'cancelled',
  'error',
])

export const updateSnapshotSchema = z.object({
  supported: z.boolean().default(true),
  status: updateStatusSchema,
  currentVersion: z.string().min(1),
  availableVersion: z.string().min(1).optional(),
  releaseDate: z.string().optional(),
  releaseNotes: z.array(z.string()).default([]),
  downloadBytes: z.number().nonnegative().optional(),
  percent: z.number().min(0).max(100).optional(),
  transferredBytes: z.number().nonnegative().optional(),
  totalBytes: z.number().nonnegative().optional(),
  bytesPerSecond: z.number().nonnegative().optional(),
  downloadPhase: z.enum(['preparing', 'transferring', 'finalizing']).optional(),
  lastProgressAt: z.string().datetime().optional(),
  downloadStalled: z.boolean().optional(),
  canRetryDownload: z.boolean().optional(),
  canRetryInstall: z.boolean().optional(),
  promptSuppressedUntil: z.string().optional(),
  errorCode: z.string().optional(),
  canRestart: z.boolean(),
  lastCheckedAt: z.string().optional(),
})

export type UpdateStatus = z.infer<typeof updateStatusSchema>
export type UpdateSnapshot = z.infer<typeof updateSnapshotSchema>
export type UpdateDeferPhase = 'download' | 'install'

export const UPDATE_CHANNELS = {
  getState: 'updates:get-state',
  check: 'updates:check',
  startDownload: 'updates:start-download',
  cancelDownload: 'updates:cancel-download',
  install: 'updates:install',
  defer: 'updates:defer',
  state: 'updates:state',
} as const
