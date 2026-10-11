<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowDown, ArrowRight, BookOpen, Box, Building2, Calculator, Megaphone, Package, Search, Truck, Trophy, Warehouse } from '@lucide/vue'
import { RouterLink } from 'vue-router'
import { marketingTasks, statusLabels } from '@/marketing/task-catalog'
import ScenarioIdentity from './ScenarioIdentity.vue'

export type ScenarioKind = 'competition' | 'course'
type Topic = { id: string; label: string; hint: string; icon: typeof Package; heading: string; description: string; beforeTitle: string; before: string[]; afterTitle: string; after: string[]; tool: string; human: string }
const props = defineProps<{ kind: ScenarioKind }>()
// Always start at the first task when entering or changing scenarios.
const selectedIndex = ref(0)
watch(() => props.kind, () => { selectedIndex.value = 0 })

const topics: Record<ScenarioKind, Topic[]> = {
  competition: [
    { id: 'company', label: '注册公司', hint: '资料散、入口多，开局就耗时', icon: Building2, heading: '比赛才刚开始，登记资料就占掉一段时间。', description: '赛训平台里的公司登记要在不同页面完成。填完一项又找下一项，留给选品和运营的时间越来越少。', beforeTitle: '对着多个页面确认开局', before: ['注册公司|资料分散在不同位置|回头补信息', '企业信息|逐项核对填写|不确定是否完整', '下一步|返回查看遗漏项|开局被打断'], afterTitle: '先把开局事项列清楚', after: ['当前任务|注册公司|明确正在处理什么', '需要资料|名称 · 类型 · 联系信息|集中准备', '继续操作|辅助重复填写|减少页面切换'], tool: '开局辅助工具', human: '登记什么公司、使用哪些信息，由你决定；这里只辅助仿真登记，不办理工商注册。' },
    { id: 'selection', label: '选品', hint: '价格、利润、重量要一起看', icon: Search, heading: '商品很多，难的是判断哪一个值得投入时间。', description: '售价、成本、重量和运费要放在一起考虑。逐件查、逐件算，很容易把时间耗在收集数字上。', beforeTitle: '反复切表格和商品页', before: ['候选商品|价格与重量|切换页面记录', '利润估算|平台费用与运费|重新计算', '最后比较|几件商品来回对照|判断被打断'], afterTitle: '把比较维度放在一起', after: ['候选资料|价格 · 重量 · 成本|集中整理', '比较结果|利润与运输影响|快速查看差异', '做出选择|对照费用差异|减少手动重算'], tool: '选品比较工具', human: '选什么商品、是否值得做，仍由你判断。' },
    { id: 'products', label: '发布商品', hint: '标题、属性、变体重复填写', icon: Package, heading: '发布一个商品，不该把时间都花在复制和填写上。', description: '什么内容值得完善，需要判断；但标题、图片、属性和变体还要逐页填写，重复录入占掉了研究商品的时间。', beforeTitle: '在商品页之间来回补资料', before: ['商品标题|重新复制粘贴|内容逐项填写', '变体属性|颜色 · 尺码|分别打开编辑', '商品价格|检查后再修改|反复回到列表'], afterTitle: '先整理商品，再辅助重复填写', after: ['商品资料|标题 · 图片 · 属性|集中准备', '商品变体|颜色 · 尺码|集中整理', '页面操作|减少重复录入|减少来回切页面'], tool: '商品发布工具', human: '标题怎么写、图片怎么选、哪些内容值得完善，由你判断；工具不承诺覆盖全部得分细节。' },
    { id: 'rates', label: '物流模板', hint: '国家、服务、重量单位容易混', icon: Truck, heading: '配送规则想好了，填进模板还是一轮细活。', description: '国家、服务、重量单位和首重续重需要一起考虑。方案一换就要重新配置，做得多不一定意味着方案更合适。', beforeTitle: '对着规则表一格一格填', before: ['国家与服务|来回查找|适用范围不清', '重量单位|克 / 千克切换|容易填错', '计费规则|首重 · 续重|反复回表核对'], afterTitle: '先整理配送规则，再辅助配置', after: ['服务范围|国家 · 服务|放在同一份资料', '计费单位|重量与价格|放在一起准备', '模板配置|重复动作交给工具|减少重复配置'], tool: '物流模板工具', human: '物流方案是否合理、费用如何设置，需要你判断。' },
    { id: 'ads', label: '广告营销', hint: '广告、秒杀、优惠券反复配置', icon: Megaphone, heading: '广告和活动不是开得越多，就越有价值。', description: '选什么商品、安排多少预算，需要取舍；广告、秒杀和优惠券各自的重复配置，又会挤占判断策略的时间。', beforeTitle: '不断切换营销页面', before: ['投放商品|回商品列表查找|确认后再返回', '预算日期|广告页逐项填写|来回检查', '活动设置|另开页面配置|重复同一信息'], afterTitle: '按营销任务拆开配置', after: ['选择活动|广告 · 秒杀 · 优惠券|明确本次目标', '准备信息|商品 · 预算 · 日期|集中整理', '页面操作|辅助重复配置|减少重复填写'], tool: '广告营销工具', human: '预算、投放对象和活动策略由你决定。' },
    { id: 'fba', label: 'FBA 配送', hint: '商品、库存、货件容易断开', icon: Warehouse, heading: 'FBA 要不要做，怎么安排，比点完页面更重要。', description: '商品变体、配送方式、库存和货件分散在多个页面。既要考虑配送安排，也要花时间把信息一项项接起来。', beforeTitle: '在库存和货件页面来回找', before: ['商品变体|确认可配送商品|回商品页核对', '库存与货件|分别查看|信息难对上', '配送方式|继续补填|遗漏后重新开始'], afterTitle: '按 FBA 任务整理信息', after: ['配送商品|确认对应变体|先整理清楚', '库存货件|把相关信息放一起|减少来回查找', '继续处理|辅助重复动作|减少页面切换'], tool: 'FBA 配送工具', human: '是否转 FBA、库存安排和货件确认由你负责。' },
    { id: 'shipping', label: '订单发货', hint: '分拣、打包、运单要走多步', icon: Box, heading: '订单一多，相同的发货步骤就不断重来。', description: '分拣、打包、承运人和运单信息要经过多个步骤。处理下一笔订单时，同样的页面又要重新走一遍。', beforeTitle: '每笔订单都重新走一遍', before: ['订单 A|找订单 → 分拣|切换页面', '订单 A|打包 → 填运单|继续切换', '订单 B|返回列表重新开始|重复相同步骤'], afterTitle: '围绕发货任务辅助重复步骤', after: ['待发订单|先确认处理范围|避免选错订单', '分拣打包|按步骤辅助处理|减少重复点击', '承运运单|补充运输资料|减少信息重复录入'], tool: '订单发货工具', human: '发什么、怎么发和特殊订单处理仍需你确认。' },
    { id: 'pricing', label: '定价与运费比较', hint: '费用、运费、利润反复计算', icon: Calculator, heading: '改一个价格，就要把利润和运费重新算一遍。', description: '售价、平台费用和运输成本一起影响利润。比较多种方案时，重复算数会打断选择和判断。', beforeTitle: '一边查费率一边重算', before: ['商品售价|输入不同价格|计算利润变化', '运输方式|比较多种运费|切换表格记录', '最终方案|回商品页修改|再重新核算'], afterTitle: '把费用比较集中起来', after: ['输入条件|售价 · 重量 · 目的地|一次准备', '方案比较|运费与利润|看清差异', '最后决定|对照费用差异|减少手动重算'], tool: '定价与运费工具', human: '定价和发货方式选择由你决定，工具只做计算辅助。' },
  ],
  course: [
    { id: 'company', label: '注册公司', hint: '资料散，作业开局就卡住', icon: Building2, heading: '第一次登记公司，找页面和准备资料就忙了一阵。', description: '这是仿真平台里的公司登记练习。登记入口、公司类型和联系信息分散，查漏补缺会占用后续练习时间。', beforeTitle: '边看作业边找资料', before: ['作业要求|注册信息分散|来回翻找', '填写页面|不确定填到哪|停下来问老师', '重新检查|遗漏一项再返工|练习被打断'], afterTitle: '把本次作业资料先理好', after: ['本次任务|注册公司|明确练习目标', '资料清单|名称 · 类型 · 联系信息|集中准备', '操作练习|辅助重复填写|减少页面切换'], tool: '开局辅助工具', human: '作业规则和公司信息要自己理解、自己确认。' },
    { id: 'selection', label: '选品', hint: '价格接近，成本和运费却未必一样', icon: Search, heading: '选品练习的难处，是弄清为什么选这一件。', description: '不能只比较售价，还要考虑重量、采购成本和运输费用。换一个商品，数字又要整理和计算一遍。', beforeTitle: '拿着几张表反复对照', before: ['商品资料|价格与重量|手动整理', '成本计算|费用与运费|反复重算', '练习结论|不知道怎么比较|等待讲解'], afterTitle: '少花时间算数，多看清商品差别', after: ['整理数据|商品价格 · 重量|按练习准备', '比较方案|运费与利润|看清计算过程', '形成结论|对照运费与利润|查看不同方案'], tool: '选品比较工具', human: '商品为什么值得选、比较理由是否合理，需要结合本次作业作判断。' },
    { id: 'products', label: '发布商品', hint: '标题、属性和价格，又要再填一次', icon: Package, heading: '换一个练习商品，不想再把相同的步骤做一遍。', description: '标题怎么写、图片怎么选，才值得多花心思。每次重新找位置、填属性和建变体，却占掉了不少练习时间。', beforeTitle: '每次作业都从空白页面开始', before: ['商品标题|根据作业改写|反复填写', '变体属性|颜色 · 尺码|逐项查位置', '提交前检查|回头找漏项|再修改一次'], afterTitle: '想好商品内容，再辅助填写', after: ['选择发布工具|进入本次商品任务|找到对应工具', '准备资料|标题 · 图片 · 属性|按作业调整', '辅助录入|标题、属性和价格|减少重复填写'], tool: '商品发布工具', human: '商品内容是否符合这次作业、哪些表达值得调整，由你判断。' },
    { id: 'settings', label: '物流模板', hint: '规则看懂了，配置还是会返工', icon: Truck, heading: '计费规则看明白了，模板配置还是容易返工。', description: '换一组国家或运输服务，重量单位、首重续重和价格就要重新填写。机械配置挤占了比较方案的时间。', beforeTitle: '边读讲义边找配置位置', before: ['练习要求|国家与运输服务|先从讲义查找', '配置页面|重量、单位、价格|来回对照', '发现不一致|返回逐项修改|重新核对'], afterTitle: '先理解规则，再减少机械配置', after: ['选择物流工具|进入本次模板任务|找到对应工具', '准备资料|服务 · 地区 · 重量 · 价格|按练习整理', '辅助配置|减少重复动作|减少重复填写'], tool: '物流模板工具', human: '怎样计费、为什么选择这项服务，需要结合题目判断，不只看模板是否保存。' },
    { id: 'ads', label: '广告营销', hint: '预算和活动设置反复练', icon: Megaphone, heading: '营销练习，不该只是重复填写预算和日期。', description: '投给谁、预算怎么分配、活动有什么用，需要尝试和比较。每次从入口找起，又把时间花回了相同的操作上。', beforeTitle: '换一种活动，又找一遍页面', before: ['活动类型|广告 / 秒杀 / 优惠券|先找入口', '投放商品|回商品页确认|再返回设置', '预算日期|逐项填写|修改后重复检查'], afterTitle: '想好这次怎么投，再辅助配置', after: ['明确目标|这次练习哪种活动|先理解用途', '准备信息|商品 · 预算 · 日期|按作业填写', '辅助配置|处理重复录入|减少重复填写'], tool: '广告营销工具', human: '活动为什么这样设置、预算是否合适，需要结合课程任务判断。' },
    { id: 'fba', label: 'FBA 配送', hint: '变体、库存、货件容易对不上', icon: Warehouse, heading: 'FBA 步骤走了一遍，还得弄清它们怎么联系。', description: '商品、配送方式、库存和货件要一起看。反复翻页找资料时，很容易只顾着下一步，没时间比较不同安排。', beforeTitle: '边看讲解边拼步骤', before: ['商品变体|确认练习对象|回商品页查找', '库存货件|多个页面核对|关系难理解', '配送设置|填完又回头看|重新检查'], afterTitle: '把配送资料集中，再辅助操作', after: ['确认对象|这次练习哪个变体|明确范围', '准备资料|商品、库存和货件|放在一起核对', '辅助填写|减少重复动作|减少页面切换'], tool: 'FBA 配送工具', human: '库存和货件怎么安排、配送方案是否合适，需要结合题目判断。' },
    { id: 'shipping', label: '订单发货', hint: '分拣打包反复做，容易漏步骤', icon: Box, heading: '相似订单一直练，发货流程又得重走一遍。', description: '分拣、打包、承运方式和运单信息分散在不同步骤。每笔订单重新点一遍，很难腾出时间比较怎么发更合适。', beforeTitle: '照着页面一步步摸索', before: ['订单列表|找到练习订单|反复筛选', '分拣打包|切换处理页面|逐项确认', '运单信息|再回头检查|担心漏填'], afterTitle: '确认发货安排，再辅助重复步骤', after: ['明确练习|本次处理哪笔订单|先看作业要求', '重复动作|辅助分拣与填写|减少来回切页面', '提交确认|补充承运信息|减少信息重复录入'], tool: '订单发货工具', human: '发货信息是否正确、运输方案是否适合这笔订单，需要你确认。' },
    { id: 'pricing', label: '定价与运费比较', hint: '算价算运费，练习时间被占掉', icon: Calculator, heading: '算一次不难，难的是反复改条件、比较方案。', description: '练习换售价、重量或目的地时，利润和运费都会变化。不断重算和抄数字，占掉了理解变化原因的时间。', beforeTitle: '手动改条件再重算', before: ['售价调整|输入新价格|重新计算利润', '运费比较|换一种运输方式|手动记录', '结论说明|回头找数据|练习时间被占用'], afterTitle: '少重复算数，多比较变化', after: ['输入条件|售价 · 重量 · 目的地|按练习准备', '比较变化|运费与利润|观察影响', '写出结论|对照不同方案|查看费用变化'], tool: '定价与运费工具', human: '费用为什么变化、最终选择哪种方案，需要自己判断；计算依赖填写的费率，不保证最低运费。' },
  ],
}
const isCompetition = computed(() => props.kind === 'competition')
const currentTopics = computed(() => topics[props.kind])
const current = computed(() => currentTopics.value[selectedIndex.value] ?? currentTopics.value[0]!)
// Reuse the tool catalog as the source of availability; topic IDs remain stable for page links and tests.
const taskIdsByTopic: Record<string, string> = {
  company: 'company',
  selection: 'sourcing',
  products: 'product',
  rates: 'shipping',
  settings: 'shipping',
  ads: 'marketing',
  fba: 'fba',
  shipping: 'orders',
  pricing: 'pricing',
}
const taskId = computed(() => taskIdsByTopic[current.value.id] ?? current.value.id)
const currentTask = computed(() => marketingTasks.find(task => task.id === taskId.value))
const isPlanned = computed(() => !currentTask.value || ['in-development', 'controlled-validation'].includes(currentTask.value.status))
const availabilityLabel = computed(() => statusLabels[currentTask.value?.status ?? 'in-development'])
// Keep the first mobile comparison readable without opening the full workflow.
const compactCopy: Record<string, { before: string; after: string }> = {
  company: { before: '资料分散，边找边填。', after: '先准备资料，减少重复填写。' },
  selection: { before: '价格、成本、运费分开查算。', after: '集中比较费用与利润。' },
  products: { before: '标题、属性、变体逐页填。', after: '集中准备资料，辅助重复录入。' },
  rates: { before: '地区、单位、价格反复核对。', after: '整理配送规则，辅助配置。' },
  settings: { before: '地区、单位、价格反复核对。', after: '整理配送规则，辅助配置。' },
  ads: { before: '广告和活动换个入口又要填。', after: '准备预算日期，辅助重复配置。' },
  fba: { before: '商品、库存、货件来回找。', after: '整理相关资料，减少页面切换。' },
  shipping: { before: '每笔订单重复分拣打包。', after: '先确认订单，再辅助重复步骤。' },
  pricing: { before: '价格或运费一变，就得重算。', after: '集中比较运费与利润。' },
}
const compact = computed(() => compactCopy[current.value.id] ?? { before: current.value.beforeTitle, after: current.value.afterTitle })
const taskAnnouncement = ref('')
watch(() => `${props.kind}-${current.value.id}`, () => { taskAnnouncement.value = `已切换到${current.value.label}` })
const rows = (items: string[]) => items.map((item) => { const [label, value, detail] = item.split('|'); return { label, description: `${value}，${detail}。` } })
</script>

