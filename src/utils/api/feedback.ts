import { api, type ApiQueryParams } from './index'
import type { components } from '@/shared/api/openapi.generated'
import { normalizePaginatedResponse, type PaginatedResponse } from '@/shared/api/pagination'

type EntityId = string | number
type Schemas = components['schemas']
type FeedbackList = NonNullable<Schemas['FeedbackListEnvelope']['data']>

export const getFeedbacks = (params: ApiQueryParams = {}): Promise<FeedbackList> => api.get('/api/feedback', params)
export const getFeedback = (id: EntityId, params: ApiQueryParams = {}): Promise<Schemas['FeedbackDetailEnvelope']['data']> =>
  api.get(`/api/feedback/${encodeURIComponent(String(id))}`, params, { cache: false })
export async function getFeedbacksPage(params: ApiQueryParams = {}): Promise<PaginatedResponse<FeedbackList[number]>> {
  const response = await api.get<Schemas['FeedbackListEnvelope']>('/api/feedback', params, { responseMode: 'raw', cache: false })
  return normalizePaginatedResponse<FeedbackList[number]>(response)
}
export const getMyFeedbacks = (params: ApiQueryParams = {}): Promise<FeedbackList> => api.get('/api/feedback/my', params)
export const createFeedback = (data: Schemas['FeedbackCreate']): Promise<Schemas['FeedbackItemEnvelope']> =>
  api.post('/api/feedback', data)
export const updateFeedback = (
  id: EntityId,
  data: Schemas['FeedbackUpdate'],
): Promise<Schemas['FeedbackItemEnvelope']> => api.put(`/api/feedback/${id}`, data)
