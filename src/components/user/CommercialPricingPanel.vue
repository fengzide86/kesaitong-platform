<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { commercialServiceLabel, type CommercialPlan } from '@/features/user/commercialCatalog'

const props = defineProps<{ plans: CommercialPlan[]; currentPlanCode: string }>()
const emit = defineEmits<{ consult: [plan: CommercialPlan] }>()
type Scene = 'competition' | 'training'
const activeScene = ref<Scene>('competition')
const tabList = ref<HTMLElement | null>(null)
const freePlans = computed(() => props.plans.filter(plan => plan.business_line === 'trial'))
const competitionOrder = ['competition-basic', 'competition-full', 'competition-guided']
const competitionPlans = computed(() => props.plans.filter(plan => plan.business_line === 'competition').sort((a, b) => {
  const order = (plan: CommercialPlan) => {
    const index = competitionOrder.indexOf(plan.plan_code || '')
    return index < 0 ? competitionOrder.length : index
  }
  return order(a) - order(b)
}))
const trainingPlans = computed(() => props.plans.filter(plan => plan.business_line === 'training'))
const scenes = computed(() => [
  ...(competitionPlans.value.length ? [{ id: 'competition' as const, label: '比赛套餐' }] : []),
  ...(trainingPlans.value.length ? [{ id: 'training' as const, label: '课程实训' }] : []),
])
watch(scenes, available => {
  if (!available.some(scene => scene.id === activeScene.value) && available[0]) activeScene.value = available[0].id
}, { immediate: true })
const singleTools = computed(() => props.plans.filter(plan => plan.business_line === 'single_tool'))
const serviceOrder = ['materials-topic', 'materials-full', 'diagnosis', 'group-qa', 'appointment']
function servicePosition(plan: CommercialPlan): number {
  const position = serviceOrder.indexOf(plan.services[0]?.code || '')
  return position < 0 ? serviceOrder.length : position
}
const services = computed(() => props.plans.filter(plan => plan.business_line === 'service')
  .sort((left, right) => servicePosition(left) - servicePosition(right)))
const serviceGroups = computed(() => [
  { id: 'materials', title: '资料', plans: services.value.filter(plan => plan.services.some(service => service.code.startsWith('materials-'))) },
  { id: 'guidance', title: '诊断与答疑', plans: services.value.filter(plan => !plan.services.some(service => service.code.startsWith('materials-'))) },
].filter(group => group.plans.length))
const guidedPlan = computed(() => competitionPlans.value.find(plan => plan.plan_code === 'competition-guided'))
const guidedServices = computed(() => guidedPlan.value?.services.map(commercialServiceLabel).join('；') || '')

function price(plan: CommercialPlan): string {
  const value = Number(plan.price)
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}
function current(plan: CommercialPlan): boolean { return Boolean(props.currentPlanCode && props.currentPlanCode === plan.plan_code) }
function recommended(plan: CommercialPlan): boolean { return plan.plan_code === 'competition-full' }
function consultText(plan: CommercialPlan): string { return current(plan) ? '咨询原套餐续期' : `咨询${price(plan)}元${plan.name}` }
function serviceUnit(plan: CommercialPlan): string {
  const service = plan.services[0]
  if (!service || plan.services.length !== 1) return '约定服务'
  if (service.minutes_per_unit) return `${service.count * service.minutes_per_unit} 分钟`
  const unit = service.code === 'materials-full' ? '套' : service.code === 'materials-topic' ? '份' : '次'
  return `${service.count === 1 ? '' : service.count}${unit}`
}
function trialIncludesAll(plan: CommercialPlan): boolean {
  return ['company.register', 'product.create', 'template.create'].every(capability => plan.allowed_capabilities.includes(capability))
}
async function onTabKeydown(event: KeyboardEvent, id: Scene): Promise<void> {
  const available = scenes.value
  const index = available.findIndex(scene => scene.id === id)
  const target = event.key === 'ArrowRight' ? (index + 1) % available.length
    : event.key === 'ArrowLeft' ? (index + available.length - 1) % available.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1 : -1
  if (target < 0 || !available[target]) return
  event.preventDefault()
  activeScene.value = available[target].id
  await nextTick()
  tabList.value?.querySelector<HTMLButtonElement>(`#platform-pricing-tab-${activeScene.value}`)?.focus()
}
</script>

