<template>
  <div class="target-reviews-page">
    <PageHeader
      eyebrow="产品与系统"
      title="平台入口审核"
      description="查看申请网址，确认并记录入口审核结果。"
    />
    <TargetReviewPanel standalone :profile-id="typeof route.query.profile_id === 'string' ? route.query.profile_id : ''" />
  </div>
</template>

<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue'
import TargetReviewPanel from '@/features/targets/TargetReviewPanel.vue'
import { useRoute } from 'vue-router'
const route = useRoute()
</script>

<style scoped>
.target-reviews-page { display: grid; gap: 18px; }
</style>
