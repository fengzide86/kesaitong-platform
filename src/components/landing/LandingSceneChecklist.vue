<script setup lang="ts">
import { computed } from 'vue'

type SceneId = 'course' | 'competition'

const props = defineProps<{ scene: SceneId }>()

const sceneContent = {
  course: {
    label: '课程实训',
    title: '先确认重复部分，再把时间留给理解规则。',
    summary: '适合正在完成课程任务、需要反复处理相似页面的学生。',
    pain: ['相似任务反复出现，每次都从空白开始。', '商品、物流、广告和发货页面来回切换。', '遇到登录验证或异常时，不确定该继续还是接手。'],
    support: ['按任务选择工具并查看开放范围。', '处理可重复的页面操作和批次步骤。', '把执行状态与结果回读放在同一条任务线上。'],
    human: ['理解课程规则和输入要求。', '完成登录、验证码、二次验证。', '提交前检查实际页面和最终结果。'],
    statuses: ['交互演示', '桌面端执行', '受控验证'],
  },
  competition: {
    label: '比赛备赛',
    title: '先把前置条件接起来，再安排备赛节奏。',
    summary: '适合需要在有限时间内反复练习商品、物流、FBA、广告和发货链路的参赛学生。',
    pain: ['重复操作挤占真正的备赛时间。', '商品、变体、物流、FBA、广告和发货互相依赖。', '平台提示完成，不代表比赛结果已经完成。'],
    support: ['按任务链拆开准备和执行顺序。', '记录页面要求、资料检查维度和待确认项。', '通过列表或详情回读确认真实状态。'],
    human: ['判断当届规则和评分相关要求。', '处理账号验证、异常和最终提交。', '不把工具状态当作分数或比赛结果。'],
    statuses: ['桌面端执行', '受控验证', '脚本开发中'],
  },
} as const

const content = computed(() => sceneContent[props.scene])
</script>

<!-- eslint-disable vue/max-attributes-per-line, vue/singleline-html-element-content-newline, vue/multiline-html-element-content-newline, vue/html-self-closing -->
<template>
  <section id="fit-checklist" class="scene-checklist" data-testid="fit-checklist" aria-labelledby="fit-checklist-title">
    <div class="scene-checklist-heading">
      <div>
        <p class="eyebrow">适用场景清单</p>
        <span class="scene-checklist-scene">{{ content.label }}</span>
        <h3 id="fit-checklist-title">{{ content.title }}</h3>
      </div>
      <p>{{ content.summary }}</p>
    </div>
    <div class="scene-checklist-grid">
      <article>
        <span class="checklist-label">你现在可能遇到</span>
        <ul>
          <li v-for="item in content.pain" :key="item">{{ item }}</li>
        </ul>
      </article>
      <article>
        <span class="checklist-label">课赛通可以处理</span>
        <ul>
          <li v-for="item in content.support" :key="item">{{ item }}</li>
        </ul>
      </article>
      <article>
        <span class="checklist-label">仍需要人确认</span>
        <ul>
          <li v-for="item in content.human" :key="item">{{ item }}</li>
        </ul>
      </article>
    </div>
    <div class="scene-checklist-footer">
      <div class="scene-statuses" aria-label="当前能力状态">
        <span v-for="status in content.statuses" :key="status" class="status-badge">{{ status }}</span>
      </div>
      <div class="scene-checklist-actions">
        <a href="#task-chain">查看任务链 <span aria-hidden="true">→</span></a>
        <a href="#workflow">查看授权与能力边界 <span aria-hidden="true">→</span></a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.scene-checklist { margin-top:28px; padding:30px; border:1px solid #dce6f4; border-radius:17px; background:#fff; }
.scene-checklist-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:35px; }
.scene-checklist-scene { display:inline-block; margin-top:8px; color:#4c77b9; font-size:11px; font-weight:600; }.scene-checklist-heading h3 { margin-top:6px; font-size:22px; line-height:1.5; letter-spacing:-.025em; }
.scene-checklist-heading > p { max-width:28em; color:var(--muted); font-size:13px; line-height:1.85; }
.scene-checklist-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-top:25px; }
.scene-checklist-grid article { min-height:175px; padding:18px; border:1px solid #e5ebf4; border-radius:12px; background:#fbfcfe; }
.checklist-label { color:#4b6f9f; font-size:11px; font-weight:600; }
.scene-checklist-grid ul { display:grid; gap:10px; margin:14px 0 0; padding:0; list-style:none; }
.scene-checklist-grid li { position:relative; padding-left:14px; color:var(--muted); font-size:12px; line-height:1.75; }
.scene-checklist-grid li::before { position:absolute; top:.7em; left:0; width:5px; height:5px; border-radius:50%; background:#8eabd2; content:''; }
.scene-checklist-footer { display:flex; align-items:center; justify-content:space-between; gap:20px; margin-top:23px; padding-top:18px; border-top:1px solid #e7edf5; }
.scene-statuses { display:flex; flex-wrap:wrap; gap:7px; }
.status-badge { padding:5px 9px; border:1px solid #dbe6f5; border-radius:20px; color:#6580a5; background:#f8fbff; font-size:10px; }
.scene-checklist-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:16px; }
.scene-checklist-actions a { color:#3267b5; font-size:11px; }
.scene-checklist-actions a span { margin-left:4px; }
@media (max-width:900px) { .scene-checklist-heading { display:block; }.scene-checklist-heading > p { margin-top:12px; }.scene-checklist-grid { grid-template-columns:1fr; }.scene-checklist-grid article { min-height:0; }.scene-checklist-footer { align-items:flex-start; flex-direction:column; }.scene-checklist-actions { justify-content:flex-start; } }
@media (max-width:640px) { .scene-checklist { margin-top:22px; padding:20px 17px; border-radius:14px; }.scene-checklist-heading h3 { font-size:20px; }.scene-checklist-heading > p { font-size:12px; }.scene-checklist-grid { margin-top:19px; }.scene-checklist-grid article { padding:15px; }.scene-checklist-grid li { font-size:11px; }.scene-checklist-footer { gap:16px; }.scene-checklist-actions { display:grid; gap:10px; } }
</style>
