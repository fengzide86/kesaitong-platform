<template>
  <div class="skeleton-container">
    <!-- 仪表盘骨架 -->
    <div class="skeleton-dashboard" v-if="type === 'dashboard'">
      <div class="skeleton-grid">
        <div class="skeleton-card skeleton-card-large">
          <div class="skeleton-line skeleton-icon"></div>
          <div class="skeleton-line skeleton-title"></div>
          <div class="skeleton-line skeleton-value"></div>
          <div class="skeleton-line skeleton-sub"></div>
        </div>
        <div class="skeleton-card" v-for="i in 3" :key="i">
          <div class="skeleton-line skeleton-icon"></div>
          <div class="skeleton-line skeleton-title"></div>
          <div class="skeleton-line skeleton-value"></div>
        </div>
      </div>
      <div class="skeleton-chart-card">
        <div class="skeleton-line skeleton-title"></div>
        <div class="skeleton-chart"></div>
      </div>
    </div>

    <!-- 表格骨架 -->
    <div class="skeleton-table" v-else-if="type === 'table'">
      <div class="skeleton-table-header">
        <div class="skeleton-line" style="width: 20%"></div>
        <div class="skeleton-line" style="width: 25%"></div>
        <div class="skeleton-line" style="width: 20%"></div>
        <div class="skeleton-line" style="width: 15%"></div>
        <div class="skeleton-line" style="width: 20%"></div>
      </div>
      <div class="skeleton-table-row" v-for="i in 8" :key="i">
        <div class="skeleton-line" style="width: 20%"></div>
        <div class="skeleton-line" style="width: 25%"></div>
        <div class="skeleton-line" style="width: 20%"></div>
        <div class="skeleton-line" style="width: 15%"></div>
        <div class="skeleton-line" style="width: 20%"></div>
      </div>
    </div>

    <!-- 网格骨架 -->
    <div class="skeleton-grid-cards" v-else-if="type === 'grid'">
      <div class="skeleton-grid-item" v-for="i in 6" :key="i">
        <div class="skeleton-line skeleton-icon"></div>
        <div class="skeleton-line skeleton-title"></div>
        <div class="skeleton-line skeleton-sub"></div>
      </div>
    </div>

    <!-- 默认骨架 -->
    <div class="skeleton-default" v-else>
      <div class="skeleton-line skeleton-header"></div>
      <div class="skeleton-line" style="width: 80%"></div>
      <div class="skeleton-line" style="width: 60%"></div>
      <div class="skeleton-line" style="width: 70%"></div>
      <div class="skeleton-line" style="width: 50%"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  type?: 'default' | 'dashboard' | 'table' | 'grid'
}>(), { type: 'default' })
</script>

<style scoped>
.skeleton-container {
  padding: 1.5rem;
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* 通用骨架线条 */
.skeleton-line {
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
  height: 16px;
  margin-bottom: 12px;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.skeleton-icon {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  margin-bottom: 16px;
}

.skeleton-title {
  height: 20px;
  width: 60%;
  margin-bottom: 12px;
}

.skeleton-value {
  height: 32px;
  width: 40%;
  margin-bottom: 8px;
}

.skeleton-sub {
  height: 14px;
  width: 50%;
}

.skeleton-header {
  height: 28px;
  width: 40%;
  margin-bottom: 24px;
}

/* 仪表盘骨架 */
.skeleton-dashboard {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.skeleton-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.skeleton-card {
  background: white;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.skeleton-card-large {
  grid-column: span 2;
}

.skeleton-chart-card {
  background: white;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.skeleton-chart {
  height: 200px;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 8px;
  margin-top: 16px;
}

/* 表格骨架 */
.skeleton-table {
  background: white;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.skeleton-table-header {
  display: flex;
  gap: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid #f0f0f0;
  margin-bottom: 16px;
}

.skeleton-table-header .skeleton-line {
  background: linear-gradient(90deg, #e8e8e8 25%, #d8d8d8 50%, #e8e8e8 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  height: 14px;
  margin-bottom: 0;
}

.skeleton-table-row {
  display: flex;
  gap: 16px;
  padding: 12px 0;
  border-bottom: 1px solid #f8f8f8;
}

.skeleton-table-row:last-child {
  border-bottom: none;
}

/* 网格骨架 */
.skeleton-grid-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.skeleton-grid-item {
  background: white;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

/* 默认骨架 */
.skeleton-default {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

/* 响应式 */
@media (max-width: 768px) {
  .skeleton-container {
    padding: 1rem;
  }

  .skeleton-grid {
    grid-template-columns: 1fr;
  }

  .skeleton-card-large {
    grid-column: span 1;
  }

  .skeleton-table-header,
  .skeleton-table-row {
    flex-wrap: wrap;
  }
}
@media (prefers-reduced-motion: reduce) {
  .skeleton-container, .skeleton-container * { animation: none; transition: none; }
}
</style>
