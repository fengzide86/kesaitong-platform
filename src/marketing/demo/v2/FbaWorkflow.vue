<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { State } from './model'
import { fbaFingerprint, fbaRows, type FbaAnswer, type FbaCommand, type FbaData, type FbaDeclaration, type FbaPreparation } from './fba-workflow'
import type { WorkflowSubmit } from './workflow-contract'
import './fba-workflow.css'

const props = defineProps<{ state: State; data: FbaData; submit: WorkflowSubmit<FbaCommand>; selection?: string[]; initialMode?: string; focusId?: string }>()
const root = ref<HTMLElement>()
type Mode = 'inventory' | 'select' | 'confirm' | 'declarations' | 'preparation' | 'shipments'
const mode = ref<Mode>(props.initialMode === 'convert' ? 'select' : props.initialMode === 'shipments' ? 'shipments' : 'inventory')
const baseline = ref(fbaFingerprint(props.state, props.data))
const selected = ref<string[]>([...(props.selection ?? [])])
const declarations = ref<Record<string, FbaDeclaration>>({})
const hazardId = ref('')
const battery = ref<FbaAnswer>('')
const hazardous = ref<FbaAnswer>('')
const afterConversion = ref(false)
const pending = ref(false)
const message = ref('')
const succeeded = ref(false)
const shipmentFilter = ref('所有')
const planType = ref('new')
const preparationStep = ref(0)
const prep = ref<Omit<FbaPreparation, 'id' | 'status' | 'updatedAt'>>({ variantId: '', name: '', quantity: 1, prepBy: 'seller', labelBy: 'seller', labelCount: 1, weightLb: 1, lengthIn: 10, widthIn: 8, heightIn: 6 })
const allRows = computed(() => props.state.products.flatMap(product => product.variants.filter(variant => !variant.deleted).map(variant => ({ product, variant }))))
const amazonRows = computed(() => fbaRows(props.state, props.data))
const conversionRows = computed(() => allRows.value.filter(row => selected.value.includes(row.variant.id)))
const hazardRow = computed(() => conversionRows.value.find(row => row.variant.id === hazardId.value))
const prepRow = computed(() => amazonRows.value.find(row => row.variant.id === prep.value.variantId))
const allAnswered = computed(() => conversionRows.value.length > 0 && conversionRows.value.every(row => declarations.value[row.variant.id]))
const changed = computed(() => ['select', 'confirm', 'declarations', 'preparation'].includes(mode.value) && baseline.value !== fbaFingerprint(props.state, props.data))
const preparedSteps = ['设置数量', '预处理商品', '为商品贴标', '检查货件', '预处理货件', '一览']
const canSelect = (row: typeof allRows.value[number]) => row.product.status === 'active' && row.variant.status === 'active' && row.variant.delivery === 'FBM'
async function focusResult() {
  if (!props.focusId) return
  mode.value = 'inventory'
  await nextTick()
  const row = Array.from(root.value?.querySelectorAll<HTMLElement>('[data-fba-row]') ?? []).find(item => item.dataset.fbaRow === props.focusId)
  row?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
}
onMounted(focusResult)
watch(() => props.focusId, focusResult)
watch(() => props.initialMode, value => {
  if (pending.value) return
  if (value === 'convert') newConversion()
  else mode.value = value === 'shipments' ? 'shipments' : 'inventory'
})
const draftSku = (id: string) => props.state.products.flatMap(product => product.variants).find(variant => variant.id === id)?.sku || id

