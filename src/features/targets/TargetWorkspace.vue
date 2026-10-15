<template>
  <section class="target-workspace" data-testid="target-workspace">
    <button class="target-toggle" type="button" :aria-expanded="expanded" @click="toggle"><Globe2 :size="19" /><span><strong>连接你的平台</strong><small>{{ selected ? `${selected.profile.name} · ${reviewLabels[selected.profile.reviewStatus]}` : '先输入网址，登录后即可识别现场' }}</small></span><ChevronDown :size="17" :class="{ rotated: expanded }" /></button>
    <div v-if="expanded" class="target-body">
      <p v-if="!bridge" class="target-notice" role="status">请使用支持多网址接入的 Windows 客户端。普通浏览器不会打开平台账号、探测页面或执行业务。</p>
      <template v-else>
        <div class="target-flow-intro">
          <div class="target-section-heading target-flow-heading"><div><span class="target-kicker">真实平台接入</span><h2>输入网址，登录后开始</h2><p>首次只需完成一次识别；审核通过后，下次选择已登记入口即可直接继续。</p></div><span class="target-flow-scope">不上传账号信息</span></div>
          <ol class="target-step-nav" aria-label="接入步骤"><li :class="{ active: !observation && !receiptBlocksCurrent }">1 选择网址与登录</li><li :class="{ active: observation && !preview && !receiptBlocksCurrent }">2 核对现场与参数</li><li :class="{ active: preview && !receiptBlocksCurrent }">3 预检与确认</li><li :class="{ active: receiptBlocksCurrent || (!preview && Boolean(receipt)) }">4 真实结果</li></ol>
        </div>
        <p v-if="error" class="target-error" role="alert">{{ error }}</p><p v-if="notice" class="target-notice" role="status">{{ notice }}</p>
        <section class="target-connect-section" aria-labelledby="target-connect-title">
          <div class="target-section-heading"><div><span class="target-kicker">第一步 · 接入现场</span><h2 id="target-connect-title">连接平台并确认课程</h2><p>打开后请在平台窗口手动登录，再选择本次要操作的课程。</p></div><span class="target-section-index">01</span></div>
          <form class="target-entry-form" @submit.prevent="openPlatform"><label>平台网址<input data-testid="target-entry-url" v-model.trim="entryUrl" type="url" required :maxlength="TARGET_PROFILE_LIMITS.rawOpenUrl" :disabled="busy" placeholder="https://你的学校或比赛入口" autocomplete="url" aria-label="平台入口网址" /><small>可直接右键粘贴；网址只用于打开并识别当前平台。</small></label><button class="target-primary" data-testid="target-open" type="submit" :disabled="busy || !entryUrl">{{ phase === 'open' ? '正在打开…' : '打开并登录' }}</button></form>
          <div v-if="profiles.length" class="target-saved-entry"><label>已审核或已登记入口<select data-testid="target-profile-select" :value="selectedId" :disabled="busy" @change="selectProfile(($event.target as HTMLSelectElement).value)"><option value="">使用新网址</option><option v-for="item in profiles" :key="item.profile.id" :value="item.profile.id">{{ item.profile.name }} · {{ editionLabels[item.profile.edition] }} · {{ reviewLabels[item.profile.reviewStatus] }}</option></select></label><button type="button" :disabled="busy" @click="load">刷新状态</button></div>
          <div v-if="opened" class="target-after-open"><button type="button" :disabled="busy" data-testid="target-detect" @click="detect">{{ phase === 'detect' ? '正在识别…' : '我已登录并进入课程，识别现场' }}</button><button type="button" :disabled="busy" data-testid="target-refresh" @click="refreshPlatform">{{ phase === 'refresh' ? '正在刷新…' : '卡住了？刷新并重新登录' }}</button></div>
          <p class="target-notice" role="note">打开后只做三件事：在平台窗口登录 → 进入本次课程首页 → 回到这里点击“识别现场”。工具不会替你选课程，也不会在审核前提交业务。</p>
        </section>

        <section v-if="observation" class="target-context" aria-label="当前平台识别结果"><div class="target-section-heading"><div><span class="target-kicker">第二步 · 现场核对</span><h2>当前平台现场</h2><p>识别结果只作为本次预检输入，不代表已经授权执行。</p></div><span :class="['context-badge', { warn: observation.kind !== 'matched' || observation.missing.length > 0 }]">{{ probeLabel }}</span></div><dl><div><dt>页面入口</dt><dd>{{ displayEntry(`${observation.origin}${observation.path}`) }}</dd></div><div><dt>平台版本</dt><dd>{{ editionLabels[observation.version || 'unknown'] }}</dd></div><div><dt>课程 / 赛事</dt><dd>{{ contextRef(observation.courseRef) }}</dd></div><div><dt>店铺</dt><dd>{{ contextRef(observation.shopRef) }}</dd></div><div><dt>账号 / 角色</dt><dd>{{ observation.localAccountRef ? '本机已识别' : observation.missing.includes('account-identity-unverified') ? '账号身份待验收' : '待登录确认' }} · {{ observation.role || '待识别' }}</dd></div><div><dt>入口审核</dt><dd>{{ selected ? reviewLabels[selected.profile.reviewStatus] : '尚未登记' }}</dd></div></dl><ul v-if="observation.missing.length"><li v-for="missing in observation.missing" :key="missing">{{ missingEvidenceLabel(missing) }}</li></ul><p v-if="observation.version === 'v3'">V3 仅记录识别结果，当前没有已验收的 V3 执行能力，不套用 V2 写入。</p></section>
        <form v-if="observation && !selected" class="target-submit" @submit.prevent="submit"><label>入口备注（可选）<input v-model.trim="entryName" :disabled="busy" :maxlength="TARGET_PROFILE_LIMITS.name" placeholder="不填则使用网址主机名" /></label><button type="submit" :disabled="busy">{{ phase === 'submit' ? '正在提交…' : '提交识别结果，等待团队审核' }}</button><small>你不需要填写“实训 / 比赛”等内部术语；系统会从现场识别版本，团队审核后再开放能力。</small></form>
        <p v-if="observation?.courseRef && selected && approved" class="target-notice" role="note" data-testid="training-scope">{{ reviewedTrainingScope ? '本课程已列入团队审核的实训范围；仍需核对本次身份、页面结构和工具授权。' : '本课程尚未列入团队审核的实训范围，不能仅凭选择“实训”开始执行。' }} 首期不开放比赛执行。</p>

        <section v-if="selected || observation" class="target-tool-section" aria-label="配送模板真实工具"><div class="target-section-heading"><div><span class="target-kicker">下一步 · 真实工具</span><h2>配送模板</h2><p>只有入口审核通过且现场识别成功后，这里才会出现可填写的工具参数。</p></div><span class="target-tool-status">受控写入</span></div><p v-if="selected && selected.profile.reviewStatus === 'pending'" class="target-notice"><strong>正在等待团队审核。</strong>你无需填写技术版本、页面指纹或课程术语。审核员会依据脱敏识别证据确认范围；审核完成后刷新状态即可继续。</p><p v-else-if="selected && selected.profile.reviewStatus === 'rejected'" class="target-notice"><strong>入口暂未通过审核。</strong>请联系团队说明现场变化；不要重复提交同一个网址。</p><p v-else-if="selected && selected.profile.reviewStatus === 'disabled'" class="target-notice"><strong>此入口已停用新的执行。</strong>历史记录仍保留，需团队重新核验后恢复。</p><p v-else-if="!toolId && hasOpenTools === false" class="target-notice">当前目录尚无开放与已审核入口绑定的配送模板工具。请先联系团队，不会用模拟执行替代真实工具。</p><p v-else-if="!toolId" class="target-notice">请先在工具目录选择配送模板工具，再开始本次真实操作。</p><p v-else-if="!approved" class="target-notice">此入口还没有可执行的签名配置。刷新入口状态或联系管理员审核。</p>
          <form v-if="toolId" class="template-form" @submit.prevent="preflight">
            <fieldset :disabled="busy || !approved"><legend>这次要做什么</legend><div class="target-fields"><label>现场类型<select data-testid="context-choice" v-model="contextChoice"><option value="training">课程实训</option><option value="practice">比赛练习</option><option value="formal">正式比赛</option></select><small>选择即可，不需要填写内部代码。正式比赛仍需已核验的比赛范围。</small></label><label>模板名称<input v-model.trim="input.name" maxlength="100" required placeholder="输入本次要创建的模板名称" /></label></div><p v-if="stage === 'formal'" class="formal-warning" role="note"><ShieldAlert :size="18" />正式比赛必须由团队单独核验；当前首期未开放正式比赛执行。</p><p class="target-muted">场景和阶段只是本次执行的选择，平台现场与管理员审核范围仍会再次核对。规则来源：本次模板配置；USD · 按重量 / 件数计费。</p></fieldset>
            <fieldset :disabled="busy || !approved">
              <legend>运费规则</legend>
              <p class="target-muted">标准国内配送必须保留完整大陆地区，已为你预填。零运费只是可修改的初始值；未添加的可选配送服务将关闭。国际规则每行选一个实际可用国家，保存前还会核对平台控件。</p>
              <div v-for="(rule, index) in input.rules" :key="index" class="template-rule">
                <div class="rule-heading"><strong>{{ index === 0 ? '必需规则 · 美国大陆地区' : `规则 ${index + 1}` }}</strong><button type="button" :disabled="index === 0" @click="input.rules.splice(index, 1)">移除</button></div>
                <div class="target-fields">
                  <label>配送服务<select :value="rule.serviceCode" :disabled="index === 0" data-testid="service-select" @change="changeService(rule, ($event.target as HTMLSelectElement).value as TemplateCreateInput['rules'][number]['serviceCode'])"><option v-for="service in services" :key="service.value" :value="service.value">{{ service.label }}</option></select></label>
                  <label v-if="rule.serviceCode.startsWith('1')">配送地区<select :value="regionPreset(rule)" :disabled="index === 0 || rule.serviceCode !== '10001'" data-testid="region-preset" @change="setRegionPreset(rule, ($event.target as HTMLSelectElement).value)"><option value="mainland">美国大陆地区（完整预设）</option><option v-if="rule.serviceCode === '10001'" value="islands">Alaska / Hawaii / Puerto Rico</option></select></label>
                  <label v-else>国家（每条一个）<input :value="rule.countries[0] || ''" maxlength="80" required placeholder="例如 Canada，须为平台实际可选国家" data-testid="international-country" @input="rule.countries = [($event.target as HTMLInputElement).value.trim()]" /></label>
                  <label v-if="fixedTransit[rule.serviceCode]">运输时效<input :value="v2TransitLabel(rule.transitTime)" readonly aria-label="固定运输时效" /></label>
                  <label v-else>运输时效<select v-model="rule.transitTime" data-testid="transit-select"><option v-for="value in selectableTransit" :key="value" :value="value">{{ v2TransitLabel(value) }}</option></select></label>
                  <label>每单费用（USD）<input v-model="rule.perOrder" inputmode="decimal" required pattern="(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?" /></label>
                  <label>每单位费用（USD）<input v-model="rule.unitRate" inputmode="decimal" required pattern="(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?" /></label>
                  <label>计费单位<select v-model="rule.unit"><option value="lb">磅（Lb）</option><option value="item">件</option></select></label>
                </div>
              </div>
              <button type="button" :disabled="input.rules.length >= 12" data-testid="add-rule" @click="input.rules.push(newRule('20001'))">添加运费规则</button>
            </fieldset>
            <button class="target-primary" type="submit" :disabled="busy || !approved || observation?.kind !== 'matched'">{{ phase === 'preflight' ? '正在读取与核对…' : '只读预检并生成执行预览' }}</button>
          </form>
        </section>

        <section v-if="preview" class="target-preview" aria-label="执行预览"><header><h3>本次执行预览</h3><span>{{ preview.canExecute ? '预检通过，等待确认' : '尚不可执行' }}</span></header><p>{{ preview.plan.input.name }} · {{ preview.plan.input.rules.length }} 条运费规则 · {{ scenarioLabels[preview.plan.context.scenario] }} / {{ stageLabels[preview.plan.context.stage] }}</p><p class="target-muted">仅新增一份模板；不设默认、不删除、不分配 SKU。版本组合已锁定，参数或入口变化需重新预检。</p><ol><li v-for="step in preview.steps" :key="step">{{ step }}</li></ol><ul v-if="preview.blockers.length" class="target-error"><li v-for="blocker in preview.blockers" :key="blocker">{{ blocker }}</li></ul><p v-if="receiptBlocksCurrent" class="target-notice" role="alert">当前模板和原现场已有待核对结果，不能重复提交。可改用不同模板或入口；原记录仍保留供核对。</p><label v-if="preview.canExecute && !receiptBlocksCurrent && !submissionAttempted" class="target-confirm"><input v-model="confirmed" type="checkbox" :disabled="busy" />我已核对当前账号、课程、店铺和{{ stage === 'formal' ? '正式比赛' : '执行' }}范围，同意保存这份模板。</label><button v-if="!receiptBlocksCurrent && !submissionAttempted" class="target-primary" type="button" :disabled="busy || !preview.canExecute || !confirmed" @click="execute">确认范围，创建并核验模板</button><p v-if="submissionAttempted && !receipt" role="status">{{ phase === 'execute' ? '正在执行并读取平台结果…' : '本次已经发起，结果尚未返回。请查看本机执行记录核对，不要重复创建。' }}</p></section>
        <section v-if="receipt" class="target-result" :class="{ verified: receipt.status === 'verified' }" aria-label="真实执行结果" aria-live="polite"><header><h3>{{ !preview || receipt.planId !== preview.plan.id ? '保留记录 · ' : '' }}{{ receiptLabel(receipt.status) }}</h3><span>{{ stageLabels[receipt.stage] }}</span></header><p v-if="!preview || receipt.planId !== preview.plan.id" class="target-muted">这是先前执行的结果，不代表当前网址、参数或重新登录后的现场已通过预检。</p><p v-if="receipt.status === 'verified'">平台同一模板的保存结果已通过回读核验。</p><p v-else-if="receipt.status === 'not_submitted'">本次没有确认到已提交操作。重新预检后才可建立新尝试。</p><p v-else>提交结果尚不确定，不能直接重复创建。请先核对原现场或读取平台状态。</p><dl><div><dt>记录</dt><dd>{{ receipt.id }}</dd></div><div><dt>模板标识</dt><dd>{{ receipt.objectRef || '尚未确认' }}</dd></div><div v-if="receipt.errorCode"><dt>问题编号</dt><dd>{{ receipt.errorCode }}</dd></div></dl><ul><li v-for="check in receipt.checks" :key="check">{{ check }}</li></ul><button v-if="receipt.status !== 'verified' && receipt.status !== 'not_submitted'" type="button" :disabled="busy" @click="reconcile(receipt)">{{ phase === 'reconcile' ? '正在核对…' : '读取原对象状态，不重新提交' }}</button></section>
        <details class="target-history" @toggle="loadHistory"><summary>查看本机执行记录</summary><p>记录只显示脱敏入口和指纹摘要；核对时仍需重新登录原入口并由主进程验证课程、店铺和账号，不会自动重试提交。</p><p v-if="!receipts.length">暂无本机记录。</p><article v-for="item in receipts" :key="item.id"><div><strong>{{ receiptLabel(item.status) }}</strong><small>{{ historySummary(item) }}</small><small>模板输入指纹 {{ item.inputHash.slice(0, 8) }} · 现场指纹 {{ item.contextHash.slice(0, 8) }} · {{ formatReceiptTime(item.updatedAt) }}</small></div><button v-if="item.status === 'needs_review' || item.status === 'submitting'" type="button" :disabled="busy" @click="prepareReconcile(item)">选择原入口核对</button></article></details>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ChevronDown, Globe2, ShieldAlert } from '@lucide/vue'
