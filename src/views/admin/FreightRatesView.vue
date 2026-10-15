<template>
  <main class="rate-center" data-route-focus>
    <PageHeader
      eyebrow="物流费率管理"
      title="物流费率中心"
      description="将 Excel 转换为可核验、可签名、可回退的标准费率包。页面适配器与费率版本互不影响。"
    >
      <template #actions>
        <div class="hero-status">
          <span :class="{ online: parserAvailable }"></span>
          <div><strong>{{ isDesktop ? '桌面解析器已连接' : '浏览器解析器可用' }}</strong><small>Excel 原文件不上传，后台只保存标准化规则</small></div>
        </div>
      </template>
    </PageHeader>

    <section class="stage-rail" aria-label="费率发布流程">
      <article v-for="(stage, index) in stages" :key="stage.title" :class="{ active: currentStage === index, done: currentStage > index }">
        <span>{{ String(index + 1).padStart(2, '0') }}</span><div><strong>{{ stage.title }}</strong><small>{{ stage.detail }}</small></div>
      </article>
    </section>

    <section class="rate-layout">
      <div class="work-column">
        <article class="panel upload-panel">
          <header><div><span>01 · SOURCE</span><h2>载入费率工作簿</h2></div><FileSpreadsheet :size="22" /></header>
          <div class="metadata-grid">
            <label>费率包名称<input v-model="draftName" /></label>
            <label>版本<input v-model="draftVersion" placeholder="1.0.0" /></label>
            <label>人民币 / 美元汇率<input v-model.number="exchangeRate" type="number" min="0.01" step="0.01" /></label>
          </div>
          <div class="upload-actions">
            <button class="primary" :disabled="busy || !parserAvailable" @click="chooseWorkbook"><Upload :size="17" />选择新费率表</button>
            <button :disabled="busy || !parserAvailable" @click="loadBuiltIn"><Database :size="17" />载入内置首版</button>
          </div>
          <div v-if="parsed" class="source-summary">
            <div><strong>{{ parsed.sourceFileName }}</strong><span>SHA-256 {{ parsed.pack.sourceHash.slice(0, 16) }}…</span></div>
            <div class="summary-metrics"><span><b>{{ parsed.summary.carrierCount }}</b>承运商</span><span><b>{{ parsed.summary.countryCount }}</b>国家/地区</span><span><b>{{ parsed.summary.ruleCount }}</b>费率规则</span></div>
          </div>
        </article>

        <article v-if="parsed" class="panel mapping-panel">
          <header><div><span>02 · MAPPING</span><h2>字段识别与工作表映射</h2></div><button class="text-button" :disabled="busy" @click="reparse"><RefreshCw :size="15" />重新识别</button></header>
          <div class="mapping-list">
            <div v-for="mapping in parsed.mappings" :key="mapping.carrierKey" class="mapping-row">
              <div><strong>{{ mapping.carrierName }}</strong><small>{{ mapping.ruleCount }} 条规则</small></div>
              <select v-model="sheetMappings[mapping.carrierKey]">
                <option value="">自动识别</option>
                <option v-for="sheet in parsed.availableWorksheets" :key="sheet" :value="sheet">{{ sheet }}</option>
              </select>
              <span :class="mapping.confidence === 1 ? 'confidence high' : 'confidence low'">{{ mapping.confidence === 1 ? '识别通过' : '需要映射' }}</span>
            </div>
          </div>
          <div v-if="parsed.warnings.length" class="warning-list"><CircleAlert :size="16" /><span>{{ parsed.warnings.join('；') }}</span></div>
        </article>

        <article v-if="parsed?.pack.rules.length" class="panel quote-panel">
          <header><div><span>03 · VALIDATION</span><h2>发布前样例计算</h2></div><Calculator :size="21" /></header>
          <div class="quote-inputs">
            <label>国家<input v-model="quoteInput.country" placeholder="美国 / US" /></label>
            <label>实重 kg<input v-model.number="quoteInput.actualWeightKg" type="number" min="0.001" step="0.01" /></label>
            <label>长 cm<input v-model.number="quoteInput.length" type="number" min="0" /></label>
            <label>宽 cm<input v-model.number="quoteInput.width" type="number" min="0" /></label>
            <label>高 cm<input v-model.number="quoteInput.height" type="number" min="0" /></label>
            <button class="primary" :disabled="busy" @click="calculateQuote">计算并比较</button>
          </div>
          <div v-if="quoteResult" class="quote-result">
            <div class="quote-winner">
              <span>推荐渠道</span><strong>{{ quoteResult.selected?.carrierName || '无可用渠道' }}</strong>
              <b v-if="quoteResult.selected">¥{{ quoteResult.selected.totalCny?.toFixed(2) }} / ${{ quoteResult.selected.totalUsd?.toFixed(2) }}</b>
              <small>费率版本 {{ quoteResult.ratePackVersion }} · 汇率 {{ quoteResult.exchangeRateCnyPerUsd }}</small>
            </div>
            <div class="candidate-table">
              <div class="candidate-head"><span>渠道</span><span>计费重</span><span>基础运费</span><span>固定费</span><span>附加费</span><span>总计</span></div>
              <div v-for="candidate in quoteResult.candidates" :key="candidate.carrierId" :class="['candidate-row', { disabled: !candidate.eligible }]">
                <span><strong>{{ candidate.carrierName }}</strong><small>{{ candidate.reason || candidate.warnings.join('；') }}</small></span>
                <span>{{ candidate.billableWeightKg?.toFixed(2) || '—' }} kg</span>
                <span>{{ money(candidate.baseFreightCny) }}</span><span>{{ money(candidate.fixedFeeCny) }}</span><span>{{ money(candidate.surchargeCny) }}</span><span>{{ money(candidate.totalCny) }}</span>
              </div>
            </div>
          </div>
        </article>

        <article v-if="parsed?.pack.rules.length" class="panel publish-panel">
          <header><div><span>04 · RELEASE</span><h2>保存草稿并签名发布</h2></div><ShieldCheck :size="21" /></header>
          <p>发布时后台会重新校验规则、计算制品 SHA-256 并使用独立签名密钥生成清单。</p>
          <div class="publish-actions">
            <button :disabled="busy || Boolean(createdDraft)" @click="saveDraft"><Save :size="17" />{{ createdDraft ? '草稿已保存' : '保存标准化草稿' }}</button>
            <button class="primary" :disabled="busy || !createdDraft" @click="publishDraft"><BadgeCheck :size="17" />签名并发布</button>
          </div>
        </article>
      </div>

      <aside class="release-column">
        <article class="panel release-list">
          <header><div><span>版本历史</span><h2>版本与回退</h2></div><History :size="20" /></header>
          <div v-if="!releases.length" class="empty-release">尚未保存费率版本</div>
          <div v-for="release in releases" :key="`${release.pack_id}:${release.version}`" class="release-item">
            <div><span :class="['release-status', release.status]">{{ release.status }}</span><strong>{{ release.name }}</strong><small>{{ release.pack_id }} · {{ release.version }}</small></div>
            <button v-if="release.status !== 'published'" :disabled="busy" @click="rollback(release)"><RotateCcw :size="14" />回退到此版</button>
            <span v-else class="current-badge"><Check :size="13" />当前发布</span>
          </div>
        </article>
      </aside>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import { BadgeCheck, Calculator, Check, CircleAlert, Database, FileSpreadsheet, History, RefreshCw, RotateCcw, Save, ShieldCheck, Upload } from '@lucide/vue'
