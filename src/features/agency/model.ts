import { z } from 'zod'

const id = z.number().int().positive()
const text = z.string().nullable().optional()
export const agencySchema = z.object({
  id, name: z.string(), contact: text, notes: text,
  status: z.enum(['active', 'disabled']), created_at: z.string(),
})
export const customerSchema = z.object({
  id, agency_id: id, agency_name: text, name: z.string(), contact: text, notes: text, created_at: z.string(),
})
export const licenseSchema = z.object({
  id, agency_id: id, agency_name: text, customer_id: id, customer_name: text, order_id: id, code: z.string(),
  plan_name: z.string(), status: z.string(), expires_at: text,
  activated: z.boolean(), created_at: z.string(),
})
export const orderSchema = z.object({
  id, agency_id: id, agency_name: text, customer_id: id, customer_name: z.string(), order_no: z.string(),
  plan_id: id.nullable(), plan_name: z.string(), amount: z.coerce.number(), status: z.enum(['pending', 'paid', 'refunded', 'cancelled']),
  platform_key: text, note: text,
  created_at: z.string(), paid_at: text, auth_code: licenseSchema.nullable(),
})
export const serviceRequestSchema = z.object({
  id, agency_id: id, agency_name: text, customer_id: id, customer_name: text, order_id: id.nullable().optional(),
  kind: z.enum(['support', 'refund', 'extension']), content: z.string(),
  status: z.enum(['open', 'resolved', 'rejected']), response: text,
  created_at: z.string(), resolved_at: text,
})
export const planSchema = z.object({
  id, name: z.string(), price: z.coerce.number(), duration_days: z.number(),
  product_type: z.enum(['consumer', 'business']),
})
export const summarySchema = z.object({
  customers: z.number().nonnegative(), orders: z.number().nonnegative(),
  pending_orders: z.number().nonnegative(), delivered_orders: z.number().nonnegative(),
  open_requests: z.number().nonnegative(),
})
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({ data: z.array(item), total: z.number().nonnegative(), page: z.number().positive(), page_size: z.number().positive() })
}
export type Agency = z.infer<typeof agencySchema>
export type Customer = z.infer<typeof customerSchema>
export type AgencyOrder = z.infer<typeof orderSchema>
export type AgencyLicense = z.infer<typeof licenseSchema>
export type ServiceRequest = z.infer<typeof serviceRequestSchema>
export type AgencyPlan = z.infer<typeof planSchema>
export type AgencySummary = z.infer<typeof summarySchema>
export type Section = 'agencies' | 'customers' | 'orders' | 'licenses' | 'requests' | 'commission'
export type AgencyRecord = Agency | Customer | AgencyOrder | AgencyLicense | ServiceRequest
export interface Page<T> { data: T[]; total: number; page: number; page_size: number }

export const sectionLabels: Record<Section, string> = {
  agencies: '代理主体', customers: '客户档案', orders: '订单交付', licenses: '授权记录', requests: '售后申请', commission: '返佣结算',
}
export function statusLabel(value: string): string {
  return ({ active: '启用', disabled: '停用', pending: '待确认收款', paid: '已收款', delivered: '已交付',
    cancelled: '已取消', refunded: '已退款', used: '已激活', unused: '未激活', pending_activation: '已交付待激活', expired: '已到期', frozen: '已冻结', deleted: '已停用',
    open: '待处理', resolved: '已回复处理', rejected: '未通过' } as Record<string, string>)[value] || value
}
export function requestKindLabel(value: ServiceRequest['kind']): string {
  return { support: '使用支持', refund: '退款申请', extension: '延期申请' }[value]
}
/** Validity comes from the server effective state, and always takes precedence over activation. */
export function canDeliverLicense(raw: unknown): boolean {
  const license = licenseSchema.safeParse(raw)
  return license.success && ['active', 'unused'].includes(license.data.status)
}
export function licenseActivationLabel(raw: unknown): string {
  const license = licenseSchema.safeParse(raw)
  if (!license.success) return '待核对'
  if (!canDeliverLicense(license.data)) return statusLabel(license.data.status)
  return license.data.activated ? '已激活' : '待激活'
}
export function money(value: number): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(value)
}