<template>
  <section class="commercial-pricing" aria-label="免费体验与工具套餐">
    <article v-for="plan in freePlans" :key="plan.id" class="pricing-free" :data-plan="plan.plan_code" aria-label="免费体验">
      <div class="pricing-free-intro">
        <p class="pricing-label">先体验，再选择</p>
        <h2>{{ plan.name }}</h2>
        <p class="pricing-price"><strong>{{ price(plan) }}</strong><span>元</span></p>
        <button type="button" class="pricing-button pricing-button-free" aria-haspopup="dialog" @click="emit('consult', plan)">申请免费体验</button>
      </div>
      <div class="pricing-free-details">
        <p class="pricing-free-promise">{{ trialIncludesAll(plan) ? '以下三项全部赠送，含对应计算。' : '体验内容以当前已启用权益为准。' }}</p>
        <ul class="pricing-features"><li v-for="benefit in plan.benefits" :key="benefit">{{ benefit }}</li></ul>
      </div>
      <p class="pricing-free-boundary">先咨询确认平台适配与约定项目，再开通免费授权；不需要支付体验订单。</p>
    </article>

    <div v-if="scenes.length" class="pricing-plans-heading">
      <h2>按使用场景，选择工具套餐。</h2>
      <div ref="tabList" class="pricing-tabs" role="tablist" aria-label="选择套餐使用场景">
        <button v-for="scene in scenes" :id="`platform-pricing-tab-${scene.id}`" :key="scene.id" type="button" role="tab"
                :aria-selected="activeScene === scene.id" :aria-controls="`platform-pricing-panel-${scene.id}`"
                :tabindex="activeScene === scene.id ? 0 : -1" @click="activeScene = scene.id" @keydown="onTabKeydown($event, scene.id)">{{ scene.label }}</button>
      </div>
    </div>

    <div v-if="competitionPlans.length" id="platform-pricing-panel-competition" :hidden="activeScene !== 'competition'" role="tabpanel" aria-labelledby="platform-pricing-tab-competition" class="pricing-panel">
      <p class="pricing-period">覆盖购买时约定的本次比赛全程。开通前确认项目、平台与结束日期。</p>
      <div class="pricing-cards" :class="{ 'pricing-cards--single': competitionPlans.length === 1, 'pricing-cards--two': competitionPlans.length === 2 }">
        <article v-for="plan in competitionPlans" :key="plan.id" class="pricing-card" :class="{ 'is-recommended': recommended(plan), 'is-current': current(plan) }" :data-plan="plan.plan_code">
          <p class="pricing-card-label"><span v-if="recommended(plan)" class="pricing-recommendation">推荐方案</span><span v-else>{{ plan.services.length ? '工具 + 指导' : '基础工具' }}</span></p>
          <span v-if="current(plan)" class="pricing-current">当前使用</span>
          <h3>{{ plan.name }}</h3>
          <p class="pricing-price"><strong>{{ price(plan) }}</strong><span>元 / 本次比赛</span></p>
          <p class="pricing-description">{{ plan.description }}</p>
          <button type="button" class="pricing-button" :class="{ 'pricing-button-primary': recommended(plan) }" aria-haspopup="dialog" @click="emit('consult', plan)">{{ consultText(plan) }}</button>
          <ul class="pricing-features"><li v-for="benefit in plan.benefits" :key="benefit">{{ benefit }}</li></ul>
          <p class="pricing-term">{{ plan.duration_label }}</p>
        </article>
      </div>
    </div>

    <div v-if="trainingPlans.length" id="platform-pricing-panel-training" :hidden="activeScene !== 'training'" role="tabpanel" aria-labelledby="platform-pricing-tab-training" class="pricing-panel">
      <p class="pricing-period">覆盖约定的本次实训全程；开通前确认课程与结束日期，不含比赛使用。</p>
      <article v-for="plan in trainingPlans" :key="plan.id" class="pricing-card pricing-course-card" :data-plan="plan.plan_code">
        <div>
          <p class="pricing-card-label">课程实训专用 <span v-if="current(plan)" class="pricing-current">当前使用</span></p>
          <h3>{{ plan.name }}</h3>
          <p class="pricing-price"><strong>{{ price(plan) }}</strong><span>元 / 本次实训</span></p>
          <p class="pricing-description">{{ plan.description }}</p>
          <button type="button" class="pricing-button" aria-haspopup="dialog" @click="emit('consult', plan)">{{ consultText(plan) }}</button>
        </div>
        <div class="pricing-course-details"><ul class="pricing-features"><li v-for="benefit in plan.benefits" :key="benefit">{{ benefit }}</li></ul><p class="pricing-term">{{ plan.duration_label }}</p></div>
      </article>
    </div>

    <div v-if="freePlans.length || scenes.length || singleTools.length" class="pricing-availability">
      <strong>选购前，一起确认适用范围</strong>
      <p>先确认适用平台、当前可开通功能与使用期。套餐包含不等于工具已经开放，未验收功能不会因选择套餐自动开通。</p>
    </div>

    <section v-if="singleTools.length" class="pricing-single-tools" aria-label="单独选择工具">
      <h2>只需要一个工具？也可单独选择。</h2>
      <article v-for="plan in singleTools" :key="plan.id" class="pricing-single-tool" :data-plan="plan.plan_code">
        <div><h3>{{ plan.name }}</h3><p>{{ plan.description }}</p></div>
        <p class="pricing-single-price"><strong>{{ price(plan) }}</strong><span>元 / 个工具</span></p>
        <button type="button" class="pricing-text-action" aria-haspopup="dialog" :aria-label="`咨询${plan.name}`" @click="emit('consult', plan)">咨询单个工具 <span aria-hidden="true">→</span></button>
      </article>
    </section>

    <section v-if="serviceGroups.length" class="pricing-support" aria-labelledby="platform-pricing-support-title">
      <header><h2 id="platform-pricing-support-title">资料与答疑，按需补充。</h2><p>只需要其中一项，也可以单独咨询。</p></header>
      <div class="pricing-service-groups">
        <section v-for="group in serviceGroups" :key="group.id" class="pricing-service-group" :aria-label="group.title">
          <h3>{{ group.title }}</h3>
          <ul class="pricing-service-list">
            <li v-for="plan in group.plans" :key="plan.id" :data-plan="plan.plan_code">
              <div class="pricing-service-heading"><h4>{{ plan.name }}</h4><p class="pricing-service-price"><strong>{{ price(plan) }}</strong><span>元 / {{ serviceUnit(plan) }}</span></p></div>
              <p class="pricing-description">{{ plan.description }}</p>
              <button type="button" class="pricing-text-action" aria-haspopup="dialog" :aria-label="`咨询${plan.name}`" @click="emit('consult', plan)">咨询此项 <span aria-hidden="true">→</span></button>
            </li>
          </ul>
        </section>
      </div>
      <p v-if="guidedPlan && guidedServices" class="pricing-included-note">{{ price(guidedPlan) }}元{{ guidedPlan.name }}已含：{{ guidedServices }}。已包含额度内无需重复购买；额外需求另行确认。</p>
    </section>
  </section>
