import { api, type ApiQueryParams } from './index'
import { normalizePaginatedResponse } from '@/shared/api/pagination'
import type { components, paths } from '@/shared/api/openapi.generated'

type EntityId = string | number
type Schemas = components['schemas']
type KnowledgeListPage = Pick<Schemas['KnowledgeListResponse'], 'items' | 'total' | 'page' | 'page_size'>

export const getKnowledgeList = async (params: ApiQueryParams = {}): Promise<KnowledgeListPage> =>
  normalizePaginatedResponse<Schemas['KnowledgeResponse']>(
    await api.get<Schemas['KnowledgeListResponse']>('/api/knowledge', params, { responseMode: 'raw' }),
  )
export const getKnowledgeCategories = (): Promise<Schemas['KnowledgeCategoryResponse'][]> =>
  api.get('/api/knowledge/categories')
export const getKnowledgeStats = (): Promise<Schemas['KnowledgeStatsResponse']> => api.get('/api/knowledge/stats')
export const getKnowledge = (id: EntityId): Promise<Schemas['KnowledgeResponse']> => api.get(`/api/knowledge/${id}`)
export const createKnowledge = (data: Schemas['KnowledgeCreateRequest']): Promise<Schemas['KnowledgeResponse']> =>
  api.post('/api/knowledge', data)
export const updateKnowledge = (
  id: EntityId,
  data: Schemas['KnowledgeUpdateRequest'],
): Promise<Schemas['KnowledgeResponse']> => api.put(`/api/knowledge/${id}`, data)
export const deleteKnowledge = (id: EntityId): Promise<Schemas['KnowledgeDeleteResponse']> =>
  api.delete(`/api/knowledge/${id}`)
export const batchImportKnowledge = (
  items: Schemas['KnowledgeBatchImportItem'][],
): Promise<Schemas['KnowledgeBatchImportResponse']> => api.post('/api/knowledge/batch-import', items)
export const syncKnowledgeVector = (): Promise<paths['/api/knowledge/sync-vector']['post']['responses']['200']> =>
  api.post('/api/knowledge/sync-vector')
export const testKnowledgeRetrieval = (
  data: Schemas['RetrievalTestRequest'],
): Promise<paths['/api/knowledge/retrieval-test']['post']['responses']['200']> => api.post('/api/knowledge/retrieval-test', data)
