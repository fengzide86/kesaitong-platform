import { createRouter, createWebHistory, type RouterHistory, type RouteRecordRaw } from 'vue-router'
import LandingView from '@/views/LandingView.vue'
import ScenarioView from '@/views/ScenarioView.vue'
import MarketingToolsView from '@/views/MarketingToolsView.vue'
import MarketingTermsView from './MarketingTermsView.vue'
import MarketingNotFound from './MarketingNotFound.vue'
import SimulationView from './demo/SimulationView.vue'

// This small static site loads its pages together. An already-open homepage
// must not need a removed lazy chunk after the local preview is rebuilt.

export const marketingRoutes: RouteRecordRaw[] = [
  {
    path: '/', name: 'Landing', component: LandingView,
    props: { marketingOnly: true }, meta: { title: '跨境电商赛训效率平台' },
  },
  {
    path: '/competition', name: 'MarketingCompetition',
    component: ScenarioView,
    props: { kind: 'competition' }, meta: { title: '比赛备赛' },
  },
  {
    path: '/course', name: 'MarketingCourse',
    component: ScenarioView,
    props: { kind: 'course' }, meta: { title: '课程实训' },
  },
  {
    path: '/tools', name: 'MarketingTools',
    component: MarketingToolsView,
    meta: { title: '工具介绍' },
  },
  {
    path: '/terms', alias: '/user/terms', name: 'MarketingTerms', component: MarketingTermsView,
    meta: { title: '服务条款' },
  },
  {
    path: '/demo', name: 'MarketingSimulation', component: SimulationView,
    meta: { title: '独立模拟体验' },
  },
  {
    path: '/:pathMatch(.*)*', name: 'MarketingNotFound', component: MarketingNotFound,
    meta: { title: '页面未找到' },
  },
]

export function createMarketingRouter(history: RouterHistory = createWebHistory()) {
  const router = createRouter({
    history,
    routes: marketingRoutes,
    scrollBehavior(to, _from, savedPosition) {
      if (savedPosition) return savedPosition
      if (to.hash) return { el: to.hash, top: 88 }
      return { top: 0 }
    },
  })
  router.afterEach(to => {
    document.title = `${String(to.meta.title || '官网')} · 课赛通 KST`
    window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>('[data-route-focus]')
      if (!target) return
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
      target.focus({ preventScroll: true })
    })
  })
  return router
}
