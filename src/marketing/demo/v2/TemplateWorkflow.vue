<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ShippingTemplate, State } from './model'
import type { WorkflowSubmit } from './workflow-contract'
import { getTemplateDetail, templateFingerprint, TEMPLATE_COUNTRIES, TEMPLATE_SERVICES, type TemplateCommand, type TemplateData, type TemplateDetail, type TemplateRule } from './template-workflow'
import './template-workflow.css'

const props = defineProps<{ state: State; data: TemplateData; submit: WorkflowSubmit<TemplateCommand>; focusId?: string }>()
const mode = ref<'view' | 'edit' | 'assign' | 'delete'>('view')
const selectedId = ref(props.state.templates[0]?.id ?? '')
const selected = computed(() => props.state.templates.find(t => t.id === selectedId.value))
const readback = computed(() => selected.value ? getTemplateDetail(selected.value, props.data) : undefined)
const bindings = computed(() => props.state.products.filter(p => p.offer.templateId === selectedId.value))
const draft = ref<ShippingTemplate>({ id: '', name: '', country: '美国', service: '标准配送', unit: 'kg', currency: 'USD', limit: 5, handling: 2, base: 0, perKg: 0 })
const detail = ref<TemplateDetail>({ templateId: '', mode: 'weight', rules: [] })
const baseline = ref(''), message = ref(''), failed = ref(false), pending = ref(false), productId = ref('')
const countryRule = ref<number | null>(null), countrySelection = ref<string[]>([])
watch(() => props.focusId, id => {
  if (!id) return
  selectedId.value = id; mode.value = 'view'; countryRule.value = null
  failed.value = !props.state.templates.some(t => t.id === id)
  message.value = failed.value ? '该配送模板已不存在，可能已被删除或重置。请从左侧列表重新选择。' : ''
}, { immediate: true })
const newId = (prefix: string) => `${prefix}-${globalThis.crypto.randomUUID()}`
const newRule = (scope: 'domestic' | 'international'): TemplateRule => ({ id: newId('sample-rule'), scope, countries: scope === 'domestic' ? ['美国'] : ['英国'], service: '标准配送', transit: '5–10 天', base: 3.5, perUnit: 0, unit: 'lb', bands: [{ from: 0, to: null, fee: 3.5 }] })
function begin(kind: 'edit' | 'assign' | 'delete', create = false) {
  if (pending.value) return
  baseline.value = templateFingerprint(props.state, props.data)
  message.value = ''; failed.value = false; countryRule.value = null
  if (kind === 'edit') {
    if (create) {
      draft.value = { id: newId('sample-template'), name: '', country: '美国', service: '标准配送', unit: 'kg', currency: 'USD', limit: 5, handling: 2, base: 3.5, perKg: 0 }
      detail.value = { templateId: draft.value.id, mode: 'weight', rules: [newRule('domestic')] }
    } else if (selected.value) {
      draft.value = { ...selected.value }; detail.value = getTemplateDetail(selected.value, props.data)
    } else return
  }
  if (kind === 'assign') productId.value = ''
  mode.value = kind
}
function view(id: string) { if (!pending.value) { selectedId.value = id; mode.value = 'view'; countryRule.value = null; message.value = '' } }
async function execute(command: TemplateCommand, captured = baseline.value) {
  if (pending.value) return
  pending.value = true; message.value = ''; failed.value = false
  try {
    const result = await props.submit(command, captured)
    message.value = result.message; failed.value = !result.ok
    if (result.ok) {
      selectedId.value = command.type === 'delete' ? props.state.templates[0]?.id ?? '' : result.id ?? selectedId.value
      mode.value = 'view'; countryRule.value = null
    }
  } catch { failed.value = true; message.value = '保存结果未确认，请重新查看列表后再继续。' }
  finally { pending.value = false }
}
function save() { void execute({ type: 'save', template: draft.value, detail: detail.value }) }
function setDefault() { if (selected.value) void execute({ type: 'default', id: selected.value.id }, templateFingerprint(props.state, props.data)) }
function countries(index: number) { countryRule.value = index; countrySelection.value = [...detail.value.rules[index]!.countries] }
function confirmCountries() {
  if (countryRule.value === null || !countrySelection.value.length) return
  detail.value.rules[countryRule.value]!.countries = [...countrySelection.value]; countryRule.value = null
}
function splitBand(rule: TemplateRule) {
  const last = rule.bands.at(-1)!
  last.to = Number((last.from + 10).toFixed(2))
  rule.bands.push({ from: Number((last.to + .01).toFixed(2)), to: null, fee: last.fee })
}
function updateBand(rule: TemplateRule, index: number) {
  const band = rule.bands[index]
  if (band && typeof band.to === 'number' && Number.isFinite(band.to) && rule.bands[index + 1]) rule.bands[index + 1]!.from = Number((band.to + .01).toFixed(2))
}
function removeBand(rule: TemplateRule) { if (rule.bands.length > 1) { rule.bands.pop(); rule.bands.at(-1)!.to = null } }
const price = (value: number) => value.toFixed(2)
</script>

