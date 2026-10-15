<template>
  <section>
    <div class="intro">
      <div><span class="eyebrow">客户到交付</span><h1>每一笔交付，都有迹可循。</h1><p>跟进自己的客户，提交订单，确认授权已送达。</p></div><el-button
        :loading="loading"
        @click="load"
      >
        刷新概览
      </el-button>
    </div>
    <el-alert
      v-if="error"
      :title="error"
      type="error"
      :closable="false"
      show-icon
      class="error"
    />
    <div
      v-loading="loading"
      class="metrics"
    >
      <router-link
        v-for="metric in metrics"
        :key="metric.key"
        :to="metric.to"
      >
        <span>{{ metric.label }}</span><strong>{{ summary ? summary[metric.key] : '—' }}</strong><small>{{ metric.note }} <ArrowUpRight :size="14" /></small>
      </router-link>
    </div>
    <section class="journey">
      <h2>从客户到授权的交付顺序</h2><ol>
        <li>
          <span>01</span><h3>登记客户</h3><p>留下客户名称、联系方式及服务备注，建立业务归属。</p><router-link to="/agent/customers">
            查看我的客户 →
          </router-link>
        </li><li>
          <span>02</span><h3>提交订单</h3><p>选择有效套餐，提交给平台负责人核对收款。</p><router-link to="/agent/orders">
            查看我的订单 →
          </router-link>
        </li><li>
          <span>03</span><h3>发送授权</h3><p>平台确认并发放后，复制授权码给客户，跟进激活。</p><router-link to="/agent/licenses">
            查看我的授权 →
          </router-link>
        </li>
      </ol>
    </section>
    <p class="boundary">
      退款、延期等特殊处理通过售后申请交由平台确认；提交申请不会直接改变授权或资金。
    </p>
  </section>
</template>
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { ArrowUpRight } from '@lucide/vue'
import { agencyApi } from './api'
import type { AgencySummary } from './model'
const summary = ref<AgencySummary | null>(null)
const loading = ref(false)
const error = ref('')
let revision = 0
const metrics: { key: keyof AgencySummary; label: string; note: string; to: string }[] = [
  { key: 'customers', label: '我的客户', note: '客户档案', to: '/agent/customers' },
  { key: 'pending_orders', label: '待确认订单', note: '等待平台确认收款', to: '/agent/orders?status=pending' },
  { key: 'delivered_orders', label: '已交付订单', note: '授权已生成', to: '/agent/orders?status=delivered' },
  { key: 'open_requests', label: '处理中售后', note: '跟进平台回复', to: '/agent/requests?status=open' },
]
async function load(): Promise<void> {
  const current = ++revision
  loading.value = true; error.value = ''
  try { const data = await agencyApi.summary(); if (current === revision) summary.value = data }
  catch (cause) { if (current === revision) error.value = cause instanceof Error ? cause.message : '概览暂时无法加载，请重试' }
  finally { if (current === revision) loading.value = false }
}
onMounted(load)
onUnmounted(() => { revision++ })
</script>
<style scoped>
.intro{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:30px}.eyebrow{font-size:10px;letter-spacing:.13em;color:var(--color-primary);font-weight:700}h1{font-size:clamp(23px,2.6vw,32px);letter-spacing:-.04em;margin:12px 0}p{color:var(--color-text-secondary);line-height:1.8;font-size:14px}.intro p{margin:0}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.metrics>a{display:grid;gap:17px;padding:24px;border:1px solid var(--color-border);border-radius:14px;background:var(--color-surface);text-decoration:none;transition:border-color .15s,transform .15s;color:var(--color-text)}.metrics>a:hover{border-color:var(--color-primary);transform:translateY(-2px)}.metrics span{font-size:13px;color:var(--color-text-secondary)}.metrics strong{font-size:36px;font-weight:650;font-variant-numeric:tabular-nums}.metrics small{font-size:11px;display:flex;justify-content:space-between;gap:8px;color:var(--color-text-tertiary)}.journey{margin-top:28px;border:1px solid var(--color-border);background:var(--color-surface);border-radius:16px;padding:28px}.journey h2{margin:0 0 28px;font-size:17px}.journey ol{margin:0;padding:0;list-style:none;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:28px}.journey li>span{font-size:11px;font-weight:700;color:var(--color-primary);letter-spacing:.1em}.journey h3{font-size:16px;margin:12px 0}.journey p{font-size:13px;min-height:47px}.journey a{font-size:13px;color:var(--color-primary);text-decoration:none;font-weight:600}.boundary{padding:8px 0;font-size:12px;color:var(--color-text-tertiary)}.error{margin-bottom:20px}@media(max-width:1000px){.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.intro{align-items:flex-start}.intro .el-button{margin-top:20px}.journey ol{grid-template-columns:1fr}.metrics{gap:10px}.metrics>a{padding:18px}.journey{padding:22px}}@media(prefers-reduced-motion:reduce){.metrics>a{transition:none;transform:none!important}}
</style>
