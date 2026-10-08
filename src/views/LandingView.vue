<template>
  <MarketingShell :show-download="false">
    <section class="landing-hero" data-testid="marketing-hero">
      <div class="landing-width landing-hero-grid">
        <div class="landing-hero-copy">
          <p class="landing-kicker">课赛通 KST</p>
          <p class="landing-identity">跨境电商比赛与亚马逊仿真实训工具</p>
          <h1><span>按要求做完了，</span><em>分数还是上不去？</em></h1>
          <p class="landing-lead">在已支持的任务中，一键处理商品、物流、广告和发货的重复步骤，套用已整理的得分配置。</p>
          <div class="landing-actions">
            <a class="landing-primary" href="#scenes">
              看看适合我的场景
              <ArrowDown :size="18" aria-hidden="true" />
            </a>
          </div>
        </div>

        <div class="landing-board landing-pain-board" aria-label="赛训里常见的三个卡点">
          <div class="landing-board-head">
            <h2>你可能也卡在这里</h2>
          </div>
          <ol class="landing-pain-stages">
            <li v-for="item in painStages" :key="item.number" class="landing-pain-stage">
              <span class="landing-pain-number" aria-hidden="true">{{ item.number }}</span>
              <div>
                <strong>{{ item.title }}</strong>
                <p>{{ item.detail }}</p>
              </div>
            </li>
          </ol>
        </div>
      </div>
    </section>

    <section id="scenes" class="landing-scenes" data-testid="scenario-entry">
      <div class="landing-width">
        <div class="landing-heading">
          <p class="landing-kicker">先从你的场景看</p>
          <h2>你在备赛，还是做实训？</h2>
        </div>
        <div class="landing-scene-grid">
          <RouterLink class="landing-scene-card competition" to="/competition">
            <span class="landing-scene-label">比赛备赛</span>
            <ScenarioIdentity kind="competition" compact />
            <h3>时间短，做了很多操作，<br class="desktop-break">分数却不一定上去</h3>
            <p>评分细节要摸清，重复操作又占时间。看看课赛通能帮你省掉哪部分。</p>
            <b>看看比赛怎么用 <ArrowRight :size="18" aria-hidden="true" /></b>
          </RouterLink>
          <RouterLink class="landing-scene-card course" to="/course">
            <span class="landing-scene-label">课程实训</span>
            <ScenarioIdentity kind="course" compact />
            <h3>作业照着要求做完了，<br class="desktop-break">分数还是不理想</h3>
            <p>换个商品或物流方案，又要重新配置。把时间留给真正需要理解的规则。</p>
            <b>看看实训怎么用 <ArrowRight :size="18" aria-hidden="true" /></b>
          </RouterLink>
        </div>
      </div>
    </section>

    <div id="impact" class="landing-width landing-impact">
      <MetricComparison :metrics="reportedTimeMetrics" title="同样的任务，用时差多少？" intro="三项高频操作，把时间差摆在一起看。" />
    </div>

    <MarketingScoreSupport />

    <div class="landing-width">
      <MarketingCaseResults />
    </div>

    <LandingTaskMap />

    <section class="landing-faq">
      <div class="landing-width landing-faq-grid">
        <div>
          <p class="landing-kicker">开始之前</p>
          <h2>你关心的，<br>这里先说清楚。</h2>
        </div>
        <div>
          <details v-for="item in faq" :key="item.question">
            <summary>{{ item.question }}<Plus :size="20" aria-hidden="true" /></summary>
            <p class="faq-answer">{{ item.answer }}</p>
          </details>
        </div>
      </div>
    </section>

    <section class="landing-final">
      <div class="landing-width">
        <p class="landing-kicker">课赛通 KST</p>
        <h2>先看你的场景，<br>再挑合适的工具。</h2>
        <RouterLink class="landing-primary" to="/tools">看工具介绍 <ArrowRight :size="18" aria-hidden="true" /></RouterLink>
      </div>
    </section>

    <footer class="landing-footer">
      <div class="landing-width">
        <div>
          <BrandLockup audience="login" />
          <nav aria-label="页脚导航">
            <RouterLink to="/competition">比赛备赛</RouterLink>
            <RouterLink to="/course">课程实训</RouterLink>
            <RouterLink to="/tools">工具介绍</RouterLink>
            <RouterLink to="/terms">服务条款</RouterLink>
          </nav>
        </div>
        <small>© {{ year }} 课赛通 KST · 亚马逊比赛与课程实训效率工具</small>
      </div>
    </footer>
  </MarketingShell>
</template>

