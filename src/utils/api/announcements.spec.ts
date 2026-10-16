import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('./index', () => ({ api }))

import { dismissAnnouncement, markAnnouncementRead } from './announcements'

describe('announcement receipt request', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ['read', markAnnouncementRead],
    ['dismiss', dismissAnnouncement],
  ] as const)('sends the displayed revision for %s', async (action, save) => {
    api.post.mockResolvedValue({ success: true, data: { announcement_id: 8, revision: 2, action } })
    await save(8, 2)
    expect(api.post).toHaveBeenCalledWith(`/api/announcements/8/${action}`, { revision: 2 })
  })
})
