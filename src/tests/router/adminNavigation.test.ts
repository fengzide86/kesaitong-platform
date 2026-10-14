import { describe, expect, it } from 'vitest'
import router from '@/router'
import { getAdminNavigation, getAdminNavigationSelection } from '@/features/admin/navigation'

describe('Admin navigation permission and legacy route compatibility', () => {
  it.each(['super_admin', 'operator', 'support', 'agent', 'user'] as const)('only points %s to routes it may visit', role => {
    for (const area of getAdminNavigation(role)) {
      for (const entry of area.items) {
        const resolved = router.resolve(entry.to)
        expect(resolved.name).not.toBe('NotFound')
        expect(resolved.meta.roles).toContain(role)
        expect(getAdminNavigationSelection(getAdminNavigation(role), resolved)?.item.id).toBe(entry.id)
      }
    }
  })
  it('keeps all admin routes discoverable without creating landing routes', () => {
    const paths = getAdminNavigation('super_admin').flatMap(area => area.items.map(entry => entry.path))
    expect(new Set(paths).size).toBe(17)
    const originals = router.getRoutes().filter(route => route.path.startsWith('/admin/') && !['AdminLogin', 'AdminChangePassword'].includes(String(route.name)))
    expect([...new Set(paths)].sort()).toEqual(originals.map(route => route.path).sort())
  })
  it('unknown agency sections retain the owner default instead of enabling another permission', () => {
    const location = { path: '/admin/agency', query: { section: 'not-a-section' } }
    expect(getAdminNavigationSelection(getAdminNavigation('super_admin'), location)?.item.id).toBe('agency')
    expect(getAdminNavigationSelection(getAdminNavigation('support'), location)).toBeUndefined()
  })
})
