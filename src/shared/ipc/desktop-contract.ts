import { z } from 'zod'

import { batchEventSchema } from '../../features/business/model.js'
import type { FreightQuoteRequest, FreightRatePack } from '../freight/types.js'
import type { FreightWorkbookOptions } from '../freight/workbook-parser.js'
import { runnerEventSchema } from './automation-contract.js'
import { localArtifactReadRequestSchema } from './artifact-contract.js'

export const DESKTOP_IPC_PROTOCOL_VERSION = 1 as const
export const DESKTOP_IPC_PAYLOAD_ERROR_CODE = 'IPC_PAYLOAD_INVALID' as const
export const DESKTOP_IPC_ERROR_PREFIX = 'KST_IPC_ERROR:' as const

export type IpcJsonValue =
  | string
  | number
  | boolean
  | null
  | IpcJsonValue[]
  | { [key: string]: IpcJsonValue }

export const ipcJsonValueSchema: z.ZodType<IpcJsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(ipcJsonValueSchema),
  z.record(z.string(), ipcJsonValueSchema),
]))

export const ipcObjectSchema = z.record(z.string(), ipcJsonValueSchema)
export type IpcObject = z.infer<typeof ipcObjectSchema>

const ipcIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/)
const nonEmptyTextSchema = z.string().trim().min(1).max(4_096)
const webContentsIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)

