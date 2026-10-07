import { z } from 'zod'

export const toolCatalogItemSchema = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string(),
  description: z.string().default(''),
  module: z.string().optional(),
  category: z.string().default('automation'),
  platform_key: z.string().optional(),
  capability_key: z.string().optional(),
  task_ids: z.array(z.string()).optional(),
  // Unknown future kinds remain visible; presentation interprets only known kinds.
  tool_kind: z.string().optional(),
  capability_tags: z.union([z.array(z.string()), z.string()]).optional(),
  preparation_notes: z.union([z.array(z.string()), z.string()]).optional(),
  intervention_scenarios: z.union([z.array(z.string()), z.string()]).optional(),
  available_plans: z.array(z.union([z.string(), z.number()])).optional(),
  release_status: z.string().optional(),
  status: z.string().optional(),
  script_key: z.string().optional(),
  target_url: z.string().optional(),
  tool_version: z.string().optional(),
  runner_api_version: z.coerce.number().optional(),
  sort_order: z.coerce.number().optional(),
  available_plans_text: z.string().optional(),
  capability_tags_text: z.string().optional(),
  preparation_notes_text: z.string().optional(),
  intervention_scenarios_text: z.string().optional(),
  supports_batch: z.boolean().optional(),
  business_description: z.string().optional(),
  batch_input_schema: z.array(z.object({
    key: z.string(),
    label: z.string(),
    type: z.literal('text').default('text'),
    required: z.boolean().default(true),
    sensitive: z.boolean().default(false),
  })).optional(),
  single_input_schema: z.array(z.object({
    key: z.string(),
    label: z.string(),
    type: z.enum(['text', 'number', 'file', 'select']).default('text'),
    required: z.boolean().default(true),
    sensitive: z.boolean().default(false),
    options: z.array(z.string()).optional(),
  })).optional(),
  batch_schema_text: z.string().optional(),
  requires_signature: z.boolean().optional(),
  availability: z.enum(['demo_only', 'live_beta', 'live']).default('demo_only'),
  script_status: z.enum(['demo_ready', 'browser_ready', 'script_ready', 'script_not_ready', 'blocked']).optional(),
  demo_scenario_id: z.string().default('default'),
  supports_demo_single: z.boolean().default(true),
  supports_demo_batch: z.boolean().default(false),
  supports_live_single: z.boolean().default(false),
  supports_live_batch: z.boolean().default(false),
}).passthrough()

export const toolCatalogSchema = z.array(toolCatalogItemSchema)
export type ToolCatalogItem = z.infer<typeof toolCatalogItemSchema>

export const toolUpdateResponseSchema = z.object({
  data: toolCatalogSchema.optional(),
}).passthrough()

export const toolLaunchGrantSchema = z.object({
  token: z.string(),
  target_url: z.string(),
  tool_id: z.union([z.string(), z.number()]).optional(),
  tool_name: z.string().optional(),
  tool_module: z.string().optional(),
  category: z.string().optional(),
  platform_key: z.string().optional(),
  expires_at: z.string().optional(),
  script_key: z.string().optional(),
  runner_api_version: z.coerce.number().optional(),
  tool_version: z.string().optional(),
  tool_manifest: z.unknown().optional(),
  tool_signature: z.string().optional(),
  signing_key_id: z.string().optional(),
  signature_required: z.boolean().optional(),
}).passthrough()

export const toolLaunchResponseSchema = z.object({
  launch_data: toolLaunchGrantSchema.optional(),
  grant: toolLaunchGrantSchema.optional(),
  expires_at: z.string().optional(),
  expires_in: z.coerce.number().optional(),
}).passthrough()

export function errorCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null
  return typeof error.code === 'number' ? error.code : null
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
