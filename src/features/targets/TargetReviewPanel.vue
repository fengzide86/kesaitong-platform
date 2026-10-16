<template>
  <component :is="standalone ? 'section' : 'details'" :class="['target-review', { 'is-standalone': standalone }]" :open="standalone ? undefined : openByDefault" @toggle="onToggle">
    <summary v-if="!standalone" class="review-toggle"><ShieldCheck :size="18" /><span>平台入口审核<small>打开申请网址，确认审核结果</small></span><ChevronDown :size="16" /></summary>
    <section class="review-body" aria-label="平台入口审核">
      <div class="review-toolbar"><div class="review-queue-summary"><strong>接入申请</strong><span v-if="loaded" data-testid="review-list-count">{{ pendingCount }} 项待审核 · 共 {{ items.length }} 项</span></div><button type="button" :disabled="busy || loading" @click="load"><RefreshCw :size="14" />{{ loading ? '正在刷新…' : '刷新申请' }}</button></div>
      <p v-if="error" class="target-error" role="alert">{{ error }}</p>
      <p v-if="notice" class="review-notice" role="status">{{ notice }}</p>
      <p v-if="loading" class="review-loading" role="status">正在读取申请…</p>
      <p v-else-if="!items.length && !error" class="target-empty">暂无接入申请。用户提交平台网址后，会显示在这里。</p>
      <div v-else class="review-layout">
        <nav class="review-list" aria-label="入口申请"><button v-for="item in items" :key="item.profile.id" type="button" :data-testid="`review-request-${item.profile.id}`" :aria-pressed="selectedId === item.profile.id" :disabled="busy" @click="select(item)"><strong :title="item.profile.name">{{ item.profile.name }}</strong><span :title="displayEntry(item.profile.entryUrl)">{{ displayEntry(item.profile.entryUrl) }}</span><small>{{ reviewLabels[item.profile.reviewStatus] }}</small></button></nav>
        <form v-if="selected" class="review-form" @submit.prevent="review('approved', true)">
          <header class="review-request-heading"><h3 :title="selected.profile.name">{{ selected.profile.name || '未命名入口' }}</h3><span class="review-status" :data-status="selected.profile.reviewStatus">{{ reviewLabels[selected.profile.reviewStatus] }}</span></header>
          <div class="review-entry">
            <span class="review-field-label">申请网址</span>
            <div class="review-entry-actions"><strong class="review-entry-url" :title="displayEntry(selected.profile.entryUrl)">{{ displayEntry(selected.profile.entryUrl) }}</strong><button class="target-open" type="button" :disabled="busy" @click="openEntry">打开网址 <ExternalLink :size="14" /></button></div>
            <small>在新窗口查看，不携带账号、密码或授权参数。</small>
          </div>
          <div class="review-decision">
            <div class="review-actions review-actions-primary">
              <button class="target-primary" type="button" :disabled="busy || selected.profile.reviewStatus === 'approved'" @click="review('approved')">{{ busy ? '正在保存…' : selected.profile.reviewStatus === 'approved' ? '已验证通过' : '验证通过' }}</button>
              <button type="button" :disabled="busy" @click="review('rejected')">验证不通过</button>
            </div>
            <p class="review-capability-note">{{ selected.profile.reviewStatus === 'approved' && selected.profile.capabilities.includes(TARGET_TEMPLATE_CAPABILITY) ? '此入口已开放配送模板工具，使用时仍会核对账号和课程。' : '通过仅记录入口审核，不会自动开放工具。' }}</p>
          </div>
          <details class="verification-details">
            <summary><span>工具权限与技术核验</span><ChevronDown :size="15" /></summary>
            <p class="verification-description">仅开放配送模板工具时填写，由技术人员核验后提交。</p>
            <p v-if="!canApprove" class="approval-hint" role="status">{{ approvalHint }}</p>
          <div class="review-fields"><label>技术版本<select v-model="edition" :disabled="busy"><option value="unknown">尚未确认</option><option value="v2">V2</option><option value="v3">V3（未验证，不可启用）</option></select></label><label>适配包版本<input v-model.trim="adapterVersion" :disabled="busy" placeholder="已验收的适配包版本" /></label></div>
          <fieldset :disabled="busy"><legend>允许访问的精确 origin 与路径前缀</legend><div v-for="(route, index) in routes" :key="index" class="route-row"><label><span>Origin</span><input v-model.trim="route.origin" :maxlength="TARGET_PROFILE_LIMITS.routeOrigin" placeholder="https://school.example" :aria-label="`Origin ${index + 1}`" /></label><label><span>路径前缀</span><input v-model.trim="route.pathPrefix" :maxlength="TARGET_PROFILE_LIMITS.routePathPrefix" placeholder="/ECrossAmazon/" :aria-label="`路径前缀 ${index + 1}`" /></label><label><span>用途</span><select v-model="route.role" :aria-label="`用途 ${index + 1}`"><option value="entry">入口</option><option value="login">登录</option><option value="business">业务</option></select></label><button type="button" :disabled="routes.length < 2" :aria-label="`移除路径 ${index + 1}`" @click="routes.splice(index, 1)">移除</button></div><button type="button" @click="routes.push({ origin: '', pathPrefix: '/', role: 'business' })">添加路径</button></fieldset>
          <label class="check-field"><input v-model="templateCapability" type="checkbox" :disabled="busy || edition !== 'v2'" />配送模板创建与同对象回读（template.create.v1）</label>
          <label>已核验页面指纹<input v-model.trim="fingerprint" :disabled="busy" placeholder="来自现场检测，不自动生成" /></label>
          <fieldset :disabled="busy"><legend>分页面结构证据</legend><label v-for="page in pageKinds" :key="page.key">{{ page.label }}<input v-model.trim="pageFingerprints[page.key]" :aria-label="page.label" maxlength="64" placeholder="现场检测的 SHA256 指纹" /></label></fieldset>
          <fieldset :disabled="busy"><legend>已核验实训课程范围</legend><p>按具体课程审核，不把用户选择的“实训”当作平台证明。首期不开放比赛执行；下面只登记脱敏课程指纹和证据编号。</p><div v-for="(scope, index) in executionScopes" :key="index" class="scope-row"><label>课程指纹<input v-model.trim="scope.courseRef" :aria-label="`课程指纹 ${index + 1}`" maxlength="64" placeholder="现场核验的课程 SHA256" /></label><label>证据编号<input v-model.trim="scope.evidenceRef" :aria-label="`证据编号 ${index + 1}`" maxlength="128" placeholder="例如：uat-20261012-course-a" /></label><button type="button" :aria-label="`移除课程 ${index + 1}`" @click="executionScopes.splice(index, 1)">移除</button></div><button type="button" :disabled="executionScopes.length >= 32" @click="executionScopes.push({ scenario: 'training', stage: 'not_applicable', courseRef: '', source: 'admin-verified', evidenceRef: '' })">添加已核验课程</button></fieldset>
          <fieldset :disabled="busy"><legend>已核验识别特征</legend><label v-for="marker in markerOptions" :key="marker" class="check-field"><input v-model="markers" type="checkbox" :value="marker" />{{ marker }}</label></fieldset>
          <label class="check-field"><input v-model="verified" type="checkbox" :disabled="busy" />我已核验页面、跳转范围和模板保存回读证据；不是只看到了版本文字。</label>
            <button class="target-primary advanced-approve" type="submit" :disabled="busy || !canApprove">{{ busy ? '正在保存…' : '通过并开放工具能力' }}</button>
          </details>
          <div class="review-actions review-secondary-actions"><button class="target-danger" type="button" :disabled="busy || selected.profile.reviewStatus === 'disabled'" @click="review('disabled')">暂停使用</button><small>仅阻止新的执行，不撤回已有操作。</small></div>
        </form>
      </div>
    </section>
  </component>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ChevronDown, ExternalLink, RefreshCw, ShieldCheck } from '@lucide/vue'
