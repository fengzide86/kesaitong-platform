<template>
  <details class="target-review" :open="openByDefault" @toggle="onToggle">
    <summary><ShieldCheck :size="18" /><span>平台入口审核<small>新增网址的兼容范围 · 不发布安装包</small></span><ChevronDown :size="16" /></summary>
    <section class="review-body" aria-label="平台入口审核">
      <div class="review-toolbar"><p>审核确认部署入口与已有适配能力。V3 或未验证能力不能因批准而变成可执行。</p><button type="button" :disabled="busy" @click="load">刷新</button></div>
      <p v-if="error" class="target-error" role="alert">{{ error }}</p>
      <p v-if="notice" role="status">{{ notice }}</p>
      <p v-if="loading" role="status">正在读取待审核入口…</p>
      <p v-else-if="!items.length && !error" class="target-empty">尚无接入申请。用户在 Windows 工具箱检测新入口后可提交。</p>
      <div v-else class="review-layout">
        <nav aria-label="入口申请"><button v-for="item in items" :key="item.profile.id" type="button" :aria-pressed="selectedId === item.profile.id" :disabled="busy" @click="select(item)"><strong>{{ item.profile.name }}</strong><span>{{ displayEntry(item.profile.entryUrl) }}</span><small>{{ editionLabels[item.profile.edition] }} · {{ reviewLabels[item.profile.reviewStatus] }} · r{{ item.profile.revision }}</small></button></nav>
        <form v-if="selected" class="review-form" @submit.prevent="review('approved')">
          <header><h3>{{ selected.profile.name }}</h3><span>{{ reviewLabels[selected.profile.reviewStatus] }}</span></header>
          <p>申请中的探测信息仅是线索。请用已取得的现场证据核对以下范围，批准后客户端仍会重新预检。</p>
          <div class="review-fields"><label>技术版本<select v-model="edition" :disabled="busy"><option value="unknown">尚未确认</option><option value="v2">V2</option><option value="v3">V3（未验证，不可启用）</option></select></label><label>适配包版本<input v-model.trim="adapterVersion" :disabled="busy" placeholder="已验收的适配包版本" /></label></div>
          <fieldset :disabled="busy"><legend>允许访问的精确 origin 与路径前缀</legend><div v-for="(route, index) in routes" :key="index" class="route-row"><label><span>Origin</span><input v-model.trim="route.origin" :maxlength="TARGET_PROFILE_LIMITS.routeOrigin" placeholder="https://school.example" :aria-label="`Origin ${index + 1}`" /></label><label><span>路径前缀</span><input v-model.trim="route.pathPrefix" :maxlength="TARGET_PROFILE_LIMITS.routePathPrefix" placeholder="/ECrossAmazon/" :aria-label="`路径前缀 ${index + 1}`" /></label><label><span>用途</span><select v-model="route.role" :aria-label="`用途 ${index + 1}`"><option value="entry">入口</option><option value="login">登录</option><option value="business">业务</option></select></label><button type="button" :disabled="routes.length < 2" :aria-label="`移除路径 ${index + 1}`" @click="routes.splice(index, 1)">移除</button></div><button type="button" @click="routes.push({ origin: '', pathPrefix: '/', role: 'business' })">添加路径</button></fieldset>
          <label class="check-field"><input v-model="templateCapability" type="checkbox" :disabled="busy || edition !== 'v2'" />配送模板创建与同对象回读（template.create.v1）</label>
          <label>已核验页面指纹<input v-model.trim="fingerprint" :disabled="busy" placeholder="来自现场检测，不自动生成" /></label>
          <fieldset :disabled="busy"><legend>分页面结构证据</legend><label v-for="page in pageKinds" :key="page.key">{{ page.label }}<input v-model.trim="pageFingerprints[page.key]" :aria-label="page.label" maxlength="64" placeholder="现场检测的 SHA256 指纹" /></label></fieldset>
          <fieldset :disabled="busy"><legend>已核验实训课程范围</legend><p>按具体课程审核，不把用户选择的“实训”当作平台证明。首期不开放比赛执行；下面只登记脱敏课程指纹和证据编号。</p><div v-for="(scope, index) in executionScopes" :key="index" class="scope-row"><label>课程指纹<input v-model.trim="scope.courseRef" :aria-label="`课程指纹 ${index + 1}`" maxlength="64" placeholder="现场核验的课程 SHA256" /></label><label>证据编号<input v-model.trim="scope.evidenceRef" :aria-label="`证据编号 ${index + 1}`" maxlength="128" placeholder="例如：uat-20261012-course-a" /></label><button type="button" :aria-label="`移除课程 ${index + 1}`" @click="executionScopes.splice(index, 1)">移除</button></div><button type="button" :disabled="executionScopes.length >= 32" @click="executionScopes.push({ scenario: 'training', stage: 'not_applicable', courseRef: '', source: 'admin-verified', evidenceRef: '' })">添加已核验课程</button></fieldset>
          <fieldset :disabled="busy"><legend>已核验识别特征</legend><label v-for="marker in markerOptions" :key="marker" class="check-field"><input v-model="markers" type="checkbox" :value="marker" />{{ marker }}</label></fieldset>
          <label class="check-field"><input v-model="verified" type="checkbox" :disabled="busy" />我已核验页面、跳转范围和模板保存回读证据；不是只看到了版本文字。</label>
          <div class="review-actions"><button class="target-primary" type="submit" :disabled="busy || !canApprove">{{ busy ? '正在保存…' : '批准并签名入口配置' }}</button><button type="button" :disabled="busy" @click="review('rejected')">不通过</button><button class="target-danger" type="button" :disabled="busy || selected.profile.reviewStatus === 'disabled'" @click="review('disabled')">停用新执行</button></div>
          <small>停用只阻止新的执行，不会撤回平台已发生的操作。审核请求带版本号，冲突时重新读取，不覆盖他人的结论。</small>
        </form>
      </div>
    </section>
  </details>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ChevronDown, ShieldCheck } from '@lucide/vue'
