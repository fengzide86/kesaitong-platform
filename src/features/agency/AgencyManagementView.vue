<template>
  <div class="agency-management">
    <PageHeader
      :title="section === 'requests' ? '代理售后' : section === 'commission' ? '代理返佣' : '代理与交付'"
      :description="section === 'requests' ? '在同一详情核对客户与关联订单，查看问题并完成回复。' : section === 'commission' ? '核对代理佣金与结算记录，保留实际确认凭据。' : '管理代理归属，核对收款，发放授权，跟进客户交付。'"
    >
      <template v-if="section !== 'requests' && section !== 'commission'" #actions>
        <el-button @click="router.push('/admin/staff-accounts')">
          关联代理账号
        </el-button>
      </template>
    </PageHeader>
    <el-alert
      title="负责人视角：可查看全部代理业务；代理账号仅能访问本代理的数据。内部运营、客服账号保持原有权限。"
      type="info"
      :closable="false"
      show-icon
      class="owner-notice"
    />
    <nav
      v-if="section !== 'requests' && section !== 'commission'"
      class="owner-tabs"
      aria-label="代理管理分区"
    >
      <button
        v-for="(label, key) in deliverySections"
        :key="key"
        type="button"
        :class="{ active: section === key }"
        :aria-pressed="section === key"
        @click="selectSection(key)"
      >
        {{ label }}
      </button>
    </nav>
    <AgencyCommissionPanel v-if="section === 'commission'" />
    <AgencyRecordsView v-else :key="section" :section="section" owner />
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageHeader from '@/components/PageHeader.vue'
import AgencyRecordsView from './AgencyRecordsView.vue'
import AgencyCommissionPanel from './AgencyCommissionPanel.vue'
import { sectionLabels, type Section } from './model'
const router = useRouter()
const route = useRoute()
const deliverySections = { agencies: sectionLabels.agencies, customers: sectionLabels.customers, orders: sectionLabels.orders, licenses: sectionLabels.licenses }
const section = computed<Section>(() => {
  const value = route.query.section
  return typeof value === 'string' && Object.hasOwn(sectionLabels, value) ? value as Section : 'agencies'
})
function selectSection(value: Section) {
  void router.replace({ path: '/admin/agency', query: { section: value } })
}
</script>
<style scoped>
.agency-management{width:100%;min-width:0;max-width:1400px;margin:auto}.owner-notice{margin-bottom:22px}.owner-tabs{display:flex;gap:8px;margin:0 0 26px;border-bottom:1px solid var(--color-border);overflow-x:auto}.owner-tabs button{white-space:nowrap;padding:13px 16px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--color-text-secondary);font-size:14px;cursor:pointer}.owner-tabs button.active{color:var(--color-primary);border-bottom-color:var(--color-primary);font-weight:700}.owner-tabs button:hover{background:var(--color-primary-soft)}
</style>