function isPlainCloneSafeValue(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  const valid = Array.isArray(value)
    ? value.every(item => isPlainCloneSafeValue(item, seen))
    : (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
      && Object.values(value as Record<string, unknown>).every(item => isPlainCloneSafeValue(item, seen))
  seen.delete(value)
  return valid
}

function rejectNonCloneSafeValue(value: unknown, context: z.RefinementCtx): void {
  if (!isPlainCloneSafeValue(value)) {
    context.addIssue({ code: 'custom', message: 'payload must contain only plain clone-safe values' })
  }
}

const toolSchema = ipcObjectSchema.refine(
  value => typeof value.id === 'string' || typeof value.id === 'number',
  { message: 'tool.id is required' },
)

const batchImportOptionsSchema = z.object({
  capabilityKey: z.string().trim().max(128).optional(),
  schema: z.array(ipcObjectSchema).max(200).default([]),
  maxRows: z.number().int().min(1).max(1_000).default(50),
}).catchall(ipcJsonValueSchema)

const batchImportErrorSchema = z.object({
  rowNumber: z.number().int().positive().optional(),
  message: nonEmptyTextSchema,
}).catchall(ipcJsonValueSchema)

const demoImportRowSchema = z.object({
  itemId: ipcIdSchema.optional(),
  accountLabel: z.string().max(80).optional(),
  input: ipcObjectSchema.default({}),
}).catchall(ipcJsonValueSchema)

export const batchStoreDemoImportRequestSchema = z.object({
  importId: ipcIdSchema.optional(),
  rows: z.array(demoImportRowSchema).min(1).max(100),
}).catchall(ipcJsonValueSchema)

export const batchRemapImportRequestSchema = z.object({
  importId: ipcIdSchema,
  itemIds: z.array(ipcIdSchema).min(1).max(1_000),
}).catchall(ipcJsonValueSchema)

export const batchCreateRequestSchema = z.object({
  importId: ipcIdSchema,
  batchId: ipcIdSchema,
  serverBatchId: z.union([z.string().min(1).max(128), z.number().int()]).optional(),
  tool: toolSchema,
  maxOpenSessions: z.number().int().min(0).max(50).optional(),
  recordKind: z.enum(['demo', 'live']).optional(),
}).catchall(ipcJsonValueSchema)

export const batchStartRequestSchema = z.object({
  itemId: ipcIdSchema,
  tool: toolSchema,
}).catchall(ipcJsonValueSchema)

export const batchFailItemRequestSchema = z.object({
  itemId: ipcIdSchema,
  message: z.string().max(4_096).optional(),
}).catchall(ipcJsonValueSchema)

export const freightWorkbookOptionsSchema = z.object({
  id: z.string().trim().min(1).max(128).optional(),
  version: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  exchangeRateCnyPerUsd: z.number().positive().finite().optional(),
  sheetMappings: z.record(z.string(), z.string().max(200)).optional(),
}).catchall(ipcJsonValueSchema)

const freightDimensionsSchema = z.object({
  length: z.number().positive().finite(),
  width: z.number().positive().finite(),
  height: z.number().positive().finite(),
})

export const freightQuoteRequestSchema = z.object({
  country: z.string().trim().min(1).max(100),
  actualWeightKg: z.number().positive().finite(),
  dimensionsCm: freightDimensionsSchema.optional(),
  exchangeRateCnyPerUsd: z.number().positive().finite().optional(),
})

export const freightQuotePayloadSchema = z.object({
  pack: ipcObjectSchema.optional(),
  request: freightQuoteRequestSchema,
}).catchall(ipcJsonValueSchema)

export const notificationFocusSchema = z.object({
  mode: z.enum(['single', 'batch']),
  itemId: ipcIdSchema.optional(),
}).superRefine((value, context) => {
  if (value.mode === 'batch' && !value.itemId) {
    context.addIssue({ code: 'custom', path: ['itemId'], message: 'itemId is required for batch focus' })
  }
})

export const desktopIpcInvocationSchemas = {
  'artifacts:read': z.tuple([localArtifactReadRequestSchema]),
  'artifacts:clear': z.tuple([]),
  'credential-save-user-code': z.tuple([nonEmptyTextSchema]),
  'credential-load-user-code': z.tuple([]),
  'credential-clear-user-code': z.tuple([]),
  'demo-activity:set-active': z.tuple([ipcIdSchema, z.boolean()]),
  'automation:start': z.tuple([toolSchema]),
  'automation:preflight': z.tuple([toolSchema]),
  'automation:pause': z.tuple([]),
  'automation:resume': z.tuple([]),
  'automation:complete-user-action': z.tuple([]),
  'automation:cancel': z.tuple([]),
  'automation:register-browser': z.tuple([webContentsIdSchema]),
  'automation:unregister-browser': z.tuple([]),
  'batch:store-demo-import': z.tuple([batchStoreDemoImportRequestSchema]),
  'batch:load-sample-import': z.tuple([batchImportOptionsSchema]),
  'batch:save-sample-template': z.tuple([]),
  'batch:remap-import-items': z.tuple([batchRemapImportRequestSchema]),
  'batch:select-import-file': z.tuple([batchImportOptionsSchema]),
  'batch:parse-import-file': z.tuple([batchImportOptionsSchema]),
  'batch:export-import-errors': z.tuple([z.array(batchImportErrorSchema).max(1_000)]),
  'batch:create': z.tuple([batchCreateRequestSchema]),
  'batch:start': z.tuple([batchStartRequestSchema]),
  'batch:fail-item': z.tuple([batchFailItemRequestSchema]),
  'batch:select-item': z.tuple([ipcIdSchema]),
  'batch:complete-user-action': z.tuple([ipcIdSchema]),
  'batch:restart-item': z.tuple([ipcIdSchema]),
  'batch:cancel': z.union([
    z.tuple([]),
    z.tuple([z.string().trim().min(1).max(64).optional()]),
  ]),
  'batch:get-snapshot': z.tuple([]),
  'batch:register-browser': z.tuple([ipcIdSchema, webContentsIdSchema]),
  'batch:unregister-browser': z.tuple([ipcIdSchema]),
  'freight:get-default-pack': z.tuple([]),
  'freight:parse-workbook': z.tuple([freightWorkbookOptionsSchema]),
  'freight:reparse-workbook': z.tuple([freightWorkbookOptionsSchema]),
  'freight:quote': z.tuple([freightQuotePayloadSchema]),
  'open-external': z.tuple([z.string().trim().min(1).max(2_048)]),
} as const

export const desktopIpcEventSchemas = {
  'automation:event': runnerEventSchema.superRefine(rejectNonCloneSafeValue),
  'batch:event': batchEventSchema.superRefine(rejectNonCloneSafeValue),
  'toolbox:notification-focus': notificationFocusSchema,
} as const

export type DesktopIpcInvocationChannel = keyof typeof desktopIpcInvocationSchemas
export type DesktopIpcEventChannel = keyof typeof desktopIpcEventSchemas
export type DesktopIpcArgs<Channel extends DesktopIpcInvocationChannel> = z.infer<(typeof desktopIpcInvocationSchemas)[Channel]>
export type DesktopIpcEvent<Channel extends DesktopIpcEventChannel> = z.infer<(typeof desktopIpcEventSchemas)[Channel]>

export const serializableIpcIssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
})