import { listTargetProfileReviews, reviewTargetProfile, type TargetProfileReview } from '@/utils/api/target-profiles'
import { TARGET_ADAPTER_VERSION, TARGET_PROFILE_LIMITS, TARGET_TEMPLATE_CAPABILITY, type SignedTargetProfile, type TargetProfile } from '@/shared/ipc/target-contract'
import { displayEntry, reviewLabels, targetError } from './presentation'

const items = ref<SignedTargetProfile[]>([])
const selectedId = ref('')
const selected = computed(() => items.value.find(item => item.profile.id === selectedId.value))
const edition = ref<TargetProfile['edition']>('unknown')
const adapterVersion = ref('')
const routes = ref<TargetProfile['allowedRoutes']>([])
const templateCapability = ref(false)
const fingerprint = ref('')
const pageKinds = [{ key: 'courseMap', label: '课程地图指纹' }, { key: 'templateList', label: '模板列表指纹' }, { key: 'templateEditor', label: '模板编辑页指纹' }] as const
const pageFingerprints = ref({ courseMap: '', templateList: '', templateEditor: '' })
const executionScopes = ref<NonNullable<TargetProfile['executionScopes']>>([])
const markerOptions: TargetProfile['evidence']['markers'] = ['amazon-v2', 'amazon-v3', 'seller-shipping-template', 'course-index']
const markers = ref<TargetProfile['evidence']['markers']>([])
const verified = ref(false)
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const loaded = ref(false)
const pendingCount = computed(() => items.value.filter(item => item.profile.reviewStatus === 'pending').length)
const { openByDefault = false, profileId = '', standalone = false } = defineProps<{ openByDefault?: boolean; profileId?: string; standalone?: boolean }>()
const canApprove = computed(() => edition.value === 'v2' && verified.value && templateCapability.value
  && adapterVersion.value === TARGET_ADAPTER_VERSION && /^[a-f0-9]{64}$/.test(fingerprint.value)
  && Object.values(pageFingerprints.value).every(value => /^[a-f0-9]{64}$/.test(value))
  && executionScopes.value.length > 0 && executionScopes.value.every(scope => /^[a-f0-9]{64}$/.test(scope.courseRef) && /^[A-Za-z0-9._:-]{1,128}$/.test(scope.evidenceRef))
  && new Set(executionScopes.value.map(scope => scope.courseRef)).size === executionScopes.value.length
  && markers.value.includes('amazon-v2') && markers.value.includes('seller-shipping-template') && !markers.value.includes('amazon-v3')
  && routes.value.some(route => route.role === 'business') && routes.value.some(route => {
    try { const entry = new URL(selected.value?.profile.entryUrl || ''); return route.role === 'entry' && entry.origin === route.origin && entry.pathname.startsWith(route.pathPrefix) }
    catch { return false }
  }))
