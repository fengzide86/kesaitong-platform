<template>
  <div v-loading="loading" class="business-access-page">
    <PageHeader
      eyebrow="工作台开放"
      title="工作台开放"
      description="管理专业工作台的登录入口、套餐与内部验证授权"
    >
      <template #actions>
        <router-link class="secondary-link" to="/admin/authcodes?product=business">查看 B 端授权码</router-link>
      </template>
    </PageHeader>

    <div v-if="sectionErrors.length" class="partial-error" role="alert">{{ sectionErrors.join('；') }}。未确认的数据不会作为关闭或零条处理。<button type="button" class="secondary-link" :disabled="loading" @click="loadData">重新加载</button></div>
    <section :class="['release-hero', { enabled: settingsKnown && workspaceEnabled }]">
      <div class="hero-symbol"><BriefcaseBusiness :size="24" /></div>
      <div class="hero-copy">
        <span>当前开放状态</span>
        <h2>{{ releaseStatusTitle }}</h2>
        <p>{{ releaseStatusDescription }}</p>
      </div>
      <div v-if="canManageSettings" class="hero-switch">
        <span>{{ !settingsKnown ? '开放状态待确认' : workspaceEnabled ? 'B 端登录已开放' : 'B 端登录未开放' }}</span>
        <el-switch
          v-model="workspaceEnabled"
          :loading="switchSaving"
          :disabled="!settingsKnown || loading"
          inline-prompt
          :active-text="settingsKnown ? '开启' : '待确认'"
          :inactive-text="settingsKnown ? '关闭' : '待确认'"
          @change="saveWorkspaceEnabled"
        />
      </div>
      <div v-else class="hero-switch readonly">发布开关仅超级管理员可查看和修改</div>
    </section>

    <section class="readiness-grid" aria-label="专业工作台准备状态">
      <article>
        <span class="card-icon premium"><BadgeCheck :size="20" /></span>
        <div><span>专业套餐</span><strong>{{ !plansKnown ? '待确认' : activeBusinessPlan?.name || '尚未配置' }}</strong></div>
        <small>{{ !plansKnown ? '套餐状态尚未读取成功' : activeBusinessPlan ? '产品权限已经配置' : '需要先建立 B 端套餐' }}</small>
      </article>
      <article>
        <span class="card-icon"><KeyRound :size="20" /></span>
        <div><span>本页 B 端授权码</span><strong>{{ codesKnown ? `${businessCodes.length} 个` : '待确认' }}</strong></div>
        <small>{{ !codesKnown ? '授权状态尚未读取成功' : businessCodes.length ? '可以用于内部登录验证' : '本页没有内部验证授权，请在授权管理检索' }}</small>
      </article>
      <article>
        <span class="card-icon"><Boxes :size="20" /></span>
        <div><span>已开放批量工具</span><strong>{{ toolsKnown ? `${batchTools.length} 个` : '待确认' }}</strong></div>
        <small>{{ !toolsKnown ? '工具状态尚未读取成功' : batchTools.length ? '目录已开放执行且支持真实批量操作' : '暂无已开放的真实批量工具' }}</small>
        <small v-if="internalDemoTools.length">内部演示 {{ internalDemoTools.length }} 项，不计入客户可执行工具。</small>
      </article>
    </section>

    <section class="operations-surface">
      <header>
        <div>
          <span>当前行动</span>
          <h3>{{ nextActionTitle }}</h3>
          <p>{{ nextActionDescription }}</p>
        </div>
        <span class="validation-badge">内部验证</span>
      </header>

      <div class="action-grid">
        <article class="primary-operation">
          <span class="step-number">01</span>
          <div>
            <strong>建立内部验证授权</strong>
            <p>生成 30 天、1 台设备的 B 端授权码，用于检查登录和四个专业页面。</p>
          </div>
          <button
            type="button"
            :disabled="!plansKnown || !activeBusinessPlan || generating || loading"
            @click="generateInternalCode"
          >
            <LoaderCircle v-if="generating" :size="16" class="spin" />
            <KeyRound v-else :size="16" />
            {{ generating ? '正在生成' : '生成测试授权' }}
          </button>
        </article>

        <article>
          <span class="step-number">02</span>
          <div>
            <strong>验证 B 端界面</strong>
            <p>{{ !toolsKnown ? '批量工具状态尚未确认，请先重新读取；确认后再核对授权范围、输入准备与支持入口。' : batchTools.length ? '使用内部验证授权核对已开放工具、输入准备与真实批次记录；执行仍受授权和本机条件约束。' : '当前目录没有开放的真实批量工具，登录后核对授权范围、输入准备与支持入口。' }}</p>
          </div>
          <router-link to="/admin/authcodes?product=business">进入授权管理</router-link>
        </article>

        <article>
          <span class="step-number">03</span>
          <div>
            <strong>复核执行与数据边界</strong>
            <p>确认原表只在本地解析，真实批次按执行证据记录；内部演示不混入客户业务记录。</p>
          </div>
          <span class="operation-note">真实执行与内部演示分开验收</span>
        </article>
      </div>
    </section>

    <section v-if="generatedCode" class="generated-license">
      <div class="generated-check"><Check :size="21" /></div>
      <div>
        <span>专业工作台授权已生成</span>
        <strong>{{ generatedCode }}</strong>
        <small>{{ activeBusinessPlan?.name }} · 30 天 · 1 台设备</small>
      </div>
      <div class="generated-actions">
        <button type="button" @click="copyGeneratedCode"><Copy :size="15" />复制授权码</button>
        <button class="primary" type="button" @click="loginWithGeneratedCode"><LogIn :size="15" />用此码登录</button>
      </div>
    </section>

    <section class="limits-surface">
      <header><div><span>授权边界</span><h3>当前专业套餐</h3></div><router-link v-if="canManageSettings" to="/admin/settings">套餐设置</router-link></header>
      <div v-if="activeBusinessPlan" class="limits-grid">
        <article><span>套餐</span><strong>{{ activeBusinessPlan.name }}</strong><small>专业 B 端</small></article>
        <article><span>单批次上限</span><strong>{{ entitlementNumber('max_batch_rows', 50) }}</strong><small>有效导入行</small></article>
        <article><span>本机会话上限</span><strong>{{ entitlementNumber('max_open_sessions', 6) }}</strong><small>实际执行受工具能力与授权约束</small></article>
      </div>
      <div v-else class="empty-plan">{{ plansKnown ? '还没有可用的 B 端套餐，请先在套餐设置中建立。' : '套餐状态待确认，请重新加载。' }}</div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  BadgeCheck, Boxes, BriefcaseBusiness, Check, Copy, KeyRound, LoaderCircle, LogIn,
} from '@lucide/vue'
import PageHeader from '@/components/PageHeader.vue'
import {
  batchGenerateAuthCodes,
  getAuthCodes,
  getPlansAdmin,
  getSettings,
  getTools,
  updateSetting,
} from '@/utils/api'
import { showToast } from '@/utils'
import { authService } from '@/utils/auth'
import {
  adminAuthCodesSchema,
  adminPlansSchema,
  adminSettingsSchema,
  generatedAuthCodesSchema,
  type AdminAuthCode,
  type AdminPlan,
} from '@/features/admin/model'
import { toolCatalogSchema, type ToolCatalogItem } from '@/features/tools/model'
import { getToolPresentation } from '@/features/tools/presentation'

