<template>
  <div class="target-reviews-page">
    <PageHeader
      eyebrow="产品与系统"
      title="平台入口审核"
      description="核对平台入口、页面证据与适配能力；审核不会发布安装包，也不会直接执行平台业务。"
    >
      <template #actions>
        <router-link class="secondary-link" to="/admin/updates">应用更新</router-link>
      </template>
    </PageHeader>

    <section class="review-guide" aria-label="平台入口审核说明">
      <article><strong>审核入口</strong><p>只读取真实审核服务返回的申请，不在页面生成待审核数量。</p></article>
      <article><strong>审核边界</strong><p>批准仅保存签名配置；客户端仍会重新预检版本、授权和业务上下文。</p></article>
      <article><strong>服务不可用</strong><p>服务端未启用或账号无权限时会显示明确提示，请不要重复提交。</p></article>
    </section>

    <TargetReviewPanel :open-by-default="true" />
  </div>
</template>

<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue'
import TargetReviewPanel from '@/features/targets/TargetReviewPanel.vue'
</script>

<style scoped>
.target-reviews-page { display: grid; gap: 18px; }
.review-guide { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.review-guide article { min-height: 98px; padding: 17px; border: 1px solid var(--color-border); border-radius: 14px; background: var(--color-surface); }
.review-guide strong { color: var(--color-text); font-size: var(--type-control); }
.review-guide p { margin: 7px 0 0; color: var(--color-text-secondary); font-size: var(--type-meta); line-height: 1.6; }
.secondary-link { display: inline-flex; align-items: center; justify-content: center; min-height: 36px; padding: 0 13px; border: 1px solid var(--color-border); border-radius: 8px; color: var(--color-text); background: var(--color-surface); font-size: var(--type-control); font-weight: 700; text-decoration: none; }
.secondary-link:hover { border-color: var(--color-primary-muted); color: var(--color-primary); }
@media (max-width: 900px) { .review-guide { grid-template-columns: 1fr; } .review-guide article { min-height: auto; } }
</style>