const approvalHint = computed(() => {
  if (edition.value !== 'v2') return '先确认这是已验收的 V2 平台入口。'
  if (!adapterVersion.value || adapterVersion.value !== TARGET_ADAPTER_VERSION) return '还缺少已验收的适配包版本。'
  if (!templateCapability.value) return '还没有确认模板保存后可以正常读回。'
  if (!fingerprint.value || !/^[a-f0-9]{64}$/.test(fingerprint.value)) return '还缺少现场页面验证记录。'
  if (!routes.value.some(route => route.role === 'entry') || !routes.value.some(route => route.role === 'business')) return '请分别填写入口页面和业务页面的使用范围。'
  if (!routes.value.some(route => {
    try { const entry = new URL(selected.value?.profile.entryUrl || ''); return route.role === 'entry' && entry.origin === route.origin && entry.pathname.startsWith(route.pathPrefix) }
    catch { return false }
  })) return '填写的入口使用范围没有包含申请网址，请核对网址和路径。'
  if (!executionScopes.value.length) return '还没有填写适用的实训课程范围。'
  if (!Object.values(pageFingerprints.value).every(value => /^[a-f0-9]{64}$/.test(value))) return '课程、模板列表或编辑页面的验证材料不完整。'
  if (!executionScopes.value.every(scope => /^[a-f0-9]{64}$/.test(scope.courseRef) && /^[A-Za-z0-9._:-]{1,128}$/.test(scope.evidenceRef))) return '适用课程的验证记录不完整，请补充材料编号。'
  if (new Set(executionScopes.value.map(scope => scope.courseRef)).size !== executionScopes.value.length) return '适用课程重复了，请核对并保留一条。'
  if (!markers.value.includes('amazon-v2') || !markers.value.includes('seller-shipping-template') || markers.value.includes('amazon-v3')) return '平台识别结果与当前工具不匹配，需要重新核验。'
  if (!verified.value) return '完成上面的核对后，再勾选“我已核验”。'
  return '验证信息还不完整，请展开验证详情继续核对。'
})
watch([edition, adapterVersion, routes, templateCapability, fingerprint, markers, pageFingerprints, executionScopes], () => { verified.value = false }, { deep: true })

