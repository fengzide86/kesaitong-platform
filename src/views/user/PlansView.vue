<template>
  <div class="plans-page">
    <PageHeader eyebrow="授权方案" title="套餐与授权" description="先确认需要使用的工具，再选择包含对应能力的套餐。">
      <template #actions>
        <div class="current-plan"><ShieldCheck :size="16" /><span>当前套餐</span><strong>{{ currentPlanName }}</strong></div>
      </template>
    </PageHeader>

    <section class="license-summary" aria-label="当前授权摘要">
      <div><small>授权期限</small><strong>{{ licenseExpiry }}</strong></div>
      <div><small>可用平台</small><strong>{{ licensePlatforms }}</strong></div>
      <div><small>设备上限</small><strong>{{ userInfo.max_devices ? `${userInfo.max_devices} 台` : '以授权信息为准' }}</strong></div>
      <p>以上为最近一次授权校验信息；项目授权以约定结束时间为准，不自动续费或改动旧权益。</p>
      <button type="button" class="btn btn-secondary" @click="renewCurrent">咨询项目与授权</button>
    </section>

    <div v-if="route.query?.tool" class="upgrade-notice">
      <LockKeyhole :size="17" />当前套餐暂未包含你选择的工具，可查看下面的可用套餐。
    </div>

    <AsyncStateNotice :state="loadState" :message="loadError" loading-text="正在加载套餐..." @retry="loadPlans" />

    <CommercialPricingPanel v-if="(loadState === 'data' || loadState === 'stale') && commercialPlans.length"
                            :plans="commercialPlans" :current-plan-code="currentPlanCode" @consult="contactService" />

    <div v-else-if="(loadState === 'data' || loadState === 'stale') && plans.length" :class="['plans-grid', `plans-grid--count-${plans.length}`]">
      <article
        v-for="plan in plans"
        :key="plan.id"
        :class="['plan-card', { featured: plan.is_recommended, current: isCurrent(plan), anchor: plan.plan_code === 'Y999' }]"
      >
        <div class="plan-topline">
          <span v-if="plan.display_badge" class="plan-badge">{{ plan.display_badge }}</span>
          <span v-if="isCurrent(plan)" class="current-badge">当前使用</span>
        </div>
        <h3>{{ cleanPlanName(plan.name) }}</h3>
        <div class="plan-price"><small>¥</small><strong>{{ formatPrice(plan.price) }}</strong></div>
        <div class="plan-duration">{{ plan.duration_label || `${plan.duration_days} 天` }}</div>
        <ul>
          <li v-for="benefit in benefitsOf(plan)" :key="benefit"><Check :size="15" />{{ benefit }}</li>
        </ul>
        <button v-if="isCurrent(plan)" type="button" @click="contactService(plan)">咨询原套餐续期</button>
        <button v-else type="button" @click="contactService(plan)">联系客服购买</button>
      </article>
    </div>

    <div v-else-if="loadState === 'empty'" class="empty-state">暂无套餐信息</div>
    <el-dialog v-model="contactVisible" :title="selectedPlan && isCurrent(selectedPlan) ? '原套餐续期咨询' : '套餐购买咨询'" width="min(460px, 92vw)" destroy-on-close>
      <div class="purchase-summary"><small>咨询项目</small><h3>{{ selectedPlan ? cleanPlanName(selectedPlan.name) : '' }}</h3><p>{{ selectedPlan?.business_line === 'service' ? '先确认服务内容、已有套餐包含额度与预约安排，不重复购买已包含的服务。' : '先确认约定项目、适用平台、工具范围与结束日期，再由工作人员开通授权。' }}</p></div>
      <p v-if="contactLoading">正在读取官方联系方式…</p>
      <p v-else-if="contactId">客服微信：<strong>{{ contactId }}</strong></p>
      <p v-else>暂未提供外部联系方式，你可以直接在系统内提交购买咨询。</p>
      <template #footer>
        <el-button v-if="contactId" @click="copyContact">复制微信号</el-button>
        <el-button type="primary" @click="openPurchaseInquiry">提交购买咨询</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter, type LocationQuery } from 'vue-router'
import { ElButton, ElDialog } from 'element-plus'
import { Check, LockKeyhole, ShieldCheck } from '@lucide/vue'
import AsyncStateNotice from '@/components/AsyncStateNotice.vue'
import PageHeader from '@/components/PageHeader.vue'
import CommercialPricingPanel from '@/components/user/CommercialPricingPanel.vue'
import { failedDataState, settledDataState, type AsyncDataState } from '@/features/async/state'
import { getPlans, getPublicSettings } from '@/utils/api'
import { prepareSupportDraft } from '@/features/ai/supportHandoff'
import { usePlatformStore } from '@/stores/platform'
import { publicSettingsSchema } from '@/features/auth/model'
import { showToast } from '@/utils'
import { customerPlanListSchema, licensePlanCode, readStoredLicense, type CustomerPlan } from '@/features/user/model'
import { loadCommercialPlans, type CommercialPlan } from '@/features/user/commercialCatalog'