const router = useRouter()
const loading = ref(false)
const switchSaving = ref(false)
const generating = ref(false)
const workspaceEnabled = ref(false)
const settingsKnown = ref(false)
const plansKnown = ref(false)
const codesKnown = ref(false)
const toolsKnown = ref(false)
const sectionErrors = ref<string[]>([])
let loadSequence = 0
onUnmounted(() => { loadSequence += 1 })
const plans = ref<AdminPlan[]>([])
const authCodes = ref<AdminAuthCode[]>([])
const tools = ref<ToolCatalogItem[]>([])
const generatedCode = ref('')
const canManageSettings = computed(() => authService.isSuperAdmin())

const businessPlans = computed(() => plans.value.filter(plan => plan.product_type === 'business'))
const activeBusinessPlan = computed(() =>
  businessPlans.value.find(plan => plan.status === 'active') || null)
const businessCodes = computed(() => authCodes.value.filter(code => code.product_type === 'business'))
const batchTools = computed(() => tools.value.filter(tool =>
  tool.supports_live_batch && getToolPresentation(tool).action === 'execute'))
const internalDemoTools = computed(() => tools.value.filter(tool =>
  tool.availability === 'demo_only' && (tool.supports_demo_batch || tool.supports_batch)))
const releaseStatusTitle = computed(() => {
  if (!canManageSettings.value) return '内部验证授权准备'
  if (!settingsKnown.value) return '开放状态待确认'
  if (!plansKnown.value || !toolsKnown.value) return '业务状态待确认'
  if (!workspaceEnabled.value) return '等待内部开放'
  if (!activeBusinessPlan.value) return '还缺少专业套餐'
  if (!batchTools.value.length) return '内部验证中'
  return '专业工作台已开放'
})
const releaseStatusDescription = computed(() => {
  if (!canManageSettings.value) return '运营可生成内部验证授权；全局入口状态由超级管理员控制。'
  if (!settingsKnown.value || !plansKnown.value || !toolsKnown.value) return '部分信息尚未读取成功，请重新加载后再判断是否开放。'
  if (!workspaceEnabled.value) return 'B 端授权不会进入专业工作台，普通 C 端不受影响。'
  if (!activeBusinessPlan.value) return '开启状态已经保存，但仍需要一个有效的 B 端套餐。'
  if (!batchTools.value.length) return '授权与前端已经就绪，批量脚本会根据真实业务能力逐个接入。'
  return 'B 端授权可以登录，已开放的批量工具会出现在专业工作台。'
})
const nextActionTitle = computed(() => {
  if (!plansKnown.value || !codesKnown.value || !toolsKnown.value || (canManageSettings.value && !settingsKnown.value)) return '先确认业务状态'
  if (!canManageSettings.value) return activeBusinessPlan.value ? '生成内部验证授权' : '等待超级管理员配置专业套餐'
  if (!workspaceEnabled.value) return '开启 B 端内部验证'
  if (!activeBusinessPlan.value) return '配置一个有效的 B 端套餐'
  if (!businessCodes.value.length) return '生成第一个内部验证授权'
  if (!batchTools.value.length) return '检查四个 B 端页面，随后逐个接入脚本'
  return '使用真实授权验证批量业务路径'
})
const nextActionDescription = computed(() => {
  if (sectionErrors.value.length) return '请先重新加载失败项目，避免依据不完整的数据建立或修改授权。'
  if (!canManageSettings.value) return '运营账号可验证授权发放与登录入口，不可修改全局发布设置。'
  if (!workspaceEnabled.value) return '开启后也不会自动开放任何批量工具。'
  if (!activeBusinessPlan.value) return '套餐必须同时具备批量执行和多账号工作台权限。'
  if (!businessCodes.value.length) return '内部授权只用于验证，不对普通客户展示。'
  return '当前页面只展示真实状态，不生成虚假队列或执行数据。'
})