import { listTargetProfileReviews, reviewTargetProfile } from '@/utils/api/target-profiles'
import { TARGET_ADAPTER_VERSION, TARGET_PROFILE_LIMITS, TARGET_TEMPLATE_CAPABILITY, type SignedTargetProfile, type TargetProfile } from '@/shared/ipc/target-contract'
import { displayEntry, editionLabels, reviewLabels, targetError } from './presentation'

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
let loaded = false
const { openByDefault = false } = defineProps<{ openByDefault?: boolean }>()
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
  try { items.value = await listTargetProfileReviews(); loaded = true; const item = items.value.find(row => row.profile.id === selectedId.value) || items.value.find(row => row.profile.reviewStatus === 'pending') || items.value[0]; if (item) select(item) }
  catch (cause) { error.value = targetError(cause) }
  finally { loading.value = false }
}
function onToggle(event: Event) { if ((event.target as HTMLDetailsElement).open && !loaded && !loading.value) void load() }
onMounted(() => { if (openByDefault) void load() })
async function review(reviewStatus: 'approved' | 'rejected' | 'disabled') {
  if (!selected.value || busy.value || (reviewStatus === 'approved' && !canApprove.value)) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const approval = reviewStatus === 'approved'
    // Rejection/disablement is intentionally status-only.  Never serialize
    // the currently edited approval draft for a destructive state change.
    const payload = approval
      ? {
        revision: selected.value.profile.revision, reviewStatus,
        edition: edition.value,
        allowedRoutes: routes.value,
        capabilities: edition.value === 'v2' && templateCapability.value ? [TARGET_TEMPLATE_CAPABILITY] : [],
        adapterVersion: adapterVersion.value || null,
        evidence: { edition: edition.value, pageFingerprint: /^[a-f0-9]{64}$/.test(fingerprint.value) ? fingerprint.value : null, pageFingerprints: { ...pageFingerprints.value }, markers: markers.value, source: 'admin-verified' as const },
        executionScopes: executionScopes.value.map(scope => ({ ...scope })),
      }
      : { revision: selected.value.profile.revision, reviewStatus }
    const item = await reviewTargetProfile(selected.value.profile.id, payload)
    items.value = items.value.map(row => row.profile.id === item.profile.id ? item : row); select(item)
    notice.value = reviewStatus === 'approved' ? '入口配置已批准。实际执行仍需客户端核验签名、版本、授权和业务上下文。' : '审核状态已更新；没有发布安装包或执行平台业务。'
  } catch (cause) { error.value = targetError(cause) }
  finally { busy.value = false }
}
</script>