const route = useRoute() || { query: {} as LocationQuery }
const router = useRouter()
const platformStore = usePlatformStore()
const contactVisible = ref(false)
const selectedPlan = ref<CustomerPlan | null>(null)
const contactId = ref('')
const contactLoading = ref(false)
const plans = ref<CustomerPlan[]>([])
const commercialPlans = ref<CommercialPlan[]>([])
const loadState = ref<AsyncDataState>('loading')
const loadError = ref('')
const userInfo = ref(readStoredLicense())
const currentPlanName = computed(() => userInfo.value.plan_name || '当前授权')
const currentPlanCode = computed(() => licensePlanCode(userInfo.value))
const licenseExpiry = computed(() => {
  const value = userInfo.value.expires_at
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return '以授权信息为准'
  const date = new Date(value)
  return `${date.toLocaleDateString('zh-CN')} ${date.getTime() <= Date.now() ? '已到期' : '到期'}`
})
const licensePlatforms = computed(() => {
  const value = userInfo.value.platform_scope
  const keys: string[] = Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string') : typeof value === 'string' ? value.split(',') : []
  const names: Record<string, string> = { amazon: '亚马逊', aliexpress: '速卖通' }
  return keys.map(key => names[key.trim()] || key.trim()).join('、') || '以授权信息为准'
})
function refreshLicense() { userInfo.value = readStoredLicense() }
function renewCurrent() {
  const plan = plans.value.find(isCurrent)
  if (plan) { void contactService(plan); return }
  prepareSupportDraft(`我想咨询当前「${currentPlanName.value}」授权续期，${licenseExpiry.value}。请先核对原授权和可续期方案，不要另建重复授权。`, platformStore.currentPlatform)
  void router.push('/user/ai-chat')
}

function cleanPlanName(name = ''): string {
  return name.replace(/^Y\d+\s*/i, '') || name
}

function formatPrice(price: string | number): string | number {
  const value = Number(price || 0)
  return Number.isInteger(value) ? value : value.toFixed(2)
}

function isCurrent(plan: CustomerPlan): boolean {
  return Boolean(currentPlanCode.value && plan.plan_code === currentPlanCode.value)
}

function benefitsOf(plan: CustomerPlan): string[] {
  if (Array.isArray(plan.benefits) && plan.benefits.length) return plan.benefits
  if (!plan.features) return ['基础工具权限']
  return String(plan.features).split(/[+\n]/).map(item => item.trim()).filter(Boolean)
}

async function contactService(plan: CustomerPlan) {
  selectedPlan.value = plan
  contactVisible.value = true
  contactLoading.value = true
  contactId.value = ''
  try {
    const settings = publicSettingsSchema.parse(await getPublicSettings())
    contactId.value = settings.find(item => (item.key === 'wechat_id' || item.key === 'service_wechat') && item.value?.trim())?.value?.trim() || ''
  } catch { /* In-app inquiry remains available when public settings cannot load. */ }
  finally { contactLoading.value = false }
}

async function copyContact() {
  try {
    await navigator.clipboard.writeText(contactId.value)
    showToast('已复制客服微信号', 'success')
  } catch { showToast('复制未成功，请选中微信号手动复制', 'warning') }
}

function openPurchaseInquiry() {
  if (!selectedPlan.value) return
  prepareSupportDraft(isCurrent(selectedPlan.value)
    ? `我想咨询当前「${cleanPlanName(selectedPlan.value.name)}」套餐续期，${licenseExpiry.value}。请先核对原授权、续期期限和费用，不要另建重复授权。`
    : selectedPlan.value.business_line === 'service'
      ? `我想咨询「${cleanPlanName(selectedPlan.value.name)}」，请先核对我的套餐已含服务额度，再确认服务范围与预约安排，避免重复购买。`
      : `我想咨询「${cleanPlanName(selectedPlan.value.name)}」，请帮我确认约定项目、适用平台、当前可开通工具和结束日期。`, platformStore.currentPlatform)
  contactVisible.value = false
  void router.push('/user/ai-chat')
}

async function loadPlans() {
  loadState.value = plans.value.length ? 'data' : 'loading'
  loadError.value = ''
  try {
    const nextCommercialPlans = await loadCommercialPlans()
    // Draft-only commercial setup changes nothing for existing legacy customers.
    const nextPlans = nextCommercialPlans.length ? nextCommercialPlans : customerPlanListSchema.parse(await getPlans()).filter(plan => plan.status === 'active')
    commercialPlans.value = nextCommercialPlans
    plans.value = nextPlans
    loadState.value = settledDataState(plans.value.length)
  } catch (error) {
    loadError.value = error instanceof Error && error.message ? error.message : '套餐加载失败'
    loadState.value = failedDataState(plans.value.length > 0)
    showToast(loadError.value, 'error')
  }
}

