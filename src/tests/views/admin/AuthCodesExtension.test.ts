import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import AuthCodesView from '@/views/admin/AuthCodesView.vue'
import { mountWithPinia } from '@/tests/helpers'
import { authService } from '@/utils/auth'

const mocks = vi.hoisted(() => ({ update: vi.fn(), extend: vi.fn(), toast: vi.fn() }))
vi.mock('@/utils/api/auth-codes', () => ({ extendAuthCode: (...args: unknown[]) => mocks.extend(...args) }))
vi.mock('vue-router', () => ({ useRouter: () => ({ currentRoute: { value: { query: {} } }, replace: vi.fn() }) }))
vi.mock('@/utils/api', () => ({
  getAuthCodesPage: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20 }),
  getPlansAdmin: vi.fn().mockResolvedValue([]),
  getAuthCode: vi.fn(), getUsersPage: vi.fn(), batchGenerateAuthCodes: vi.fn(),
  updateAuthCode: (...args: unknown[]) => mocks.update(...args), deleteAuthCode: vi.fn(), unbindDevice: vi.fn(),
}))
vi.mock('@/utils', () => ({ showToast: (...args: unknown[]) => mocks.toast(...args) }))

function mountView() {
  return mountWithPinia(AuthCodesView, { global: { directives: { loading: {} }, stubs: {
    RouterLink: true, PageHeader: true, AsyncStateNotice: true, AdminDetailDrawer: true,
    DataToolbar: true, 'el-card': true, 'el-table': true, 'el-table-column': true,
    'el-select': true, 'el-option': true, 'el-input': true, 'el-input-number': true,
    'el-dialog': true, 'el-button': true, 'el-tag': true, 'el-dropdown': true,
    'el-dropdown-menu': true, 'el-dropdown-item': true, 'el-pagination': true,
  } } })
}

interface ExtensionState {
  openExtend: (code: unknown) => void
  confirmExtend: () => Promise<void>
  toggleFreeze: (code: unknown) => Promise<void>
}

describe('授权延期保留首次激活与显式停权边界', () => {
  beforeEach(() => { vi.clearAllMocks(); authService.setRole('super_admin') })

  it.each([
    ['自然过期未激活', 'expired', 'unused', null, undefined],
    ['自然过期已激活', 'expired', 'active', 7, undefined],
    ['显式过期未激活', 'expired', 'expired', null, 'unused'],
    ['显式过期已激活', 'expired', 'expired', 7, 'active'],
    ['冻结授权', 'frozen', 'frozen', 7, undefined],
    ['延期前已被另一管理员冻结', 'expired', 'frozen', 7, undefined],
    ['延期前已被另一管理员删除', 'expired', 'deleted', 7, undefined],
  ])('%s只发一次原子续期，不追加状态覆盖', async (_label, displayedStatus, returnedStatus, userId) => {
    const wrapper = mountView()
    await flushPromises()
    const state = wrapper.vm as unknown as ExtensionState
    const code = { id: 9, code: 'EXTENSION-TEST', status: displayedStatus, expires_at: '2020-01-01T00:00:00', user_id: userId, devices: [] }
    mocks.extend.mockResolvedValue({ ...code, status: returnedStatus })
    state.openExtend(code)
    await state.confirmExtend()
    expect(mocks.extend).toHaveBeenCalledExactlyOnceWith(9, 30)
    expect(mocks.update).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('延期请求失败时不再发起状态恢复', async () => {
    const wrapper = mountView()
    await flushPromises()
    const state = wrapper.vm as unknown as ExtensionState
    mocks.extend.mockRejectedValueOnce(new Error('延期请求失败'))
    state.openExtend({ id: 9, code: 'EXTENSION-TEST', status: 'expired', user_id: 7, devices: [] })
    await state.confirmExtend()
    expect(mocks.extend).toHaveBeenCalledExactlyOnceWith(9, 30)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('延期失败', 'error')
    wrapper.unmount()
  })

  it.each([
    ['已激活但解绑所有设备', 7, 0, 0, 'active'],
    ['未激活被冻结', null, 0, 0, 'unused'],
    ['历史席位存在但从未创建用户', null, 1, 1, 'unused'],
  ])('解冻%s时以用户身份恢复状态', async (_label, userId, seatUsed, deviceUsed, expectedStatus) => {
    const wrapper = mountView()
    await flushPromises()
    mocks.update.mockResolvedValue({})
    const state = wrapper.vm as unknown as ExtensionState
    await state.toggleFreeze({ id: 9, code: 'UNFREEZE-TEST', status: 'frozen', user_id: userId, seat_used: seatUsed, device_used: deviceUsed, devices: [] })
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(9, { status: expectedStatus })
    wrapper.unmount()
  })
})
