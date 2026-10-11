<template>
  <section class="customer-journey" aria-label="客户关联业务">
    <h3>这位客户的业务</h3>
    <p class="journey-note">按客户档案编号关联订单、授权和售后，不与同名软件用户合并。</p>
    <el-alert v-if="error" type="error" :title="error" :closable="false" />
    <el-button v-if="error" size="small" @click="load">重试关联查询</el-button>
    <p v-if="loading" role="status">正在查询关联记录…</p>
    <div v-else-if="!error" class="journey-groups">
      <section v-for="group in groups" :key="group.section" class="journey-group">
        <header><strong>{{ group.label }}</strong><el-button link type="primary" @click="$emit('browse', group.section)">查看全部 {{ group.total }} 条</el-button></header>
        <ul v-if="group.items.length"><li v-for="item in group.items" :key="item.id"><button type="button" @click="$emit('open', group.section, item.id)"><span>{{ item.label }}</span><small>{{ item.state }}</small></button></li></ul>
        <p v-else>暂无关联{{ group.label }}</p>
      </section>
    </div>
    <el-button type="primary" data-testid="customer-create-order" @click="$emit('createOrder')">为此客户提交订单</el-button>
  </section>
</template>
<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { agencyApi } from './api'
import { statusLabel, requestKindLabel, licenseActivationLabel, type Customer } from './model'
type RelatedSection = 'orders' | 'licenses' | 'requests'
type Group = { section: RelatedSection; label: string; total: number; items: { id: number; label: string; state: string }[] }
const props = defineProps<{ customer: Customer }>()
defineEmits<{ browse: [section: RelatedSection]; open: [section: RelatedSection, id: number]; createOrder: [] }>()
const loading = ref(false), error = ref(''), groups = ref<Group[]>([])
let generation = 0
async function load() {
  const current = ++generation
  loading.value = true; error.value = ''; groups.value = []
  try {
    const params = { customer_id: props.customer.id, page: 1, page_size: 3 }
    const [orders, licenses, requests] = await Promise.all([agencyApi.orders(params), agencyApi.licenses(params), agencyApi.requests(params)])
    if (current !== generation) return
    groups.value = [
      { section: 'orders', label: '订单', total: orders.total, items: orders.data.map(item => ({ id: item.id, label: item.order_no, state: statusLabel(item.status) })) },
      { section: 'licenses', label: '授权', total: licenses.total, items: licenses.data.map(item => ({ id: item.id, label: item.plan_name, state: licenseActivationLabel(item) })) },
      { section: 'requests', label: '售后', total: requests.total, items: requests.data.map(item => ({ id: item.id, label: requestKindLabel(item.kind), state: statusLabel(item.status) })) },
    ]
  } catch (cause) { if (current === generation) error.value = cause instanceof Error ? cause.message : '关联记录暂时无法读取' }
  finally { if (current === generation) loading.value = false }
}
watch(() => props.customer.id, load, { immediate: true })
onUnmounted(() => { generation++ })
</script>
<style scoped>
.customer-journey{border-top:1px solid var(--color-border);padding-top:20px;margin-top:24px}.customer-journey h3{font-size:16px;margin:0 0 8px}.journey-note,.journey-group p{font-size:12px;color:var(--color-text-secondary);line-height:1.75}.journey-groups{display:grid;gap:12px;margin:18px 0}.journey-group{border:1px solid var(--color-border);padding:12px 14px;border-radius:10px;min-width:0}.journey-group header{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}.journey-group strong{font-size:13px}.journey-group ul{list-style:none;padding:0;margin:8px 0 0}.journey-group li+li{border-top:1px solid var(--color-border)}.journey-group li button{display:flex;width:100%;gap:12px;justify-content:space-between;align-items:center;border:0;background:transparent;cursor:pointer;color:var(--color-primary);padding:10px 0;text-align:left}.journey-group li span{overflow-wrap:anywhere;min-width:0}.journey-group small{color:var(--color-text-secondary);flex-shrink:0}.journey-group button:hover span{text-decoration:underline}
</style>