</template>

<style scoped>
/* Public content follows the catalogue; visual tokens belong to the desktop platform. */
.commercial-pricing { color: var(--color-text); }
.pricing-free { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr); align-items: center; gap: 20px 32px; padding: 24px; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); box-shadow: var(--shadow-low); }
.pricing-free-intro, .pricing-free-details { min-width: 0; }
.pricing-label { margin: 0 0 8px; color: var(--color-primary-hover); font-size: var(--type-meta); font-weight: 600; }
.pricing-free h2, .pricing-card h3 { margin: 0; font-size: var(--type-section); line-height: 1.4; }
.pricing-price { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; margin: 14px 0; font-size: var(--type-control); line-height: 1.5; }
.pricing-price strong { color: var(--color-text); font-size: var(--type-stat-large); font-weight: 700; line-height: 1.15; font-variant-numeric: tabular-nums; }
.pricing-price span { color: var(--color-text-secondary); }
.pricing-free-promise { margin: 0; font-size: var(--type-control); font-weight: 600; line-height: 1.6; }
.pricing-free .pricing-free-boundary { grid-column: 1 / -1; margin: 0; padding-top: 16px; border-top: 1px solid var(--color-border); color: var(--color-text-secondary); font-size: var(--type-meta); line-height: 1.7; }
.pricing-features { display: grid; gap: 10px; margin: 18px 0 0; padding: 0; list-style: none; }
.pricing-features li { position: relative; padding-left: 16px; color: var(--color-text-secondary); font-size: var(--type-control); line-height: 1.7; overflow-wrap: anywhere; }
.pricing-features li::before { position: absolute; top: .7em; left: 0; width: 4px; height: 4px; border-radius: 50%; background: var(--color-primary); content: ''; }
.pricing-button { display: inline-flex; align-items: center; justify-content: center; min-height: 40px; padding: 8px 16px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); color: var(--color-primary-hover); background: var(--color-surface); font: inherit; font-size: var(--type-control); font-weight: 600; line-height: 1.5; cursor: pointer; }
.pricing-button:hover { border-color: var(--color-primary-muted); background: var(--color-primary-soft); }
.pricing-button-free { min-width: 156px; }
.pricing-button-primary { border-color: var(--color-primary); color: white; background: var(--color-primary); }
.pricing-button-primary:hover { border-color: var(--color-primary-hover); background: var(--color-primary-hover); }
.pricing-plans-heading { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 16px; margin: 28px 0 0; }
.pricing-plans-heading h2, .pricing-support h2 { margin: 0; font-size: var(--type-section); line-height: 1.4; }
.pricing-tabs { display: flex; gap: 4px; padding: 4px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface-soft); }
.pricing-tabs button { min-height: 36px; padding: 7px 14px; border: 1px solid transparent; border-radius: var(--radius-sm); color: var(--color-text-secondary); background: transparent; font: inherit; font-size: var(--type-control); font-weight: 600; cursor: pointer; }
.pricing-tabs button[aria-selected='true'] { border-color: var(--color-border); color: var(--color-primary-hover); background: var(--color-surface); box-shadow: var(--shadow-low); }
.pricing-panel[hidden] { display: none; }
.pricing-period { margin: 16px 0; color: var(--color-text-secondary); font-size: var(--type-meta); line-height: 1.7; }
.pricing-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: stretch; gap: 16px; }
.pricing-cards--single { grid-template-columns: minmax(0, 1fr); max-width: 520px; }
.pricing-cards--two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.pricing-card { display: flex; flex-direction: column; min-width: 0; padding: 20px; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); box-shadow: var(--shadow-low); }
.pricing-card.is-recommended { border-color: var(--color-primary-muted); }
.pricing-card-label { display: flex; align-items: center; gap: 10px; min-height: 28px; margin: 0 0 14px; color: var(--color-text-secondary); font-size: var(--type-meta); font-weight: 600; }
.pricing-recommendation { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: var(--radius-sm); color: var(--color-premium); background: var(--color-premium-soft); font-weight: 700; }
.is-recommended .pricing-price strong { color: var(--color-primary-hover); }
.pricing-current { align-self: flex-start; margin-bottom: 8px; color: var(--color-primary-hover); font-size: var(--type-meta); font-weight: 600; }
.pricing-description { margin: 0; color: var(--color-text-secondary); font-size: var(--type-control); line-height: 1.7; }
.pricing-card > .pricing-description { min-height: 72px; }
.pricing-card > .pricing-button { width: 100%; margin-top: 16px; }
.pricing-term { margin: auto 0 0; padding-top: 20px; color: var(--color-text-secondary); font-size: var(--type-meta); line-height: 1.6; }
.pricing-course-card { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; }
.pricing-course-card .pricing-button { margin-top: 16px; }
.pricing-course-details .pricing-features { margin-top: 0; }
.pricing-availability { margin-top: 20px; padding: 14px 16px; border-radius: var(--radius-md); background: var(--color-surface-soft); font-size: var(--type-control); line-height: 1.7; }
.pricing-availability p { margin: 6px 0 0; color: var(--color-text-secondary); }
.pricing-single-tools { margin-top: 28px; }
.pricing-single-tools h2 { margin: 0 0 12px; font-size: var(--type-section); line-height: 1.5; }
.pricing-single-tool { display: flex; flex-wrap: wrap; align-items: center; gap: 14px 24px; padding: 16px 0; border-top: 1px solid var(--color-border); }
.pricing-single-tool > div { flex: 1 1 320px; min-width: 0; }
.pricing-single-tool h3 { margin: 0; font-size: 16px; line-height: 1.5; }
.pricing-single-tool > div > p { margin: 8px 0 0; color: var(--color-text-secondary); font-size: var(--type-control); line-height: 1.7; }
.pricing-single-price, .pricing-service-price { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; margin: 0; color: var(--color-text-secondary); font-size: var(--type-control); }
.pricing-single-price strong, .pricing-service-price strong { color: var(--color-text); font-size: 22px; font-variant-numeric: tabular-nums; }
.pricing-text-action { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; padding: 8px 0; border: 0; background: transparent; color: var(--color-primary-hover); font: inherit; font-size: var(--type-control); cursor: pointer; text-underline-offset: 4px; }
.pricing-text-action:hover { text-decoration: underline; }
.pricing-support { margin-top: 28px; }
.pricing-support header p { margin: 8px 0 0; color: var(--color-text-secondary); font-size: var(--type-control); }
.pricing-service-groups { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 16px; margin-top: 20px; }
.pricing-service-group { min-width: 0; padding: 20px; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); }
.pricing-service-group h3 { margin: 0 0 16px; font-size: var(--type-section); }
.pricing-service-list { margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--color-border); }
.pricing-service-list li { padding: 16px 0 12px; border-bottom: 1px solid var(--color-border); }
.pricing-service-list li:last-child { padding-bottom: 0; border-bottom: 0; }
.pricing-service-heading { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px 16px; margin-bottom: 10px; }
.pricing-service-heading h4 { margin: 0; font-size: 16px; font-weight: 600; }
.pricing-included-note { margin: 20px 0 0; padding: 14px 16px; border-radius: var(--radius-md); background: var(--color-surface-soft); color: var(--color-text-secondary); font-size: var(--type-control); line-height: 1.8; }
.commercial-pricing button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 3px; }
@media (max-width: 800px) { .pricing-cards { grid-template-columns: 1fr; } .pricing-cards--single { max-width: none; } .pricing-free, .pricing-course-card, .pricing-service-groups { grid-template-columns: 1fr; } .pricing-card > .pricing-description { min-height: 0; } }
</style>