import { listTargetProfiles, submitTargetProfile } from '@/utils/api/target-profiles'
import { TARGET_PROFILE_LIMITS, templateCreateInputSchema, type OperationReceipt, type ProbeObservation, type RunPlanPreview, type SignedTargetProfile, type TargetPreflightRequest, type TemplateCreateInput } from '@/shared/ipc/target-contract'
import { V2_MAINLAND_COUNTRIES, V2_ISLAND_COUNTRIES, V2_TEMPLATE_SERVICE_OPTIONS, V2_TEMPLATE_FIXED_TRANSIT, V2_TEMPLATE_SELECTABLE_TRANSIT, v2TransitLabel } from '@/shared/ipc/target-template-options'
import { displayEntry, editionLabels, reviewLabels, scenarioLabels, stageLabels, targetError, missingEvidenceLabel, reviewedMarkerNames } from './presentation'

// `unknown` avoids Vue's absent Boolean-prop coercion to false: an omitted
// value means the workspace is used standalone and must not claim an empty catalog.
const props = defineProps<{ toolId?: string | number; open?: boolean; openRequest?: number; hasOpenTools?: unknown }>()
const bridge = window.electronAPI?.targets
// The first action is the URL field, so a fresh Windows workspace opens on
// that field instead of hiding the entry point behind a second click.
const expanded = ref(true)
const profiles = ref<SignedTargetProfile[]>([])
const selectedId = ref('')
const selected = computed(() => profiles.value.find(item => item.profile.id === selectedId.value))
const entryUrl = ref('')
const entryName = ref('')
const opened = ref(false)
const observation = ref<ProbeObservation | null>(null)
const preview = ref<RunPlanPreview | null>(null)
const receipt = ref<OperationReceipt | null>(null)
const receipts = ref<OperationReceipt[]>([])
const scenario = ref<TargetPreflightRequest['scenario']>('training')
const stage = ref<TargetPreflightRequest['stage']>('not_applicable')
type ContextChoice = 'training' | 'practice' | 'formal'
const contextChoice = computed<ContextChoice>({
  get: () => scenario.value === 'training' || stage.value === 'not_applicable' ? 'training' : stage.value,
  set: value => {
    if (value === 'training') { scenario.value = 'training'; stage.value = 'not_applicable' }
    else { scenario.value = 'competition'; stage.value = value }
  },
})
const input = ref<TemplateCreateInput>({ name: '', currency: 'USD', pricingMode: 'weight-item', rules: [newRule()] })
const phase = ref('')
const busy = computed(() => Boolean(phase.value))
const error = ref('')
const notice = ref('')
const confirmed = ref(false)
const submissionAttempted = ref(false)
let loaded = false
let generation = 0
const services = V2_TEMPLATE_SERVICE_OPTIONS
const fixedTransit = V2_TEMPLATE_FIXED_TRANSIT
const selectableTransit = V2_TEMPLATE_SELECTABLE_TRANSIT
function newRule(serviceCode: TemplateCreateInput['rules'][number]['serviceCode'] = '10001'): TemplateCreateInput['rules'][number] {
  return { countries: serviceCode.startsWith('1') ? [...V2_MAINLAND_COUNTRIES] : ['Canada'], serviceCode, transitTime: V2_TEMPLATE_FIXED_TRANSIT[serviceCode] || '1 - 2', perOrder: '0', unitRate: '0', unit: 'lb' }
}
function changeService(rule: TemplateCreateInput['rules'][number], serviceCode: TemplateCreateInput['rules'][number]['serviceCode']) { const replacement = newRule(serviceCode); Object.assign(rule, { serviceCode, countries: replacement.countries, transitTime: replacement.transitTime }) }
function regionPreset(rule: TemplateCreateInput['rules'][number]) { return rule.countries[0] === 'Alaska' ? 'islands' : 'mainland' }
function setRegionPreset(rule: TemplateCreateInput['rules'][number], preset: string) { rule.countries = [...(preset === 'islands' ? V2_ISLAND_COUNTRIES : V2_MAINLAND_COUNTRIES)] }
const approved = computed(() => Boolean(selected.value?.signature && selected.value.signingKeyId && selected.value.profile.reviewStatus === 'approved' && selected.value.profile.edition === 'v2' && selected.value.profile.capabilities.includes('template.create.v1')))
const reviewedTrainingScope = computed(() => selected.value?.profile.executionScopes?.some(scope => scope.courseRef === observation.value?.courseRef && scope.scenario === 'training' && scope.stage === 'not_applicable' && scope.source === 'admin-verified') || false)
const probeLabel = computed(() => ({ matched: observation.value?.missing.length ? '页面已识别，身份或现场仍待核对' : '现场已识别，执行仍需预检', ambiguous: '识别冲突，不可写入', unknown: '识别未完成，不可写入', login_required: '请刷新并重新登录，进入原课程后再识别' })[observation.value?.kind || 'unknown'])
const contextRef = (value: string | null) => value ? `本机已识别 · ${value.slice(0, 8)}` : '未识别，不能执行'
const receiptLabel = (value: OperationReceipt['status']) => ({ verified: '已核验成功', not_submitted: '确定未提交', prepared: '已准备，尚待核验', submitting: '结果待核对', needs_review: '结果待核对' })[value]
const pendingReceiptForCurrentPlan = computed(() => {
  const item = receipt.value?.status === 'needs_review' || receipt.value?.status === 'submitting' ? receipt.value : undefined
  if (item) return item
  const plan = preview.value?.plan
  if (!plan) return undefined
  return receipts.value.find(candidate => ['needs_review', 'submitting'].includes(candidate.status)
    && candidate.profileId === plan.context.profileId
    && candidate.profileRevision === plan.context.profileRevision
    && candidate.contextHash === plan.contextHash
    && candidate.inputHash === plan.inputHash
    && candidate.stage === plan.context.stage)
})
const receiptBlocksCurrent = computed(() => {
  const item = pendingReceiptForCurrentPlan.value
  const plan = preview.value?.plan
  if (!item || !plan) return false
  return item.profileId === plan.context.profileId
    && item.profileRevision === plan.context.profileRevision
    && item.contextHash === plan.contextHash
    && item.inputHash === plan.inputHash
    && item.stage === plan.context.stage
})
function historyProfile(item: OperationReceipt): SignedTargetProfile | undefined {
  return profiles.value.find(row => row.profile.id === item.profileId)
}
function historySummary(item: OperationReceipt): string {
  const profile = historyProfile(item)
  return `${profile?.profile.name || '原入口已不可用'} · ${profile ? displayEntry(profile.profile.entryUrl) : '请联系支持核对入口'} · ${stageLabels[item.stage]} · 课程/店铺需重新识别`
}
function formatReceiptTime(value: string): string {
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(time) : '时间待确认'
}

