import type { AuthRole } from '@/features/auth/model'
import { hasStaffPermission, type StaffPermission } from '@/features/auth/permissions'

export type AdminAreaId = 'action' | 'customers' | 'orders' | 'support' | 'finance' | 'system'
interface AdminLocation { path?: string; query?: Record<string, unknown> }
export interface AdminNavigationItem {
  id: string
  label: string
  path: string
  to: string
  permission?: StaffPermission
  section?: 'requests' | 'commission'
}
export interface AdminNavigationArea { id: AdminAreaId; label: string; items: AdminNavigationItem[] }

const item = (id: string, label: string, path: string, permission?: StaffPermission): AdminNavigationItem => ({ id, label, path, to: path, permission })
const areas: readonly AdminNavigationArea[] = [
  { id: 'action', label: '行动中心', items: [item('dashboard', '行动中心', '/admin/dashboard')] },
  { id: 'customers', label: '客户与授权', items: [
    item('users', '用户管理', '/admin/users'),
    item('authcodes', '授权码管理', '/admin/authcodes'),
  ] },
  { id: 'orders', label: '订单与代理', items: [
    item('orders', '订单管理', '/admin/orders'),
    item('agency', '代理与交付', '/admin/agency', 'agency.manage'),
  ] },
  { id: 'support', label: '售后支持', items: [
    item('feedback', '工单管理', '/admin/feedback'),
    item('knowledge', '知识库管理', '/admin/knowledge'),
    item('rules', '客服规则', '/admin/ai-chat', 'rules.write'),
    { ...item('agency-requests', '代理售后', '/admin/agency', 'agency.manage'), to: '/admin/agency?section=requests', section: 'requests' },
  ] },
  { id: 'finance', label: '经营财务', items: [
    item('profit', '分润管理', '/admin/profit', 'profit.read'),
    item('expenses', '公账支出', '/admin/expenses', 'expenses.read'),
    { ...item('agency-commission', '代理返佣', '/admin/agency', 'agency.manage'), to: '/admin/agency?section=commission', section: 'commission' },
  ] },
  { id: 'system', label: '产品与系统', items: [
    item('settings', '套餐与设置', '/admin/settings', 'settings.manage'),
    item('business-access', '工作台开放', '/admin/business-access', 'business_access.write'),
    item('announcements', '公告管理', '/admin/announcements'),
    item('updates', '应用更新', '/admin/updates', 'updates.manage'),
    item('freight-rates', '物流费率', '/admin/freight-rates', 'settings.manage'),
    item('staff-accounts', '后台账号', '/admin/staff-accounts', 'staff.manage'),
  ] },
]

/** Navigation is not an authorization boundary: existing route and API guards remain required. */
export function getAdminNavigation(role: AuthRole | null | undefined): AdminNavigationArea[] {
  if (!hasStaffPermission(role, 'backoffice.read')) return []
  return areas.map(area => ({ ...area, items: area.items.filter(entry => !entry.permission || hasStaffPermission(role, entry.permission)) }))
    .filter(area => area.items.length > 0)
}

export function isAdminItemActive(entry: AdminNavigationItem, location: AdminLocation): boolean {
  if (entry.path !== location.path) return false
  if (entry.path !== '/admin/agency') return true
  const section = location.query?.section
  // These sections have one canonical home, even when reached via the legacy owner tabs.
  if (entry.section) return entry.section === section
  return section !== 'requests' && section !== 'commission'
}

export function getAdminNavigationSelection(navigation: readonly AdminNavigationArea[], location: AdminLocation) {
  for (const area of navigation) {
    const entry = area.items.find(candidate => isAdminItemActive(candidate, location))
    if (entry) return { area, item: entry }
  }
  return undefined
}
