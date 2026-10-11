import { z } from 'zod'

export const entityIdSchema = z.union([z.string(), z.number()])

const nullableText = z.string().nullable().optional()

export const adminUserSchema = z.object({
  id: entityIdSchema,
  name: nullableText,
  phone: nullableText,
  auth_code_id: entityIdSchema.nullable().optional(),
  device_id: nullableText,
  device_name: nullableText,
  total_seats: z.coerce.number().int().min(1).default(1),
  extra_devices: z.coerce.number().int().min(0).default(0),
  created_at: nullableText,
}).passthrough()

export const adminUsersSchema = z.array(adminUserSchema.nullable()).transform((items) =>
  items.filter((item): item is z.infer<typeof adminUserSchema> => item !== null),
)

export type AdminUser = z.infer<typeof adminUserSchema>

export const feedbackStatusSchema = z.enum(['pending', 'processing', 'resolved'])

export const adminFeedbackSchema = z.object({
  id: entityIdSchema,
  user_id: entityIdSchema.nullable().optional(),
  title: nullableText,
  content: nullableText,
  screenshot: nullableText,
  screenshots: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  status: feedbackStatusSchema.catch('pending'),
  admin_reply: nullableText,
  created_at: nullableText,
  replied_at: nullableText,
  updated_at: nullableText,
  platform_key: nullableText,
}).passthrough()

export const adminFeedbacksSchema = z.array(adminFeedbackSchema)
export type AdminFeedback = z.infer<typeof adminFeedbackSchema>
export type FeedbackStatus = z.infer<typeof feedbackStatusSchema>

export const profitSummarySchema = z.object({
  total_tech: z.coerce.number().default(0),
  total_market: z.coerce.number().default(0),
  total_product: z.coerce.number().default(0),
  total_service: z.coerce.number().default(0),
  total_coordination: z.coerce.number().default(0),
  total_record: z.coerce.number().default(0),
  grand_total: z.coerce.number().default(0),
})

export const profitPolicySchema = z.object({
  version: z.coerce.number().int().positive(),
  ratios: z.object({
    tech: z.coerce.number().min(0).max(1),
    market: z.coerce.number().min(0).max(1),
    product: z.coerce.number().min(0).max(1),
    service: z.coerce.number().min(0).max(1),
    coordination: z.coerce.number().min(0).max(1),
    record: z.coerce.number().min(0).max(1),
  }),
})

export const profitRecordSchema = z.object({
  id: z.number(), order_id: z.number(), status: z.string(), policy_version: z.number(),
  order_amount_snapshot: z.coerce.number(),
  tech_share: z.coerce.number(), market_share: z.coerce.number(), product_share: z.coerce.number(),
  service_share: z.coerce.number(), coordination_share: z.coerce.number(), record_share: z.coerce.number(),
  reversal_reason: nullableText, created_at: nullableText,
})
export type ProfitRecord = z.infer<typeof profitRecordSchema>

export const adminSettingsSchema = z.array(z.object({
  key: z.string(),
  value: z.string().nullable().optional(),
}).passthrough())

const actionSummarySchema = z.object({
  expiring_authorizations: z.coerce.number().int().nonnegative().default(0),
  device_anomalies: z.coerce.number().int().nonnegative().default(0),
  pending_tickets: z.coerce.number().int().nonnegative().default(0),
  waiting_interventions: z.coerce.number().int().nonnegative().default(0),
  stale_batches: z.coerce.number().int().nonnegative().default(0),
  expense_renewals_due: z.coerce.number().int().nonnegative().default(0),
})

export const adminActionCenterSchema = z.object({
  summary: actionSummarySchema,
  agency_delivery_tasks: z.array(z.object({
    key: z.string(), label: z.string(), count: z.number().int().nonnegative(),
    section: z.enum(['orders', 'licenses', 'requests']), status: z.string(),
  })).default([]),
  expiring_authorizations: z.array(z.object({
    id: entityIdSchema,
    code_masked: z.string(),
    expires_at: nullableText,
  })).default([]),
  device_anomalies: z.array(z.object({
    auth_code_id: entityIdSchema,
    code_masked: z.string(),
    seat_used: z.coerce.number().int().nonnegative(),
    seat_limit: z.coerce.number().int().positive(),
    device_used: z.coerce.number().int().nonnegative(),
    device_limit: z.coerce.number().int().positive(),
  })).default([]),
  pending_tickets: z.array(z.object({
    id: entityIdSchema,
    title: z.string(),
    priority: z.string().nullable().optional(),
    created_at: nullableText,
  })).default([]),
  waiting_interventions: z.array(z.object({
    batch_id: entityIdSchema,
    tool_name: z.string(),
    account_label_masked: z.string(),
    intervention_type: z.string().nullable().optional(),
    updated_at: nullableText,
  })).default([]),
  stale_batches: z.array(z.object({
    batch_id: entityIdSchema,
    tool_name: z.string(),
    last_heartbeat_at: nullableText,
  })).default([]),
  expense_renewals: z.array(z.object({
    id: entityIdSchema,
    name: z.string(),
    vendor: nullableText,
    default_amount: z.coerce.number().positive(),
    category_name: z.string(),
    next_due_on: z.string(),
    due_state: z.string(),
  }).passthrough()).default([]),
})

export type AdminActionCenter = z.infer<typeof adminActionCenterSchema>

export const adminBatchDetailSchema = z.object({
  id: entityIdSchema,
  tool_name: z.string(),
  status: z.string(),
  total_count: z.coerce.number().int().nonnegative(),
  last_heartbeat_at: nullableText,
  items: z.array(z.object({
    account_label_masked: z.string(),
    status: z.string(),
    intervention_type: z.string().nullable().optional(),
    customer_message: nullableText,
    updated_at: nullableText,
  })).default([]),
})