function invalidate() { generation++; preview.value = null; confirmed.value = false; submissionAttempted.value = false }
watch(() => props.open, value => { if (value) { expanded.value = true; if (!loaded) void load() } })
watch(() => props.openRequest, () => { expanded.value = true; if (!loaded) void load() })
onMounted(() => { if (expanded.value && bridge && !loaded) void load() })
watch(() => props.toolId, invalidate)
watch(input, invalidate, { deep: true })
watch(scenario, value => {
  if (value === 'training') stage.value = 'not_applicable'
  else if (!['practice', 'formal'].includes(stage.value)) stage.value = 'practice'
  invalidate()
})
watch(stage, invalidate)
watch(entryUrl, value => {
  // Selecting a saved profile is still reversible: editing its URL turns the
  // operation into a new, unreviewed entry instead of silently reusing its
  // signature and evidence.
  if (selectedId.value && value !== selected.value?.profile.entryUrl) selectedId.value = ''
  opened.value = false; observation.value = null; invalidate()
})
function toggle() { expanded.value = !expanded.value; if (expanded.value && !loaded && bridge) void load() }
async function task(name: string, action: () => Promise<void>) { if (busy.value) return; phase.value = name; error.value = ''; notice.value = ''; try { await action() } catch (cause) { error.value = targetError(cause) } finally { phase.value = '' } }
async function load() {
  if (!bridge) return
  await task('load', async () => {
    profiles.value = await listTargetProfiles()
    try {
      // Load local receipts with the entry list so the UI can block the same
      // unresolved attempt before the user reaches the final submit button.
      receipts.value = await bridge.listReceipts()
    } catch {
      receipts.value = []
      notice.value = '本机执行记录暂时无法读取；提交前主进程仍会再次核对，不能据此重复执行。'
    }
    loaded = true
    if (!selectedId.value) {
      const approvedEntry = profiles.value.filter(row => row.profile.reviewStatus === 'approved')
      if (approvedEntry.length === 1) selectProfile(approvedEntry[0]!.profile.id)
    }
    invalidate()
  })
}
function selectProfile(id: string) { selectedId.value = id; const item = profiles.value.find(row => row.profile.id === id); entryUrl.value = item?.profile.entryUrl || ''; observation.value = null; opened.value = false; invalidate() }
async function openPlatform() { if (!bridge) return; await task('open', async () => { await bridge.open({ entryUrl: entryUrl.value, ...(selected.value ? { profileId: selected.value.profile.id } : {}) }); opened.value = true; observation.value = null; invalidate(); notice.value = '已打开本机平台窗口。请完成登录并进入目标课程 / 店铺，再回来识别现场。' }) }
async function refreshPlatform() {
  if (!bridge || !opened.value) return
  await task('refresh', async () => {
    // A refresh invalidates the plan even if navigation fails, but never clears a submission receipt.
    observation.value = null; invalidate()
    await bridge.refresh()
    notice.value = '已刷新原平台窗口。请重新登录并进入原来的课程地图首页，再识别现场。已有待核对记录保留；不会因为重新登录而重试提交。'
  })
}
async function detect() { if (!bridge || !opened.value) return; await task('detect', async () => { observation.value = await bridge.detect(); invalidate() }) }
async function submit() {
  const observed = observation.value
  if (!observed || selected.value) return
  await task('submit', async () => {
    const markers = reviewedMarkerNames(observed.evidence)
    const fallbackName = (() => { try { return new URL(entryUrl.value).hostname } catch { return '新平台入口' } })()
    const item = await submitTargetProfile({ name: entryName.value || fallbackName, entryUrl: displayEntry(entryUrl.value), providerId: 'bjysoft', productKey: 'amazon', edition: observed.version || 'unknown', evidence: { edition: observed.version || 'unknown', pageFingerprint: observed.pageFingerprint, markers } })
    profiles.value = [...profiles.value.filter(row => row.profile.id !== item.profile.id), item]; selectedId.value = item.profile.id
    notice.value = '检测资料已提交，等待团队首次审核。此次没有保存或提交平台业务。'; invalidate()
  })
}
async function preflight() {
  if (!bridge || !selected.value || !approved.value || !props.toolId || observation.value?.kind !== 'matched') return
  await task('preflight', async () => {
    if (input.value.rules.some(rule => rule.serviceCode.startsWith('2') && (rule.countries.length !== 1 || !/^[A-Za-z][A-Za-z .'()&/-]{0,79}$/.test(rule.countries[0] || '')))) throw new Error('国际规则每条只能填写一个平台实际可选的英文国家，不支持逗号合并多个国家。')
    const parsed = templateCreateInputSchema.safeParse(input.value)
    if (!parsed.success) throw new Error(`请检查模板参数：${parsed.error.issues[0]?.message || '输入不完整'}`)
    invalidate(); const ticket = generation
    const result = await bridge.preflight({ profileId: selected.value!.profile.id, profileRevision: selected.value!.profile.revision, toolId: props.toolId!, scenario: scenario.value, stage: stage.value, input: parsed.data })
    if (ticket === generation) { preview.value = result }
  })
}
async function execute() { if (!bridge || !preview.value?.canExecute || !confirmed.value || receiptBlocksCurrent.value || submissionAttempted.value) return; await task('execute', async () => { const planId = preview.value!.plan.id; confirmed.value = false; submissionAttempted.value = true; receipt.value = await bridge.execute({ planId }); receipts.value = await bridge.listReceipts() }) }
async function reconcile(item: OperationReceipt) { if (!bridge) return; await task('reconcile', async () => { receipt.value = await bridge.reconcile({ operationId: item.id }); receipts.value = await bridge.listReceipts() }) }
function prepareReconcile(item: OperationReceipt): void {
  const profile = historyProfile(item)
  if (!profile) { notice.value = '原入口已不在当前授权列表，请联系支持核对。'; return }
  selectedId.value = profile.profile.id
  entryUrl.value = profile.profile.entryUrl
  receipt.value = item
  observation.value = null
  opened.value = false
  invalidate()
  notice.value = '已选择原入口。请打开并登录原课程，进入原店铺后识别现场，再读取原对象状态；不会自动提交。'
}
async function loadHistory(event: Event) { if (!bridge || !(event.target as HTMLDetailsElement).open) return; await task('history', async () => { receipts.value = await bridge.listReceipts() }) }
</script>

<style scoped>
.target-workspace{margin:18px 0;border:1px solid var(--color-border,#dce3ee);border-radius:16px;background:var(--color-surface,#fff);color:var(--color-text,#172a46);overflow:hidden}.target-toggle{width:100%;display:flex;align-items:center;gap:12px;text-align:left;border:0;border-radius:0;padding:17px 20px}.target-toggle>span{flex:1;display:grid;gap:4px}.target-toggle strong{font-size:14px}.target-toggle small{color:var(--color-text-secondary,#596b83);font-size:12px}.rotated{transform:rotate(180deg)}.target-body{padding:0 20px 22px;display:grid;gap:18px;min-width:0}.target-step-nav{display:flex;flex-wrap:wrap;gap:9px;margin:0;padding:14px 0 0;list-style:none;border-top:1px solid var(--color-border,#dce3ee)}.target-step-nav li{font-size:12px;border-radius:20px;background:var(--color-bg,#f5f7fb);padding:7px 12px;color:var(--color-text-secondary,#596b83)}.target-step-nav li.active{color:var(--color-primary,#365cff);background:var(--color-primary-soft,#edf3ff);font-weight:700}.target-entry-row,.target-entry-form{display:flex;gap:10px;align-items:end}.target-entry-row label{flex:1}.target-entry-form label{flex:1;min-width:180px}label{display:grid;gap:7px;font-size:13px}input:not([type=checkbox]),select{width:100%;min-width:0;box-sizing:border-box;border:1px solid var(--color-border,#dce3ee);border-radius:8px;background:var(--color-surface,#fff);color:inherit;padding:10px 11px;font:inherit}button{border:1px solid var(--color-border,#dce3ee);border-radius:8px;background:var(--color-surface,#fff);color:inherit;font:inherit;font-size:13px;padding:10px 14px;cursor:pointer;line-height:1.4}button:disabled,fieldset:disabled{opacity:.55;cursor:not-allowed}button.target-primary{background:var(--color-primary,#365cff);color:#fff;border-color:transparent}.target-muted{color:var(--color-text-secondary,#596b83);font-size:12px;line-height:1.7}.target-notice,.target-error{border-radius:10px;background:var(--color-bg,#f5f7fb);padding:12px 14px;font-size:13px;line-height:1.7;margin:0}.target-error{background:#fff1f0;color:#9e2924}.target-context,.target-preview,.target-result{border:1px solid var(--color-border,#dce3ee);border-radius:12px;padding:17px;min-width:0}.target-context header,.target-tool-section header,.target-preview header,.target-result header{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}h3{font-size:15px;margin:0}header>span{font-size:12px;color:var(--color-text-secondary,#596b83)}.context-badge{background:#eaf7f1;padding:5px 9px;border-radius:20px;color:#216750!important}.context-badge.warn{background:#fff5df;color:#865a1d!important}dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:15px;margin:18px 0 0}dl>div{min-width:0}dt{font-size:11px;color:var(--color-text-secondary,#596b83);margin-bottom:5px}dd{margin:0;overflow-wrap:anywhere;font-size:13px}.target-context p,.target-context ul,.target-preview p,.target-preview li,.target-result p,.target-result li{font-size:13px;line-height:1.7}.target-submit{display:flex;align-items:end;flex-wrap:wrap;gap:12px}.target-submit label{flex:1}.target-submit small{width:100%;color:var(--color-text-secondary,#596b83);font-size:12px}.target-tool-section{display:grid;gap:14px;border-top:1px solid var(--color-border,#dce3ee);padding-top:20px}.template-form{display:grid;gap:15px}.template-form>button{justify-self:start}.template-form fieldset{border:1px solid var(--color-border,#dce3ee);border-radius:12px;padding:16px;min-width:0}.template-form legend{padding:0 6px;font-size:12px;color:var(--color-text-secondary,#596b83)}.target-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.template-rule{padding-bottom:18px;margin-bottom:18px;border-bottom:1px solid var(--color-border,#dce3ee)}.rule-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;font-size:13px}.rule-heading button{padding:5px 9px;font-size:12px}.formal-warning{display:flex;gap:9px;align-items:center;padding:12px;background:#fff1df;border:1px solid #e9b972;border-radius:9px;color:#7f4b10;font-size:13px;line-height:1.6}.formal-warning svg{flex:none}.target-confirm{display:flex;align-items:flex-start;margin:15px 0;line-height:1.7}.target-confirm input{margin-top:4px}.target-result.verified{background:#f5fcf8;border-color:#a4d6b8}.target-history{border-top:1px solid var(--color-border,#dce3ee);padding-top:15px}.target-history summary{font-size:13px;cursor:pointer}.target-history p{font-size:12px;color:var(--color-text-secondary,#596b83);line-height:1.7}.target-history article{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 0;border-top:1px solid var(--color-border,#dce3ee)}.target-history article>div{display:grid;gap:5px;font-size:13px;overflow-wrap:anywhere}.target-history small{color:var(--color-text-secondary,#596b83)}input:focus-visible,select:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--color-primary,#365cff);outline-offset:3px}@media(max-width:1100px){.target-entry-form{flex-wrap:wrap}.target-entry-form>label{flex-basis:100%}.target-fields,dl{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:650px){.target-body{padding:0 14px 18px}.target-toggle{padding:15px 14px}.target-fields,dl{grid-template-columns:1fr}.target-entry-row{flex-wrap:wrap}.target-entry-row label{flex-basis:100%}.target-submit>label{flex-basis:100%}.target-history article{align-items:start;flex-direction:column}}
</style>

<style scoped>
/* The workflow is intentionally spacious: each stage gets a clear visual
   surface so users can tell what is read-only, what is editable, and what
   will write to the selected platform. */
.target-workspace {
  --target-ink: var(--color-text, #172a46);
  --target-muted: var(--color-text-secondary, #596b83);
  --target-border: var(--color-border, #dce3ee);
  --target-blue: var(--color-primary, #365cff);
  --target-soft: var(--color-primary-soft, #edf3ff);
  margin: 24px 0;
  border-color: #ccd7e7;
  border-radius: 20px;
  box-shadow: 0 14px 40px rgba(31, 52, 86, .08);
}
.target-toggle {
  min-height: 76px;
  padding: 18px 24px;
  background: linear-gradient(135deg, #f8fbff 0%, #fff 72%);
}
.target-toggle > svg:first-child { color: var(--target-blue); flex: none; }
.target-toggle strong { color: var(--target-ink); font-size: 16px; letter-spacing: .01em; }
.target-toggle small { font-size: 13px; line-height: 1.5; }
.target-body {
  gap: 22px;
  padding: 4px 28px 30px;
  background: linear-gradient(180deg, #fbfcff 0%, #fff 160px);
}
.target-flow-intro { display: grid; gap: 18px; padding: 4px 0 2px; }
.target-section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}
.target-section-heading > div { min-width: 0; }
.target-kicker {
  display: block;
  margin-bottom: 7px;
  color: var(--target-blue);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .12em;
  text-transform: uppercase;
}
.target-section-heading h2 {
  margin: 0;
  color: var(--target-ink);
  font-size: 19px;
  line-height: 1.35;
  letter-spacing: -.01em;
}
.target-section-heading p { margin: 6px 0 0; color: var(--target-muted); font-size: 13px; line-height: 1.65; }
.target-flow-scope, .target-tool-status, .target-section-index {
  flex: none;
  border-radius: 999px;
  padding: 7px 11px;
  background: var(--target-soft);
  color: var(--target-blue);
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}
.target-section-index { padding: 6px 10px; background: #edf1f8; color: #65748b; font-variant-numeric: tabular-nums; }
.target-step-nav {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  padding: 0;
  border: 0;
}
.target-step-nav li {
  position: relative;
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid #e1e7f0;
  border-radius: 12px;
  background: #f5f7fb;
  color: #6a7890;
  font-size: 12px;
  line-height: 1.35;
}
.target-step-nav li::first-letter { font-weight: 800; }
.target-step-nav li.active { border-color: #a9b9ff; background: #eef2ff; color: #2346d8; box-shadow: 0 4px 12px rgba(54, 92, 255, .08); }
.target-step-nav li.active::after { content: ''; position: absolute; right: 10px; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.target-connect-section, .target-context, .target-tool-section, .target-preview, .target-result, .target-history {
  border-color: #d7e0ec;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(31, 52, 86, .045);
}
.target-connect-section { display: grid; gap: 16px; padding: 22px; }
.target-entry-row { padding: 14px; border: 1px solid #e4eaf2; border-radius: 12px; background: #f8faff; }
.target-entry-form { align-items: end; gap: 12px; }
.target-entry-form > label { min-width: 240px; }
label { gap: 8px; color: var(--target-ink); font-size: 13px; font-weight: 650; }
input:not([type=checkbox]), select { border-color: #cfd9e7; border-radius: 9px; padding: 11px 12px; background: #fff; }
input:not([type=checkbox]):hover, select:hover { border-color: #aabbd3; }
button { border-radius: 9px; padding: 10px 14px; transition: background .16s ease, border-color .16s ease, transform .16s ease; }
button:not(:disabled):hover { border-color: #9eafd0; background: #f6f8fc; }
button.target-primary:not(:disabled):hover { border-color: transparent; background: #2e4fe3; transform: translateY(-1px); }
.target-notice, .target-error { border: 1px solid #e0e7f1; border-radius: 11px; padding: 12px 14px; }
.target-muted { line-height: 1.75; }
.target-context, .target-preview, .target-result { padding: 22px; }
.target-context > .target-section-heading, .target-preview > header, .target-result > header { padding-bottom: 15px; border-bottom: 1px solid #e8edf4; }
.target-context dl { margin-top: 18px; gap: 10px; }
.target-context dl > div { padding: 11px 12px; border: 1px solid #edf0f5; border-radius: 10px; background: #fafcff; }
.target-context dt { margin-bottom: 6px; font-size: 11px; letter-spacing: .03em; }
.target-context dd { font-weight: 650; line-height: 1.45; }
.target-context ul { margin: 16px 0 0; padding: 12px 14px 12px 30px; border-radius: 10px; background: #fff8e7; color: #7a581e; }
.context-badge { padding: 7px 11px; font-weight: 700; }
.target-submit { padding: 16px; border: 1px dashed #bdcbe0; border-radius: 12px; background: #fbfcff; }
.target-tool-section { gap: 18px; border-top: 0; padding: 22px; }
.target-tool-section > .target-section-heading { padding-bottom: 2px; }
.template-form { gap: 18px; }
.template-form fieldset { padding: 20px; border-color: #d8e1ed; border-radius: 14px; background: #fcfdff; }
.template-form legend { padding: 0 8px; color: #465b78; font-size: 13px; font-weight: 750; }
.target-fields { gap: 16px; }
.template-rule { margin: 4px 0 20px; padding: 0 0 20px; border-bottom-color: #e3e9f1; }
.rule-heading { margin-bottom: 14px; font-size: 14px; }
.rule-heading strong { color: #2a3d59; }
.formal-warning { padding: 14px; border-radius: 11px; }
.target-preview ol { display: grid; gap: 8px; margin: 16px 0 0; padding: 0; list-style: none; counter-reset: preview-step; }
.target-preview ol li { counter-increment: preview-step; display: flex; gap: 10px; align-items: baseline; padding: 9px 11px; border-radius: 9px; background: #f7f9fc; }
.target-preview ol li::before { content: counter(preview-step); display: inline-grid; place-items: center; width: 20px; height: 20px; flex: none; border-radius: 50%; background: #e9efff; color: var(--target-blue); font-size: 11px; font-weight: 800; }
.target-confirm { margin: 18px 0; padding: 13px 14px; border: 1px solid #cddaff; border-radius: 10px; background: #f5f7ff; }
.target-result.verified { box-shadow: 0 10px 30px rgba(42, 135, 87, .1); }
.target-result dl { margin-top: 16px; }
.target-history { padding: 18px 22px; border-top: 1px solid #d7e0ec; }
.target-history summary { color: #324866; font-weight: 700; }
@media (max-width: 900px) { .target-step-nav { grid-template-columns: repeat(2, minmax(0, 1fr)); } .target-section-heading { gap: 12px; } }
@media (max-width: 650px) { .target-body { padding: 4px 14px 22px; } .target-toggle { min-height: 68px; padding: 16px 14px; } .target-connect-section, .target-context, .target-tool-section, .target-preview, .target-result { padding: 17px; } .target-section-heading { display: grid; } .target-flow-scope, .target-tool-status, .target-section-index { justify-self: start; } .target-step-nav { grid-template-columns: 1fr; } .target-entry-row { padding: 12px; } }
</style>
