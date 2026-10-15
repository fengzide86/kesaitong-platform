import { computed, onMounted, ref } from 'vue'
import {
  archivePlan,
  createPlan,
  disablePlan,
  enablePlan,
  getPlansAdmin,
  getProfitPolicy,
  getSettings,
  updatePlan,
  updateProfitPolicy,
  updateSetting,
} from '@/utils/api'
import { showToast } from '@/utils'
import { confirmAction } from '@/shared/ui/confirm'
import { hasStaffPermission } from '@/features/auth/permissions'
import { authService } from '@/utils/auth'
import {
  adminPlanSchema,
  adminPlansSchema,
  adminSettingsSchema,
  profitPolicySchema,
  type AdminPlan,
} from '@/features/admin/model'
import {
  buildDisplayPlanPatch,
  buildPlanPermissionsPatch,
  type PlanPermissionDraft,
} from '@/features/admin/planLifecycle'

export function useAdminSettings() {
  const plans = ref<AdminPlan[]>([])
  const settings = ref<Array<{ key: string; value?: string | null }>>([])
  const editingPlan = ref<AdminPlan | null>(null)
  const editingPlanOriginal = ref<AdminPlan | null>(null)
  const savingPlan = ref(false)
  const showAddPlan = ref(false)
  const showPlanPermissions = ref(false)
  const planPermissionDraft = ref<PlanPermissionDraft | null>(null)
  const wechatId = ref('')

  const defaultEntitlements = () => ({
    batch_execution: true,
    multi_account_workspace: true,
    desktop_notification: true,
    usage_metering: false,
    max_batch_rows: 50,
    max_open_sessions: 6,
  })
  const newPlan = ref({
    name: '',
    price: 1,
    duration_days: 7,
    features: '',
    product_type: 'consumer' as 'consumer' | 'business',
    entitlements: defaultEntitlements(),
  })

  const showProfitModal = ref(false)
  const profitPolicyVersion = ref<number | null>(null)
  const canEditProfitPolicy = computed(() => hasStaffPermission(authService.getRole(), 'profit.policy.write'))
  const profitRatios = ref({
    tech: 30,
    market: 25,
    product: 15,
    service: 15,
    coordination: 10,
    record: 5,
  })

  const profitTotal = computed(() => (
    profitRatios.value.tech + profitRatios.value.market + profitRatios.value.product
    + profitRatios.value.service + profitRatios.value.coordination + profitRatios.value.record
  ))

  const profitRatiosText = computed(() => {
    const ratios = profitRatios.value
    return `技术${ratios.tech}% / 市场${ratios.market}% / 产品${ratios.product}% / 客服${ratios.service}% / 统筹${ratios.coordination}% / 记录${ratios.record}%`
  })

  async function loadData() {
    const results = await Promise.allSettled([
      getPlansAdmin(),
      getSettings(),
      getProfitPolicy(),
    ])
    const [plansResult, settingsResult, profitPolicyResult] = results

    if (plansResult.status === 'fulfilled') {
      plans.value = adminPlansSchema.parse(plansResult.value)
    }
    if (settingsResult.status === 'fulfilled') {
      const parsedSettings = adminSettingsSchema.parse(settingsResult.value)
      settings.value = parsedSettings
      const wxSetting = parsedSettings.find((setting) => setting.key === 'wechat_id')
      if (wxSetting) wechatId.value = wxSetting.value || ''
    }
    if (profitPolicyResult.status === 'fulfilled') {
      const policy = profitPolicySchema.parse(profitPolicyResult.value)
      profitPolicyVersion.value = policy.version
      profitRatios.value = {
        tech: Number((policy.ratios.tech * 100).toFixed(2)),
        market: Number((policy.ratios.market * 100).toFixed(2)),
        product: Number((policy.ratios.product * 100).toFixed(2)),
        service: Number((policy.ratios.service * 100).toFixed(2)),
        coordination: Number((policy.ratios.coordination * 100).toFixed(2)),
        record: Number((policy.ratios.record * 100).toFixed(2)),
      }
    }
    if (results.every((result) => result.status === 'rejected')) {
      showToast('数据加载失败', 'error')
    }
  }

  async function saveWechat() {
    try {
      await updateSetting({
        key: 'wechat_id',
        value: wechatId.value,
        description: '客服微信号',
      })
      showToast('已保存', 'success')
    } catch {
      showToast('保存失败', 'error')
    }
  }

  function startEdit(rawPlan: unknown) {
    if (savingPlan.value) return
    const plan = adminPlanSchema.parse(rawPlan)
    if (plan.status === 'archived') return
    editingPlan.value = { ...plan }
    editingPlanOriginal.value = { ...plan }
  }

  async function savePlan() {
    const draft = editingPlan.value
    const original = editingPlanOriginal.value
    if (!draft || !original || savingPlan.value) return
    savingPlan.value = true
    try {
      // Validate and freeze primitive request values before opening the async confirmation.
      const plan = { ...draft }
      const patch = buildDisplayPlanPatch(plan, original)
      if (Object.keys(patch).length === 0) {
        showToast('没有需要保存的修改', 'info')
        return
      }
      if (
        'price' in patch
        && !await confirmAction({
          title: '确认调整套餐价格？',
          message: `“${plan.name.trim()}”：原价 ¥${original.price.toFixed(2)} → 新价 ¥${plan.price.toFixed(2)}。${
            'duration_days' in patch
              ? `同时将有效期从 ${original.duration_days} 天改为 ${plan.duration_days} 天；尚未激活的授权码首次激活时使用新有效期。历史订单金额不变。`
              : '调整仅影响新订单，历史订单金额和已发授权权益保持不变。'
          }`,
          confirmText: '确认调整',
        })
      ) return
      await updatePlan(plan.id, patch)
      showToast('套餐已更新', 'success')
      if (editingPlan.value === draft) {
        editingPlan.value = null
        editingPlanOriginal.value = null
      }
      await loadData()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '更新失败，请检查套餐状态和输入内容', 'error')
    } finally {
      savingPlan.value = false
    }
  }

  function openPlanPermissions(rawPlan: unknown) {
    if (savingPlan.value) return
    const plan = adminPlanSchema.parse(rawPlan)
    if (plan.status !== 'disabled') {
      showToast('请先禁用套餐，再修改产品类型和专业权限', 'warning')
      return
    }
    const entitlements = { ...defaultEntitlements(), ...(plan.entitlements || {}) }
    planPermissionDraft.value = {
      id: plan.id,
      status: 'disabled',
      product_type: plan.product_type || 'consumer',
      batchEnabled: Boolean(entitlements.batch_execution && entitlements.multi_account_workspace),
      maxBatchRows: Number(entitlements.max_batch_rows || 50),
      maxOpenSessions: Number(entitlements.max_open_sessions || 6),
      desktopNotification: entitlements.desktop_notification !== false,
    }
    showPlanPermissions.value = true
  }

  async function savePlanPermissions() {
    const draft = planPermissionDraft.value
    if (!draft) return
    try {
      await updatePlan(draft.id, buildPlanPermissionsPatch(draft))
      showPlanPermissions.value = false
      showToast('产品权限已更新', 'success')
      await loadData()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '产品权限保存失败，请刷新后重试', 'error')
    }
  }

  async function togglePlanStatus(rawPlan: unknown) {
    if (savingPlan.value) return
    const plan = adminPlanSchema.parse(rawPlan)
    if (plan.status !== 'active' && plan.status !== 'disabled') return
    const enabling = plan.status === 'disabled'
    try {
      if (enabling) await enablePlan(plan.id)
      else await disablePlan(plan.id)
      showToast(enabling ? '已启用' : '已禁用', 'success')
      editingPlan.value = null
      await loadData()
    } catch {
      showToast('状态切换失败', 'error')
    }
  }

  async function archivePlanStatus(rawPlan: unknown) {
    if (savingPlan.value) return
    const plan = adminPlanSchema.parse(rawPlan)
    if (plan.status === 'archived') return
    if (!await confirmAction({
      title: '归档套餐？',
      message: `归档“${plan.name}”后不能恢复或修改；存在可用授权码时后端会拒绝归档。`,
      confirmText: '确认归档',
      danger: true,
    })) return
    try {
      await archivePlan(plan.id)
      showToast('套餐已归档', 'success')
      editingPlan.value = null
      await loadData()
    } catch {
      showToast('归档失败，请先处理该套餐的可用授权码', 'error')
    }
  }

  async function addPlan() {
    if (!newPlan.value.name.trim()) {
      showToast('请输入套餐名称', 'error')
      return
    }
    if (!Number.isFinite(newPlan.value.price) || newPlan.value.price <= 0) {
      showToast('套餐价格必须大于 0', 'error')
      return
    }
    if (!Number.isInteger(newPlan.value.duration_days) || newPlan.value.duration_days <= 0) {
      showToast('有效期必须是大于 0 的整数天数', 'error')
      return
    }
    try {
      const isBusiness = newPlan.value.product_type === 'business'
      await createPlan({
        ...newPlan.value,
        name: newPlan.value.name.trim(),
        entitlements: {
          ...newPlan.value.entitlements,
          batch_execution: isBusiness,
          multi_account_workspace: isBusiness,
        },
      })
      showToast('套餐已添加；默认处于禁用状态', 'success')
      showAddPlan.value = false
      newPlan.value = {
        name: '',
        price: 1,
        duration_days: 7,
        features: '',
        product_type: 'consumer',
        entitlements: defaultEntitlements(),
      }
      await loadData()
    } catch {
      showToast('添加失败', 'error')
    }
  }

  function planStatusText(status?: string) {
    return status === 'active' ? '启用' : status === 'disabled' ? '禁用' : status === 'archived' ? '已归档' : '未知'
  }

  function planStatusType(status?: string): 'success' | 'danger' | 'info' {
    return status === 'active' ? 'success' : status === 'disabled' ? 'danger' : 'info'
  }

  function openProfitEdit() {
    if (!canEditProfitPolicy.value) return
    showProfitModal.value = true
  }

  async function saveProfitRatios() {
    if (!canEditProfitPolicy.value) return
    if (profitPolicyVersion.value === null) {
      showToast('请先加载当前分润策略后再保存', 'error')
      return
    }
    if (Math.abs(profitTotal.value - 100) > 0.001) {
      showToast('分润比例总和必须为100%', 'error')
      return
    }
    try {
      const normalizedRatios = {
        tech: Number((profitRatios.value.tech / 100).toFixed(6)),
        market: Number((profitRatios.value.market / 100).toFixed(6)),
        product: Number((profitRatios.value.product / 100).toFixed(6)),
        service: Number((profitRatios.value.service / 100).toFixed(6)),
        coordination: Number((profitRatios.value.coordination / 100).toFixed(6)),
        record: Number((profitRatios.value.record / 100).toFixed(6)),
      }
      await updateProfitPolicy(normalizedRatios, profitPolicyVersion.value)
      showToast('分润比例已更新', 'success')
      showProfitModal.value = false
      await loadData()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存失败', 'error')
    }
  }

  onMounted(loadData)

  return {
    plans,
    settings,
    editingPlan,
    savingPlan,
    showAddPlan,
    showPlanPermissions,
    planPermissionDraft,
    wechatId,
    newPlan,
    showProfitModal,
    canEditProfitPolicy,
    profitRatios,
    profitTotal,
    profitRatiosText,
    loadData,
    saveWechat,
    startEdit,
    savePlan,
    openPlanPermissions,
    savePlanPermissions,
    togglePlanStatus,
    archivePlanStatus,
    addPlan,
    planStatusText,
    planStatusType,
    openProfitEdit,
    saveProfitRatios,
  }
}