function select(item: SignedTargetProfile) {
  selectedId.value = item.profile.id
  edition.value = item.profile.edition
  adapterVersion.value = item.profile.adapterVersion || ''
  routes.value = item.profile.allowedRoutes.map(route => ({ ...route }))
  templateCapability.value = item.profile.capabilities.includes('template.create.v1')
  fingerprint.value = item.profile.evidence?.pageFingerprint || ''
  pageFingerprints.value = { courseMap: item.profile.evidence.pageFingerprints?.courseMap || '', templateList: item.profile.evidence.pageFingerprints?.templateList || '', templateEditor: item.profile.evidence.pageFingerprints?.templateEditor || '' }
  executionScopes.value = (item.profile.executionScopes || []).map(scope => ({ ...scope }))
  markers.value = [...(item.profile.evidence?.markers || [])]
  verified.value = false
  notice.value = ''
}
async function load() {
  loading.value = true; error.value = ''
  try { items.value = await listTargetProfileReviews(); loaded.value = true; const item = items.value.find(row => row.profile.id === profileId) || items.value.find(row => row.profile.id === selectedId.value) || items.value.find(row => row.profile.reviewStatus === 'pending') || items.value[0]; if (item) select(item) }
  catch (cause) { error.value = reviewError(cause) }
  finally { loading.value = false }
}
function onToggle(event: Event) { if (!standalone && (event.target as HTMLDetailsElement).open && !loaded.value && !loading.value) void load() }
onMounted(() => { if (standalone || openByDefault) void load() })
watch(() => profileId, value => { const item = items.value.find(row => row.profile.id === value); if (item && !busy.value) select(item) })
function openEntry() {
  if (!selected.value) return
  const url = displayEntry(selected.value.profile.entryUrl)
  if (url === '无效入口') { error.value = '申请网址格式不正确，无法打开。请让申请人核对网址后重新提交。'; return }
  try { window.open(url, '_blank', 'noopener,noreferrer') }
  catch { error.value = '浏览器未能打开网址。请允许打开新窗口，或复制上方网址自行查看。' }
}
function reviewError(cause: unknown): string {
  const detail = typeof cause === 'object' && cause !== null ? cause as { status?: number; errorCode?: string | number | null } : {}
  if (detail.errorCode === 'TARGET_SIGNING_UNAVAILABLE') return '暂时不能保存“验证通过”：审核服务尚未准备好，本次结论没有生效。请联系技术负责人处理后再试，无需补填工具开放设置。'
  if (detail.status === 503) return '审核服务暂时不可用，本次操作未完成。请稍后刷新申请确认结果；若仍不可用，请联系技术负责人。'
  if (detail.errorCode === 'TARGET_PROFILE_MISSING') return '这条申请已不存在，请刷新申请列表后再查看。'
  return targetError(cause)
}
async function review(reviewStatus: 'approved' | 'rejected' | 'disabled', enableTool = false) {
  if (!selected.value || busy.value || (reviewStatus === 'approved' && enableTool && !canApprove.value)) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const approval = reviewStatus === 'approved'
    // Rejection/disablement is intentionally status-only.  Never serialize
    // the currently edited approval draft for a destructive state change.
    const payload: TargetProfileReview = approval && enableTool
      ? {
        revision: selected.value.profile.revision, reviewStatus,
        edition: edition.value,
        allowedRoutes: routes.value,
        capabilities: edition.value === 'v2' && templateCapability.value ? [TARGET_TEMPLATE_CAPABILITY] : [],
        adapterVersion: adapterVersion.value || null,
        evidence: { edition: edition.value, pageFingerprint: /^[a-f0-9]{64}$/.test(fingerprint.value) ? fingerprint.value : null, pageFingerprints: { ...pageFingerprints.value }, markers: markers.value, source: 'admin-verified' as const },
        executionScopes: executionScopes.value.map(scope => ({ ...scope })),
      }
      : approval
        ? { revision: selected.value.profile.revision, reviewStatus: 'approved' }
        : { revision: selected.value.profile.revision, reviewStatus }
    const item = await reviewTargetProfile(selected.value.profile.id, payload)
    items.value = items.value.map(row => row.profile.id === item.profile.id ? item : row); select(item)
    notice.value = reviewStatus === 'approved'
      ? enableTool ? '已通过审核并开放配送模板工具。实际使用仍会核对当前账号、课程和工具是否适用。' : '已记录“验证通过”。仅通过入口审核，没有开放工具。'
      : reviewStatus === 'rejected' ? '已记录“验证不通过”，此入口不能用于新的工具操作。' : '已暂停此入口的新工具操作，已经发生的操作不会撤回。'
  } catch (cause) { error.value = reviewError(cause) }
  finally { busy.value = false }
}
</script>

