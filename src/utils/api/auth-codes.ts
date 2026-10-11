import { api, type ApiQueryParams } from './index'
import type { components } from '@/shared/api/openapi.generated'
import { normalizePaginatedResponse, type PaginatedResponse } from '@/shared/api/pagination'

type EntityId = string | number
type Schemas = components['schemas']

export const getAuthCodes = (params: ApiQueryParams = {}): Promise<Schemas['AuthCodeResponse'][]> =>
  api.get('/api/auth-codes', { page: 1, page_size: 100, ...params })
export async function getAuthCodesPage(params: ApiQueryParams = {}): Promise<PaginatedResponse<Schemas['AuthCodeResponse']>> {
  const response = await api.get<Schemas['AuthCodePageResponse']>('/api/auth-codes', params, { responseMode: 'raw', cache: false })
  return normalizePaginatedResponse<Schemas['AuthCodeResponse']>(response)
}
export const getAuthCode = (id: EntityId, params: ApiQueryParams = {}): Promise<Schemas['AuthCodeResponse']> =>
  api.get(`/api/auth-codes/${encodeURIComponent(String(id))}`, params, { cache: false })
export const batchGenerateAuthCodes = (data: Schemas['AuthCodeGenerate']): Promise<Schemas['AuthCodeBatchGenerateResponse']> =>
  api.post('/api/auth-codes/batch-generate', data)
export const updateAuthCode = (id: EntityId, data: Schemas['AuthCodeUpdate']): Promise<Schemas['AuthCodeResponse']> =>
  api.put(`/api/auth-codes/${encodeURIComponent(String(id))}`, data)
export const extendAuthCode = (id: EntityId, days: number): Promise<Schemas['AuthCodeResponse']> =>
  api.post(`/api/auth-codes/${encodeURIComponent(String(id))}/extend`, { days })
export const deleteAuthCode = (id: EntityId): Promise<Schemas['AuthCodeDeleteResponse']> =>
  api.delete(`/api/auth-codes/${encodeURIComponent(String(id))}`)