<template>
  <section
    class="v2-template-workflow"
    aria-label="配送模板设置"
  >
    <header class="v2-template-heading">
      <div><h1>配送设置</h1><p>配送模板</p></div><button
        class="v2-button v2-primary"
        data-action="template-create"
        :disabled="pending || mode !== 'view'"
        @click="begin('edit', true)"
      >
        创建新配送模板
      </button>
    </header>
    <div
      v-if="message"
      data-testid="template-result"
      role="status"
      :class="['v2-template-result', { 'is-error': failed }]"
    >
      {{ message }}
    </div>
    <div class="v2-template-layout">
      <nav
        class="v2-template-list"
        aria-label="配送模板列表"
      >
        <h2>配送模板</h2><button
          v-for="item in state.templates"
          :key="item.id"
          :data-template-id="item.id"
          data-action="template-select"
          :class="{ selected: selectedId === item.id }"
          :aria-current="selectedId === item.id ? 'page' : undefined"
          :disabled="pending || mode !== 'view'"
          @click="view(item.id)"
        >
          <span>{{ item.name }}</span><small v-if="data.defaultTemplateId === item.id">默认模板</small>
        </button><p v-if="!state.templates.length">
          尚无模板，请新建。
        </p>
      </nav>
      <main class="v2-template-main">
        <template v-if="mode === 'edit'">
          <form
            class="v2-template-form"
            novalidate
            @submit.prevent="save"
          >
            <h2>{{ state.templates.some(t => t.id === draft.id) ? '编辑配送模板' : '创建配送模板' }}</h2>
            <label class="v2-template-name">配送模板名称 <input
              v-model="draft.name"
              name="templateName"
              maxlength="100"
              :disabled="pending"
              placeholder="输入便于识别的模板名称"
            ></label>
            <fieldset :disabled="pending">
              <legend>运费计算方式</legend><label><input
                v-model="detail.mode"
                name="templateMode"
                type="radio"
                value="weight"
              > 按重量／件数</label><label><input
                v-model="detail.mode"
                name="templateMode"
                type="radio"
                value="price"
              > 按订单价格分段</label>
            </fieldset>
            <p class="v2-template-note">
              运输时间不包括处理时间。此处设置向买家收取的样例运费，不是承运人报价。
            </p>
            <section
              v-for="(rule, index) in detail.rules"
              :key="rule.id"
              class="v2-template-rule"
              :data-template-rule="index"
            >
              <header>
                <h3>{{ rule.scope === 'domestic' ? '国内配送' : '国际配送' }} · 规则 {{ index + 1 }}</h3><button
                  class="v2-link"
                  type="button"
                  data-action="template-remove-rule"
                  :disabled="pending || detail.rules.length === 1"
                  @click="detail.rules.splice(index, 1)"
                >
                  删除规则
                </button>
              </header>
              <div class="v2-template-fields">
                <label>国家／地区 <button
                  type="button"
                  class="v2-button"
                  data-action="template-countries"
                  :disabled="pending || rule.scope === 'domestic'"
                  @click="countries(index)"
                >{{ rule.countries.join('、') || '选择国家' }}</button></label><label>配送服务 <select
                  v-model="rule.service"
                  :name="`templateRuleService${index}`"
                  :disabled="pending"
                ><option
                  v-for="service in TEMPLATE_SERVICES.filter(s => rule.scope === 'domestic' || ['标准配送', '加急配送'].includes(s))"
                  :key="service"
                >{{ service }}</option></select></label><label>运输时间 <input
                  v-model="rule.transit"
                  :name="`templateRuleTransit${index}`"
                  :disabled="pending"
                  placeholder="例如 5–10 天"
                ></label>
              </div>
              <div
                v-if="detail.mode === 'weight'"
                class="v2-template-fields"
              >
                <label>每单金额（{{ draft.currency }}）<input
                  v-model.number="rule.base"
                  type="number"
                  min="0"
                  step="0.01"
                  :name="`templateRuleBase${index}`"
                  :disabled="pending"
                ></label><label>单位价（{{ draft.currency }}）<input
                  v-model.number="rule.perUnit"
                  type="number"
                  min="0"
                  step="0.01"
                  :name="`templateRulePerUnit${index}`"
                  :disabled="pending"
                ></label><label>单位 <select
                  v-model="rule.unit"
                  :name="`templateRuleUnit${index}`"
                  :disabled="pending"
                ><option value="item">每商品</option><option value="lb">Lb</option></select></label>
              </div>
              <div
                v-else
                class="v2-template-band-wrap"
              >
                <table class="v2-template-table">
                  <thead><tr><th>订单金额起点</th><th>订单金额终点</th><th>运费（{{ draft.currency }}）</th></tr></thead><tbody>
                    <tr
                      v-for="(band, bandIndex) in rule.bands"
                      :key="bandIndex"
                    >
                      <td>{{ price(band.from) }}</td><td>
                        <span v-if="bandIndex === rule.bands.length - 1">无上限</span><input
                          v-else
                          v-model.number="band.to"
                          type="number"
                          min="0"
                          step="0.01"
                          :name="`templateBandTo${index}_${bandIndex}`"
                          :aria-label="`规则 ${index + 1} 第 ${bandIndex + 1} 段终点`"
                          :disabled="pending"
                          @change="updateBand(rule, bandIndex)"
                        >
                      </td><td>
                        <input
                          v-model.number="band.fee"
                          type="number"
                          min="0"
                          step="0.01"
                          :name="`templateBandFee${index}_${bandIndex}`"
                          :aria-label="`规则 ${index + 1} 第 ${bandIndex + 1} 段运费`"
                          :disabled="pending"
                        >
                      </td>
                    </tr>
                  </tbody>
                </table><div class="v2-template-inline-actions">
                  <button
                    type="button"
                    class="v2-link"
                    data-action="template-add-band"
                    :disabled="pending"
                    @click="splitBand(rule)"
                  >
                    添加价格分段
                  </button><button
                    type="button"
                    class="v2-link"
                    data-action="template-remove-band"
                    :disabled="pending || rule.bands.length < 2"
                    @click="removeBand(rule)"
                  >
                    移除最后一段
                  </button>
                </div>
              </div>
            </section>
            <div class="v2-template-inline-actions">
              <button
                class="v2-button"
                type="button"
                data-action="template-add-domestic"
                :disabled="pending"
                @click="detail.rules.push(newRule('domestic'))"
              >
                添加国内规则
              </button><button
                class="v2-button"
                type="button"
                data-action="template-add-international"
                :disabled="pending"
                @click="detail.rules.push(newRule('international'))"
              >
                添加国际规则
              </button>
            </div>
            <details class="v2-template-local-settings">
              <summary>本地体验参数（不是已确认的 V2 模板字段）</summary><p>kg、限重、币种切换在已采集模板页中未确认；处理时间属于商品报价。以下仅保留样例配置，不改变商品处理时间，也不代表真实运费校验。</p><div class="v2-template-fields">
                <label>限重单位 <select
                  v-model="draft.unit"
                  name="templateLimitUnit"
                  :disabled="pending"
                ><option>kg</option><option>lb</option></select></label><label>样例限重 <input
                  v-model.number="draft.limit"
                  name="templateLimit"
                  type="number"
                  min="0.01"
                  step="0.01"
                  :disabled="pending"
                ></label><label>样例币种 <select
                  v-model="draft.currency"
                  name="templateCurrency"
                  :disabled="pending"
                ><option>USD</option><option>CNY</option></select></label><label>样例处理时间 <input
                  v-model.number="draft.handling"
                  name="templateHandling"
                  type="number"
                  min="0"
                  :disabled="pending"
                ></label>
              </div>
            </details>
            <footer class="v2-template-form-actions">
              <button
                class="v2-button v2-primary"
                data-action="template-save"
                type="submit"
                :disabled="pending"
              >
                {{ pending ? '保存中…' : '保存' }}
              </button><button
                class="v2-button"
                data-action="template-cancel"
                type="button"
                :disabled="pending"
                @click="mode='view'; countryRule=null"
              >
                取消
              </button>
            </footer>
          </form>
        </template>
        <template v-else-if="mode === 'assign' && selected">
          <h2>分配 SKU · {{ selected.name }}</h2><p class="v2-template-note">
            在管理库存中选择商品并更换报价模板。同一商品的子 SKU 继承模板；不模拟尚未确认的子 SKU 独立绑定。
          </p>
          <form @submit.prevent="execute({ type: 'assign', id: selected.id, productId })">
            <label class="v2-template-name">选择商品 <select
              v-model="productId"
              name="templateProduct"
              :disabled="pending"
            ><option value="">请选择</option><option
              v-for="product in state.products.filter(p=>p.variants.some(v=>!v.deleted))"
              :key="product.id"
              :value="product.id"
            >{{ product.title }}</option></select></label><p data-testid="template-assignment-skus">
              {{ state.products.find(p=>p.id===productId)?.variants.filter(v=>!v.deleted).map(v=>v.sku).join(' · ') || '选择后显示受影响的 SKU' }}
            </p><footer class="v2-template-form-actions">
              <button
                type="submit"
                class="v2-button v2-primary"
                data-action="template-assign-save"
                :disabled="pending || !productId"
              >
                保存商品模板
              </button><button
                type="button"
                class="v2-button"
                data-action="template-cancel"
                :disabled="pending"
                @click="mode='view'"
              >
                取消
              </button>
            </footer>
          </form>
        </template>
        <template v-else-if="mode === 'delete' && selected">
          <h2>删除配送模板</h2><p>确认删除“{{ selected.name }}”？此操作仅影响本机样例。</p><p class="v2-template-note">
            默认模板、仍被商品使用的模板不能删除。这是本地保护，不代表已测得原平台全部限制。
          </p><div class="v2-template-form-actions">
            <button
              class="v2-button"
              data-action="template-delete-confirm"
              :disabled="pending"
              @click="execute({ type: 'delete', id: selected.id })"
            >
              确认删除
            </button><button
              class="v2-button"
              data-action="template-cancel"
              :disabled="pending"
              @click="mode='view'"
            >
              取消
            </button>
          </div>
        </template>
        <template v-else-if="selected && readback">
          <div class="v2-template-detail-heading">
            <div>
              <h2 data-testid="template-detail-name">
                {{ selected.name }}
              </h2><small v-if="data.defaultTemplateId === selected.id">默认配送模板</small>
            </div><div class="v2-template-inline-actions">
              <button
                class="v2-button"
                data-action="template-edit"
                :disabled="pending"
                @click="begin('edit')"
              >
                编辑模板
              </button><button
                class="v2-button"
                data-action="template-assign"
                :disabled="pending"
                @click="begin('assign')"
              >
                分配 SKU
              </button>
            </div>
          </div>
          <div class="v2-template-detail-actions">
            <button
              class="v2-link"
              data-action="template-default"
              :disabled="pending || data.defaultTemplateId === selected.id"
              @click="setDefault"
            >
              设为默认模板
            </button><button
              class="v2-link"
              data-action="template-delete"
              :disabled="pending"
              @click="begin('delete')"
            >
              删除模板
            </button>
          </div>
          <p>运费计算：{{ readback.mode === 'weight' ? '按重量／件数' : '按订单价格分段' }}</p><p class="v2-template-note">
            运输时间不包括处理时间。国家列表为有限本地样例。
          </p>
          <section
            v-for="rule in readback.rules"
            :key="rule.id"
            class="v2-template-rule"
            data-testid="template-rule-readback"
          >
            <header><h3>{{ rule.scope === 'domestic' ? '国内配送' : '国际配送' }} · {{ rule.service }}</h3></header><dl class="v2-template-readback">
              <dt>国家／地区</dt><dd>{{ rule.countries.join('、') }}</dd><dt>运输时间</dt><dd>{{ rule.transit }}</dd><template v-if="readback.mode === 'weight'">
                <dt>每单金额</dt><dd>{{ selected.currency }} {{ price(rule.base) }}</dd><dt>单位价</dt><dd>{{ selected.currency }} {{ price(rule.perUnit) }} / {{ rule.unit === 'lb' ? 'Lb' : '每商品' }}</dd>
              </template>
            </dl><table
              v-if="readback.mode === 'price'"
              class="v2-template-table"
            >
              <thead><tr><th>订单价格范围</th><th>运费</th></tr></thead><tbody>
                <tr
                  v-for="(band,i) in rule.bands"
                  :key="i"
                >
                  <td>{{ price(band.from) }} – {{ band.to === null ? '无上限' : price(band.to) }}</td><td>{{ selected.currency }} {{ price(band.fee) }}</td>
                </tr>
              </tbody>
            </table>
          </section>
          <section class="v2-template-bindings">
            <h3>商品与 SKU 回读</h3><p v-if="!bindings.length">
              尚无商品使用此模板。
            </p><div
              v-for="product in bindings"
              :key="product.id"
              data-testid="template-binding-readback"
            >
              <strong>{{ product.title }}</strong><p>{{ product.variants.filter(v=>!v.deleted).map(v=>v.sku).join(' · ') }}</p><small>商品处理时间：{{ product.offer.handlingTime }}（商品报价字段，与运输时间独立）</small>
            </div>
          </section>
        </template>
        <p
          v-else
          class="v2-empty"
          data-testid="template-missing"
        >
          {{ selectedId ? '该配送模板已不存在，请从列表重新选择或创建新模板。' : '请选择或创建配送模板。' }}
        </p>
      </main>
    </div>
    <div
      v-if="countryRule !== null"
      class="v2-template-country-shade"
      @keydown.esc.stop="countryRule=null"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-country-title"
        class="v2-template-country-dialog"
      >
        <header>
          <h2 id="template-country-title">
            选择国际配送国家
          </h2><button
            type="button"
            class="v2-link"
            data-action="template-country-cancel"
            aria-label="关闭国家选择"
            @click="countryRule=null"
          >
            关闭
          </button>
        </header><p>当前提供 {{ TEMPLATE_COUNTRIES.length }} 个本地国家样例。</p><div class="v2-template-country-options">
          <label
            v-for="country in TEMPLATE_COUNTRIES"
            :key="country"
          ><input
            v-model="countrySelection"
            type="checkbox"
            name="templateCountries"
            :value="country"
          >{{ country }}</label>
        </div><footer>
          <button
            type="button"
            class="v2-button v2-primary"
            data-action="template-country-confirm"
            :disabled="!countrySelection.length"
            @click="confirmCountries"
          >
            确定
          </button><button
            type="button"
            class="v2-button"
            data-action="template-country-cancel"
            @click="countryRule=null"
          >
            取消
          </button>
        </footer>
      </section>
    </div>
  </section>
</template>
