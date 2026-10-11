import { z } from 'zod'

// File paths stay on the local IPC boundary, never the control API.
export const fileInputSelectionRequestSchema = z.object({ label: z.string().trim().min(1).max(120) }).strict()
export const fileInputSelectionSchema = z.object({ filePath: z.string().min(1).max(4096), fileName: z.string().min(1).max(260) }).strict()
export const fileInputValidationRequestSchema = z.object({ paths: z.array(z.string().min(1).max(4096)).max(64) }).strict()
export const fileInputValidationResultSchema = z.object({ valid: z.boolean(), issues: z.array(z.object({ filePath: z.string(), message: z.string() }).strict()) }).strict()
export type FileInputSelectionRequest = z.infer<typeof fileInputSelectionRequestSchema>
export type FileInputSelection = z.infer<typeof fileInputSelectionSchema>
export type FileInputValidationRequest = z.infer<typeof fileInputValidationRequestSchema>
export type FileInputValidationResult = z.infer<typeof fileInputValidationResultSchema>
