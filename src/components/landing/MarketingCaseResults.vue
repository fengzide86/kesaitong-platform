<script setup lang="ts">
import { computed, getCurrentInstance, onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowRight, Expand, FileCheck2, Trophy } from '@lucide/vue'
import { reportedOutcomeCases, type CaseOutcome } from '@/marketing/impact-data'
import { competitionAwardEvidence, teamQualificationEvidence, type CertificateEvidence } from '@/marketing/award-evidence'
import MarketingCertificateViewer from './MarketingCertificateViewer.vue'

const props = defineProps<{ kind?: 'course' | 'competition' }>()
const cases = computed(() => reportedOutcomeCases.filter(item => !props.kind || item.id === props.kind))
const headingId = `case-results-${getCurrentInstance()?.uid ?? 0}`
const results = ref<HTMLElement | null>(null)
const awardEntered = ref(false)
const viewedCertificate = ref<CertificateEvidence | null>(null)
const loadedCertificates = ref(new Set<string>())
let awardObserver: IntersectionObserver | undefined

function markCertificateLoaded(id: string): void {
  loadedCertificates.value = new Set(loadedCertificates.value).add(id)
}

function scoreChange(item: CaseOutcome): number | null {
  return typeof item.after.value === 'number' ? item.after.value - item.before.value : null
}

function scoreWidth(item: CaseOutcome, value: number): string {
  const max = Math.max(item.before.value, typeof item.after.value === 'number' ? item.after.value : 0, 1)
  return `${value / max * 100}%`
}

onMounted(() => {
  const card = results.value?.querySelector('.case-competition')
  if (!card || typeof IntersectionObserver !== 'function') return
  if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  awardObserver = new IntersectionObserver(entries => {
    if (awardEntered.value || !entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.3)) return
    awardEntered.value = true
    awardObserver?.unobserve(card)
  }, { threshold: 0.3 })
  awardObserver.observe(card)
})
onBeforeUnmount(() => awardObserver?.disconnect())
</script>

