<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import { ArrowRight, Check, Copy, UsersRound } from '@lucide/vue'
import MarketingDownloadAction from '@/components/landing/MarketingDownloadAction.vue'
import { marketingTasks, statusLabels, taskGroups } from '@/marketing/task-catalog'

const contactWechat = 'Moweiiong'
const copyState = ref<'idle' | 'copied' | 'manual'>('idle')
const copyingWechat = ref(false)

async function copyWechat() {
  if (copyingWechat.value) return
  copyingWechat.value = true
  copyState.value = 'idle'
  try {
    await navigator.clipboard.writeText(contactWechat)
    copyState.value = 'copied'
  } catch {
    copyState.value = 'manual'
  } finally {
    copyingWechat.value = false
  }
}

function selectWechat(event: Event) {
  const input = event.target
  if (input instanceof HTMLInputElement) input.select()
}
</script>

<template>
  <section class="tools-overview" data-testid="marketing-tools-overview" aria-labelledby="tools-overview-title">
    <header class="tools-overview-header">
      <div>
        <p class="tools-eyebrow">课赛通工具箱</p>
        <h1 id="tools-overview-title">先看要完成什么，<br>再选合适的工具。</h1>
        <p>从注册公司、选品到商品、物流、广告和发货，找到你现在要处理的一项。先准备任务资料，再确认可以使用的辅助范围。</p>
        <p class="tools-scene">适用于亚马逊仿真比赛与课程实训；使用前需确认平台与版本。</p>
      </div>
    </header>

    <section class="scoring-journey" aria-labelledby="scoring-journey-title">
      <div class="scoring-journey-heading"><h2 id="scoring-journey-title">基础配置少反复，精力留给你的策略。</h2><p>支持的任务可一键套用已整理的得分配置，具体覆盖按任务确认。</p></div>
      <ol class="scoring-steps">
        <li><span>1</span><div><strong>查看已整理的得分细节</strong><p>了解对应任务中容易遗漏的配置要求。</p></div></li>
        <li><span>2</span><div><strong>对应任务一键配置</strong><p>在支持的工具中套用已整理的配置。</p></div></li>
        <li><span>3</span><div><strong>补充你的策略</strong><p>选品、定价和营销取舍，继续由你判断。</p></div></li>
      </ol>
      <details class="scoring-details"><summary>得分配置的适用边界</summary><p>一键配置指处理已经整理、且当前任务支持的基础配置，不代表八项工具都已开放或覆盖所有得分点。平台规则与版本变化需重新确认，也不保证分数或比赛名次。</p></details>
    </section>

    <div class="tools-groups">
      <section v-for="group in taskGroups" :key="group.id" class="tools-group" :aria-labelledby="`tools-group-${group.id}`">
        <div class="tools-group-heading">
          <h2 :id="`tools-group-${group.id}`">{{ group.title }}</h2>
          <p>{{ group.description }}</p>
        </div>
        <div class="tools-grid">
          <article v-for="task in marketingTasks.filter(item => item.group === group.id)" :id="`tool-${task.id}`" :key="task.id" class="tool-card" :data-task-id="task.id">
            <div class="tool-card-top"><span class="tool-index">{{ String(marketingTasks.indexOf(task) + 1).padStart(2, '0') }}</span><span class="tool-intent">{{ task.intent }}</span></div>
            <div class="tool-card-title"><h3>{{ task.title }}</h3><span class="tool-status" :class="`status-${task.status}`">{{ statusLabels[task.status] }}</span></div>
            <p class="tool-input"><strong>准备什么</strong>{{ task.inputHint }}</p>
            <p class="tool-support"><strong>课赛通辅助</strong>{{ task.support }}</p>
            <details class="tool-details"><summary>得分配置与使用说明</summary><p>{{ task.scoringNote }}</p><p><strong>这一步容易卡在：</strong>{{ task.pain }}</p></details>
          </article>
        </div>
      </section>
    </div>

    <div class="team-note"><UsersRound :size="18" aria-hidden="true" /><div><strong>带队或多人使用</strong><p>先列出团队要完成的任务，再联系我们确认开放工具、席位和设备安排。</p><details class="team-details"><summary>团队使用前还需确认什么</summary><p>批次、异常支持和执行方式需另行确认。团队使用不代表可以无人值守并发执行，各项工具仍以上方状态为准。</p></details></div></div>
    <div id="start" class="tools-boundary"><Check :size="17" aria-hidden="true" /><div>
      <p><strong>申请使用</strong>告诉我们你参加的比赛或课程，以及想处理的任务；先确认可用范围和授权，再下载使用。</p>
      <div class="wechat-contact" data-testid="marketing-wechat-contact">
        <label for="marketing-wechat-account">添加微信</label>
        <div class="wechat-contact-actions"><input id="marketing-wechat-account" :value="contactWechat" aria-label="公开微信号" aria-describedby="wechat-copy-feedback" readonly @focus="selectWechat" @click="selectWechat"><button type="button" :disabled="copyingWechat" @click="copyWechat"><Copy :size="17" aria-hidden="true" />{{ copyingWechat ? '正在复制…' : '复制微信号' }}</button></div>
        <p id="wechat-copy-feedback" class="wechat-feedback" role="status" aria-live="polite"><template v-if="copyState === 'copied'">微信号已复制，请打开微信添加。</template><template v-else-if="copyState === 'manual'">未能自动复制。请选择上方微信号手动复制；手机可长按复制。</template><template v-else>添加时请说明比赛或课程与想处理的任务。</template></p>
      </div>
      <ol class="tools-start-steps" aria-label="开始使用步骤"><li><span>1</span><strong>选择任务</strong><small>找到当前要处理的环节</small></li><li><span>2</span><strong>添加微信确认</strong><small>确认平台、可用工具和授权</small></li><li><span>3</span><strong>准备与下载</strong><small>按上方说明准备资料，再下载桌面端</small></li><li><span>4</span><strong>开始使用</strong><small>按工具提示操作，关键选择由你确认</small></li></ol>
      <details class="start-details"><summary>授权与使用条件</summary><p class="authorization-copy">下载桌面端不等于自动开通。实际能力取决于工具状态、授权、设备和现场条件，不承诺下载后全部自动执行；遇到登录验证或最终提交时，需要由你接手。</p></details>
    </div></div>
    <div class="tools-actions"><RouterLink class="tools-cta" to="/terms">查看使用条款 <ArrowRight :size="17" aria-hidden="true" /></RouterLink><MarketingDownloadAction /></div>
  </section>
