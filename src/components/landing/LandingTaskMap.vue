<script setup lang="ts">
import { ArrowRight } from '@lucide/vue'
import { RouterLink } from 'vue-router'
import { marketingTasks, taskGroups } from '@/marketing/task-catalog'
</script>

<template>
  <section id="task-map" class="landing-task-map" data-testid="landing-task-map" aria-labelledby="task-map-title">
    <header class="landing-task-map-heading">
      <div>
        <p class="landing-task-map-eyebrow">八大高耗时任务</p>
        <h2 id="task-map-title">八个环节，<br>最费时间，也最容易卡住。</h2>
      </div>
      <p>从你最费时间的一项，看看工具可以帮到哪一步。</p>
    </header>

    <div v-for="group in taskGroups" :key="group.id" class="landing-task-group">
      <div class="landing-task-group-heading">
        <h3>{{ group.title }}</h3>
        <p>{{ group.description }}</p>
      </div>
      <div class="landing-task-grid">
        <RouterLink
          v-for="task in marketingTasks.filter(item => item.group === group.id)"
          :key="task.id"
          class="landing-task-card"
          :to="`/tools#tool-${task.id}`"
          :data-task-id="task.id"
        >
          <span class="landing-task-card-icon"><component :is="task.icon" :size="21" aria-hidden="true" /></span>
          <span class="landing-task-card-copy">
            <strong>{{ task.title }}</strong>
            <small>{{ task.homePain }}</small>
            <em>{{ task.homeSupport }}</em>
          </span>
          <span class="landing-task-card-action">查看工具说明<ArrowRight :size="17" aria-hidden="true" /></span>
        </RouterLink>
      </div>
    </div>
  </section>
</template>

<style scoped>
.landing-task-map {
  width: min(var(--m-width), calc(100% - var(--m-gutter) * 2));
  margin-inline: auto;
  padding-block: var(--m-section);
  color: var(--m-ink);
  scroll-margin-top: 90px;
}

.landing-task-map-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 40px;
}

.landing-task-map-heading > div { min-width: 0; }

.landing-task-map-eyebrow {
  margin: 0;
  color: var(--m-blue);
  font-size: 14px;
  font-weight: 650;
  line-height: 1.7;
}

.landing-task-map h2 {
  margin: 16px 0 0;
  color: var(--m-ink);
  font-size: var(--m-h2);
  line-height: 1.4;
  letter-spacing: 0;
  text-wrap: balance;
}

.landing-task-map-heading > p {
  max-width: 290px;
  margin: 0;
  color: var(--m-text);
  font-size: var(--m-body);
  line-height: 1.85;
}

.landing-task-group { margin-top: 44px; }
.landing-task-group + .landing-task-group { margin-top: 32px; }

.landing-task-group-heading {
  display: flex;
  align-items: baseline;
  gap: 16px;
  margin-bottom: 16px;
}

.landing-task-group-heading h3 {
  margin: 0;
  color: var(--m-ink);
  font-size: 19px;
  line-height: 1.6;
  letter-spacing: 0;
}

.landing-task-group-heading p {
  margin: 0;
  color: var(--m-muted);
  font-size: 14px;
  line-height: 1.75;
}

.landing-task-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
  gap: 24px;
}

.landing-task-card {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  align-items: flex-start;
  gap: 12px;
  min-width: 0;
  padding: 22px 8px;
  border-top: 1px solid var(--m-border);
  border-radius: 0 0 8px 8px;
  color: inherit;
  background: transparent;
  text-decoration: none;
  transition: border-color var(--m-duration) ease, background var(--m-duration) ease;
}

@media (hover: hover) {
  .landing-task-card:hover {
    border-color: var(--m-blue);
    background: var(--m-blue-soft);
  }
}
.landing-task-card:active { background: var(--m-blue-soft); }

.landing-task-card:focus-visible {
  outline: 3px solid var(--m-blue);
  outline-offset: 4px;
}

.landing-task-card-icon {
  display: inline-flex;
  justify-self: start;
  align-items: center;
  justify-content: center;
  flex: 0 0 24px;
  width: 24px;
  height: 28px;
  color: var(--m-blue);
}

.landing-task-card-copy { min-width: 0; }

.landing-task-card strong,
.landing-task-card small,
.landing-task-card em { display: block; }

.landing-task-card strong {
  color: var(--m-ink);
  font-size: 18px;
  font-weight: 650;
  line-height: 1.55;
}

.landing-task-card small {
  margin-top: 12px;
  color: var(--m-text);
  font-size: var(--m-body);
  line-height: 1.75;
}

.landing-task-card em {
  margin-top: 10px;
  color: var(--m-muted);
  font-size: var(--m-body);
  font-style: normal;
  line-height: 1.75;
}

.landing-task-card-action {
  display: inline-flex;
  grid-column: 2;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  margin-top: 4px;
  color: var(--m-blue);
  font-size: 14px;
  font-weight: 650;
  line-height: 1.5;
}
.landing-task-card-action svg { flex: 0 0 auto; transition: transform var(--m-duration) var(--m-ease); }
@media (hover: hover) { .landing-task-card:hover .landing-task-card-action svg { transform: translateX(2px); } }

@media (max-width: 1000px) {
  .landing-task-map-heading { display: block; }
  .landing-task-map-heading > p { max-width: 560px; margin-top: 20px; }
  .landing-task-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .landing-task-card:last-child:nth-child(odd) { grid-column: 1 / -1; }
}

@media (max-width: 620px) {
  .landing-task-group { margin-top: 28px; }
  .landing-task-group + .landing-task-group { margin-top: 24px; }
  .landing-task-group-heading { display: block; }
  .landing-task-group-heading p { margin-top: 4px; }
  .landing-task-map-heading > p { margin-top: 14px; }
  .landing-task-group-heading { margin-bottom: 12px; }
  .landing-task-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; }
  .landing-task-card { display: grid; grid-template-columns: 1fr auto; gap: 6px; padding: 14px 2px; }
  .landing-task-card:last-child:nth-child(odd) { grid-column: auto; }
  .landing-task-card-copy { grid-column: 1 / -1; }
  .landing-task-card-action { grid-column: 1 / -1; font-size: 14px; gap: 6px; margin-top: 0; }
  .landing-task-card strong { font-size: 16px; }
  .landing-task-card small { margin-top: 6px; font-size: 15px; line-height: 1.65; }
  .landing-task-card em { margin-top: 6px; font-size: 15px; line-height: 1.65; }
}

@media (prefers-reduced-motion: reduce) {
  .landing-task-card, .landing-task-card-action svg { transition: none; }
}
</style>