<style scoped>
.scope-row{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) auto;align-items:end;gap:8px;margin-bottom:12px}.review-form fieldset>label{margin-bottom:10px}@media(max-width:1050px){.scope-row{grid-template-columns:minmax(0,1fr)}.scope-row button{justify-self:start}}
.target-review{border:1px solid var(--color-border,#dce3ee);border-radius:14px;background:var(--color-surface,#fff);color:var(--color-text,#172a46)}summary{list-style:none;display:flex;align-items:center;gap:12px;padding:18px;cursor:pointer;font-weight:700}summary>span{flex:1;display:grid;gap:4px}summary small{font-weight:400;color:var(--color-text-secondary,#596b83);font-size:12px}.review-body{padding:0 18px 20px}.review-toolbar{display:flex;align-items:center;gap:16px}.review-toolbar p{flex:1}.review-body p,.review-form>small{font-size:13px;line-height:1.7;color:var(--color-text-secondary,#596b83)}.review-layout{display:grid;grid-template-columns:minmax(200px,280px) minmax(0,1fr);gap:20px}nav{display:grid;align-content:start;gap:8px}nav button{display:grid;text-align:left;gap:7px;padding:12px;overflow-wrap:anywhere}nav button[aria-pressed=true]{background:var(--color-primary-soft,#edf3ff);border-color:var(--color-primary,#365cff)}nav span,nav small{font-size:12px;color:var(--color-text-secondary,#596b83)}.review-form{display:grid;gap:15px;min-width:0}.review-form header{display:flex;gap:12px;align-items:center;justify-content:space-between}.review-form h3{margin:0;font-size:17px}.review-form header>span{font-size:12px}.review-fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}label{display:grid;gap:6px;font-size:13px}.review-form input:not([type=checkbox]),select,textarea{box-sizing:border-box;width:100%;min-width:0;border:1px solid var(--color-border,#dce3ee);border-radius:7px;padding:9px 10px;background:var(--color-surface,#fff);color:inherit;font:inherit}.review-form fieldset{min-width:0;border:1px solid var(--color-border,#dce3ee);border-radius:9px;padding:12px}.review-form legend{font-size:12px;padding:0 5px}.route-row{display:grid;grid-template-columns:1.5fr 1fr 82px auto;align-items:end;gap:8px;margin-bottom:10px}.route-row label span{font-size:11px;color:var(--color-text-secondary,#596b83)}button{border:1px solid var(--color-border,#dce3ee);border-radius:7px;padding:9px 12px;background:var(--color-surface,#fff);color:inherit;font:inherit;cursor:pointer;font-size:13px}button:disabled{opacity:.5;cursor:not-allowed}.check-field{display:flex;align-items:flex-start;gap:8px;line-height:1.6}.check-field input{margin-top:4px}.review-actions{display:flex;gap:8px;flex-wrap:wrap}.target-primary{background:var(--color-primary,#365cff);color:white;border-color:transparent}.target-danger{color:#b43737}.target-error{padding:10px;border-radius:8px;background:#fff1f0;color:#9e2924!important}.target-empty{padding:20px;background:var(--color-bg,#f6f8fb);border-radius:9px}input:focus-visible,select:focus-visible,textarea:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--color-primary,#365cff);outline-offset:3px}@media(max-width:1050px){.review-layout{grid-template-columns:1fr}.route-row{grid-template-columns:1fr 1fr}.review-fields{grid-template-columns:1fr}}
</style>