<template>
  <section class="scenario-comparison" data-testid="scenario-comparison" :data-scenario="kind" aria-labelledby="scenario-comparison-title">
    <header class="scenario-hero">
      <div class="hero-copy">
        <p class="eyebrow"><component :is="isCompetition ? Trophy : BookOpen" :size="16" aria-hidden="true" />{{ isCompetition ? '比赛备赛' : '课程实训' }}</p>
        <h1 id="scenario-comparison-title">
          <template v-if="isCompetition"><span>比赛时间短，</span><span>操作做了不少，</span><em>分数却没上去？</em></template>
          <template v-else><span>练习做了一遍遍，</span><em>门道却没弄明白？</em></template>
        </h1>
        <p class="hero-intro">{{ isCompetition ? '隐性得分点要摸清，哪些操作值得花时间也要判断；重复填写又挤占了研究这些问题的时间。' : '作业按要求做完了，不代表评分细节和每一步的作用都弄清了；换个商品、物流方案或活动，又要重复配置。' }}</p>
        <a class="hero-explore" href="#scenario-pains">看看你是否也遇到过 <ArrowDown :size="16" aria-hidden="true" /></a>
      </div>
      <ScenarioIdentity :kind="kind" />
    </header>

    <section id="scenario-pains" class="pain-section" aria-labelledby="pain-section-title">
      <div class="pain-heading">
        <div><p class="eyebrow">八个最费时间的任务</p><h2 id="pain-section-title"><span>{{ isCompetition ? '哪些操作，' : '哪些重复操作，' }}</span><span>{{ isCompetition ? '值得你多花时间？' : '占掉了练习时间？' }}</span></h2></div>
        <p>选一个任务，看看具体卡在哪里。</p>
      </div>
      <div class="pain-selector" role="group" aria-label="选择要对比的任务">
        <button v-for="(topic, index) in currentTopics" :key="topic.id" type="button" :aria-pressed="selectedIndex === index" :aria-controls="`comparison-${kind}`" :data-testid="`pain-${topic.id}`" :class="{ selected: selectedIndex === index }" @click="selectedIndex = index">
          <component :is="topic.icon" :size="20" :stroke-width="1.7" aria-hidden="true" /><span>{{ topic.label }}</span>
        </button>
      </div>

      <p class="task-announcement" role="status" aria-live="polite" aria-atomic="true">{{ taskAnnouncement }}</p>
      <div :id="`comparison-${kind}`" class="comparison-body" :data-active-pain="current.id">
        <div :key="`${kind}-${current.id}`" class="comparison-details">
          <div class="comparison-intro">
            <span class="topic-number" aria-hidden="true">{{ String(selectedIndex + 1).padStart(2, '0') }}</span>
            <div><p class="selected-hint">{{ current.hint }}</p><h3>{{ current.heading }}</h3><p class="task-description">{{ current.description }}</p></div>
          </div>
          <div class="comparison-panels desktop-comparison">
            <article class="comparison-panel before-panel">
              <div class="panel-label">自己操作时</div>
              <h4>{{ current.beforeTitle }}</h4>
              <ol class="action-steps">
                <li v-for="(row, index) in rows(current.before)" :key="`${index}-${row.label}`"><span class="step-number" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span><div><h5>{{ row.label }}</h5><p>{{ row.description }}</p></div></li>
              </ol>
            </article>
            <article class="comparison-panel after-panel" :class="{ 'planned-panel': isPlanned }">
              <div class="panel-label"><span>{{ isPlanned ? '后续辅助方式' : '课赛通辅助后' }}</span><span class="availability-label">{{ availabilityLabel }}</span></div>
              <h4>{{ current.afterTitle }}</h4>
              <p v-if="isPlanned" class="planning-note">这一项暂未开放，以下为辅助方式示意。</p>
              <ol class="action-steps">
                <li v-for="(row, index) in rows(current.after)" :key="`${index}-${row.label}`"><span class="step-number" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span><div><h5>{{ row.label }}</h5><p>{{ row.description }}</p></div></li>
              </ol>
            </article>
          </div>
          <div class="mobile-comparison">
            <div class="compact-comparison" aria-label="操作方式简要对比">
              <article class="compact-panel before-panel">
                <h4>自己操作</h4>
                <p>{{ compact.before }}</p>
              </article>
              <article class="compact-panel after-panel" :class="{ 'planned-panel': isPlanned }">
                <div class="compact-label"><h4>{{ isPlanned ? '后续辅助' : '课赛通辅助' }}</h4><span class="availability-label">{{ availabilityLabel }}</span></div>
                <p>{{ compact.after }}</p>
              </article>
            </div>
            <!-- The keyed task container recreates a closed native details on every task change. -->
            <details class="mobile-workflow" data-testid="scenario-mobile-details">
              <summary>具体三步对照 <span aria-hidden="true">＋</span></summary>
              <p class="details-context">{{ current.description }}</p>
              <div class="mobile-step-panels">
                <article class="comparison-panel before-panel">
                  <div class="panel-label">自己操作时</div>
                  <h4>{{ current.beforeTitle }}</h4>
                  <ol class="action-steps">
                    <li v-for="(row, index) in rows(current.before)" :key="`${index}-${row.label}`"><span class="step-number" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span><div><h5>{{ row.label }}</h5><p>{{ row.description }}</p></div></li>
                  </ol>
                </article>
                <article class="comparison-panel after-panel" :class="{ 'planned-panel': isPlanned }">
                  <div class="panel-label"><span>{{ isPlanned ? '后续辅助方式' : '课赛通辅助后' }}</span><span class="availability-label">{{ availabilityLabel }}</span></div>
                  <h4>{{ current.afterTitle }}</h4>
                  <p v-if="isPlanned" class="planning-note">这一项暂未开放，以下为辅助方式示意。</p>
                  <ol class="action-steps">
                    <li v-for="(row, index) in rows(current.after)" :key="`${index}-${row.label}`"><span class="step-number" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span><div><h5>{{ row.label }}</h5><p>{{ row.description }}</p></div></li>
                  </ol>
                </article>
              </div>
            </details>
          </div>
          <aside class="human-note" aria-label="需要自己判断什么"><strong>需要自己判断什么</strong><p>{{ current.human }}</p></aside>
          <div class="comparison-footer">
            <p class="illustration-note">操作方式示意，实际开放范围见工具介绍。</p>
            <RouterLink class="task-tool-link" :to="`/tools#tool-${taskId}`" data-testid="scenario-tool-link">查看这项工具 <ArrowRight :size="17" aria-hidden="true" /></RouterLink>
          </div>
        </div>
      </div>
    </section>

    <slot name="results" />
  </section>