import { showToast } from '@/utils'
import { createFreightRateDraft, getFreightRateReleases, publishFreightRatePack, rollbackFreightRatePack } from '@/utils/api'
import type { FreightQuoteResult } from '@/shared/freight/types'
import { quoteFreight } from '@/shared/freight/rate-engine'
import {
  chooseBrowserFreightWorkbook,
  loadBuiltInFreightWorkbook,
  parseFreightWorkbookBuffer,
  type FreightWorkbookOptions,
  type ParsedFreightWorkbook,
} from '@/shared/freight/workbook-parser'
import { getRuntimeCapabilities } from '@/runtime/capabilities'
import PageHeader from '@/components/PageHeader.vue'

interface Release { pack_id: string; version: string; name: string; status: string }

const stages = [
  { title: '上传工作簿', detail: '本地读取 Excel' }, { title: '识别映射', detail: '确认工作表和规则' },
  { title: '样例核验', detail: '比较候选渠道' }, { title: '签名发布', detail: '独立回退版本' },
]
const runtime = getRuntimeCapabilities()
const busy = ref(false)
const parsed = ref<ParsedFreightWorkbook | null>(null)
const quoteResult = ref<FreightQuoteResult | null>(null)
const releases = ref<Release[]>([])
const createdDraft = ref<Release | null>(null)
const draftName = ref('赛训物流费率包')
const draftVersion = ref('1.0.0')
const exchangeRate = ref(7)
const sheetMappings = reactive<Record<string, string>>({})
const quoteInput = reactive({ country: '美国', actualWeightKg: 0.5, length: 20, width: 15, height: 8 })
const isDesktop = computed(() => runtime.isDesktop && Boolean(window.electronAPI?.freight))
const parserAvailable = computed(() => runtime.freightWorkbook)
const currentStage = computed(() => createdDraft.value ? 3 : quoteResult.value ? 2 : parsed.value ? 1 : 0)
let browserSource: { buffer: ArrayBuffer; fileName: string; builtIn: boolean } | null = null

