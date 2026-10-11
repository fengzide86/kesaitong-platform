<script setup lang="ts">
import { ref, watch } from 'vue'
import { evaluateSampleShipping, SAMPLE_SHIPPING_RATE_VERSION, type SampleCarrier, type SampleShippingCandidate, type SampleShippingDimensions, type SampleShippingQuote } from './shipping-demo'

const props = defineProps<{ country: string; weightKg: number; dimensions?: SampleShippingDimensions; quantity?: number }>()
const emit = defineEmits<{ quoted: [quotes: SampleShippingQuote[]]; selected: [carrier: SampleCarrier] }>()
const countryInput = ref(props.country)
const weightInput = ref<string | number>(props.weightKg || '')
const lengthInput = ref<string | number>(props.dimensions?.lengthCm ?? 0)
const widthInput = ref<string | number>(props.dimensions?.widthCm ?? 0)
const heightInput = ref<string | number>(props.dimensions?.heightCm ?? 0)
const candidates = ref<SampleShippingCandidate[]>([])
const quotes = ref<SampleShippingQuote[]>([])
const selectedCarrier = ref<SampleCarrier>()
const error = ref('')
const calculated = ref(false)
const volumeWeight = ref(0)
const warnings = ref<string[]>([])

function clearResult() {
  candidates.value = []; quotes.value = []; selectedCarrier.value = undefined
  error.value = ''; calculated.value = false; volumeWeight.value = 0; warnings.value = []
  emit('quoted', [])
}
watch([countryInput, weightInput, lengthInput, widthInput, heightInput], clearResult, { flush: 'sync' })
watch(() => [props.country, props.weightKg, props.dimensions?.lengthCm, props.dimensions?.widthCm, props.dimensions?.heightCm], () => {
  countryInput.value = props.country; weightInput.value = props.weightKg || ''
  lengthInput.value = props.dimensions?.lengthCm ?? 0; widthInput.value = props.dimensions?.widthCm ?? 0; heightInput.value = props.dimensions?.heightCm ?? 0
  clearResult()
})

function calculate() {
  clearResult()
  try {
    const evaluation = evaluateSampleShipping(countryInput.value, Number(weightInput.value), {
      lengthCm: Number(lengthInput.value), widthCm: Number(widthInput.value), heightCm: Number(heightInput.value),
    })
    candidates.value = evaluation.candidates; quotes.value = evaluation.quotes
    warnings.value = evaluation.warnings
    volumeWeight.value = evaluation.dimensionalWeightKg; calculated.value = true
    emit('quoted', [...evaluation.quotes])
    if (!quotes.value.length) error.value = '没有可用样例渠道，请核对目的国、实际重量和限重。不会继续发货。'
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '尺寸输入不合法，未生成报价。'
  }
}
function selectCarrier(carrier: SampleCarrier) {
  if (!quotes.value.some(quote => quote.carrier === carrier)) return
  selectedCarrier.value = carrier; emit('selected', carrier)
}
const money = (value: number) => value.toFixed(2)
const kg = (value: number) => Number(value.toFixed(4)).toString()
</script>

