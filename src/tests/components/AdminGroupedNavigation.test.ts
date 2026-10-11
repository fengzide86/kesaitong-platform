import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import AdminSidebar from '@/components/AdminSidebar.vue'

let router: Router
const wrappers: VueWrapper[] = []
const paths = ['dashboard', 'authcodes', 'business-access', 'orders', 'profit', 'expenses', 'users', 'feedback', 'knowledge', 'ai-chat', 'announcements', 'updates', 'freight-rates', 'settings', 'staff-accounts', 'agency']
async function render(path = '/admin/dashboard', role = 'super_admin') {
  sessionStorage.setItem('toolbox_role', role)
  await router.push(path)
  const wrapper = mount(AdminSidebar, { global: { plugins: [router] } })
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

describe('AdminSidebar: grouped product navigation', () => {
  it('keeps the accepted brand and exactly six principal destinations', async () => {
    const wrapper = await render()
    expect(wrapper.get('[data-testid="kst-brand-lockup"]').attributes('aria-label')).toBe('课赛通 KST，运营控制中心')
    expect(wrapper.findAll('.menu-label').map(item => item.text())).toEqual(['行动中心', '客户与授权', '订单与代理', '售后支持', '经营财务', '产品与系统'])
    expect(wrapper.findAll('a.menu-nav-item')).toHaveLength(6)
    expect(wrapper.find('.logout-item').exists()).toBe(false)
  })
  it.each([
    ['/admin/users?user_id=42', '客户与授权'],
    ['/admin/authcodes?status=expired', '客户与授权'],
    ['/admin/orders?order_id=21', '订单与代理'],
    ['/admin/agency?section=licenses', '订单与代理'],
    ['/admin/agency?section=requests&request_id=12', '售后支持'],
    ['/admin/agency?section=commission', '经营财务'],
    ['/admin/announcements', '产品与系统'],
  ])('highlights the parent for direct links without dropping context: %s', async (path, label) => {
    const wrapper = await render(path)
    const links = wrapper.findAll('.menu-nav-item.is-active')
    expect(links).toHaveLength(1)
    expect(links[0]!.text()).toContain(label)
    expect(links[0]!.attributes('aria-current')).toBe('location')
    await links[0]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe(path)
  })
  it('updates selection when the same agency route changes section', async () => {
    const wrapper = await render('/admin/agency?section=orders')
    await router.push('/admin/agency?section=requests')
    expect(wrapper.get('.menu-nav-item.is-active').text()).toContain('售后支持')
    await router.push('/admin/agency?section=commission')
    expect(wrapper.get('.menu-nav-item.is-active').text()).toContain('经营财务')
  })
  it('does not elevate support permissions via product grouping', async () => {
    const wrapper = await render('/admin/feedback', 'support')
    expect(wrapper.findAll('.menu-label').map(item => item.text())).toEqual(['行动中心', '客户与授权', '订单与代理', '售后支持', '产品与系统'])
    expect(wrapper.findAll('a').find(link => link.text().includes('产品与系统'))!.attributes('href')).toBe('/admin/announcements')
  })
  it.each(['agent', 'user'])('never exposes internal navigation to %s', async role => {
    const wrapper = await render('/admin/dashboard', role)
    expect(wrapper.findAll('.menu-nav-item')).toHaveLength(0)
  })
  it('removes staff links immediately when the session is cleared', async () => {
    const wrapper = await render()
    sessionStorage.clear()
    window.dispatchEvent(new CustomEvent('toolbox:auth-cleared'))
    await flushPromises()
    expect(wrapper.findAll('.menu-nav-item')).toHaveLength(0)
  })
  it('provides native keyboard links, not extra landing pages', async () => {
    const wrapper = await render()
    expect(wrapper.findAll('.menu-nav-item').every(link => link.element.tagName === 'A')).toBe(true)
    expect(wrapper.findAll('a').map(link => link.attributes('href'))).toEqual(['/admin/dashboard', '/admin/users', '/admin/orders', '/admin/feedback', '/admin/profit', '/admin/settings'])
  })
})