<style scoped>
.target-review { min-width: 0; overflow: hidden; border: 1px solid var(--color-border, #dce3ee); border-radius: 14px; background: var(--color-surface, #fff); color: var(--color-text, #172a46); }
summary { list-style: none; cursor: pointer; }
summary::-webkit-details-marker { display: none; }
.review-toggle { display: flex; align-items: center; gap: 12px; padding: 18px; font-weight: 700; }
.review-toggle > span { flex: 1; display: grid; gap: 4px; }
.review-toggle small { color: var(--color-text-secondary); font-size: 12px; font-weight: 400; }
.review-body { min-width: 0; padding: 0 18px 20px; }
.review-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 0 0 16px; }
.review-queue-summary { display: flex; align-items: baseline; flex-wrap: wrap; gap: 10px; min-width: 0; }
.review-queue-summary strong { font-size: 14px; }
.review-queue-summary span { color: var(--color-text-secondary); font-size: 12px; }
.review-toolbar > button { display: inline-flex; align-items: center; gap: 7px; flex: none; }
.review-layout { display: grid; grid-template-columns: 232px minmax(0, 1fr); align-items: start; gap: 24px; min-width: 0; }
.review-list { display: grid; align-content: start; gap: 8px; min-width: 0; max-height: 560px; max-height: min(560px, 65vh); overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.review-list button { display: grid; gap: 6px; min-width: 0; min-height: 104px; padding: 12px; text-align: left; }
.review-list button[aria-pressed=true] { background: var(--color-primary-soft, #edf3ff); border-color: var(--color-primary, #365cff); }
.review-list strong { display: -webkit-box; overflow: hidden; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; font-size: 13px; line-height: 1.55; }
.review-list span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-text-secondary); font-size: 12px; }
.review-list small { color: var(--color-text-secondary); font-size: 11px; line-height: 1.5; }
.review-form { display: grid; align-content: start; gap: 22px; min-width: 0; }
.review-request-heading { display: flex; align-items: flex-start; gap: 12px; min-width: 0; }
.review-request-heading h3 { display: -webkit-box; flex: 0 1 auto; min-width: 0; margin: 0; overflow: hidden; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; font-size: 20px; line-height: 1.45; }
.review-status { flex: none; margin-top: 2px; padding: 4px 8px; border: 1px solid var(--color-border); border-radius: 6px; color: var(--color-text-secondary); background: var(--color-canvas, #f6f8fb); font-size: 12px; line-height: 1.5; white-space: nowrap; }
.review-status[data-status=pending] { border-color: #ead8b4; color: #846024; background: #fff8eb; }
.review-status[data-status=approved] { border-color: #c5e4d6; color: #28734f; background: #eff9f3; }
.review-entry { display: grid; gap: 8px; min-width: 0; }
.review-field-label { color: var(--color-text-secondary); font-size: 12px; }
.review-entry-actions { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 16px; min-width: 0; }
.review-entry-url { min-width: 0; padding-top: 6px; overflow-wrap: anywhere; font-size: 14px; font-weight: 600; line-height: 1.65; }
.target-open { display: inline-flex; align-items: center; justify-content: center; gap: 6px; color: var(--color-primary, #365cff); white-space: nowrap; }
.review-entry > small, .review-secondary-actions > small { color: var(--color-text-secondary); font-size: 12px; line-height: 1.6; }
.review-decision { display: grid; gap: 10px; }
.review-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.review-capability-note { margin: 0; color: var(--color-text-secondary); font-size: 12px; line-height: 1.65; }
.review-secondary-actions { gap: 14px; padding-top: 16px; border-top: 1px solid var(--color-border); }
.review-secondary-actions > small { flex: 1; min-width: 140px; }
.target-danger { color: #a33939; }
.review-secondary-actions .target-danger { min-height: 32px; padding: 5px 0; border-color: transparent; background: transparent; font-size: 12px; }
.verification-details { min-width: 0; border: 1px solid var(--color-border); border-radius: 9px; padding: 0 14px; background: var(--color-canvas, #f6f8fb); }
.verification-details > summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px 0; font-size: 13px; font-weight: 600; }
.verification-details > summary svg { flex: none; transition: transform .16s ease; }
.verification-details[open] { display: grid; gap: 14px; padding-bottom: 16px; }
.verification-details[open] > summary { border-bottom: 1px solid var(--color-border); }
.verification-details[open] > summary svg { transform: rotate(180deg); }
.verification-description { margin: 0; color: var(--color-text-secondary); font-size: 12px; line-height: 1.6; }
.approval-hint { margin: 0; padding: 10px 12px; border-radius: 8px; color: #8a5a11; background: var(--color-warning-soft, #fff6e3); font-size: 12px; line-height: 1.6; }
.review-fields { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
label { display: grid; gap: 6px; min-width: 0; font-size: 13px; }
.review-form input:not([type=checkbox]), select, textarea { box-sizing: border-box; width: 100%; min-width: 0; border: 1px solid var(--color-border); border-radius: 7px; padding: 9px 10px; background: var(--color-surface); color: inherit; font: inherit; }
.review-form fieldset { min-width: 0; border: 1px solid var(--color-border); border-radius: 9px; padding: 12px; }
.review-form fieldset > label { margin-bottom: 10px; }
.review-form fieldset p { margin-top: 0; color: var(--color-text-secondary); font-size: 12px; line-height: 1.6; }
.review-form legend { padding: 0 5px; font-size: 12px; }
.route-row { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr) 82px auto; align-items: end; gap: 8px; margin-bottom: 10px; }
.route-row label span { color: var(--color-text-secondary); font-size: 11px; }
.scope-row { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) auto; align-items: end; gap: 8px; margin-bottom: 12px; }
.check-field { display: flex; align-items: flex-start; gap: 8px; line-height: 1.6; }
.check-field input { margin-top: 4px; }
button { min-height: 36px; border: 1px solid var(--color-border); border-radius: 7px; padding: 8px 12px; background: var(--color-surface); color: inherit; font: inherit; font-size: 13px; line-height: 1.4; cursor: pointer; }
button:disabled { opacity: .5; cursor: not-allowed; }
button:not(:disabled):hover { border-color: var(--color-primary-muted, #b9c9f5); }
.target-primary { border-color: transparent; background: var(--color-primary, #365cff); color: #fff; }
.advanced-approve { justify-self: start; }
.target-error, .review-notice, .review-loading, .target-empty { margin: 0 0 16px; padding: 12px 14px; border-radius: 8px; color: var(--color-text-secondary); font-size: 13px; line-height: 1.6; }
.target-error { background: #fff1f0; color: #9e2924; }
.review-notice { background: var(--color-primary-soft, #edf3ff); }
.target-empty { padding: 30px 20px; background: var(--color-canvas, #f6f8fb); text-align: center; }
input:focus-visible, select:focus-visible, textarea:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid var(--color-primary, #365cff); outline-offset: 3px; }
.is-standalone .review-body { padding: 0; }
.is-standalone .review-toolbar { padding: 16px 20px; border-bottom: 1px solid var(--color-border); }
.is-standalone .review-layout { grid-template-columns: 256px minmax(0, 1fr); align-items: stretch; gap: 0; }
.is-standalone .review-list { align-self: stretch; box-sizing: border-box; max-height: 570px; max-height: min(570px, 66vh); padding: 22px 14px 22px 20px; border-right: 1px solid var(--color-border); }
.is-standalone .review-form { padding: 22px 26px 24px; }
.is-standalone .target-error, .is-standalone .review-notice, .is-standalone .review-loading { margin: 14px 20px 0; }
.is-standalone .target-empty { margin: 0; border-radius: 0; }
@media (max-width: 1100px) {
  .is-standalone .review-layout { grid-template-columns: 220px minmax(0, 1fr); }
  .is-standalone .review-list { padding-right: 12px; padding-left: 16px; }
  .is-standalone .review-form { padding-right: 20px; padding-left: 20px; }
  .review-request-heading h3 { font-size: 18px; }
  .route-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .scope-row { grid-template-columns: minmax(0, 1fr); }
  .scope-row button { justify-self: start; }
}
@media (max-width: 760px) {
  .review-layout, .is-standalone .review-layout { grid-template-columns: minmax(0, 1fr); }
  .review-list, .is-standalone .review-list { max-height: 240px; padding: 12px; border-right: 0; border-bottom: 1px solid var(--color-border); }
  .review-form, .is-standalone .review-form { padding: 18px; }
  .review-toolbar, .is-standalone .review-toolbar { padding: 14px 16px; }
  .review-entry-actions { grid-template-columns: minmax(0, 1fr); gap: 10px; }
  .target-open { justify-self: start; }
  .review-fields { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) { .verification-details > summary svg { transition: none; } }
</style>