</template>

<style scoped>
.scenario-comparison {
  width: min(var(--m-width), calc(100% - var(--m-gutter) * 2));
  margin-inline: auto;
  padding-block: 56px var(--m-section);
  color: var(--m-ink);
}
.scenario-comparison *, .scenario-comparison *::before, .scenario-comparison *::after { box-sizing: border-box; }
.scenario-hero { display: grid; grid-template-columns: 1.3fr 1fr; align-items: center; gap: 56px; }
.scenario-hero > * { min-width: 0; }
.eyebrow { display: flex; align-items: center; gap: 9px; margin: 0 0 20px; color: var(--m-blue); font-size: 14px; font-weight: 700; }
.hero-copy h1 { margin: 0; font-size: var(--m-h1); font-weight: 750; line-height: 1.28; letter-spacing: 0; }
.hero-copy h1 > span, .hero-copy h1 > em { display: block; }
.hero-copy h1 em { color: var(--m-blue); font-style: normal; }
.hero-intro { max-width: 550px; margin: 24px 0 0; color: var(--m-text); font-size: var(--m-body); line-height: 1.85; }
.hero-explore { display: inline-flex; align-items: center; gap: 12px; min-height: 44px; margin-top: 20px; color: var(--m-blue); font-size: var(--m-body); font-weight: 700; text-decoration: none; transition: color var(--m-duration); }
.hero-explore:hover, .task-tool-link:hover { color: var(--m-blue-hover); }
.hero-explore:focus-visible, .pain-selector button:focus-visible, .task-tool-link:focus-visible, .mobile-workflow summary:focus-visible { outline: 3px solid var(--m-blue); outline-offset: 5px; }
.pain-section { padding-top: clamp(44px, 6vw, 72px); scroll-margin-top: 96px; }
.pain-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 30px; }
.pain-heading .eyebrow { margin-bottom: 12px; }
.pain-heading h2 { max-width: 780px; margin: 0; font-size: var(--m-h2); line-height: 1.4; letter-spacing: 0; text-wrap: balance; }
.pain-heading > p { flex: 0 0 auto; margin: 0 0 3px; color: var(--m-muted); font-size: 14px; line-height: 1.8; }
.pain-selector { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 28px; }
.pain-selector button { display: flex; align-items: center; gap: 10px; min-width: 0; min-height: 64px; padding: 15px 17px; border: 1px solid var(--m-border); border-radius: 10px; color: var(--m-text); background: #fff; font: inherit; text-align: left; cursor: pointer; transition: border-color var(--m-duration), color var(--m-duration), background var(--m-duration); }
.pain-selector button > svg { flex: 0 0 auto; }
.pain-selector button > span { min-width: 0; font-size: 16px; font-weight: 650; line-height: 1.5; }
.pain-selector button:hover { border-color: var(--m-blue); color: var(--m-blue); }
.pain-selector button.selected { border-color: var(--m-blue); box-shadow: inset 0 0 0 1px var(--m-blue); background: var(--m-blue-soft); color: var(--m-blue); }
.task-announcement { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.comparison-body { margin-top: 36px; }
.comparison-details { animation: comparison-reveal 120ms ease-out; }
.comparison-intro { display: flex; align-items: flex-start; gap: 18px; margin-bottom: 28px; min-block-size: 7rem; }
.topic-number { flex: 0 0 auto; color: var(--m-orange); font-size: 28px; font-weight: 650; font-variant-numeric: tabular-nums; line-height: 1.4; }
.comparison-intro h3 { margin: 5px 0 0; font-size: 24px; line-height: 1.5; letter-spacing: 0; text-wrap: balance; }
.comparison-intro p { max-width: 960px; margin: 10px 0 0; color: var(--m-text); font-size: var(--m-body); line-height: 1.8; }
.comparison-intro .selected-hint { margin: 0; color: var(--m-orange); font-size: 14px; font-weight: 600; }
.comparison-panels { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
.mobile-comparison { display: none; }
/* Reserve room for the longest task and development note; content can still grow when text is zoomed. */
.comparison-panel { display: flex; min-width: 0; min-block-size: 29rem; flex-direction: column; padding: 30px; border-radius: var(--m-radius); background: #eef0f3; }
.after-panel { background: var(--m-blue-soft); }
.panel-label { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; min-height: 26px; color: var(--m-muted); font-size: 14px; font-weight: 650; }
.after-panel .panel-label { color: var(--m-blue); }
.availability-label { padding: 3px 8px; border-radius: 5px; background: #fff; color: var(--m-muted); font-size: 14px; font-weight: 500; line-height: 1.5; }
.planned-panel .availability-label { color: var(--m-orange); }
.comparison-panel h4 { margin: 14px 0 0; font-size: 23px; line-height: 1.5; letter-spacing: 0; text-wrap: balance; }
.planning-note { margin: 10px 0 0; color: var(--m-orange); font-size: 15px; line-height: 1.7; }
.action-steps { display: grid; flex: 1; grid-template-rows: repeat(3, minmax(84px, auto)); gap: 0; margin: 22px 0 0; padding: 0; list-style: none; }
.action-steps li { display: flex; align-items: flex-start; gap: 14px; min-width: 0; padding-block: 16px; }
.action-steps li + li { border-top: 1px solid var(--m-border); }
.step-number { flex: 0 0 28px; padding-top: 1px; color: var(--m-muted); font-size: 14px; font-weight: 650; line-height: 1.6; font-variant-numeric: tabular-nums; }
.after-panel .step-number { color: var(--m-blue); }
.action-steps li > div { min-width: 0; }
.action-steps h5 { margin: 0; font-size: 17px; font-weight: 650; line-height: 1.5; }
.action-steps p { margin: 5px 0 0; color: var(--m-text); font-size: var(--m-body); line-height: 1.7; }
.human-note { display: flex; align-items: baseline; gap: 22px; margin-top: 22px; padding-block: 8px; }
.human-note strong { flex: 0 0 auto; font-size: 15px; font-weight: 650; }
.human-note p { margin: 0; color: var(--m-text); font-size: 15px; line-height: 1.8; }
.comparison-footer { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--m-border); }
.illustration-note { margin: 0; color: var(--m-muted); font-size: 13px; line-height: 1.7; }
.task-tool-link { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 9px; min-height: 44px; color: var(--m-blue); font-size: 15px; font-weight: 700; text-decoration: none; transition: color var(--m-duration); }
@keyframes comparison-reveal { from { opacity: .5; } to { opacity: 1; } }
@media (max-width: 1100px) {
  .scenario-hero { gap: 32px; }
  .hero-copy h1 { font-size: 44px; }
  .pain-heading { display: block; }
  .pain-heading > p { margin-top: 12px; }
  .comparison-panel { padding: 24px; }
}
@media (max-width: 820px) {
  .comparison-intro { min-block-size: 9rem; }
  .scenario-comparison { padding-top: 36px; }
  .scenario-hero { grid-template-columns: 1fr; gap: 32px; }
  .hero-copy h1 { font-size: var(--m-h1); }
  .hero-intro { max-width: 650px; }
  .pain-selector { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .comparison-panels { gap: 16px; }
  .comparison-panel { padding: 22px; min-block-size: 28rem; }
  .comparison-panel h4 { font-size: 21px; }
  .action-steps li { gap: 10px; }
  .human-note { align-items: flex-start; gap: 14px; }
}
@media (max-width: 620px) {
  .comparison-intro { min-block-size: 0; }
  .task-description, .desktop-comparison { display: none; }
  .mobile-comparison { display: block; }
  .compact-comparison { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .compact-panel { min-width: 0; padding: 18px 16px; border-radius: 12px; background: #eef0f3; }
  .compact-panel.after-panel { background: var(--m-blue-soft); }
  .compact-label { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 7px; }
  .compact-panel h4 { margin: 0; color: var(--m-muted); font-size: 15px; font-weight: 700; line-height: 1.6; }
  .compact-panel.after-panel h4 { color: var(--m-blue); }
  .compact-panel p { margin: 10px 0 0; font-size: 16px; font-weight: 600; line-height: 1.7; }
  .compact-panel .availability-label { padding: 2px 6px; font-size: 14px; }
  .mobile-workflow { margin-top: 14px; border-block: 1px solid var(--m-border); }
  .mobile-workflow summary { display: flex; align-items: center; justify-content: space-between; gap: 14px; min-height: 48px; padding-block: 12px; color: var(--m-blue); font-size: 15px; font-weight: 650; cursor: pointer; list-style: none; }
  .mobile-workflow summary::-webkit-details-marker { display: none; }
  .mobile-workflow summary > span { font-size: 22px; font-weight: 400; line-height: 1; }
  .mobile-workflow[open] summary > span { transform: rotate(45deg); }
  .details-context { margin: 0 0 16px; color: var(--m-text); font-size: 15px; line-height: 1.8; }
  .mobile-step-panels { display: grid; gap: 14px; padding-bottom: 18px; }
  .mobile-step-panels .comparison-panel { min-block-size: 0; padding: 20px; }
  .mobile-step-panels .comparison-panel h4 { margin-top: 10px; font-size: 19px; }
  .mobile-step-panels .action-steps { grid-template-rows: none; margin-top: 14px; }
  .mobile-step-panels .action-steps li { padding-block: 12px; }
  .mobile-step-panels .action-steps p { font-size: 15px; }
  .human-note { flex-direction: column; gap: 7px; min-block-size: 0; }
}
@media (max-width: 480px) {
  .pain-heading h2 span { display: block; }
  .scenario-comparison { padding-top: 28px; }
  .hero-copy h1 { font-size: clamp(30px, 8.4vw, 36px); line-height: 1.35; }
  .eyebrow { margin-bottom: 16px; }
  .hero-intro { margin-top: 20px; }
  .pain-heading > p { font-size: 14px; }
  .pain-selector { gap: 10px; margin-top: 22px; }
  .pain-selector button { gap: 9px; min-height: 56px; padding: 13px 11px; }
  .pain-selector button > span { font-size: 15px; }
  .pain-selector button > svg { width: 18px; height: 18px; }
  .comparison-body { margin-top: 28px; }
  .comparison-intro { gap: 12px; margin-bottom: 22px; }
  .comparison-intro h3 { font-size: 20px; }
  .topic-number { font-size: 24px; }
  .compact-panel { padding: 16px 13px; }
  .comparison-footer { align-items: flex-start; flex-direction: column; gap: 8px; }
}
@media (prefers-reduced-motion: reduce) {
  .pain-selector button, .hero-explore, .task-tool-link { transition: none; }
  .comparison-details { animation: none; }
}
</style>