<template>
  <section ref="results" class="case-results" data-testid="marketing-case-results" :aria-labelledby="headingId">
    <header class="case-heading">
      <p class="case-eyebrow">使用者的经历</p>
      <h2 :id="headingId">{{ kind === 'course' ? '实训成绩：从21分到90分。' : kind === 'competition' ? '一段走到全国总决赛的经历。' : '实训与比赛，看看这些变化。' }}</h2>
    </header>

    <div class="case-grid" :class="{ 'single-case': cases.length === 1 }">
      <article v-for="item in cases" :key="item.id" class="case-card" :class="[`case-${item.id}`, { 'award-detail': item.id === 'competition' && kind === 'competition', 'award-entered': item.id === 'competition' && awardEntered }]" :data-case-id="item.id">
        <template v-if="item.id === 'competition'">
          <div class="award-copy">
            <div class="award-eyebrow"><Trophy :size="18" aria-hidden="true" /><span>2025 年 · 往届案例 · 第六届全国数字贸易技能大赛</span></div>
            <h3 class="case-award"><span>跨境电商赛 · 全国总决赛</span><strong>一等奖</strong></h3>
            <div class="case-before award-baseline"><span>从及格起步</span><strong>{{ item.before.value }}<span>{{ item.before.unit }}</span></strong><span>使用者提供的起点成绩</span></div>
            <p class="award-story">课赛通聚焦商品发布、物流模板与发货等重复环节，把更多时间留给规则理解与运营判断。</p>
            <span class="award-source">用户提供案例 · 证书已隐去个人信息</span>
            <div v-if="kind === 'competition'" class="qualification-achievement">
              <p>获得全国一等奖，同时取得跨境电子商务师（中级）职业能力证书。</p>
              <button type="button" class="qualification-link" data-testid="qualification-open-certificate" @click="viewedCertificate = teamQualificationEvidence"><FileCheck2 :size="17" aria-hidden="true" />查看中级证书<ArrowRight :size="16" aria-hidden="true" /></button>
            </div>
          </div>
          <button type="button" class="award-document" data-testid="award-open-certificate" :aria-label="`放大查看${competitionAwardEvidence.title}`" @click="viewedCertificate = competitionAwardEvidence">
            <span class="award-thumbnail" :class="{ 'is-loaded': loadedCertificates.has(competitionAwardEvidence.id) }" aria-hidden="true">
              <span class="award-thumbnail-placeholder">证书预览</span>
              <img :src="competitionAwardEvidence.thumbnail!.src" :width="competitionAwardEvidence.thumbnail!.width" :height="competitionAwardEvidence.thumbnail!.height" :alt="competitionAwardEvidence.alt" loading="lazy" decoding="async" @load="markCertificateLoaded(competitionAwardEvidence.id)" />
            </span>
            <span><Expand :size="17" aria-hidden="true" />查看获奖证书</span>
          </button>
        </template>
        <template v-else>
        <div class="case-card-heading">
          <h3>{{ item.title }}</h3>
          <span class="case-source-label">用户提供案例</span>
        </div>
        <div class="case-value-row">
          <div class="case-before">
            <p>{{ item.before.label }}</p>
            <strong>{{ item.before.value }}<span>{{ item.before.unit }}</span></strong>
          </div>
          <ArrowRight class="case-arrow" :size="26" aria-hidden="true" />
          <div class="case-after">
            <p>{{ item.after.label }}</p>
            <strong v-if="typeof item.after.value === 'number'">{{ item.after.value }}<span>{{ item.after.unit }}</span></strong>
          </div>
        </div>

        <template v-if="typeof item.after.value === 'number'">
          <div class="case-score-bars" aria-hidden="true">
            <div><span>使用前</span><i><em :style="{ width: scoreWidth(item, item.before.value) }" /></i></div>
            <div><span>使用后</span><i><em :style="{ width: scoreWidth(item, item.after.value) }" /></i></div>
          </div>
          <p class="case-difference">本案例成绩变化 <strong>{{ scoreChange(item)! > 0 ? '+' : '' }}{{ scoreChange(item) }}<span>分</span></strong></p>
        </template>
        </template>
      </article>
    </div>
    <p class="case-note">来源：用户提供的使用前后案例。成绩变化与比赛结果受练习、策略及评分规则影响。</p>
    <MarketingCertificateViewer :evidence="viewedCertificate" @close="viewedCertificate = null" />
  </section>
</template>