export type AdminBatchDetail = z.infer<typeof adminBatchDetailSchema>

export const adminPlanSchema = z.object({
  id: entityIdSchema,
  name: z.string(),
  price: z.coerce.number(),
  duration_days: z.coerce.number().int().nonnegative().optional(),
  status: z.string().default('active'),
  features: nullableText,
  product_type: z.enum(['consumer', 'business']).default('consumer'),
  entitlements: z.record(z.string(), z.unknown()).default({}),
}).passthrough()
export const adminPlansSchema = z.array(adminPlanSchema)
export type AdminPlan = z.infer<typeof adminPlanSchema>

export const adminOrderSchema = z.object({
  id: entityIdSchema,
  order_no: z.string(),
  plan_id: entityIdSchema.nullable().optional(),
  amount: z.coerce.number(),
  channel: nullableText,
  responsible: nullableText,
  status: z.string().default('pending'),
  refund_amount: z.coerce.number().default(0),
  created_at: nullableText,
  agency_id: entityIdSchema.nullable().optional(),
  customer_id: entityIdSchema.nullable().optional(),
  customer_name: nullableText,
  agency_name: nullableText,
  auth_code_id: entityIdSchema.nullable().optional(),
  auth_code_status: nullableText,
  plan_name_snapshot: nullableText,
  platform_key: nullableText,
  paid_at: nullableText,
  refunded_at: nullableText,
}).passthrough()
export const adminOrdersSchema = z.array(adminOrderSchema)
export type AdminOrder = z.infer<typeof adminOrderSchema>

export const knowledgeItemSchema = z.object({
  id: entityIdSchema,
  category: z.string(),
  title: z.string(),
  content: z.string(),
  keywords: z.array(z.string()).default([]),
  priority: z.string().default('medium'),
  status: z.string().default('active'),
  vector_id: nullableText,
  view_count: z.coerce.number().int().nonnegative().default(0),
  platform_key: nullableText,
  capability_key: nullableText,
  created_at: nullableText,
  updated_at: nullableText,
}).passthrough()
export type KnowledgeItem = z.infer<typeof knowledgeItemSchema>

export const knowledgeListSchema = z.object({
  items: z.array(knowledgeItemSchema).default([]),
  total: z.coerce.number().int().nonnegative().default(0),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().default(20),
})

export const knowledgeCategoriesSchema = z.array(z.object({
  name: z.string(),
  count: z.coerce.number().int().nonnegative().default(0),
}))

export const knowledgeStatsSchema = z.object({
  total: z.coerce.number().int().nonnegative().default(0),
  active: z.coerce.number().int().nonnegative().default(0),
  categories: z.coerce.number().int().nonnegative().default(0),
  vector_store: z.object({
    total_vectors: z.coerce.number().int().nonnegative().default(0),
    status: z.string().default('unknown'),
  }).passthrough().default({ total_vectors: 0, status: 'unknown' }),
})

export const vectorSyncResultSchema = z.object({ synced: z.coerce.number().int().nonnegative() })

export const retrievalTestResultSchema = z.object({
  elapsed_ms: z.coerce.number().nonnegative(),
  results: z.array(z.object({
    id: entityIdSchema,
    title: z.string(),
    category: z.string(),
    content: z.string(),
    score: z.coerce.number(),
    platform_key: nullableText,
    capability_key: nullableText,
  }).passthrough()).default([]),
}).passthrough()

export type RetrievalTestResult = z.infer<typeof retrievalTestResultSchema>

export const toolReleaseSchema = z.object({
  tool_id: z.string(),
  version: z.string(),
  script_key: z.string(),
  runner_api_version: z.coerce.number().default(1),
  artifact_sha256: z.string().default('embedded'),
  artifact_url: nullableText,
  channel: z.string().default('canary'),
  rollout_percentage: z.coerce.number().default(0),
  status: z.string().default('draft'),
  created_at: nullableText,
}).passthrough()
export const toolReleasesSchema = z.array(toolReleaseSchema)
export type ToolRelease = z.infer<typeof toolReleaseSchema>

const authDeviceSchema = z.object({
  id: entityIdSchema,
  device_id: z.string(),
  device_name: nullableText,
  created_at: nullableText,
}).passthrough()

export const adminAuthCodeSchema = z.object({
  id: entityIdSchema,
  code: z.string(),
  plan_id: entityIdSchema.nullable().optional(),
  plan_name: nullableText,
  device_id: nullableText,
  device_name: nullableText,
  max_devices: z.coerce.number().int().positive().default(1),
  status: z.string(),
  expires_at: nullableText,
  created_at: nullableText,
  devices: z.array(authDeviceSchema).default([]),
  platform_scope: z.array(z.string()).nullable().optional(),
  scene_type: nullableText,
  seat_limit: z.coerce.number().int().positive().default(1),
  seat_used: z.coerce.number().int().nonnegative().default(0),
  device_used: z.coerce.number().int().nonnegative().default(0),
  product_type: z.enum(['consumer', 'business']).default('consumer'),
  entitlements: z.record(z.string(), z.unknown()).default({}),
}).passthrough()

export const adminAuthCodesSchema = z.array(adminAuthCodeSchema)
export type AdminAuthCode = z.infer<typeof adminAuthCodeSchema>

export const generatedAuthCodesSchema = z.object({
  success: z.boolean(),
  codes: z.array(z.string()).default([]),
  count: z.coerce.number().int().nonnegative().default(0),
})
