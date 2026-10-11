import { api, type ApiQueryParams } from './index'
import type { components } from '@/shared/api/openapi.generated'
import { normalizePaginatedResponse, type PaginatedResponse } from '@/shared/api/pagination'

type EntityId = string | number
type Schemas = components['schemas']
type UserList = Schemas['UserListEnvelope']['data']

export const getUsers = (): Promise<UserList> => api.get('/api/users')
export const getUser = (id: EntityId, params: ApiQueryParams = {}): Promise<Schemas['UserDetailEnvelope']['data']> =>
  api.get(`/api/users/${encodeURIComponent(String(id))}`, params, { cache: false })
export async function getUsersPage(params: ApiQueryParams = {}): Promise<PaginatedResponse<Schemas['UserSummaryResponse']>> {
  const response = await api.get<Schemas['UserListEnvelope']>('/api/users', params, { responseMode: 'raw', cache: false })
  return normalizePaginatedResponse<Schemas['UserSummaryResponse']>(response)
}
export const updateUser = (id: EntityId, data: Schemas['UserUpdate']): Promise<Schemas['UserItemEnvelope']> =>
  api.put(`/api/users/${id}`, data)