<style scoped>
.case-results { --award-navy: #142b47; --award-gold: #f3d397; --award-muted: #bfd0e5; padding-block: var(--m-section); color: var(--m-ink); }
.case-eyebrow { margin: 0; color: var(--m-blue); font-size: 14px; font-weight: 700; }
.case-heading h2 { margin: 14px 0 0; font-size: var(--m-h2); line-height: 1.4; text-wrap: balance; }
.case-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; margin-top: 32px; }
.case-grid.single-case { grid-template-columns: 1fr; }
.case-card { display: flex; flex-direction: column; min-width: 0; padding: 32px; border-radius: var(--m-radius); background: var(--m-surface); }
.case-card-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.case-card-heading h3 { margin: 0; font-size: 18px; line-height: 1.5; }
.case-source-label { color: var(--m-muted); font-size: 13px; line-height: 1.6; }
.case-value-row { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1.15fr); align-items: end; gap: 14px; margin-top: 34px; }
.case-value-row p { margin: 0 0 12px; color: var(--m-text); font-size: 15px; line-height: 1.6; }
.case-value-row strong { display: flex; align-items: baseline; gap: 6px; color: var(--m-ink); font-size: clamp(56px, 5.6vw, 76px); line-height: 1.05; font-weight: 750; font-variant-numeric: tabular-nums; }
.case-value-row strong span { font-size: 18px; font-weight: 600; }
.case-before strong { color: var(--m-muted); }
.case-after strong { color: var(--m-blue); }
.case-arrow { margin-bottom: 20px; color: var(--m-muted); }
.case-score-bars { display: grid; gap: 11px; margin-top: 28px; }
.case-score-bars > div { display: grid; grid-template-columns: 52px minmax(0, 1fr); align-items: center; gap: 12px; color: var(--m-text); font-size: 13px; }
.case-score-bars i { display: block; height: 10px; border-radius: 99px; background: #e2e7ef; overflow: hidden; }
.case-score-bars em { display: block; height: 100%; border-radius: 99px; background: var(--m-data-before, #66758a); }
.case-score-bars > div:last-child em { background: var(--m-blue); }
.case-difference { display: flex; align-items: baseline; gap: 14px; margin: 26px 0 0; color: var(--m-text); font-size: 14px; }
.case-difference strong { color: var(--m-orange); font-size: 44px; font-weight: 750; line-height: 1.2; }
.case-difference strong span { margin-left: 6px; font-size: 17px; }
.case-competition { display: grid; grid-template-columns: minmax(0, 1fr) 120px; align-items: center; gap: 24px; color: #fff; background: var(--award-navy); }
.award-copy { min-width: 0; }
.award-eyebrow { display: flex; align-items: flex-start; gap: 9px; color: var(--award-muted); font-size: 13px; line-height: 1.7; }
.award-eyebrow svg { flex: 0 0 auto; margin-top: 2px; color: var(--award-gold); }
.case-award { margin: 24px 0 0; font-weight: 650; }
.case-award > span { display: block; color: var(--award-gold); font-size: 17px; line-height: 1.5; }
.case-award strong { display: block; margin-top: 3px; color: var(--award-gold); font-size: 52px; font-weight: 750; white-space: nowrap; line-height: 1.18; letter-spacing: .02em; }
.award-baseline { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 10px; margin-top: 22px; color: var(--award-muted); font-size: 14px; line-height: 1.5; }
.award-baseline strong { color: var(--award-muted); font-size: 25px; font-weight: 600; font-variant-numeric: tabular-nums; }
.award-baseline strong span { margin-left: 3px; font-size: 14px; }
.award-baseline > span:last-child { flex-basis: 100%; font-size: 13px; }
.award-story { margin: 16px 0 0; color: #e0e8f2; font-size: 14px; line-height: 1.85; }
.award-source { display: block; margin-top: 18px; color: var(--award-muted); font-size: 13px; line-height: 1.7; }
.award-document { display: flex; flex-direction: column; align-items: stretch; min-width: 0; min-height: 44px; padding: 0; border: 0; color: var(--award-gold); background: transparent; cursor: pointer; font: inherit; text-align: center; transition: transform 180ms ease; }
.award-thumbnail { position: relative; display: block; min-height: 120px; border-radius: 4px; background: linear-gradient(135deg, #ffffff14, #ffffff08); overflow: hidden; }
.award-thumbnail-placeholder { position: absolute; inset: 0; display: grid; place-items: center; color: var(--award-muted); font-size: 12px; letter-spacing: .04em; transition: opacity 180ms ease; }
.award-thumbnail img { position: relative; z-index: 1; display: block; width: 100%; height: auto; max-height: 200px; object-fit: contain; border-radius: 4px; opacity: 0; transition: opacity 180ms ease; }
.award-thumbnail.is-loaded img { opacity: 1; }
.award-thumbnail.is-loaded .award-thumbnail-placeholder { opacity: 0; }
.award-document > span { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; margin-top: 8px; color: var(--award-gold); font-size: 13px; line-height: 1.6; }
.award-document > span svg { flex: 0 0 auto; }
.award-document:focus-visible, .qualification-link:focus-visible { outline: 3px solid var(--award-gold); outline-offset: 6px; }
.qualification-achievement { max-width: 440px; margin-top: 20px; padding-top: 16px; border-top: 1px solid #ffffff26; }
.qualification-achievement p { margin: 0; color: var(--award-muted); font-size: 14px; line-height: 1.8; }
.qualification-link { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; margin: 4px 0 0; padding: 6px 0; border: 0; color: var(--award-muted); background: transparent; font: inherit; font-size: 14px; line-height: 1.6; cursor: pointer; text-align: left; }
.qualification-link svg { flex: 0 0 auto; }
.award-detail { grid-template-columns: minmax(0, 1fr) minmax(260px, .85fr); gap: 52px; padding: 40px 44px; }
.award-detail .award-eyebrow { font-size: 15px; }
.award-detail .case-award { margin-top: 26px; }
.award-detail .case-award > span { font-size: 20px; }
.award-detail .case-award strong { font-size: 76px; }
.award-detail .award-baseline { margin-top: 26px; }
.award-detail .award-story { max-width: 440px; font-size: 16px; }
.award-detail .award-document { padding: 16px 16px 4px; border: 1px solid #ffffff24; border-radius: 10px; background: #ffffff08; }
.award-detail .award-thumbnail { min-height: 260px; }
.award-detail .award-document img { max-height: 360px; }
.award-detail .award-document > span { font-size: 14px; }
.case-competition.award-entered { animation: award-arrive 500ms cubic-bezier(.2, .7, .2, 1) both; }
.case-note { margin: 20px 0 0; color: var(--m-muted); font-size: 14px; line-height: 1.8; }
.single-case .case-value-row { max-width: 700px; }
.single-case .case-value-row strong { font-size: 88px; }
.single-case .case-score-bars { max-width: 720px; }
@keyframes award-arrive { from { opacity: .7; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@media (hover: hover) { .award-document:hover { transform: translateY(-2px); }.qualification-link:hover { color: var(--award-gold); } }
@media (max-width: 1100px) { .case-competition:not(.award-detail) { grid-template-columns: minmax(0, 1fr); gap: 20px; }.case-competition:not(.award-detail) .award-document { flex-direction: row; align-items: center; gap: 16px; }.case-competition:not(.award-detail) .award-thumbnail { min-width: 68px; }.case-competition:not(.award-detail) .award-document img { width: 68px; max-height: 94px; }.case-competition:not(.award-detail) .award-document > span { margin: 0; }.award-detail { gap: 32px; padding: 34px; } }
@media (max-width: 900px) { .case-card { padding: 26px 24px; }.case-card-heading { flex-wrap: wrap; gap: 8px; }.case-value-row { gap: 10px; }.case-value-row strong { font-size: 58px; }.award-detail { grid-template-columns: minmax(0, 1fr) minmax(220px, .8fr); gap: 24px; }.award-detail .case-award strong { font-size: 64px; } }
@media (max-width: 700px) { .case-grid { grid-template-columns: 1fr; gap: 16px; }.case-card-heading { flex-wrap: nowrap; }.case-value-row { margin-top: 28px; }.case-competition:not(.award-detail) { grid-template-columns: minmax(0, 1fr) 100px; gap: 20px; }.case-competition:not(.award-detail) .award-document { flex-direction: column; gap: 0; }.case-competition:not(.award-detail) .award-thumbnail { min-height: 120px; }.case-competition:not(.award-detail) .award-document img { width: 100%; max-height: 170px; }.case-competition:not(.award-detail) .award-document > span { margin-top: 8px; }.award-detail { grid-template-columns: minmax(0, 1fr); }.award-detail .award-document { width: min(100%, 350px); justify-self: center; }.award-detail .award-thumbnail { min-height: 230px; }.award-detail .award-document img { max-height: 320px; } }
@media (max-width: 480px) { .case-grid { margin-top: 26px; }.case-card { padding: 26px 22px; }.case-value-row strong, .single-case .case-value-row strong { font-size: 58px; }.case-value-row strong span { font-size: 16px; }.case-source-label { font-size: 13px; }.case-value-row p { font-size: 14px; }.case-arrow { width: 22px; margin-bottom: 14px; }.case-difference { gap: 12px; }.case-difference strong { font-size: 42px; }.case-competition:not(.award-detail) { grid-template-columns: minmax(0, 1fr); gap: 20px; }.case-competition:not(.award-detail) .award-document { flex-direction: row; gap: 16px; }.case-competition:not(.award-detail) .award-document img { width: 64px; max-height: 88px; }.case-competition:not(.award-detail) .award-document > span { margin: 0; }.case-award strong { font-size: 52px; }.award-detail .case-award strong { font-size: 64px; }.award-detail .award-story { font-size: 15px; }.award-detail .award-eyebrow { font-size: 14px; }.qualification-link { flex-wrap: wrap; gap: 6px; font-size: 13px; } }
@media (prefers-reduced-motion: reduce) { .case-competition.award-entered { animation: none; }.award-document, .award-thumbnail img, .award-thumbnail-placeholder { transition: none; }.award-document:hover { transform: none; } }
</style>
