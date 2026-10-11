import type { LocationQueryValue } from 'vue-router'
import { hasStaffPermission } from '@/features/auth/permissions'
import type { AuthRole } from '@/features/auth/model'

export function contextId(value: LocationQueryValue | LocationQueryValue[] | undefined): number | undefined {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return undefined
  const id = Number(value)
  return Number.isSafeInteger(id) ? id : undefined
}

export function contextText(value: LocationQueryValue | LocationQueryValue[] | undefined): string {
  return typeof value === 'string' ? value : ''
}

export function supportSourcePath(fullPath: string): string {
  const [path = '/admin/dashboard', search = ''] = fullPath.split('?', 2)
  const params = new URLSearchParams(search.split('#', 1)[0])
  // Preserve the source's own filters and selected object, never recursively
  // embed its previous return target into another target.
  params.delete('return_to')
  const suffix = params.toString()
  return suffix ? `${path}?${suffix}` : path
}

// Return only to known internal work areas. Route guards still enforce access.
export function supportReturnPath(value: LocationQueryValue | LocationQueryValue[] | undefined, role: AuthRole | null | undefined): string | undefined {
  if (typeof value !== 'string' || value.length > 2048 || /[\\\r\n]/.test(value)) return undefined
  const path = value.split(/[?#]/, 1)[0]
  const allowed = ['/admin/dashboard', '/admin/users', '/admin/authcodes', '/admin/feedback', '/admin/orders', '/admin/agency']
  if (!path || !allowed.includes(path) || !hasStaffPermission(role, 'backoffice.read')) return undefined
  if (path === '/admin/agency' && role !== 'super_admin') return undefined
  return value
}
