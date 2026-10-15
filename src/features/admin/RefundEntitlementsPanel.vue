<template>
  <section class="panel" aria-labelledby="refund-rights-title">
    <h2 id="refund-rights-title">退款后的剩余权益</h2>
    <p class="hint">部分退款后，逐项确认保留的工具及服务次数。不改购买快照，不清除退款记录；再次退款需要重新核对。分成调整仍在成员台账单独处理。</p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="message" role="status" class="notice">{{ message }}</p>
    <form @submit.prevent="loadReview">
      <div class="actions">
        <label>部分退款订单
          <select v-model.number="orderId" required @change="clearReview">
            <option :value="0" disabled>选择订单</option>
            <option v-for="order in orders.filter(o => o.status === 'paid' && Number(o.refund_amount) > 0)" :key="order.id" :value="order.id">#{{ order.id }} · {{ order.commercial.definition.name }}</option>
          </select>
        </label>
        <button :disabled="busy || !orderId">读取最新权益与退款</button>
      </div>
    </form>
    <form v-if="review && selectedOrder" @submit.prevent="save">
      <fieldset :disabled="busy" style="border:0;padding:0">
        <p>累计退款 ¥{{ review.refund_amount }} · {{ review.current ? '已核对当前退款' : '待核对' }} · 版本 {{ review.revision }}</p>
        <h3>明确选择保留的工具</h3>
        <div class="fields">
          <label v-for="capability in selectedOrder.commercial.definition.allowed_capabilities" :key="capability" class="check">
            <input v-model="retained" type="checkbox" :value="capability">{{ capability }}
          </label>
        </div>
        <p v-if="!selectedOrder.commercial.definition.allowed_capabilities.length" class="hint">该订单没有工具权益。</p>
        <h3 v-if="services.length">逐项填写保留的服务总次数</h3>
        <p v-if="services.length" class="hint">总次数包含已经完成的部分。不得低于已完成次数，也不得超过原购买次数；未填不能保存。</p>
        <div class="fields">
          <label v-for="service in services" :key="service.id">{{ service.service_code }} · 已完成 {{ service.completed_count }} / 原购 {{ service.total_count }}
            <input v-model="limits[service.service_code]" type="number" :min="service.completed_count" :max="service.total_count" step="1" required>
          </label>
          <label>核对凭证编号<input v-model="evidence" required maxlength="250"></label>
        </div>
        <div class="actions"><button class="primary">确认保留范围</button><button type="button" @click="clearReview">取消</button></div>
      </fieldset>
    </form>
  </section>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { api } from '@/utils/api'
import { confirmAction } from '@/shared/ui/confirm'
import { commercialApi, type CommercialOrder, type Fulfillment } from './commercial'
import { useFrameworkTask } from './useFrameworkTask'

defineProps<{ orders: CommercialOrder[] }>()
const emit = defineEmits<{ changed: [] }>()
interface Review { order_id: number; refund_amount: string; revision: number; current: boolean; retained_capabilities: string[]; service_limits: Record<string, number>; evidence_ref: string | null }
const { busy, error, message, run } = useFrameworkTask()
const orderId = ref(0), selectedOrder = ref<CommercialOrder | null>(null), review = ref<Review | null>(null)
const services = ref<Fulfillment[]>([]), retained = ref<string[]>([]), limits = ref<Record<string, string | number>>({}), evidence = ref('')
function clearReview() { selectedOrder.value = null; review.value = null; retained.value = []; limits.value = {}; evidence.value = '' }
async function loadReview() {
  clearReview()
  await run(async () => {
    const id = orderId.value
    const [order, current, items] = await Promise.all([
      api.get<CommercialOrder>(`/api/commercial/orders/${id}`, {}, { cache: false }),
      api.get<Review>(`/api/commercial/orders/${id}/refund-entitlements`, {}, { cache: false }),
      commercialApi.fulfillments(id),
    ])
    if (id !== orderId.value) return
    selectedOrder.value = order; review.value = current; services.value = items
    // Do not silently restore all purchased rights after a refund.
    retained.value = current.current ? [...current.retained_capabilities] : []
    limits.value = Object.fromEntries(items.map(item => [item.service_code, current.current ? String(current.service_limits[item.service_code]) : '']))
  })
}
async function save() {
  await run(async () => {
    const current = review.value
    if (!current || !selectedOrder.value) return
    const serviceLimits: Record<string, number> = {}
    for (const service of services.value) {
      const raw = String(limits.value[service.service_code] ?? '').trim()
      const value = Number(raw)
      if (!raw || !Number.isInteger(value) || value < service.completed_count || value > service.total_count) throw new Error('请逐项填写合法的服务总次数')
      serviceLimits[service.service_code] = value
    }
    if (!await confirmAction({ title: '确认退款后保留权益', message: `订单 #${current.order_id}，保留 ${retained.value.length} 项工具及本页填写的服务总次数。此操作不调整团队分成，也不发起转账。确认？` })) return false
    await api.post(`/api/commercial/orders/${current.order_id}/refund-entitlements`, {
      expected_revision: current.revision, expected_refunded_total: current.refund_amount,
      retained_capabilities: [...retained.value], service_limits: serviceLimits, evidence_ref: evidence.value,
    })
    clearReview(); emit('changed')
  }, '退款后的权益范围已记录')
}
</script>