const message = (error: unknown, fallback: string) => error instanceof Error && error.message ? error.message : fallback
const money = (value?: number) => Number.isFinite(value) ? `¥${Number(value).toFixed(2)}` : '—'

function parsePayload(value: unknown): ParsedFreightWorkbook {
  if (!value || typeof value !== 'object' || !('pack' in value)) throw new Error('费率解析结果无效')
  return value as ParsedFreightWorkbook
}

function options(): FreightWorkbookOptions {
  return { id: 'competition-freight', version: draftVersion.value, name: draftName.value, exchangeRateCnyPerUsd: exchangeRate.value, sheetMappings: { ...sheetMappings } }
}

function acceptParsed(value: unknown) {
  parsed.value = parsePayload(value)
  parsed.value.pack.version = draftVersion.value
  parsed.value.pack.name = draftName.value
  parsed.value.pack.exchangeRateCnyPerUsd = exchangeRate.value
  for (const mapping of parsed.value.mappings) sheetMappings[mapping.carrierKey] = mapping.worksheetName || ''
  quoteResult.value = null
  createdDraft.value = null
}

async function chooseWorkbook() {
  busy.value = true
  try {
    if (isDesktop.value) {
      const value = await window.electronAPI?.freight?.parseWorkbook(options())
      if (value) acceptParsed(value)
    } else {
      const file = await chooseBrowserFreightWorkbook()
      if (!file) return
      const buffer = await file.arrayBuffer()
      browserSource = { buffer, fileName: file.name, builtIn: false }
      acceptParsed(await parseFreightWorkbookBuffer(buffer, file.name, options()))
    }
  }
  catch (error) { showToast(message(error, '费率工作簿解析失败'), 'error') }
  finally { busy.value = false }
}

async function loadBuiltIn() {
  busy.value = true
  try {
    if (isDesktop.value) acceptParsed(await window.electronAPI?.freight?.getDefaultPack())
    else {
      browserSource = { buffer: new ArrayBuffer(0), fileName: 'FreightTemplate_v2.xlsx', builtIn: true }
      acceptParsed(await loadBuiltInFreightWorkbook(options()))
    }
  }
  catch (error) { showToast(message(error, '内置费率包载入失败'), 'error') }
  finally { busy.value = false }
}

