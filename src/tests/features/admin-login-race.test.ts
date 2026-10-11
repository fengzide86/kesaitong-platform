import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import AdminLoginView from '@/views/admin/AdminLoginView.vue'

const mocks = vi.hoisted(() => ({ login: vi.fn(), setLogin: vi.fn(), push: vi.fn(), auth: vi.fn(), toast: vi.fn() }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('@/utils', () => ({ Auth: { set: mocks.auth }, showToast: mocks.toast }))
vi.mock('@/utils/api', () => ({ adminLogin: mocks.login }))
vi.mock('@/stores/user', () => ({ useUserStore: () => ({ setLogin: mocks.setLogin }) }))
describe('backoffice login identity', () => {
  beforeEach(() => vi.clearAllMocks())
  it.each([true, false])('does not accept a late response after returning to customer login: success=%s', async success => {
    let finish!: (value: unknown) => void
    mocks.login.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const wrapper = mount(AdminLoginView)
    await wrapper.get('#adminUsername').setValue('original-admin')
    await wrapper.get('#adminPassword').setValue('example-password')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('#adminUsername').attributes('disabled')).toBeDefined()
    await wrapper.get('form').trigger('submit')
    expect(mocks.login).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    finish({ success, message: 'old response', data: success ? { token: 'test-admin-token', role: 'super_admin' } : undefined })
    await flushPromises()
    expect(mocks.setLogin).not.toHaveBeenCalled()
    expect(mocks.auth).not.toHaveBeenCalled()
    expect(mocks.push).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
  })
})
