import { api } from '@/utils/api'

export interface OfferDefinition {
  name: string; price: string; business_line: 'trial' | 'competition' | 'training' | 'service' | 'single_tool'
  term_type: 'project_end' | 'service_fulfillment'; description: string; allowed_capabilities: string[]
  services: Array<{ code: string; count: number; minutes_per_unit: number }>; availability: 'consult' | 'limited' | 'available'
}
export interface Offer { id: number; sku: string; version: number; revision: number; status: string; definition: OfferDefinition }
export interface CommercialOrder { id: number; order_no: string; amount: string; status: string; refund_amount: string; commercial: { sku: string; definition: OfferDefinition; ends_at: string | null; project_id: string | null; site_origin: string | null } }
export interface Fulfillment { id: number; order_id: number; service_code: string; remaining_count: number; total_count: number; completed_count: number; minutes_per_unit: number; revision: number }
export interface ToolOption { capability: string; name: string; selectable: boolean }
export interface Envelope<T> { success: boolean; data: T }
export const commercialApi = {
  offers: () => api.get<Offer[]>('/api/commercial/offers', {}, { cache: false }),
  orders: () => api.get<CommercialOrder[]>('/api/commercial/orders', {}, { cache: false }),
  tools: () => api.get<ToolOption[]>('/api/commercial/tool-options', {}, { cache: false }),
  fulfillments: (order: number) => api.get<Fulfillment[]>(`/api/commercial/orders/${order}/fulfillments`, {}, { cache: false }),
}
export function savePublicCatalog(filename: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
