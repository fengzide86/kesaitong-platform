<template>
  <div class="story-scene" :class="{ 'is-paused': paused, 'is-reduced': reduced }" data-testid="brand-hero-art">
    <div class="scene-heading"><span>{{ isTeam ? '整批进展，一处掌握。' : '从准备到反馈，把任务串起来。' }}</span><span class="scene-disclaimer">产品流程示意 · 非实时执行</span></div>
    <div class="scene-columns brand-scene-motion" @animationend.self="$emit('finished')">
      <div class="scene-column">
        <div class="illustration document-illustration" aria-hidden="true">
          <div class="paper paper-back"></div>
          <div class="paper paper-front"><div class="paper-icon"><FileSpreadsheet :size="24" :stroke-width="1.5" /></div><span>{{ isTeam ? '账号导入资料' : '物流模板资料' }}</span><div class="paper-lines"><i></i><i></i><i></i></div><div class="paper-tags"><b>{{ isTeam ? 'Excel' : '配送国家' }}</b><b>{{ isTeam ? 'CSV' : '运费规则' }}</b></div></div>
        </div>
        <div class="scene-caption"><span class="step-dot">1</span><div><h3>{{ isTeam ? '先把账号整理好' : '带上你的任务资料' }}</h3><p>{{ isTeam ? '导入表格，检查字段与问题行。' : '按所选工具准备配送与运费资料。' }}</p></div></div>
      </div>
      <div class="scene-column middle-column">
        <div class="illustration tool-illustration" aria-hidden="true">
          <span class="connection-line connection-left"></span><span class="connection-line connection-right"></span>
          <div class="tool-tile"><BrandMark decorative :size="54" /><span>课赛通 KST</span></div>
          <div class="tool-label"><span class="blue-dot"></span>{{ isTeam ? '专业批量工作台' : '个人效率工具箱' }}</div>
        </div>
        <div class="scene-caption"><span class="step-dot">2</span><div><h3>{{ isTeam ? '在同一处组织批次' : '选用适合的工具' }}</h3><p>{{ isTeam ? '查看整体，找到需要关注的账号。' : '填写模板，或比较物流方案。' }}</p></div></div>
      </div>
      <div class="scene-column">
        <div class="illustration record-illustration" aria-hidden="true">
          <div class="record-sheet"><div class="record-head"><ListChecks :size="19" :stroke-width="1.6" /><span>{{ isTeam ? '批次与账号' : '本次使用' }}</span></div><div v-for="label in (isTeam ? ['批次概览', '账号详情', '执行记录'] : ['任务反馈', '人工确认', '使用记录'])" :key="label" class="record-line"><span class="record-symbol"></span><span>{{ label }}</span><span class="record-rule"></span></div></div>
        </div>
        <div class="scene-caption"><span class="step-dot">3</span><div><h3>{{ isTeam ? '需要处理时，及时接手' : '过程可见，结果可回看' }}</h3><p>{{ isTeam ? '进入详情处理问题，保留批次记录。' : '按反馈确认下一步，保留使用记录。' }}</p></div></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { FileSpreadsheet, ListChecks } from '@lucide/vue'
import BrandMark from '@/components/brand/BrandMark.vue'

const props = defineProps<{ scenario: 'personal' | 'team'; paused: boolean; reduced: boolean }>()
defineEmits<{ finished: [] }>()
const isTeam = computed(() => props.scenario === 'team')
</script>

