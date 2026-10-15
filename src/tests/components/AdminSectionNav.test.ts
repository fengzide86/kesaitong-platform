import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import AdminSectionNav from '@/components/AdminSectionNav.vue'

let router: Router
const wrappers: VueWrapper[] = []
const paths = ['dashboard', 'authcodes', 'business-access', 'orders', 'profit', 'expenses', 'users', 'feedback', 'knowledge', 'ai-chat', 'announcements', 'target-reviews', 'updates', 'freight-rates', 'settings', 'staff-accounts', 'agency', 'commercial', 'team-ledger', 'scenarios', 'local-runtime']
async function render(path: string, role = 'super_admin') {
  sessionStorage.setItem('toolbox_role', role)
  await router.push(path)
  const wrapper = mount(AdminSectionNav, { global: { plugins: [router] } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  router = createRouter({ history: createMemoryHistory(), routes: paths.map(path => ({ path: `/admin/${path}`, component: { template: '<div />' } })) })
})
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()) })

describe('AdminSectionNav', () => {
  it('only displays the current area and preserves direct link context on the active item', async () => {
    const wrapper = await render('/admin/authcodes?status=expired&auth_code_id=20')
    expect(wrapper.get('nav').attributes('aria-label')).toBe('客户与授权页面')
    expect(wrapper.findAll('a').map(link => link.text())).toEqual(['用户管理', '本机多账号现场', '授权码管理'])
    await wrapper.get('[aria-current="page"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ status: 'expired', auth_code_id: '20' })
  })
  it('links to existing agency support without copying another backend page', async () => {
    const wrapper = await render('/admin/feedback')
    await wrapper.findAll('a').find(item => item.text() === '代理售后')!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/admin/agency?section=requests')
    expect(wrapper.get('[aria-current="page"]').text()).toBe('代理售后')
    expect(wrapper.findAll('[aria-current="page"]')).toHaveLength(1)
  })
  it('places agency commission in finance while keeping the original permissions', async () => {
    const wrapper = await render('/admin/agency?section=commission')
    expect(wrapper.findAll('a').map(link => link.text())).toEqual(['分润管理', '成员结算台账', '公账支出', '代理返佣'])
    expect(wrapper.get('[aria-current="page"]').text()).toBe('代理返佣')
  })
  it.each(['operator', 'support'])('hides owner-only agency support from %s', async role => {
    const wrapper = await render('/admin/feedback', role)
    expect(wrapper.findAll('a').map(link => link.text())).toEqual(['工单管理', '知识库管理', '客服规则'])
  })
  it('operator product area excludes settings, updates, rates and staff management', async () => {
    const wrapper = await render('/admin/business-access', 'operator')
    expect(wrapper.findAll('a').map(link => link.text())).toEqual(['工作台开放', '公告管理'])
  })
  it.each(['/admin/dashboard', '/admin/announcements'])('does not add a redundant one-item navigation for support: %s', async path => {
    const wrapper = await render(path, 'support')
    expect(wrapper.find('nav').exists()).toBe(false)
  })
  it('uses native links in a focusable narrow-window scroll region', async () => {
    const wrapper = await render('/admin/settings')
    expect(wrapper.get('nav').attributes('tabindex')).toBe('0')
    expect(wrapper.findAll('a')).toHaveLength(8)
  })
})
