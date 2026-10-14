import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authService } from '@/utils/auth'
import { createReleaseUploadSession } from '@/features/updates/release-upload-session'

beforeEach(() => {
  window.dispatchEvent(new Event('toolbox:auth-cleared'))
  vi.spyOn(authService, 'getRole').mockReturnValue('super_admin')
  vi.spyOn(authService, 'getUser').mockReturnValue({ staff_id: 1 })
})
afterEach(() => vi.restoreAllMocks())

describe('release upload session guard', () => {
  it('retains only version and timestamp across route instances', () => {
    createReleaseUploadSession().remember('1.8.16')
    expect(createReleaseUploadSession().read()).toEqual({ version: '1.8.16', since: expect.any(Number) })
  })

  it('isolates a new account and rejects stale callbacks from the old account', () => {
    const old = createReleaseUploadSession()
    old.remember('1.8.16')
    vi.mocked(authService.getUser).mockReturnValue({ staff_id: 2 })
    const next = createReleaseUploadSession()
    expect(next.read()).toBeUndefined()
    old.remember('1.8.17')
    expect(next.read()).toBeUndefined()
    expect(old.isCurrent()).toBe(false)
  })

  it('clears on logout and old async completions cannot change a new login guard', () => {
    const old = createReleaseUploadSession()
    old.remember('1.8.16')
    window.dispatchEvent(new Event('toolbox:auth-cleared'))
    const next = createReleaseUploadSession()
    expect(next.read()).toBeUndefined()
    next.remember('1.8.16')
    old.clear('1.8.16')
    old.remember('1.8.17')
    expect(next.read()?.version).toBe('1.8.16')
  })
})