<script setup lang="ts">
import { ArrowDown, ArrowRight, Plus } from '@lucide/vue'
import { RouterLink } from 'vue-router'
import BrandLockup from '@/components/brand/BrandLockup.vue'
import MarketingShell from '@/components/landing/MarketingShell.vue'
import LandingTaskMap from '@/components/landing/LandingTaskMap.vue'
import ScenarioIdentity from '@/components/landing/ScenarioIdentity.vue'
import MetricComparison from '@/components/landing/MetricComparison.vue'
import MarketingCaseResults from '@/components/landing/MarketingCaseResults.vue'
import MarketingScoreSupport from '@/components/landing/MarketingScoreSupport.vue'
import { reportedTimeMetrics } from '@/marketing/impact-data'

const year = new Date().getFullYear()
const painStages = [
  {
    number: '01',
    title: '照着要求做，隐性得分点还是会漏',
    detail: '页面要求之外的评分细节，往往要反复试才摸清。',
  },
  {
    number: '02',
    title: '重复填写，挤占研究时间',
    detail: '找入口、填资料、切页面，同样的步骤反复做。',
  },
  {
    number: '03',
    title: '哪些配置有用，还在反复试',
    detail: '改一遍、试一遍，真正影响得分的细节却未必能抓住。',
  },
]
const faq = [
  {
    question: '能帮我照顾到隐性得分细节吗？',
    answer: '在支持的任务中，课赛通会把已整理的得分细节带入一键配置，减少自己反复摸索和填写。具体适用任务与当前开放范围见工具介绍。',
  },
  {
    question: '适用于哪个实训平台？',
    answer: '目前围绕亚马逊仿真比赛与课程实训设计。添加微信 Moweiiong，告诉我们你使用的平台和任务，先确认适用范围再开始。',
  },
  {
    question: '我正在参赛或上课，应该先看哪里？',
    answer: '正在备赛，先看“比赛备赛”；正在上课或做实训，先看“课程实训”。找到你遇到的问题后，再选择对应工具。',
  },
  {
    question: '课赛通会替我完成所有操作吗？',
    answer: '不会。它辅助处理明确的重复部分；登录、规则判断和特殊确认仍由你完成。具体辅助范围以工具介绍为准。',
  },
  {
    question: '下载后是不是所有功能都能直接运行？',
    answer: '不一定。具体能否使用取决于当前授权、版本和开放范围，可以先查看工具介绍再确认。',
  },
]
</script>

<style scoped>
.landing-width {
  width: min(var(--m-width), calc(100% - var(--m-gutter) * 2));
  margin-inline: auto;
}

.landing-hero {
  padding-block: 64px 48px;
  background: linear-gradient(180deg, var(--m-blue-soft), #fff);
}

.landing-impact { scroll-margin-top: 96px; }

.landing-hero-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.06fr) minmax(0, 1fr);
  align-items: center;
  gap: 48px;
}

.landing-kicker {
  margin: 0;
  color: var(--m-blue);
  font-size: 14px;
  font-weight: 650;
  line-height: 1.7;
}

.landing-identity { margin: 10px 0 0; color: var(--m-ink); font-size: 18px; font-weight: 650; line-height: 1.65; }

.landing-hero-copy > * {
  animation: landing-fade-up 240ms both;
}

.landing-hero-copy h1 { animation-delay: 40ms; }
.landing-hero-copy .landing-lead { animation-delay: 80ms; }
.landing-hero-copy .landing-actions { animation-delay: 120ms; }

.landing-hero h1 {
  margin: 24px 0 0;
  color: var(--m-ink);
  font-size: var(--m-h1);
  line-height: 1.28;
  letter-spacing: 0;
}

.landing-hero h1 span,
.landing-hero h1 em { display: block; }

.landing-hero h1 em {
  color: var(--m-blue);
  font-style: normal;
  white-space: nowrap;
}

.landing-lead,
.landing-help {
  max-width: 520px;
  color: var(--m-text);
  font-size: var(--m-body);
  line-height: 1.85;
}

.landing-lead { margin: 28px 0 0; }
.landing-actions { margin-top: 32px; }

.landing-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 50px;
  padding: 12px 22px;
  border-radius: 10px;
  color: #fff;
  background: var(--m-blue);
  font-size: var(--m-body);
  font-weight: 650;
  line-height: 1.5;
  text-decoration: none;
  transition: background var(--m-duration) ease, transform var(--m-duration) ease;
}

@media (hover: hover) { .landing-primary:hover { background: var(--m-blue-hover); transform: translateY(-2px); } }
.landing-primary:active { background: var(--m-blue-hover); transform: translateY(0); }

.landing-primary svg { flex-shrink: 0; }

.landing-primary:focus-visible,
.landing-scene-card:focus-visible,
.landing-faq summary:focus-visible,
.landing-footer a:focus-visible {
  outline: 3px solid var(--m-blue);
  outline-offset: 5px;
}

.landing-board {
  min-width: 0;
  padding: 30px 32px;
  border-radius: var(--m-radius);
  background: #fff;
}