export const serializableIpcErrorSchema = z.object({
  protocolVersion: z.literal(DESKTOP_IPC_PROTOCOL_VERSION),
  code: z.literal(DESKTOP_IPC_PAYLOAD_ERROR_CODE),
  message: z.string(),
  channel: z.string(),
  issues: z.array(serializableIpcIssueSchema),
})

export type SerializableIpcError = z.infer<typeof serializableIpcErrorSchema>

function serializablePayloadError(channel: string, error: z.ZodError): SerializableIpcError {
  return {
    protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
    code: DESKTOP_IPC_PAYLOAD_ERROR_CODE,
    message: 'IPC payload rejected by contract',
    channel,
    issues: error.issues.map(issue => ({
      path: issue.path.filter((part): part is string | number => typeof part === 'string' || typeof part === 'number'),
      message: issue.message,
    })),
  }
}

export function ipcPayloadError(channel: string, error: z.ZodError): Error & {
  code: typeof DESKTOP_IPC_PAYLOAD_ERROR_CODE
  detail: SerializableIpcError
} {
  const detail = serializablePayloadError(channel, error)
  return Object.assign(new Error(`${DESKTOP_IPC_ERROR_PREFIX}${JSON.stringify(detail)}`), {
    name: 'DesktopIpcContractError',
    code: DESKTOP_IPC_PAYLOAD_ERROR_CODE,
    detail,
  })
}

export function parseSerializableIpcError(input: unknown): SerializableIpcError | null {
  const message = input instanceof Error
    ? input.message
    : typeof input === 'string'
      ? input
      : ''
  const start = message.indexOf(DESKTOP_IPC_ERROR_PREFIX)
  if (start < 0) return null
  const serialized = message.slice(start + DESKTOP_IPC_ERROR_PREFIX.length)
  try {
    const parsed = serializableIpcErrorSchema.safeParse(JSON.parse(serialized))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function parseDesktopIpcArgs<Channel extends DesktopIpcInvocationChannel>(
  channel: Channel,
  args: readonly unknown[],
): DesktopIpcArgs<Channel> {
  const result = desktopIpcInvocationSchemas[channel].safeParse(args)
  if (!result.success) throw ipcPayloadError(channel, result.error)
  return result.data as DesktopIpcArgs<Channel>
}

export function parseDesktopIpcEvent<Channel extends DesktopIpcEventChannel>(
  channel: Channel,
  payload: unknown,
): DesktopIpcEvent<Channel> {
  const result = desktopIpcEventSchemas[channel].safeParse(payload)
  if (!result.success) throw ipcPayloadError(channel, result.error)
  return result.data as DesktopIpcEvent<Channel>
}

export type AutomationToolRequest = Record<string, unknown>

export interface BatchImportOptions {
  capabilityKey?: string
  schema: Record<string, unknown>[]
  maxRows: number
  [key: string]: unknown
}

export interface BatchStoreDemoImportRow {
  itemId?: string
  accountLabel?: string
  input?: Record<string, unknown>
  [key: string]: unknown
}

export interface BatchStoreDemoImportRequest {
  importId?: string
  rows: BatchStoreDemoImportRow[]
  [key: string]: unknown
}

export interface BatchRemapImportRequest {
  importId: string
  itemIds: string[]
  [key: string]: unknown
}

export interface BatchCreateRequest {
  importId: string
  batchId: string
  serverBatchId?: string | number
  tool: Record<string, unknown>
  maxOpenSessions?: number
  recordKind?: 'demo' | 'live'
  [key: string]: unknown
}

export interface BatchStartRequest {
  itemId: string
  tool: Record<string, unknown>
  [key: string]: unknown
}

export interface BatchFailItemRequest {
  itemId: string
  message?: string
  [key: string]: unknown
}

export interface BatchImportError {
  rowNumber?: number
  message: string
  [key: string]: unknown
}

export type FreightWorkbookIpcOptions = FreightWorkbookOptions
export interface FreightQuoteIpcPayload {
  pack?: FreightRatePack
  request: FreightQuoteRequest
  [key: string]: unknown
}
export type NotificationFocusPayload = z.infer<typeof notificationFocusSchema>
