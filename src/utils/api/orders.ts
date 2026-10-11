import { api, type ApiQueryParams } from './index'
import type { components } from '@/shared/api/openapi.generated'
import { downloadApiFile } from './download'
import { normalizePaginatedResponse, type PaginatedResponse } from '@/shared/api/pagination'

type EntityId = string | number
type Schemas = components['schemas']
type OrderWire = Schemas['OrderResponse']
type OrderEnvelope = Schemas['APIResponse_OrderResponse_']

export const getOrders = (params: ApiQueryParams = {}): Promise<OrderWire[]> => api.get('/api/orders', params)
export const getOrder = (id: EntityId, params: ApiQueryParams = {}): Promise<OrderWire> =>
  api.get(`/api/orders/${encodeURIComponent(String(id))}`, params, { cache: false })

export async function getOrdersPage(params: ApiQueryParams = {}): Promise<PaginatedResponse<OrderWire>> {
  const response = await api.get<Schemas['OrderPageResponse']>('/api/orders', params, { responseMode: 'raw' })
  return normalizePaginatedResponse<OrderWire>(response)
}

export async function exportOrders(params: ApiQueryParams = {}): Promise<Blob> {
  return downloadApiFile('/api/orders/export', params)
}

export const createOrder = (data: Schemas['OrderCreate']): Promise<OrderEnvelope> => api.post('/api/orders', data)
export const updateOrder = (id: EntityId, data: Schemas['OrderUpdate']): Promise<OrderWire> =>
  api.patch(`/api/orders/${encodeURIComponent(String(id))}`, data)
export const markOrderPaid = (id: EntityId): Promise<OrderEnvelope> =>
  api.post(`/api/orders/${encodeURIComponent(String(id))}/mark-paid`)
export const cancelOrder = (id: EntityId, reason: string): Promise<OrderEnvelope> => {
  const data: Schemas['OrderTransitionRequest'] = { reason }
  return api.post(`/api/orders/${encodeURIComponent(String(id))}/cancel`, data)
}
export const refundOrder = (id: EntityId, reason: string): Promise<OrderEnvelope> => {
  const data: Schemas['OrderTransitionRequest'] = { reason }
  return api.post(`/api/orders/${encodeURIComponent(String(id))}/refund`, data)
}