.landing-board-head h2 {
  margin: 0;
  color: var(--m-ink);
  font-size: 26px;
  line-height: 1.45;
  letter-spacing: 0;
}

.landing-pain-stages {
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

.landing-pain-stage {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding-block: 20px;
  border-bottom: 1px solid var(--m-border);
  animation: landing-fade-up 240ms both;
}

.landing-pain-stage:nth-child(2) { animation-delay: 60ms; }
.landing-pain-stage:nth-child(3) { animation-delay: 120ms; }
.landing-pain-stage:last-child { padding-bottom: 0; border-bottom: 0; }

.landing-pain-number {
  flex: 0 0 28px;
  color: var(--m-orange);
  font-size: 17px;
  font-weight: 700;
  line-height: 1.6;
  font-variant-numeric: tabular-nums;
}

.landing-pain-stage strong {
  display: block;
  color: var(--m-ink);
  font-size: 18px;
  line-height: 1.55;
}

.landing-pain-stage p {
  margin: 8px 0 0;
  color: var(--m-text);
  font-size: var(--m-body);
  line-height: 1.75;
}

.landing-scenes {
  padding-top: 24px;
  background: #fff;
  scroll-margin-top: 90px;
}

.landing-heading { max-width: 720px; }

.landing-heading h2,
.landing-faq h2 {
  margin: 16px 0 0;
  color: var(--m-ink);
  font-size: var(--m-h2);
  line-height: 1.4;
  letter-spacing: 0;
  text-wrap: balance;
}

.landing-heading > p:last-child {
  margin: 20px 0 0;
  color: var(--m-text);
  font-size: var(--m-body);
  line-height: 1.85;
}

.landing-scene-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
  margin-top: 28px;
}

.landing-scene-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 30px;
  border: 1px solid var(--m-border);
  border-radius: var(--m-radius);
  color: var(--m-ink);
  background: #fff;
  text-decoration: none;
  transition: transform var(--m-duration) ease, border-color var(--m-duration) ease, background var(--m-duration) ease;
}