function result(text: string, ok = false) { message.value = text; succeeded.value = ok }
function newConversion() {
  baseline.value = fbaFingerprint(props.state, props.data)
  selected.value = (props.selection ?? []).filter(id => allRows.value.some(row => row.variant.id === id && canSelect(row)))
  declarations.value = {}; hazardId.value = ''; afterConversion.value = false; message.value = ''; mode.value = 'select'
}
function confirmSelection() {
  if (!selected.value.length || conversionRows.value.length !== selected.value.length || conversionRows.value.some(row => !canSelect(row))) { result('请选择在售的卖家配送子 SKU；父商品不是转换对象。'); return }
  message.value = ''; mode.value = 'confirm'
}
function startDeclarations(send: boolean) { afterConversion.value = send; message.value = ''; mode.value = 'declarations' }
function openHazard(id: string) {
  hazardId.value = id
  battery.value = declarations.value[id]?.battery ?? ''; hazardous.value = declarations.value[id]?.hazardous ?? ''; message.value = ''
}
function saveHazard() {
  if (!battery.value || !hazardous.value) { result('请分别选择电池与危险品信息。'); return }
  declarations.value[hazardId.value] = { variantId: hazardId.value, battery: battery.value, hazardous: hazardous.value }
  hazardId.value = ''; message.value = ''
}
async function convert() {
  if (!allAnswered.value) { result('请完成每个子 SKU 的危险品信息。'); return }
  if (pending.value) return
  pending.value = true
  try {
    const reply = await props.submit({ type: 'convert', variantIds: [...selected.value], declarations: selected.value.map(id => ({ ...declarations.value[id]! })) }, baseline.value)
    result(reply.message, reply.ok)
    if (reply.ok) {
      mode.value = 'inventory'
      if (afterConversion.value && selected.value[0]) openPreparation(selected.value[0], true)
    }
  } catch { result('保存未完成，请核对本地库存，不会自动重复转换。') }
  finally { pending.value = false }
}
function openPreparation(id: string, preserveMessage = false) {
  baseline.value = fbaFingerprint(props.state, props.data)
  const saved = props.data.preparations.find(item => item.variantId === id)
  prep.value = saved ? { ...saved } : { variantId: id, name: '样例入库准备', quantity: 1, prepBy: 'seller', labelBy: 'seller', labelCount: 1, weightLb: 1, lengthIn: 10, widthIn: 8, heightIn: 6 }
  preparationStep.value = 0; planType.value = 'new'; mode.value = 'preparation'
  if (!preserveMessage) message.value = ''
}
function nextPreparation() {
  if (planType.value === 'existing') { result('当前没有可添加的既有入库计划。可以保存一份本地准备草稿，但不能伪造平台计划。'); return }
  if (!Number.isSafeInteger(prep.value.quantity) || prep.value.quantity <= 0 || prep.value.quantity > 100000) { result('请填写 1 至 100000 的计划数量。该数字不代表可发库存。'); return }
  if (preparationStep.value === 2 && prep.value.labelCount !== prep.value.quantity) { result('此单 SKU 样例的标签数应与计划数量一致。'); return }
  message.value = ''; preparationStep.value = Math.min(5, preparationStep.value + 1)
}
async function savePreparation() {
  if (pending.value) return
  pending.value = true
  try {
    const reply = await props.submit({ type: 'save-preparation', preparation: { ...prep.value } }, baseline.value)
    result(reply.message, reply.ok)
    if (reply.ok) { baseline.value = fbaFingerprint(props.state, props.data); mode.value = 'shipments' }
  } catch { result('本地草稿未保存，请稍后核对，不会生成已发出的货件。') }
  finally { pending.value = false }
}
</script>

