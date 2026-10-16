import { api } from './index'
import type { components } from '@/shared/api/openapi.generated'

type AnnouncementId = string | number
type Schemas = components['schemas']
type AnnouncementList = NonNullable<Schemas['APIResponse_list_AnnouncementResponse__']['data']>

export const getAnnouncements = (status?: string): Promise<AnnouncementList> =>
  api.get('/api/announcements', status ? { status } : {})

export const getAnnouncementFeed = (): Promise<AnnouncementList> =>
  api.get('/api/announcements/feed', {}, { cache: false })
export const markAnnouncementRead = (id: AnnouncementId, revision: number): Promise<Schemas['APIResponse_AnnouncementReceiptResponse_']> =>
  api.post(`/api/announcements/${id}/read`, { revision })
export const dismissAnnouncement = (id: AnnouncementId, revision: number): Promise<Schemas['APIResponse_AnnouncementReceiptResponse_']> =>
  api.post(`/api/announcements/${id}/dismiss`, { revision })
export const createAnnouncement = (
  data: Schemas['AnnouncementCreate'],
): Promise<Schemas['APIResponse_AnnouncementResponse_']> => api.post('/api/announcements', data)
export const updateAnnouncement = (
  id: AnnouncementId,
  data: Schemas['AnnouncementUpdate'],
): Promise<Schemas['APIResponse_AnnouncementResponse_']> => api.put(`/api/announcements/${id}`, data)
export const deleteAnnouncement = (id: AnnouncementId): Promise<Schemas['APIResponse_NoneType_']> =>
  api.delete(`/api/announcements/${id}`)