async function reparse() {
  busy.value = true
  try {
    if (isDesktop.value) acceptParsed(await window.electronAPI?.freight?.reparseWorkbook(options()))
    else if (browserSource?.builtIn) acceptParsed(await loadBuiltInFreightWorkbook(options()))
    else if (browserSource) acceptParsed(await parseFreightWorkbookBuffer(browserSource.buffer, browserSource.fileName, options()))
    else throw new Error('请先选择费率工作簿')
  }
  catch (error) { showToast(message(error, '重新识别失败'), 'error') }
  finally { busy.value = false }
}

async function calculateQuote() {
  if (!parsed.value) return
  busy.value = true
  try {
    const request = {
      country: quoteInput.country,
      actualWeightKg: quoteInput.actualWeightKg,
      dimensionsCm: { length: quoteInput.length, width: quoteInput.width, height: quoteInput.height },
      exchangeRateCnyPerUsd: exchangeRate.value,
    }
    quoteResult.value = isDesktop.value
      ? await window.electronAPI?.freight?.quote({ pack: parsed.value.pack, request }) as FreightQuoteResult
      : quoteFreight(parsed.value.pack, request)
  } catch (error) { showToast(message(error, '样例计算失败'), 'error') }
  finally { busy.value = false }
}

async function saveDraft() {
  if (!parsed.value?.pack.rules.length) return
  busy.value = true
  try {
    parsed.value.pack.version = draftVersion.value
    parsed.value.pack.name = draftName.value
    parsed.value.pack.exchangeRateCnyPerUsd = exchangeRate.value
    createdDraft.value = await createFreightRateDraft({ pack: parsed.value.pack, source_file_name: parsed.value.sourceFileName }) as Release
    await refreshReleases()
    showToast('费率草稿已保存', 'success')
  } catch (error) { showToast(message(error, '草稿保存失败'), 'error') }
  finally { busy.value = false }
}

async function publishDraft() {
  if (!createdDraft.value) return
  busy.value = true
  try {
    await publishFreightRatePack(createdDraft.value.pack_id, createdDraft.value.version)
    await refreshReleases()
    showToast('费率包已签名发布', 'success')
  } catch (error) { showToast(message(error, '发布失败，请检查签名密钥'), 'error') }
  finally { busy.value = false }
}

async function rollback(release: Release) {
  try {
    await ElMessageBox.confirm(`将 ${release.pack_id} 回退到 ${release.version}，并重新签名发布。`, '确认回退费率版本？', { confirmButtonText: '确认回退', cancelButtonText: '取消', type: 'warning' })
  } catch { return }
  busy.value = true
  try { await rollbackFreightRatePack(release.pack_id, release.version); await refreshReleases(); showToast('费率版本已回退', 'success') }
  catch (error) { showToast(message(error, '回退失败'), 'error') }
  finally { busy.value = false }
}

async function refreshReleases() {
  try { releases.value = (await getFreightRateReleases() as Release[]) || [] }
  catch (error) { showToast(message(error, '费率版本载入失败'), 'error') }
}

onMounted(refreshReleases)
</script>