<template>
  <section
    class="v2-shipping-calculation"
    aria-label="样例运费计算"
  >
    <header><h2>运费计算与渠道选择</h2><span>虚构费率 · {{ SAMPLE_SHIPPING_RATE_VERSION }} · CNY</span></header>
    <p class="v2-quote-explanation">
      核对目的国、实重和尺寸，再选择样例渠道。
    </p>
    <p
      v-if="quantity && quantity > 1"
      class="v2-quote-quantity-note"
    >
      本订单含 {{ quantity }} 件商品。当前为单件重量估算，未确认整包实重与尺寸前，不代表整笔订单的实际运费。
    </p>
    <div class="v2-quote-fields">
      <label>目的国<input
        v-model="countryInput"
        name="quoteCountry"
        placeholder="美国 / 英国"
      ></label>
      <label>实际重量（kg）<input
        v-model="weightInput"
        name="quoteWeight"
        type="number"
        min="0"
        step="any"
      ></label>
      <label>费率版本<input
        :value="SAMPLE_SHIPPING_RATE_VERSION"
        readonly
        aria-label="样例费率版本"
      ></label>
      <label>长（cm）<input
        v-model="lengthInput"
        name="quoteLength"
        type="number"
        min="0"
        step="any"
      ></label>
      <label>宽（cm）<input
        v-model="widthInput"
        name="quoteWidth"
        type="number"
        min="0"
        step="any"
      ></label>
      <label>高（cm）<input
        v-model="heightInput"
        name="quoteHeight"
        type="number"
        min="0"
        step="any"
      ></label>
    </div>
    <div class="v2-quote-actions">
      <button
        type="button"
        class="v2-button"
        data-action="calculate-shipping"
        @click="calculate"
      >
        计算样例运费
      </button><details class="v2-quote-rules">
        <summary>查看计费规则</summary><p>尺寸都为 0 时，UPS 不可用；填写尺寸时必须填全。UPS 按长×宽×高÷5000，与实重取高后向上整公斤；E 邮宝有最低计费重量，中邮和燕文按重量区间。UPS 样例不含燃油附加费。多件需确认整包实重，不自动乘数量；这些虚构费率不代表真实报价或模板向买家收取的运费。</p>
      </details>
    </div>
    <p
      v-if="error"
      class="v2-quote-error"
      role="alert"
    >
      {{ error }}
    </p>
    <div
      data-testid="shipping-quotes"
      class="v2-quote-results"
      aria-live="polite"
    >
      <template v-if="calculated">
        <p class="v2-quote-summary">
          本次目的国：{{ countryInput }} · 实重 {{ kg(Number(weightInput)) }} kg<span v-if="volumeWeight"> · UPS 体积重 {{ kg(volumeWeight) }} kg</span> · {{ quotes.length }} 个可用样例渠道<span v-if="selectedCarrier"> · 已选择 {{ selectedCarrier }}</span>
        </p>
        <p
          v-if="warnings.length"
          class="v2-quote-quantity-note"
          data-testid="shipping-calculation-warnings"
        >
          {{ warnings.join('；') }}
        </p>
        <div class="v2-quote-table-scroll">
          <table>
            <thead><tr><th>承运人</th><th>计费重量</th><th>固定费</th><th>运费</th><th>附加费</th><th>合计 / 不可用原因</th><th>选择</th></tr></thead><tbody>
              <tr
                v-for="candidate in candidates"
                :key="candidate.carrier"
                :class="{ 'is-selected': selectedCarrier === candidate.carrier, 'is-unavailable': !candidate.quote }"
              >
                <td
                  data-label="承运人"
                  class="v2-quote-carrier"
                >
                  {{ candidate.carrier }}<small v-if="quotes[0]?.carrier === candidate.carrier">最低可用样例价</small>
                </td><template v-if="candidate.quote">
                  <td data-label="计费重量">
                    {{ kg(candidate.quote.billableWeightKg) }} kg<small>{{ candidate.carrier === 'UPS' ? '实重与体积重取高，向上整 kg' : candidate.quote.billingMode === 'epacket' ? '实际重量与最低计费重量取高' : '匹配实重阶梯' }}</small>
                  </td><td data-label="固定费">
                    ¥{{ money(candidate.quote.fixedCny) }}
                  </td><td data-label="运费">
                    ¥{{ money(candidate.quote.weightChargeCny) }}<small>{{ candidate.quote.pricingDescription }}</small>
                  </td><td data-label="附加费">
                    ¥{{ money(candidate.quote.surchargeCny) }}
                  </td><td
                    data-label="合计"
                    class="v2-quote-total"
                  >
                    <strong>¥{{ money(candidate.quote.totalCny) }}</strong><small
                      v-for="warning in candidate.quote.warnings"
                      :key="warning"
                    >{{ warning }}</small>
                  </td><td class="v2-quote-choice">
                    <button
                      type="button"
                      class="v2-button"
                      :data-quote-carrier="candidate.carrier"
                      :aria-pressed="selectedCarrier === candidate.carrier"
                      @click="selectCarrier(candidate.carrier)"
                    >
                      {{ selectedCarrier === candidate.carrier ? '已选择' : '选择渠道' }}
                    </button>
                  </td>
                </template><template v-else>
                  <td>—</td><td>—</td><td>—</td><td>—</td><td class="v2-quote-reason">
                    {{ candidate.unavailableReason }}
                  </td><td class="v2-quote-choice">
                    不可用
                  </td>
                </template>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <p
        v-else-if="!error"
        class="v2-quote-empty"
      >
        填写或核对以上数据后计算，再从候选渠道选择承运人。输入改变后，旧报价和旧选择立即失效。
      </p>
    </div>
  </section>
