import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listTargetProfiles, listTargetProfileReviews, reviewTargetProfile, submitTargetProfile } from '@/utils/api/target-profiles'
import { targetProfile } from '../features/target-fixtures'
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/utils/api/index', () => ({ api: mocks }))
describe('target profile API', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.get.mockResolvedValue([targetProfile()]); mocks.post.mockResolvedValue({ success: true, data: targetProfile() }) })
  it('readiness lists bypass caches and use distinct customer/admin endpoints', async () => {
    await listTargetProfiles(); await listTargetProfileReviews()
    expect(mocks.get).toHaveBeenNthCalledWith(1, '/api/tools/target-profiles', {}, { cache: false })
    expect(mocks.get).toHaveBeenNthCalledWith(2, '/api/tool-releases/target-profiles', {}, { cache: false })
  })
  it('write endpoints never automatically retry or publish an installer', async () => {
    const profile = targetProfile().profile
    await submitTargetProfile({ name: profile.name, entryUrl: profile.entryUrl })
    const payload = { revision: 1, reviewStatus: 'approved' as const, edition: profile.edition, allowedRoutes: profile.allowedRoutes, capabilities: profile.capabilities, adapterVersion: profile.adapterVersion, evidence: { ...profile.evidence, source: 'admin-verified' as const }, executionScopes: profile.executionScopes || [] }
    await reviewTargetProfile('school-a', payload)
    expect(mocks.post).toHaveBeenNthCalledWith(1, '/api/tools/target-profiles', { name: profile.name, entryUrl: profile.entryUrl }, { retry: 'none' })
    expect(mocks.post).toHaveBeenNthCalledWith(2, '/api/tool-releases/target-profiles/school-a/review', payload, { retry: 'none' })
  })
  it('incompatible server responses cannot create a fabricated approval', async () => {
    mocks.get.mockResolvedValue([{ profile: { id: 'unknown' }, signature: 'not-enough' }])
    await expect(listTargetProfiles()).rejects.toThrow()
  })
})