</template>

<style scoped>
.tools-overview {
  width: min(var(--m-width), calc(100% - var(--m-gutter) * 2));
  margin: 0 auto;
  padding: var(--m-section) 0;
  color: var(--m-ink);
}
.tools-overview-header { max-width: 740px; }
.tools-eyebrow { margin: 0 0 16px; color: var(--m-blue); font-size: 14px; font-weight: 700; }
.tools-overview h1 { margin: 0; font-size: var(--m-h1); line-height: 1.3; letter-spacing: 0; }
.tools-overview-header > div > p:not(.tools-eyebrow) { max-width: 660px; margin: 24px 0 0; color: var(--m-text); font-size: var(--m-body); line-height: 1.8; }
.tools-overview-header > div > .tools-scene { margin-top: 14px; color: var(--m-muted); font-size: 14px; }
.scoring-journey { margin-top: 40px; padding: 28px 32px; border-radius: var(--m-radius); background: var(--m-surface); }
.scoring-journey-heading h2 { margin: 0; color: var(--m-ink); font-size: 24px; line-height: 1.45; }
.scoring-journey-heading p { margin: 12px 0 0; color: var(--m-text); font-size: var(--m-body); line-height: 1.8; }
.scoring-steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; margin: 24px 0 0; padding: 24px 0 0; border-top: 1px solid var(--m-border); list-style: none; }
.scoring-steps li { display: flex; align-items: flex-start; gap: 12px; min-width: 0; }
.scoring-steps li > span { flex-shrink: 0; color: var(--m-blue); font-size: 14px; font-weight: 700; line-height: 1.8; }
.scoring-steps strong { color: var(--m-ink); font-size: var(--m-body); line-height: 1.7; }
.scoring-steps p { margin: 8px 0 0; color: var(--m-text); font-size: var(--m-body); line-height: 1.7; }
.scoring-details, .tool-details, .team-details, .start-details { margin-top: 24px; }
.scoring-details summary, .tool-details summary, .team-details summary, .start-details summary { min-height: 44px; width: fit-content; max-width: 100%; color: var(--m-blue-hover); font-size: 15px; line-height: 1.8; cursor: pointer; }
.scoring-details summary:focus-visible, .tool-details summary:focus-visible, .team-details summary:focus-visible, .start-details summary:focus-visible { outline: 3px solid var(--m-blue); outline-offset: 4px; border-radius: 4px; }
.scoring-details p, .tool-details p { margin: 0; color: var(--m-text); font-size: 15px; line-height: 1.8; }
.tool-details p + p { margin-top: 12px; }
.tools-groups { margin-top: 56px; }
.tools-group + .tools-group { margin-top: 40px; }
.tools-group-heading { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 20px; margin-bottom: 20px; }
.tools-group-heading h2 { margin: 0; font-size: 24px; line-height: 1.4; letter-spacing: 0; }
.tools-group-heading p { margin: 0; color: var(--m-muted); font-size: var(--m-body); line-height: 1.6; }
.tools-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
.tool-card { min-width: 0; padding: 28px; border: 1px solid var(--m-border); border-radius: var(--m-radius); background: #fff; scroll-margin-top: 100px; }
.tool-card:target { border-color: var(--m-blue); box-shadow: 0 0 0 3px var(--m-blue-soft); }
.tool-card-top { display: flex; align-items: baseline; gap: 10px; }
.tool-index { flex-shrink: 0; color: var(--m-muted); font-size: 13px; font-variant-numeric: tabular-nums; }
.tool-intent { color: var(--m-text); font-size: var(--m-body); line-height: 1.7; }
.tool-card-title { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; margin: 16px 0 24px; }
.tool-card h3 { margin: 0; font-size: 22px; line-height: 1.45; letter-spacing: 0; }
.tool-status { display: inline-block; max-width: 100%; padding: 5px 10px; border-radius: 6px; color: var(--m-blue-hover); background: var(--m-blue-soft); font-size: 14px; line-height: 1.6; }
.status-in-development { color: var(--m-muted); background: var(--m-surface); }
.tool-input, .tool-support { margin: 0; color: var(--m-text); font-size: var(--m-body); line-height: 1.75; }
.tool-input { padding-top: 20px; border-top: 1px solid var(--m-border); }
.tool-support { margin-top: 18px; }
.tool-input strong, .tool-support strong { display: block; margin-bottom: 5px; color: var(--m-ink); font-size: 14px; font-weight: 700; }
.team-note { display: flex; align-items: flex-start; gap: 18px; margin-top: var(--m-section); padding-top: 32px; border-top: 1px solid var(--m-border); }
.team-note > svg { flex-shrink: 0; margin-top: 3px; color: var(--m-blue); }
.team-note strong { margin: 0; color: var(--m-ink); font-size: 24px; line-height: 1.4; }
.team-note p { max-width: 790px; margin: 12px 0 0; color: var(--m-text); font-size: var(--m-body); line-height: 1.8; }
.tools-boundary { display: flex; align-items: flex-start; gap: 16px; margin-top: 40px; padding: 32px; border-radius: var(--m-radius); background: var(--m-blue-soft); scroll-margin-top: 100px; }
.tools-boundary > svg { flex-shrink: 0; margin-top: 6px; color: var(--m-blue); }
.tools-boundary > div { min-width: 0; }
.wechat-contact { margin-top: 24px; padding: 20px; border: 1px solid #cddaf4; border-radius: 10px; background: #fff; }
.wechat-contact label { display: block; margin-bottom: 12px; color: var(--m-ink); font-size: 14px; font-weight: 700; line-height: 1.6; }
.wechat-contact-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.wechat-contact-actions input { min-width: 0; width: 190px; max-width: 100%; min-height: 44px; padding: 8px 12px; border: 1px solid var(--m-border); border-radius: 6px; color: var(--m-ink); background: var(--m-surface); font: inherit; font-size: 20px; font-weight: 700; }
.wechat-contact-actions button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 10px 16px; border: 0; border-radius: 6px; color: #fff; background: var(--m-blue); font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; transition: background var(--m-duration); }
.wechat-contact-actions button:disabled { cursor: wait; opacity: 0.7; }
.wechat-contact-actions button:focus-visible, .wechat-contact-actions input:focus-visible { outline: 3px solid var(--m-blue); outline-offset: 4px; }
.tools-boundary p { margin: 0; color: var(--m-text); font-size: var(--m-body); line-height: 1.8; }
.tools-boundary .wechat-feedback { margin-top: 12px; font-size: 14px; }
.tools-boundary p > strong { display: block; margin-bottom: 12px; color: var(--m-ink); font-size: 24px; line-height: 1.4; letter-spacing: 0; }
.tools-boundary p + p { margin-top: 16px; }
.tools-start-steps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 24px; margin: 32px 0 0; padding: 24px 0 0; border-top: 1px solid #cddaf4; list-style: none; }
.tools-start-steps li { min-width: 0; }
.tools-start-steps li > span { display: block; margin-bottom: 10px; color: var(--m-blue); font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; }
.tools-start-steps strong { color: var(--m-ink); font-size: var(--m-body); }
.tools-start-steps small { display: block; margin: 8px 0 0; color: var(--m-text); font-size: var(--m-body); line-height: 1.7; }
.tools-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 16px 28px; margin-top: 28px; }
.tools-cta { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; color: var(--m-blue); font-size: 15px; font-weight: 700; text-decoration: none; transition: color var(--m-duration); }
.tools-cta:focus-visible { outline: 3px solid var(--m-blue); outline-offset: 4px; border-radius: 4px; }
@media (hover: hover) { .tools-cta:hover { color: var(--m-blue-hover); } .wechat-contact-actions button:hover:not(:disabled) { background: var(--m-blue-hover); } }
@media (max-width: 960px) {
  .tools-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .tool-card:last-child:nth-child(odd) { grid-column: 1 / -1; }
  .tool-card { padding: 24px; }
  .tools-start-steps { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 600px) {
  .tools-groups { margin-top: 40px; }
  .scoring-journey { margin-top: 32px; padding: 24px 20px; }
  .scoring-journey-heading h2 { font-size: 22px; }
  .scoring-steps { grid-template-columns: minmax(0, 1fr); gap: 20px; }
  .tools-group + .tools-group { margin-top: 32px; }
  .tools-group-heading h2, .team-note strong, .tools-boundary p > strong { font-size: 22px; }
  .tools-grid { grid-template-columns: minmax(0, 1fr); gap: 16px; }
  .tool-card { padding: 22px; }
  .tool-card h3 { font-size: 21px; }
  .team-note { gap: 12px; }
  .tools-boundary { display: block; margin-top: 32px; padding: 24px 20px; }
  .tools-boundary > svg { display: none; }
  .wechat-contact { padding: 18px 16px; }
  .wechat-contact-actions { flex-direction: column; align-items: stretch; }
  .wechat-contact-actions input { width: 100%; }
  .tools-start-steps { gap: 24px 18px; }
  .tools-actions { flex-direction: column; align-items: stretch; }
  .tools-cta { width: fit-content; }
}
@media (prefers-reduced-motion: reduce) { .tools-cta, .wechat-contact-actions button { transition: none; } }
</style>