@media (hover: hover) { .landing-scene-card:hover { border-color: var(--m-blue); background: #fafcff; transform: translateY(-2px); } }
.landing-scene-card:active { border-color: var(--m-blue); background: var(--m-blue-soft); transform: translateY(0); }

.landing-scene-label {
  display: block;
  margin-bottom: 18px;
  color: var(--m-blue);
  font-size: 15px;
  font-weight: 650;
  line-height: 1.6;
}

.landing-scene-card .scenario-identity { min-height: 96px; }

.landing-scene-card h3 {
  min-height: 3em;
  margin: 20px 0 0;
  color: var(--m-ink);
  font-size: 24px;
  line-height: 1.5;
  letter-spacing: 0;
}

.landing-scene-card p {
  margin: 12px 0 16px;
  color: var(--m-text);
  font-size: var(--m-body);
  line-height: 1.85;
}

.landing-scene-card b {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  margin-top: auto;
  color: var(--m-blue);
  font-size: 15px;
  font-weight: 650;
  line-height: 1.65;
}

.landing-scene-card b svg { flex-shrink: 0; }

.landing-shift {
  padding-block: var(--m-section);
  background: var(--m-surface);
}

.landing-shift-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
  margin-top: 36px;
}

.landing-shift-card {
  padding: 32px;
  border-radius: var(--m-radius);
  background: #fff;
}

.landing-shift-card > span {
  color: var(--m-text);
  font-size: 15px;
  font-weight: 650;
  line-height: 1.6;
}

.landing-shift-card h3 {
  margin: 20px 0 0;
  color: var(--m-ink);
  font-size: 25px;
  line-height: 1.5;
  letter-spacing: 0;
}

.landing-shift-card ol {
  display: grid;
  gap: 24px;
  margin: 30px 0 0;
  padding: 0;
  list-style: none;
  counter-reset: task-step;
}

.landing-shift-card li {
  position: relative;
  padding-left: 40px;
  counter-increment: task-step;
}

.landing-shift-card li::before {
  position: absolute;
  left: 0;
  top: 0;
  color: var(--m-muted);
  font-size: 15px;
  font-weight: 650;
  line-height: 1.7;
  content: "0" counter(task-step);
}

.landing-shift-card li strong {
  color: var(--m-ink);
  font-size: var(--m-body);
  line-height: 1.7;
}

.landing-shift-card li p {
  margin: 6px 0 0;
  color: var(--m-text);
  font-size: var(--m-body);
  line-height: 1.8;
}

.landing-shift-card.after { background: var(--m-blue-soft); }
.landing-shift-card.after > span,
.landing-shift-card.after li::before { color: var(--m-blue); }

.landing-faq { padding-block: var(--m-section); background: #fff; }

.landing-faq-grid {
  display: grid;
  grid-template-columns: .8fr 1.2fr;
  gap: 80px;
}

.landing-faq details { border-top: 1px solid var(--m-border); }
.landing-faq details:last-child { border-bottom: 1px solid var(--m-border); }

.landing-faq summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  min-height: 64px;
  padding-block: 20px;
  color: var(--m-ink);
  font-size: var(--m-body);
  font-weight: 600;
  line-height: 1.7;
  cursor: pointer;
  list-style: none;
}

.landing-faq summary::-webkit-details-marker { display: none; }

.landing-faq summary svg {
  flex-shrink: 0;
  color: var(--m-blue);
  transition: transform var(--m-duration) ease;
}

.landing-faq details[open] summary svg { transform: rotate(45deg); }

.landing-faq details p {
  margin: 0 0 24px;
  color: var(--m-text);
  font-size: var(--m-body);
  line-height: 1.85;
}

.landing-final {
  padding-block: var(--m-section);
  color: #fff;
  background: var(--m-ink);
}

.landing-final h2 {
  margin: 16px 0 30px;
  font-size: var(--m-h2);
  line-height: 1.4;
  letter-spacing: 0;
}

.landing-final .landing-kicker { color: #bed1ed; }
.landing-final .landing-primary { color: var(--m-ink); background: #fff; }
.landing-final .landing-primary:hover { background: var(--m-blue-soft); }
.landing-final .landing-primary:focus-visible { outline-color: #fff; }

.landing-footer { padding: 36px 0 24px; background: #fff; }

.landing-footer > .landing-width > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.landing-footer nav { display: flex; flex-wrap: wrap; gap: 8px 24px; }

.landing-footer nav a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  color: var(--m-text);
  font-size: 14px;
  text-decoration: none;
  transition: color var(--m-duration) ease;
}

.landing-footer nav a:hover { color: var(--m-blue); }

.landing-footer small {
  display: block;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--m-border);
  color: var(--m-muted);
  font-size: 13px;
  line-height: 1.8;
}

@keyframes landing-fade-up {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 1100px) {
  .landing-hero-grid { gap: 28px; }
  .landing-board { padding: 24px; }
  .landing-hero h1 { font-size: min(var(--m-h1), 4.4vw); }
  .landing-scene-card { padding: 24px; }
  .landing-scene-card h3 { font-size: 22px; }
  .desktop-break { display: none; }
}

@media (max-width: 900px) {
  .landing-hero { padding-block: 44px 32px; }
  .landing-hero-grid { grid-template-columns: 1fr; gap: 28px; }
  .landing-hero h1 { font-size: var(--m-h1); }
  .landing-hero-copy { max-width: 620px; }
  .landing-board { padding: 24px; }
  .landing-scene-grid { gap: 16px; }
  .landing-scene-card .scenario-identity { min-height: 112px; }
  .landing-scene-card h3 { min-height: 0; }
  .landing-faq-grid { gap: 36px; }
  .landing-shift-card { padding: 26px; }
  .landing-shift-card h3 { font-size: 23px; }
}

@media (max-width: 700px) {
  .landing-scene-grid,
  .landing-shift-grid,
  .landing-faq-grid { grid-template-columns: 1fr; }
  .landing-scene-card .scenario-identity { min-height: 0; }
  .landing-scene-card h3 { margin-top: 24px; }
  .landing-scene-card p { margin-bottom: 18px; }
  .landing-faq-grid { gap: 28px; }
  .landing-footer > .landing-width > div { align-items: flex-start; flex-direction: column; }
}

@media (max-width: 480px) {
  .landing-hero { padding-block: 32px 28px; }
  .landing-identity { font-size: 16px; }
  .landing-hero-grid { gap: 26px; }
  .landing-board { padding: 20px; }
  .landing-board-head h2 { font-size: 20px; }
  .landing-pain-stage { gap: 10px; padding-block: 14px; }
  .landing-pain-number { flex-basis: 24px; font-size: 15px; }
  .landing-pain-stage strong { font-size: 16px; }
  .landing-pain-stage p { display: none; }
  .landing-primary { padding-inline: 18px; font-size: 15px; }
  .landing-scene-card h3 { margin-top: 18px; }
  .landing-shift-card { padding: 24px; }
  .landing-shift-card h3 { font-size: 22px; }
  .landing-shift-card li { padding-left: 34px; }
}

@media (max-width: 370px) {
  .landing-hero h1 { font-size: 32px; }
}

@media (prefers-reduced-motion: reduce) {
  .landing-hero-copy > *,
  .landing-pain-stage { animation: none; }
  .landing-primary,
  .landing-scene-card,
  .landing-faq summary svg,
  .landing-footer nav a { transition: none; }
}
</style>