<template>
  <section
    ref="root"
    class="v2-fba-workflow"
    aria-label="亚马逊配送流程"
  >
    <nav
      class="v2-inventory-tabs"
      aria-label="FBA 页面"
    >
      <button
        :class="{ active: mode === 'inventory' }"
        data-action="fba-show-inventory"
        :disabled="pending"
        @click="mode = 'inventory'; message = ''"
      >
        亚马逊库存
      </button>
      <button
        :class="{ active: mode === 'shipments' }"
        data-action="fba-show-shipments"
        :disabled="pending"
        @click="mode = 'shipments'; message = ''"
      >
        货件处理进度
      </button>
    </nav>
    <div
      v-if="message"
      class="v2-message"
      :class="{ error: !succeeded }"
      data-testid="fba-result"
      :data-success="succeeded"
      role="status"
    >
      {{ message }}
    </div>
    <p
      v-if="changed"
      class="v2-fba-warning"
      role="alert"
    >
      库存或 FBA 记录已变化。本页仍保留你填写的内容；请返回列表重新打开，旧页面不会覆盖新结果。
    </p>

    <template v-if="mode === 'inventory'">
      <div class="v2-fba-heading">
        <h1>管理亚马逊库存</h1><button
          class="v2-button"
          data-action="fba-new-conversion"
          @click="newConversion"
        >
          转换为“亚马逊配送”
        </button>
      </div>
      <p class="v2-local-note">
        配送方式转换、FBA 可售库存和货件是不同状态。样例未入库，因此 FBA 可售为 0。
      </p>
      <div class="v2-table-scroll">
        <table class="v2-fba-table">
          <thead><tr><th>状态 / 配送</th><th>SKU / FNSKU</th><th>商品名称 / 父项 ASIN</th><th>可售</th><th>操作</th></tr></thead>
          <tbody>
            <tr
              v-for="row in amazonRows"
              :key="row.variant.id"
              :data-fba-row="row.variant.id"
              :data-focused="row.variant.id === focusId"
            >
              <td>{{ row.variant.status === 'active' && row.product.status === 'active' ? '在售' : '不可售' }}<small>亚马逊配送</small></td>
              <td>{{ row.variant.sku }}<small data-testid="fba-fnsku">{{ row.fnsku }}</small></td>
              <td>{{ row.product.title }}<small>{{ row.product.asin }} · {{ row.variant.term }}</small></td>
              <td data-testid="fba-available">
                {{ row.available }}
              </td>
              <td>
                <button
                  class="v2-link"
                  data-action="fba-replenish"
                  :data-fba-variant="row.variant.id"
                  :disabled="row.product.status !== 'active' || row.variant.status !== 'active'"
                  @click="openPreparation(row.variant.id)"
                >
                  发 / 补货
                </button><br><button
                  class="v2-link"
                  data-action="fba-view-shipments"
                  @click="mode = 'shipments'; message = ''"
                >
                  查看亚马逊货件
                </button>
              </td>
            </tr><tr v-if="!amazonRows.length">
              <td
                colspan="5"
                class="v2-empty"
              >
                没有亚马逊配送商品。先选择在售子 SKU 转换配送方式。
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <template v-else-if="mode === 'select'">
      <h1>选择要转换的子 SKU</h1><p class="v2-local-note">
        展开后的子商品才是转换对象；选择配送筛选不会改变商品配送方式。
      </p>
      <div class="v2-table-scroll">
        <table class="v2-fba-table">
          <thead><tr><th>选择</th><th>SKU</th><th>商品 / 变体</th><th>配送类型</th></tr></thead><tbody>
            <tr
              v-for="row in allRows"
              :key="row.variant.id"
            >
              <td>
                <input
                  v-model="selected"
                  type="checkbox"
                  name="fbaSku"
                  :value="row.variant.id"
                  :aria-label="`选择 ${row.variant.sku}`"
                  :disabled="!canSelect(row)"
                >
              </td><td>{{ row.variant.sku }}</td><td>{{ row.product.title }}<small>{{ row.variant.term }}</small></td><td>{{ row.variant.delivery === 'FBA' ? '亚马逊' : '卖家' }}<small v-if="!canSelect(row)">{{ row.variant.delivery === 'FBA' ? '已转换，无需重复' : '当前不可转换' }}</small></td>
            </tr>
          </tbody>
        </table>
      </div>
      <footer class="v2-fba-actions">
        <span>已选 {{ selected.length }} 个子 SKU</span><button
          class="v2-button"
          data-action="fba-cancel"
          @click="mode = 'inventory'; message = ''"
        >
          取消
        </button><button
          class="v2-button v2-yellow"
          data-action="fba-selection-confirm"
          @click="confirmSelection"
        >
          转换为“亚马逊配送”
        </button>
      </footer>
    </template>

    <template v-else-if="mode === 'confirm'">
      <h1>转换为“亚马逊配送”</h1><p>即将转换 {{ conversionRows.length }} 个 SKU。亚马逊配送库存与卖家库存独立，请在转换后查看库存状态。</p>
      <ul class="v2-fba-chosen">
        <li
          v-for="row in conversionRows"
          :key="row.variant.id"
        >
          <strong>{{ row.variant.sku }}</strong> {{ row.product.title }} · {{ row.variant.term }}
        </li>
      </ul>
      <footer class="v2-fba-actions">
        <button
          class="v2-button"
          data-action="fba-back-selection"
          @click="mode = 'select'"
        >
          返回
        </button><button
          class="v2-button"
          data-action="fba-only-convert"
          @click="startDeclarations(false)"
        >
          只转换
        </button><button
          class="v2-button v2-yellow"
          data-action="fba-convert-send"
          @click="startDeclarations(true)"
        >
          转换并发送库存
        </button>
      </footer>
      <p class="v2-local-note">
        “转换并发送库存”在本体验中先完成转换，再进入货件准备；不自动生成已发出或已入库的货件。
      </p>
    </template>

    <template v-else-if="mode === 'declarations'">
      <h1>提供危险品信息</h1>
      <div
        v-if="!hazardId"
        class="v2-table-scroll"
      >
        <table class="v2-fba-table">
          <thead><tr><th>卖家 SKU</th><th>商品</th><th>危险品信息</th></tr></thead><tbody>
            <tr
              v-for="row in conversionRows"
              :key="row.variant.id"
            >
              <td>{{ row.variant.sku }}</td><td>{{ row.product.title }}</td><td>
                <span
                  v-if="declarations[row.variant.id]"
                  class="v2-fba-complete"
                >✓ 已完成</span><button
                  class="v2-link"
                  data-action="fba-hazard-open"
                  :data-fba-variant="row.variant.id"
                  @click="openHazard(row.variant.id)"
                >
                  {{ declarations[row.variant.id] ? '修改信息' : '添加危险品信息' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <form
        v-if="hazardId"
        class="v2-fba-hazard"
        aria-label="危险品信息"
        @submit.prevent="saveHazard"
      >
        <h2>{{ hazardRow?.variant.sku }}</h2>
        <fieldset>
          <legend>此商品是否含有电池，或需要电池？</legend><label
            v-for="answer in ([['yes', '是'], ['no', '否'], ['unknown', '不确定']] as const)"
            :key="answer[0]"
          ><input
            v-model="battery"
            name="fbaBattery"
            type="radio"
            :value="answer[0]"
          >{{ answer[1] }}</label>
        </fieldset>
        <fieldset>
          <legend>此商品是否属于危险品（危险材料）？</legend><label
            v-for="answer in ([['yes', '是'], ['no', '否'], ['unknown', '不确定']] as const)"
            :key="answer[0]"
          ><input
            v-model="hazardous"
            name="fbaHazardous"
            type="radio"
            :value="answer[0]"
          >{{ answer[1] }}</label>
        </fieldset>
        <p class="v2-local-note">
          当前样例仅完成“否 / 否”的转换验证。“是 / 不确定”可以查看和保存选项，但不会伪造危险品审批成功。
        </p>
        <footer class="v2-fba-actions">
          <button
            type="button"
            class="v2-button"
            data-action="fba-hazard-cancel"
            @click="hazardId = ''"
          >
            取消
          </button><button
            class="v2-button v2-yellow"
            data-action="fba-hazard-save"
          >
            提交信息
          </button>
        </footer>
      </form>
      <footer
        v-else
        class="v2-fba-actions"
      >
        <button
          class="v2-button"
          :disabled="pending"
          data-action="fba-back-confirm"
          @click="mode = 'confirm'"
        >
          返回
        </button><button
          class="v2-button v2-yellow"
          data-action="fba-save-conversion"
          :disabled="pending"
          @click="convert"
        >
          {{ pending ? '正在保存…' : '保存并继续' }}
        </button>
      </footer>
    </template>

    <template v-else-if="mode === 'preparation'">
      <h1>发送 / 补充库存</h1>
      <p class="v2-fba-warning">
        本地货件准备草稿 · 可练习已知字段；不是平台货件，不代表已经发出或入库。
      </p>
      <ol class="v2-fba-stepbar">
        <li
          v-for="(step, index) in preparedSteps"
          :key="step"
          :class="{ active: preparationStep === index, done: preparationStep > index }"
        >
          <span>{{ index + 1 }}</span>{{ step }}
        </li>
      </ol>
      <div class="v2-fba-plan-summary">
        <b>{{ prepRow?.variant.sku }}</b><span>{{ prepRow?.product.title }}</span><span>FBA 可售：0</span><span>本地计划数量：{{ prep.quantity }}</span>
      </div>
      <form
        class="v2-fba-preparation"
        @submit.prevent="savePreparation"
      >
        <template v-if="preparationStep === 0">
          <h2>要创建新入库计划还是添加至现有入库计划？</h2>
          <fieldset class="v2-fba-plan-choice">
            <label><input
              v-model="planType"
              name="fbaPlanType"
              type="radio"
              value="new"
            >创建新的入库计划（本地准备）</label><label><input
              v-model="planType"
              name="fbaPlanType"
              type="radio"
              value="existing"
            >添加至现有入库计划</label>
          </fieldset>
          <p
            v-if="planType === 'existing'"
            class="v2-fba-warning"
          >
            无相关数据：没有已经创建的平台入库计划。
          </p>
          <label>准备名称<input
            v-model="prep.name"
            name="fbaPreparationName"
            maxlength="240"
          ></label><label>计划商品数量<input
            v-model.number="prep.quantity"
            name="fbaQuantity"
            type="number"
            min="1"
            max="100000"
            step="1"
          ></label>
          <p class="v2-local-note">
            计划数量仅供准备练习，不把普通库存数量当作 FBA 已收货数量，也不据此扣减库存。
          </p>
        </template>
        <template v-else-if="preparationStep === 1">
          <h2>预处理商品</h2><p>准备指导：当前虚构商品无需额外预处理。</p><label>预处理方<select
            v-model="prep.prepBy"
            name="fbaPrepBy"
          ><option value="seller">卖家（样例选择）</option><option value="amazon">亚马逊（样例选择）</option></select></label><p class="v2-local-note">
            未接入真实费用或可用服务，不计算预处理成本。
          </p>
        </template>
        <template v-else-if="preparationStep === 2">
          <h2>为商品贴标</h2><p>FNSKU：{{ prepRow?.fnsku }}</p><label>贴标方<select
            v-model="prep.labelBy"
            name="fbaLabelBy"
          ><option value="seller">卖家（样例选择）</option><option value="amazon">亚马逊（样例选择）</option></select></label><label>要打印的标签数量<input
            v-model.number="prep.labelCount"
            name="fbaLabelCount"
            type="number"
            min="1"
            step="1"
          ></label><p class="v2-local-note">
            仅保存标签需求，不生成可用于真实发货的标签或条码。
          </p>
        </template>
        <template v-else-if="preparationStep === 3">
          <h2>检查货件准备</h2><dl class="v2-fba-details">
            <dt>名称</dt><dd>{{ prep.name }}</dd><dt>MSKU</dt><dd>{{ prepRow?.variant.sku }}</dd><dt>计划数量 / 标签数</dt><dd>{{ prep.quantity }} / {{ prep.labelCount }}</dd><dt>目的地</dt><dd>尚未由平台分配运营中心</dd>
          </dl>
        </template>
        <template v-else-if="preparationStep === 4">
          <h2>预处理货件</h2><p>包装类型：混装商品 · 运输方式：小包裹快递 (SPD)</p><label>箱子重量（lb）<input
            v-model.number="prep.weightLb"
            name="fbaBoxWeight"
            type="number"
            min="0.01"
            step="any"
          ></label><label>箱子长度（in）<input
            v-model.number="prep.lengthIn"
            name="fbaBoxLength"
            type="number"
            min="0.01"
            step="any"
          ></label><label>箱子宽度（in）<input
            v-model.number="prep.widthIn"
            name="fbaBoxWidth"
            type="number"
            min="0.01"
            step="any"
          ></label><label>箱子高度（in）<input
            v-model.number="prep.heightIn"
            name="fbaBoxHeight"
            type="number"
            min="0.01"
            step="any"
          ></label><p class="v2-local-note">
            真实物流商、运营中心、追踪号和费用尚未确认，本地不虚构选择结果。
          </p>
        </template>
        <template v-else>
          <h2>准备一览</h2><dl class="v2-fba-details">
            <dt>名称 / SKU</dt><dd>{{ prep.name }} / {{ prepRow?.variant.sku }}</dd><dt>计划 / 标签数量</dt><dd>{{ prep.quantity }} / {{ prep.labelCount }}</dd><dt>箱子</dt><dd>{{ prep.weightLb }} lb · {{ prep.lengthIn }} × {{ prep.widthIn }} × {{ prep.heightIn }} in</dd><dt>状态</dt><dd>仅本地准备；尚未创建货件</dd>
          </dl><p class="v2-fba-warning">
            当前没有已经核验的 FBA 可发数量与平台货件。可以保存准备草稿；不能在本体验中宣称货件已完成或已入库。
          </p>
        </template>
        <footer class="v2-fba-actions">
          <button
            type="button"
            class="v2-button"
            data-action="fba-preparation-cancel"
            :disabled="pending"
            @click="mode = 'inventory'; message = ''"
          >
            返回库存
          </button><button
            v-if="preparationStep > 0"
            type="button"
            class="v2-button"
            data-action="fba-preparation-back"
            @click="preparationStep--"
          >
            上一步
          </button><button
            v-if="preparationStep < 5"
            type="button"
            class="v2-button v2-yellow"
            data-action="fba-continue-plan"
            @click="nextPreparation"
          >
            继续准备
          </button><button
            v-else
            class="v2-button v2-yellow"
            data-action="fba-save-preparation"
            :disabled="pending"
          >
            {{ pending ? '正在保存…' : '保存本地准备草稿' }}
          </button>
        </footer>
      </form>
    </template>

    <template v-else>
      <h1>货件处理进度</h1>
      <fieldset class="v2-fba-shipment-filter">
        <legend>状态</legend><label
          v-for="status in ['所有', '处理中', '在途', '在运营中心', '已完成', '已删除/已取消']"
          :key="status"
        ><input
          v-model="shipmentFilter"
          name="fbaShipmentStatus"
          type="radio"
          :value="status"
        >{{ status }}</label>
      </fieldset>
      <div class="v2-table-scroll">
        <table class="v2-fba-table">
          <thead><tr><th>货件名称</th><th>货件编号</th><th>MSKU</th><th>已发货</th><th>已收到</th><th>目的地</th><th>状态</th></tr></thead><tbody>
            <tr>
              <td
                class="v2-empty"
                colspan="7"
              >
                无相关数据。FBA 转换不自动创建货件，准备草稿也不会计入已发货。
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <h2 class="v2-fba-draft-heading">
        本地货件准备草稿 <small>仅在此浏览器保存，与上方平台货件状态分开。</small>
      </h2>
      <div class="v2-table-scroll">
        <table class="v2-fba-table">
          <thead><tr><th>准备名称</th><th>SKU</th><th>计划数量 / 标签数</th><th>状态</th><th>操作</th></tr></thead><tbody>
            <tr
              v-for="draft in data.preparations"
              :key="draft.id"
              :data-fba-preparation="draft.id"
            >
              <td>{{ draft.name }}</td><td>{{ draftSku(draft.variantId) }}</td><td>{{ draft.quantity }} / {{ draft.labelCount }}</td><td>本地草稿 · 未发出</td><td>
                <button
                  class="v2-link"
                  data-action="fba-edit-preparation"
                  :data-fba-variant="draft.variantId"
                  @click="openPreparation(draft.variantId)"
                >
                  继续准备
                </button>
              </td>
            </tr><tr v-if="!data.preparations.length">
              <td
                colspan="5"
                class="v2-empty"
              >
                尚未保存本地准备草稿。
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>