<style scoped>
.rate-center{display:grid;gap:16px;padding-bottom:28px;color:var(--color-text)}.rate-hero{display:flex;align-items:flex-end;justify-content:space-between;gap:28px;padding:28px 30px;border:1px solid var(--color-border);border-radius:var(--radius-xl);background:linear-gradient(135deg,var(--color-surface) 58%,var(--color-surface-premium));box-shadow:var(--shadow-low)}.eyebrow,.panel header span{color:var(--color-premium);font-size:var(--type-micro);font-weight:800;letter-spacing:.14em}.rate-hero h1{margin:7px 0 8px;font-size:30px;letter-spacing:-.045em}.rate-hero p{max-width:680px;margin:0;color:var(--color-text-secondary);font-size:var(--type-control);line-height:1.7}.hero-status{min-width:260px;display:flex;align-items:center;gap:10px;padding:12px;border:1px solid var(--color-border);border-radius:12px;background:rgba(252,252,253,.8)}.hero-status>span{width:9px;height:9px;border-radius:50%;background:var(--color-warning);box-shadow:0 0 0 5px var(--color-warning-soft)}.hero-status>span.online{background:var(--color-success);box-shadow:0 0 0 5px var(--color-success-soft)}.hero-status div{display:grid;gap:3px}.hero-status strong{font-size:var(--type-control)}.hero-status small{color:var(--color-text-tertiary);font-size:var(--type-micro)}.stage-rail{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.stage-rail article{display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px solid var(--color-border);border-radius:12px;background:var(--color-surface)}.stage-rail article>span{font:700 var(--type-micro)/1 var(--font-mono);color:var(--color-text-tertiary)}.stage-rail article div{display:grid;gap:2px}.stage-rail strong{font-size:var(--type-meta)}.stage-rail small{color:var(--color-text-tertiary);font-size:var(--type-micro)}.stage-rail article.active{border-color:rgba(45,95,202,.35);background:var(--color-primary-soft)}.stage-rail article.done>span{color:var(--color-success)}.rate-layout{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:14px;align-items:start}.work-column{display:grid;gap:14px}.panel{border:1px solid var(--color-border);border-radius:var(--radius-lg);background:var(--color-surface);box-shadow:var(--shadow-low);overflow:hidden}.panel>header{min-height:68px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 20px;border-bottom:1px solid var(--color-border);background:var(--color-surface-soft)}.panel header>div{display:grid;gap:4px}.panel h2{margin:0;font-size:var(--type-card);letter-spacing:-.02em}.panel header>svg{color:var(--color-primary)}.metadata-grid,.quote-inputs{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:20px}.metadata-grid label,.quote-inputs label{display:grid;gap:7px;color:var(--color-text-secondary);font-size:var(--type-meta);font-weight:700}.metadata-grid input,.quote-inputs input,.mapping-row select{height:40px;padding:0 11px;border:1px solid var(--color-border);border-radius:9px;color:var(--color-text);background:var(--color-surface);font:inherit;font-size:var(--type-control);outline:0}.metadata-grid input:focus,.quote-inputs input:focus,.mapping-row select:focus{border-color:var(--color-primary);box-shadow:0 0 0 3px var(--color-focus-ring)}.upload-actions,.publish-actions{display:flex;gap:9px;padding:0 20px 20px}.upload-actions button,.publish-actions button,.quote-inputs button,.text-button,.release-item button{min-height:38px;display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:0 13px;border:1px solid var(--color-border);border-radius:9px;color:var(--color-text-secondary);background:var(--color-surface);font-size:var(--type-control);font-weight:700;cursor:pointer}.primary{color:#fff!important;border-color:var(--color-primary)!important;background:var(--color-primary)!important;box-shadow:0 7px 17px rgba(45,95,202,.16)}button:disabled{opacity:.45;cursor:not-allowed}.source-summary{display:flex;align-items:center;justify-content:space-between;gap:18px;margin:0 20px 20px;padding:13px;border-radius:11px;background:var(--color-primary-soft)}.source-summary>div:first-child{display:grid;gap:4px}.source-summary strong{font-size:var(--type-control)}.source-summary span,.source-summary small{font-size:var(--type-micro);color:var(--color-text-secondary)}.summary-metrics{display:flex;gap:18px}.summary-metrics span{display:grid;text-align:center}.summary-metrics b{color:var(--color-primary);font-size:20px}.mapping-list{display:grid}.mapping-row{display:grid;grid-template-columns:1fr 220px 90px;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid var(--color-border)}.mapping-row>div{display:grid;gap:3px}.mapping-row strong{font-size:var(--type-control)}.mapping-row small{color:var(--color-text-tertiary);font-size:var(--type-micro)}.confidence{padding:5px 7px;border-radius:7px;text-align:center;font-size:var(--type-micro);font-weight:800}.confidence.high{color:var(--color-success);background:var(--color-success-soft)}.confidence.low{color:var(--color-warning);background:var(--color-warning-soft)}.text-button{border:0;background:transparent}.warning-list{display:flex;gap:8px;margin:14px 20px;padding:11px;border-radius:9px;color:var(--color-warning);background:var(--color-warning-soft);font-size:var(--type-meta)}.quote-inputs{grid-template-columns:repeat(6,1fr);align-items:end}.quote-result{display:grid;grid-template-columns:210px 1fr;gap:14px;padding:0 20px 20px}.quote-winner{display:grid;align-content:start;gap:6px;padding:17px;border-radius:12px;color:#fff;background:linear-gradient(145deg,var(--color-ink),var(--color-ink-soft))}.quote-winner span,.quote-winner small{color:rgba(255,255,255,.6);font-size:var(--type-micro)}.quote-winner strong{font-size:17px}.quote-winner b{color:#d8c39d;font-size:20px}.candidate-table{border:1px solid var(--color-border);border-radius:11px;overflow:hidden}.candidate-head,.candidate-row{display:grid;grid-template-columns:1.6fr repeat(5,1fr);align-items:center;gap:8px;padding:9px 11px}.candidate-head{color:var(--color-text-tertiary);background:var(--color-surface-soft);font-size:var(--type-micro);font-weight:800}.candidate-row{border-top:1px solid var(--color-border);font-size:var(--type-meta)}.candidate-row>span:first-child{display:grid;gap:2px}.candidate-row small{color:var(--color-warning);font-size:10px}.candidate-row.disabled{opacity:.55}.publish-panel>p{margin:0;padding:18px 20px;color:var(--color-text-secondary);font-size:var(--type-control);line-height:1.65}.release-list{position:sticky;top:calc(var(--header-height) + 14px)}.empty-release{padding:28px;text-align:center;color:var(--color-text-tertiary);font-size:var(--type-meta)}.release-item{display:grid;gap:10px;padding:14px;border-bottom:1px solid var(--color-border)}.release-item>div{display:grid;gap:4px}.release-item strong{font-size:var(--type-control)}.release-item small{color:var(--color-text-tertiary);font-size:var(--type-micro)}.release-status{width:max-content;padding:4px 6px;border-radius:6px;color:var(--color-warning);background:var(--color-warning-soft);font-size:10px;font-weight:800;text-transform:uppercase}.release-status.published{color:var(--color-success);background:var(--color-success-soft)}.release-status.retired{color:var(--color-text-tertiary);background:var(--color-surface-soft)}.current-badge{display:flex;align-items:center;gap:5px;color:var(--color-success);font-size:var(--type-micro);font-weight:700}@media(max-width:1180px){.rate-layout{grid-template-columns:1fr}.release-list{position:static}.stage-rail{grid-template-columns:repeat(2,1fr)}}@media(max-width:900px){.rate-hero{display:grid}.hero-status{min-width:0}.metadata-grid,.quote-inputs{grid-template-columns:1fr 1fr}.quote-result{grid-template-columns:1fr}.mapping-row{grid-template-columns:1fr}.stage-rail{grid-template-columns:1fr}.candidate-head,.candidate-row{grid-template-columns:1.5fr repeat(2,1fr)}.candidate-head span:nth-child(n+4),.candidate-row span:nth-child(n+4){display:none}}@media(max-width:560px){.metadata-grid,.quote-inputs{grid-template-columns:1fr}.upload-actions,.publish-actions{align-items:stretch;flex-direction:column}.source-summary{align-items:flex-start;flex-direction:column}}
</style>