function entitlementNumber(key: string, fallback: number): number {
  const value = activeBusinessPlan.value?.entitlements?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

async function loadData() {
  const sequence = ++loadSequence
  loading.value = true
  sectionErrors.value = []
  settingsKnown.value = false
  plansKnown.value = false
  codesKnown.value = false
  toolsKnown.value = false
  const results = await Promise.allSettled([
      getPlansAdmin({ page_size: 100 }),
      getAuthCodes(),
      canManageSettings.value ? getSettings() : Promise.resolve([]),
      getTools(),
  ])
  if (sequence !== loadSequence) return
  const [plansResult, codesResult, settingsResult, toolsResult] = results
  function apply(result: PromiseSettledResult<unknown>, label: string, assign: (value: unknown) => void) {
    try { if (result.status === 'rejected') throw result.reason; assign(result.value) }
    catch { sectionErrors.value.push(`${label}读取失败`) }
  }
  apply(plansResult, '专业套餐', value => { plans.value = adminPlansSchema.parse(value); plansKnown.value = true })
  apply(codesResult, '授权码', value => { authCodes.value = adminAuthCodesSchema.parse(value); codesKnown.value = true })
  apply(toolsResult, '工具目录', value => { tools.value = toolCatalogSchema.parse(value); toolsKnown.value = true })
  if (canManageSettings.value) {
    apply(settingsResult, '开放设置', value => {
      const settings = adminSettingsSchema.parse(value)
      const setting = settings.find(item => item.key === 'business_workspace_enabled')
      workspaceEnabled.value = String(setting?.value || '').toLowerCase() === 'true'
      settingsKnown.value = true
    })
  }
  loading.value = false
}

async function saveWorkspaceEnabled(rawValue: string | number | boolean) {
  if (!canManageSettings.value || !settingsKnown.value || loading.value || switchSaving.value) return
  const enabled = rawValue === true
  switchSaving.value = true
  try {
    await updateSetting({
      key: 'business_workspace_enabled',
      value: enabled ? 'true' : 'false',
      description: '专业批量工作台全局发布开关',
    })
    showToast(enabled ? 'B 端登录已开放' : 'B 端入口已关闭', 'success')
  } catch {
    workspaceEnabled.value = !enabled
    showToast('开放状态保存失败', 'error')
  } finally {
    switchSaving.value = false
  }
}

async function generateInternalCode() {
  if (!plansKnown.value || !activeBusinessPlan.value || loading.value || generating.value) return
  generating.value = true
  try {
    const result = generatedAuthCodesSchema.parse(await batchGenerateAuthCodes({
      plan_id: Number(activeBusinessPlan.value.id),
      count: 1,
      duration_days: 30,
      platform_scope: 'amazon',
      scene_type: 'operations',
      seat_limit: 1,
      max_devices: 1,
    }))
    generatedCode.value = result.codes[0] || ''
    showToast('内部验证授权已生成', 'success')
    await loadData()
  } catch {
    showToast('内部验证授权生成失败', 'error')
  } finally {
    generating.value = false
  }
}

async function copyGeneratedCode() {
  if (!generatedCode.value) return
  await navigator.clipboard.writeText(generatedCode.value)
  showToast('授权码已复制', 'success')
}

async function loginWithGeneratedCode() {
  if (!generatedCode.value) return
  sessionStorage.setItem('toolbox_login_handoff_code', generatedCode.value)
  authService.clear()
  await router.replace('/user/login')
}

onMounted(loadData)
</script>

<style scoped>
.partial-error{padding:14px;border:1px solid var(--color-border);border-radius:12px;color:var(--color-danger);line-height:1.6}.partial-error button{margin-left:12px}
.business-access-page { display: grid; gap: 20px; }
.secondary-link { min-height: 38px; display: inline-flex; align-items: center; padding: 0 14px; border: 1px solid var(--color-border); border-radius: 10px; color: var(--color-text); background: var(--color-surface); font-size: var(--type-control); font-weight: 700; text-decoration: none; }
.release-hero { display: grid; grid-template-columns: auto minmax(0,1fr) auto; align-items: center; gap: 18px; padding: 24px; border: 1px solid var(--color-border); border-radius: 18px; background: var(--color-surface); box-shadow: var(--shadow-low); }
.release-hero.enabled { border-color: rgba(169,133,82,.3); background: linear-gradient(120deg,#fcfcfd,#f8f5ef); }
.hero-symbol { width: 50px; height: 50px; display: grid; place-items: center; border-radius: 15px; color: var(--color-primary); background: var(--color-primary-soft); }
.enabled .hero-symbol { color: #765d38; background: #f1e8d9; }
.hero-copy { display: grid; gap: 4px; }
.hero-copy > span,.operations-surface header span,.limits-surface header span { color: var(--color-primary); font-size: var(--type-micro); font-weight: 800; letter-spacing: .11em; }
.hero-copy h2 { margin: 0; color: var(--color-text); font-size: 22px; letter-spacing: -.03em; }
.hero-copy p { margin: 0; color: var(--color-text-secondary); font-size: var(--type-control); line-height: 1.6; }
.hero-switch { display: flex; align-items: center; gap: 12px; color: var(--color-text-secondary); font-size: var(--type-meta); }
.hero-switch.readonly { max-width: 220px; line-height: 1.55; text-align: right; }
.readiness-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 14px; }
.readiness-grid article { min-height: 132px; display: grid; grid-template-columns: auto 1fr; align-items: start; gap: 13px; padding: 18px; border: 1px solid var(--color-border); border-radius: 15px; background: var(--color-surface); box-shadow: var(--shadow-low); }
.card-icon { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 12px; color: var(--color-primary); background: var(--color-primary-soft); }
.card-icon.premium { color: #765d38; background: #f1e8d9; }
.readiness-grid article > div { display: grid; gap: 5px; }
.readiness-grid article > div span { color: var(--color-text-secondary); font-size: var(--type-meta); }
.readiness-grid strong { color: var(--color-text); font-size: var(--type-card); }
.readiness-grid small { grid-column: 1/-1; align-self: end; color: var(--color-text-secondary); font-size: var(--type-meta); line-height: 1.55; }
.operations-surface,.limits-surface { overflow: hidden; border: 1px solid var(--color-border); border-radius: 17px; background: var(--color-surface); box-shadow: var(--shadow-low); }
.operations-surface > header,.limits-surface > header { min-height: 76px; display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 16px 20px; border-bottom: 1px solid var(--color-border); }
.operations-surface header div,.limits-surface header div { display: grid; gap: 4px; }
.operations-surface h3,.limits-surface h3 { margin: 0; color: var(--color-text); font-size: var(--type-card); }
.operations-surface header p { margin: 0; color: var(--color-text-secondary); font-size: var(--type-meta); }
.validation-badge { padding: 7px 9px; border-radius: 8px; color: #765d38 !important; background: #f1e8d9; white-space: nowrap; }
.action-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); }
.action-grid article { min-height: 190px; display: grid; align-content: start; gap: 13px; padding: 22px; border-right: 1px solid var(--color-border); }
.action-grid article:last-child { border: 0; }
.step-number { color: var(--color-primary); font: 800 var(--type-micro)/1 var(--font-mono,monospace); }
.action-grid article > div { display: grid; gap: 7px; }
.action-grid strong { color: var(--color-text); font-size: 15px; }
.action-grid p { min-height: 66px; margin: 0; color: var(--color-text-secondary); font-size: var(--type-control); line-height: 1.65; }
.action-grid button,.action-grid a { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; align-self: end; padding: 0 13px; border: 1px solid var(--color-border); border-radius: 10px; color: var(--color-text); background: var(--color-surface-soft); font-size: var(--type-control); font-weight: 700; text-decoration: none; cursor: pointer; }
.action-grid .primary-operation button { border: 0; color: white; background: var(--color-primary); }
.action-grid button:disabled { opacity: .45; cursor: not-allowed; }
.operation-note { align-self: end; color: var(--color-primary); font-size: var(--type-meta); font-weight: 700; }
.generated-license { display: grid; grid-template-columns: auto minmax(0,1fr) auto; align-items: center; gap: 14px; padding: 18px 20px; border: 1px solid rgba(22,138,99,.2); border-radius: 15px; background: #edf8f4; }
.generated-check { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 13px; color: white; background: var(--color-success); }
.generated-license > div:nth-child(2) { display: grid; gap: 3px; }
.generated-license span,.generated-license small { color: #497565; font-size: var(--type-meta); }
.generated-license strong { color: var(--color-text); font: 800 15px/1.4 var(--font-mono,monospace); }
.generated-actions { display: flex; gap: 8px; }
.generated-actions button { min-height: 38px; display: inline-flex; align-items: center; gap: 7px; padding: 0 12px; border: 1px solid rgba(22,138,99,.25); border-radius: 9px; color: var(--color-success); background: white; font-size: var(--type-control); font-weight: 700; cursor: pointer; }
.generated-actions button.primary { border: 0; color: white; background: var(--color-primary); }
.limits-surface header a { color: var(--color-primary); font-size: var(--type-meta); font-weight: 700; text-decoration: none; }
.limits-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 14px; padding: 18px; }
.limits-grid article { min-height: 110px; display: grid; align-content: space-between; gap: 7px; padding: 17px; border: 1px solid var(--color-border); border-radius: 13px; background: var(--color-surface-soft); }
.limits-grid span,.limits-grid small { color: var(--color-text-secondary); font-size: var(--type-meta); }
.limits-grid strong { color: var(--color-text); font-size: 20px; }
.empty-plan { padding: 38px 20px; text-align: center; color: var(--color-text-secondary); font-size: var(--type-control); }
.spin { animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media(max-width:900px) {
  .release-hero { grid-template-columns: auto 1fr; }
  .hero-switch { grid-column: 1/-1; justify-content: space-between; }
  .readiness-grid,.action-grid { grid-template-columns: 1fr; }
  .action-grid article { min-height: auto; border-right: 0; border-bottom: 1px solid var(--color-border); }
  .action-grid p { min-height: 0; }
  .generated-license { grid-template-columns: auto 1fr; }
  .generated-actions { grid-column: 1/-1; justify-content: flex-end; }
}
@media(max-width:600px) {
  .release-hero { grid-template-columns: 1fr; }
  .hero-switch { grid-column: auto; }
  .validation-badge { display: none; }
  .generated-license { grid-template-columns: 1fr; }
  .generated-actions { grid-column: auto; display: grid; }
}
@media(prefers-reduced-motion:reduce) { .spin { animation: none; } }
</style>