onMounted(() => { void loadPlans(); window.addEventListener('toolbox:user-updated', refreshLicense) })
onUnmounted(() => window.removeEventListener('toolbox:user-updated', refreshLicense))
</script>

<style scoped>
.plans-page { width: min(1180px, 100%); margin: 0 auto; }
.license-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 16px 24px; margin-bottom: 20px; padding: 16px 18px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); }
.license-summary div { display: grid; gap: 5px; }
.license-summary small, .license-summary p { color: var(--color-text-secondary); font-size: var(--type-meta); }
.license-summary strong { font-size: var(--type-control); }
.license-summary p { flex: 1 1 240px; margin: 0; line-height: 1.6; }
.purchase-summary { padding: 18px; border-radius: 12px; background: var(--color-surface-soft); }
.purchase-summary small, .purchase-summary p { color: var(--color-text-secondary); line-height: 1.7; }
.purchase-summary h3 { margin: 8px 0; }
.plans-eyebrow { display: block; margin-bottom: 8px; color: var(--color-premium); font-size:var(--type-meta); font-weight: 800; letter-spacing: .12em; }
.plans-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 20px; }
.plans-header h2 { margin: 0; color: var(--color-text); font-size: var(--type-page); letter-spacing: -.03em; }
.plans-header p { margin: 7px 0 0; color: var(--color-text-secondary); font-size: 13px; }
.current-plan { display: grid; grid-template-columns: auto auto; align-items: center; gap: 2px 7px; padding: 10px 13px; border: 1px solid rgba(169,133,82,.22); border-radius: var(--radius-md); color: var(--color-premium); background: var(--color-premium-soft); }
.current-plan span { color: var(--color-text-secondary); font-size:var(--type-micro); }
.current-plan strong { grid-column: 2; color: var(--color-text); font-size:var(--type-control); }
.upgrade-notice { display: flex; align-items: center; gap: 8px; margin-bottom: 18px; padding: 12px 14px; border: 1px solid rgba(183,121,31,.2); border-radius: var(--radius-md); color: var(--color-warning); background: var(--color-warning-soft); font-size:var(--type-control); }
.plans-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; align-items: stretch; }
.plans-grid--count-1 { grid-template-columns: minmax(0, 1fr); max-width: 520px; }
.plans-grid--count-2, .plans-grid--count-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (min-width: 1060px) { .plans-grid--count-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.plan-card { position: relative; min-height: 390px; display: flex; flex-direction: column; padding: 20px; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: white; box-shadow: var(--shadow-low); }
.plan-card.featured { transform: translateY(-4px); border-color: rgba(169,133,82,.48); box-shadow: 0 16px 36px rgba(169,133,82,.1); }
.plan-card.current { border-color: var(--color-primary-muted); }
.plan-card.anchor { background: var(--color-surface-premium); }
.plan-topline { min-height: 24px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.plan-badge, .current-badge { padding: 4px 7px; border-radius: 999px; font-size:var(--type-micro); font-weight: 800; }
.plan-badge { color: white; background: var(--color-premium); }
.current-badge { color: var(--color-primary-hover); background: var(--color-primary-soft); }
.plan-card h3 { margin: 16px 0 8px; color: var(--color-text); font-size: 17px; }
.plan-price { display: flex; align-items: flex-start; color: var(--color-text); }
.plan-price small { margin-top: 7px; font-size: 14px; }
.plan-price strong { font-size: 34px; line-height: 1.1; }
.plan-duration { margin-top: 5px; color: var(--color-text-secondary); font-size:var(--type-meta); }
.plan-card ul { flex: 1; margin: 20px 0; padding: 16px 0 0; border-top: 1px solid var(--color-border); list-style: none; }
.plan-card li { display: flex; align-items: flex-start; gap: 7px; margin-bottom: 11px; color: var(--color-text); font-size:var(--type-control); line-height: 1.5; }
.plan-card li svg { flex-shrink: 0; margin-top: 1px; color: var(--color-success); }
.plan-card button { width: 100%; min-height: 40px; border: 0; border-radius: 8px; color: white; background: var(--color-primary); font-size:var(--type-control); font-weight: 800; cursor: pointer; }
.featured button, .anchor button { background: var(--color-primary); }
.plan-card button:disabled { color: var(--color-text-secondary); background: var(--color-surface-soft); cursor: default; }
.empty-state { padding: 80px; color: var(--color-text-secondary); text-align: center; }
@media (max-width: 1050px) { .plan-card.featured { transform: none; } }
@media (max-width: 759px) { .plans-header { flex-direction: column; } .plans-grid { grid-template-columns: 1fr; } }
</style>
