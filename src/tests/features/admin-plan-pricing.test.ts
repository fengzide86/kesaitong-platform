import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAdminSettings } from '@/features/admin/useAdminSettings'

const mocks = vi.hoisted(() => ({
  archivePlan: vi.fn(), createPlan: vi.fn(), disablePlan: vi.fn(), enablePlan: vi.fn(),
  getPlansAdmin: vi.fn(), getProfitPolicy: vi.fn(), getSettings: vi.fn(),
  updatePlan: vi.fn(), updateProfitPolicy: vi.fn(), updateSetting: vi.fn(),
  confirmAction: vi.fn(), showToast: vi.fn(),
}))
vi.mock('@/utils/api', () => mocks)
vi.mock('@/utils', () => ({ showToast: mocks.showToast }))
vi.mock('@/shared/ui/confirm', () => ({ confirmAction: mocks.confirmAction }))
vi.mock('@/utils/auth', () => ({ authService: { getRole: () => 'super_admin' } }))

const basePlan = {
  id: 1, name: '专业版', price: 199, duration_days: 30, features: '原说明',
  status: 'active', product_type: 'business', entitlements: {},
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

let wrapper: ReturnType<typeof mount> | undefined
async function mountSettings() {
  let api!: ReturnType<typeof useAdminSettings>
  wrapper = mount(defineComponent({ setup() {
    api = useAdminSettings()
    return () => h('div')
  } }))
  await flushPromises()
  api.startEdit(basePlan)
  return api
}

describe('后台套餐改价确认与并发保护', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.getPlansAdmin.mockResolvedValue([basePlan])
    mocks.getSettings.mockResolvedValue([])
    // The independent profit-policy panel is irrelevant to plan editing.
    mocks.getProfitPolicy.mockRejectedValue(new Error('not loaded'))
    mocks.updatePlan.mockResolvedValue({})
    mocks.confirmAction.mockResolvedValue(true)
  })
  afterEach(() => { wrapper?.unmount() })

  it('未加载分润版本时不保存，加载后携带期望版本且冲突保留草稿', async () => {
    const api = await mountSettings()
    await api.saveProfitRatios()
    expect(mocks.updateProfitPolicy).not.toHaveBeenCalled()
    mocks.getProfitPolicy.mockResolvedValue({ version: 8, ratios: {
      tech: 0.3, market: 0.25, product: 0.15, service: 0.15, coordination: 0.1, record: 0.05,
    } })
    await api.loadData()
    api.openProfitEdit()
    mocks.updateProfitPolicy.mockRejectedValue(new Error('策略已更新，请刷新后重试'))
    await api.saveProfitRatios()
    expect(mocks.updateProfitPolicy).toHaveBeenCalledWith(expect.any(Object), 8)
    expect(api.showProfitModal.value).toBe(true)
    expect(mocks.showToast).toHaveBeenCalledWith('策略已更新，请刷新后重试', 'error')
  })

  it('无变化不保存，也不弹改价确认', async () => {
    const api = await mountSettings()
    await api.savePlan()
    expect(mocks.updatePlan).not.toHaveBeenCalled()
    expect(mocks.confirmAction).not.toHaveBeenCalled()
    expect(mocks.showToast).toHaveBeenCalledWith('没有需要保存的修改', 'info')
    expect(api.savingPlan.value).toBe(false)
  })

  it('只改说明不提交价格，避免把别人的新价覆盖回去', async () => {
    const api = await mountSettings()
    api.editingPlan.value!.features = '新说明'
    await api.savePlan()
    expect(mocks.confirmAction).not.toHaveBeenCalled()
    expect(mocks.updatePlan).toHaveBeenCalledWith(1, { features: '新说明' })
    expect(api.editingPlan.value).toBeNull()
  })

  it('取消确认不写入，保留草稿允许重新确认', async () => {
    const api = await mountSettings()
    api.editingPlan.value!.price = 299
    mocks.confirmAction.mockResolvedValueOnce(false)
    await api.savePlan()
    expect(mocks.updatePlan).not.toHaveBeenCalled()
    expect(api.editingPlan.value?.price).toBe(299)
    expect(api.savingPlan.value).toBe(false)
    await api.savePlan()
    expect(mocks.updatePlan).toHaveBeenCalledWith(1, { price: 299, expected_price: 199 })
  })

  it('先校验金额，非法值不打开确认也不发请求', async () => {
    const api = await mountSettings()
    api.editingPlan.value!.price = NaN
    await api.savePlan()
    expect(mocks.confirmAction).not.toHaveBeenCalled()
    expect(mocks.updatePlan).not.toHaveBeenCalled()
    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining('套餐价格'), 'error')
    expect(api.savingPlan.value).toBe(false)
  })

  it('确认期间防重复保存、切换编辑和其他生命周期操作；请求使用确认快照', async () => {
    const api = await mountSettings()
    const confirmation = deferred<boolean>()
    mocks.confirmAction.mockReturnValueOnce(confirmation.promise)
    api.editingPlan.value!.price = 299
    const pending = api.savePlan()
    expect(api.savingPlan.value).toBe(true)
    expect(mocks.confirmAction).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('原价 ¥199.00 → 新价 ¥299.00'),
    }))
    await api.savePlan()
    api.startEdit({ ...basePlan, id: 2 })
    api.openPlanPermissions({ ...basePlan, status: 'disabled' })
    await api.togglePlanStatus(basePlan)
    await api.archivePlanStatus(basePlan)
    expect(api.editingPlan.value?.id).toBe(1)
    expect(api.showPlanPermissions.value).toBe(false)
    expect(mocks.disablePlan).not.toHaveBeenCalled()
    expect(mocks.archivePlan).not.toHaveBeenCalled()
    expect(mocks.confirmAction).toHaveBeenCalledTimes(1)
    // UI inputs are disabled. Even a programmatic mutation cannot alter confirmed values.
    api.editingPlan.value!.price = 399
    confirmation.resolve(true)
    await pending
    expect(mocks.updatePlan).toHaveBeenCalledExactlyOnceWith(1, { price: 299, expected_price: 199 })
    expect(api.savingPlan.value).toBe(false)
  })

  it('保存请求 pending 时不重复发送', async () => {
    const api = await mountSettings()
    const request = deferred<object>()
    mocks.updatePlan.mockReturnValueOnce(request.promise)
    api.editingPlan.value!.features = '新说明'
    const pending = api.savePlan()
    await api.savePlan()
    expect(mocks.updatePlan).toHaveBeenCalledTimes(1)
    request.resolve({})
    await pending
    expect(api.savingPlan.value).toBe(false)
  })

  it('冲突保留草稿并展示重新确认提示；重新打开以最新价格作为基线', async () => {
    const api = await mountSettings()
    api.editingPlan.value!.price = 299
    const message = '套餐价格已被其他管理员修改，请取消编辑、刷新后重新确认'
    mocks.updatePlan.mockRejectedValueOnce(new Error(message))
    await api.savePlan()
    expect(api.editingPlan.value?.price).toBe(299)
    expect(mocks.showToast).toHaveBeenCalledWith(message, 'error')
    api.startEdit({ ...basePlan, price: 249 })
    api.editingPlan.value!.price = 299
    await api.savePlan()
    expect(mocks.updatePlan).toHaveBeenLastCalledWith(1, { price: 299, expected_price: 249 })
  })

  it('禁用套餐改价同样确认，授权不被描述成按新价格重新计费', async () => {
    const api = await mountSettings()
    api.startEdit({ ...basePlan, status: 'disabled' })
    api.editingPlan.value!.price = 299
    await api.savePlan()
    expect(mocks.confirmAction).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('历史订单金额和已发授权权益保持不变'),
    }))
    expect(mocks.updatePlan).toHaveBeenCalledWith(1, { price: 299, expected_price: 199 })
  })

  it('网络失败释放保存状态并允许重试', async () => {
    const api = await mountSettings()
    api.editingPlan.value!.features = '新说明'
    mocks.updatePlan.mockRejectedValueOnce(new Error('网络连接失败'))
    await api.savePlan()
    expect(api.savingPlan.value).toBe(false)
    expect(api.editingPlan.value?.features).toBe('新说明')
    await api.savePlan()
    expect(mocks.updatePlan).toHaveBeenCalledTimes(2)
    expect(api.editingPlan.value).toBeNull()
  })

  it('禁用套餐同时改价格和有效期时明确未激活授权的影响', async () => {
    const api = await mountSettings()
    api.startEdit({ ...basePlan, status: 'disabled' })
    api.editingPlan.value!.price = 299
    api.editingPlan.value!.duration_days = 60
    await api.savePlan()
    expect(mocks.confirmAction).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('同时将有效期从 30 天改为 60 天'),
    }))
    expect(mocks.confirmAction).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('尚未激活的授权码首次激活时使用新有效期'),
    }))
    expect(mocks.confirmAction.mock.calls[0][0].message).not.toContain('已发授权权益保持不变')
    expect(mocks.updatePlan).toHaveBeenCalledWith(1, { price: 299, expected_price: 199, duration_days: 60 })
  })
})