</template>

<style scoped>
.v2-shipping-calculation{margin:20px 0;border:1px solid #c7c7c7;background:#fff;padding:18px 20px;color:#333;font-size:13px}
.v2-shipping-calculation header{display:flex;align-items:baseline;justify-content:space-between;gap:12px;border-bottom:1px solid #ddd;padding-bottom:10px}
.v2-shipping-calculation h2{font-size:18px;margin:0;font-weight:600}.v2-shipping-calculation header>span{font-size:12px;color:#666}
.v2-quote-explanation{color:#666;line-height:1.65;margin:12px 0 16px}.v2-quote-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px 18px;max-width:850px}
.v2-quote-quantity-note{margin:12px 0;padding:8px 10px;background:#faf7ed;border-left:3px solid #b99a55;color:#66552f;line-height:1.6}
.v2-quote-fields label{display:flex;flex-direction:column;gap:6px;font-weight:600}.v2-quote-fields input{width:100%;box-sizing:border-box;min-width:0;border:1px solid #888;border-radius:2px;background:#fff;color:#333;padding:7px 8px;font-size:13px;line-height:1.3}.v2-quote-fields input[readonly]{background:#f3f3f3;color:#666}
.v2-quote-actions{display:flex;align-items:center;gap:14px;margin-top:16px}.v2-quote-actions span{color:#666;font-size:12px;line-height:1.5}.v2-quote-actions button{flex-shrink:0}.v2-quote-error{color:#a22;border-left:3px solid #a22;background:#fbf4f4;padding:10px 12px;margin:14px 0;line-height:1.6}
.v2-quote-rules{font-size:12px;line-height:1.65;color:#666}.v2-quote-rules summary{cursor:pointer;color:#315b87}.v2-quote-rules p{max-width:650px;margin:8px 0}
.v2-quote-summary{margin:16px 0 10px;font-size:13px;line-height:1.6}.v2-quote-table-scroll{overflow-x:auto}.v2-quote-results table{border-collapse:collapse;width:100%;min-width:700px;font-size:13px}.v2-quote-results th,.v2-quote-results td{border:1px solid #ccc;text-align:left;padding:9px 10px;vertical-align:middle}.v2-quote-results th{background:#efefef;font-weight:600}.v2-quote-results td small{display:block;color:#666;font-size:11px;line-height:1.6;margin-top:3px}.v2-quote-results .is-selected{background:#f4f7f1}.v2-quote-results .is-unavailable{color:#777;background:#fafafa}.v2-quote-empty{color:#777;line-height:1.6;margin:16px 0 0}
@media(max-width:700px){.v2-shipping-calculation{padding:14px 12px}.v2-shipping-calculation header{flex-direction:column;gap:5px}.v2-quote-fields{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.v2-quote-actions{align-items:flex-start;flex-direction:column;gap:8px}.v2-shipping-calculation h2{font-size:17px}}
@media(max-width:700px){.v2-quote-results table,.v2-quote-results tbody{display:block;min-width:0;width:100%}.v2-quote-results thead{display:none}.v2-quote-results tr{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border:1px solid #d4dce5;border-radius:6px;margin:10px 0;overflow:hidden}.v2-quote-results td{order:1;display:block;border:0;padding:9px 11px;overflow-wrap:anywhere}.v2-quote-results td[data-label]::before{content:attr(data-label);display:block;margin-bottom:4px;color:#718096;font-size:11px}.v2-quote-results .v2-quote-carrier,.v2-quote-results .v2-quote-total{order:0;background:#f4f6f9;font-weight:600}.v2-quote-results .v2-quote-total{text-align:right}.v2-quote-results .v2-quote-total strong{font-size:18px;color:#204f89}.v2-quote-results .v2-quote-choice{order:2;grid-column:1/-1;border-top:1px solid #e0e5eb}.v2-quote-choice button{width:100%;min-height:38px}.v2-quote-results .is-unavailable td:not(.v2-quote-carrier):not(.v2-quote-reason):not(.v2-quote-choice){display:none}.v2-quote-results .v2-quote-reason{grid-column:1/-1}.v2-quote-results .is-unavailable .v2-quote-carrier{grid-column:1/-1}}
</style>