<style scoped>
.story-scene { position: relative; padding: 30px 36px 34px; border: 1px solid #e1e7f0; border-radius: 24px; background: linear-gradient(145deg, #f9fbff 0%, #f0f5fc 70%, #f8faff 100%); overflow: hidden; }
.scene-heading { display: flex; align-items: center; justify-content: space-between; gap: 20px; color: #44516a; font-size: 14px; }.scene-disclaimer { color: #5b6e88; font-size: 12px; }
.scene-columns { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 46px; animation: scene-arrive 4s cubic-bezier(.2,.7,.2,1) both; }.scene-column { min-width: 0; }.illustration { height: 184px; position: relative; display: flex; justify-content: center; align-items: center; }
.paper { position: absolute; width: 188px; height: 154px; border: 1px solid #dce4ef; border-radius: 10px; background: #fff; }.paper-back { transform: rotate(-7deg) translate(-9px, -2px); background: #eaf0fc; }.paper-front { transform: rotate(3deg); padding: 19px; box-shadow: 0 8px 16px #193a6c06; }.paper-front > span { display: block; position: absolute; left: 52px; top: 24px; color: #3b4961; font-size: 12px; font-weight: 600; }.paper-icon { color: #356bcb; }.paper-lines { display: grid; gap: 8px; margin-top: 17px; }.paper-lines i { height: 4px; border-radius: 3px; background: #e6eaf1; }.paper-lines i:nth-child(2) { width: 85%; }.paper-lines i:nth-child(3) { width: 62%; }.paper-tags { display: flex; gap: 8px; margin-top: 14px; }.paper-tags b { font-size: 9px; font-weight: 500; color: #687891; background: #f0f4fa; padding: 3px 6px; border-radius: 3px; }
.tool-illustration { flex-direction: column; }.tool-tile { display: grid; justify-items: center; gap: 9px; width: 116px; padding: 16px 10px 13px; background: #fff; border: 1px solid #e1e7f1; border-radius: 22px; box-shadow: 0 12px 30px #2e5cab09; z-index: 1; }.tool-tile > span { color: #283752; font-size: 11px; font-weight: 600; }.tool-label { display: flex; align-items: center; gap: 7px; margin-top: 15px; color: #5b6e88; font-size: 11px; }.blue-dot { width: 5px; height: 5px; border-radius: 100%; background: #1565ff; }.connection-line { position: absolute; width: 49%; height: 1px; background: #c6d6f2; top: 92px; }.connection-left { right: calc(50% + 60px); }.connection-right { left: calc(50% + 60px); }.connection-line::after { content: ''; width: 5px; height: 5px; border-top: 1px solid #9cb6dc; border-right: 1px solid #9cb6dc; position: absolute; right: 0; top: -2px; transform: rotate(45deg); }
.record-sheet { width: 212px; min-height: 145px; padding: 17px; border: 1px solid #dce4ef; border-radius: 10px; background: #fff; box-shadow: 0 8px 16px #193a6c06; transform: rotate(-3deg); }.record-head { display: flex; align-items: center; gap: 8px; color: #42536c; font-size: 12px; padding-bottom: 12px; border-bottom: 1px solid #ecf0f6; }.record-line { display: flex; align-items: center; gap: 8px; margin-top: 12px; font-size: 10px; color: #75839b; }.record-symbol { display: block; height: 8px; width: 8px; border: 1px solid #9bb1d1; border-radius: 50%; }.record-rule { width: 85px; height: 4px; background: #e4eaf3; border-radius: 2px; }.record-mini { margin-left: auto; font-size: 9px; color: #8793a6; }
.scene-caption { display: flex; align-items: flex-start; gap: 10px; }.step-dot { display: grid; place-items: center; flex-shrink: 0; height: 21px; width: 21px; border-radius: 50%; border: 1px solid #d6e0ee; font-size: 11px; color: #7a8aa1; margin-top: 2px; }.scene-caption h3 { margin: 0; color: #283954; font-weight: 600; font-size: 15px; line-height: 1.6; }.scene-caption p { margin: 7px 0 0; font-size: 13px; line-height: 1.7; color: #5b6e88; }
.is-paused .brand-scene-motion { animation-play-state: paused; }.is-reduced .brand-scene-motion { animation: none; }
@keyframes scene-arrive { 0% { transform: translateY(14px); opacity: .72; } 30% { opacity: 1; } 100% { transform: translateY(0); opacity: 1; } }
@media (min-width: 901px) { .illustration { height: 166px; }.scene-columns { gap: 52px; }.connection-line { top: 83px; } }
@media (max-width: 900px) { .story-scene { padding: 24px; }.scene-columns { gap: 18px; }.paper { width: 158px; }.paper-front { padding: 15px; }.paper-front > span { left: 46px; top: 22px; font-size: 10px; }.record-sheet { width: 174px; padding: 13px; }.scene-caption { gap: 7px; }.scene-caption h3 { font-size: 13px; }.scene-caption p { font-size: 11px; }.scene-disclaimer { font-size: 10px; } }
@media (max-width: 640px) { .story-scene { padding: 22px 20px; border-radius: 18px; }.scene-heading { display: block; font-size: 13px; }.scene-disclaimer { display: block; margin-top: 7px; font-size: 10px; }.scene-columns { grid-template-columns: 1fr; gap: 0; margin-top: 12px; }.scene-column { display: grid; grid-template-columns: 108px 1fr; align-items: center; gap: 15px; padding: 12px 0; }.scene-column + .scene-column { border-top: 1px solid #e0e7f1; }.illustration { height: 104px; }.paper { width: 86px; height: 80px; border-radius: 5px; }.paper-front { padding: 9px; }.paper-icon svg { width: 15px; height: 15px; }.paper-front > span { display: none; }.paper-lines { gap: 5px; margin-top: 8px; }.paper-lines i { height: 3px; }.paper-tags { display: none; }.tool-tile { width: 76px; border-radius: 15px; padding: 9px; gap: 3px; }.tool-tile :deep(.kst-brand-mark) { width: 35px !important; height: 35px !important; }.tool-tile > span { font-size: 8px; }.tool-label, .connection-line { display: none; }.record-sheet { width: 95px; min-height: 76px; padding: 9px; border-radius: 5px; }.record-head { gap: 4px; font-size: 8px; padding-bottom: 5px; }.record-head svg { width: 12px; height: 12px; }.record-line { gap: 4px; margin-top: 6px; font-size: 7px; }.record-symbol { width: 5px; height: 5px; }.record-rule { width: 35px; height: 3px; }.record-mini { display: none; }.scene-caption { gap: 7px; }.step-dot { height: 17px; width: 17px; font-size: 9px; }.scene-caption h3 { font-size: 13px; }.scene-caption p { font-size: 12px; margin-top: 4px; } }
@media (prefers-reduced-motion: reduce) { .brand-scene-motion { animation: none; } }
/* The mobile illustration is a document symbol, not a tiny application screenshot. */
@media (max-width: 640px) {
  .record-line > span:nth-child(2) { display: none; }
  .record-rule { flex: 1; max-width: 52px; }
  .record-head > span { white-space: nowrap; }
}
</style>
