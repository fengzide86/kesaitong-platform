import { createRouter, createWebHistory, type RouterHistory, type RouteRecordRaw } from 'vue-router'
import LandingView from '@/views/LandingView.vue'
import ScenarioView from '@/views/ScenarioView.vue'
import MarketingToolsView from '@/views/MarketingToolsView.vue'
import MarketingTermsView from './MarketingTermsView.vue'
import MarketingNotFound from './MarketingNotFound.vue'
import { cancelMarketingScroll, focusMarketingPage, restoreMarketingPosition, scrollToMarketingAnchor } from './navigation-scroll'
import { updateMarketingSeo } from './seo'

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
    path: '/:pathMatch(.*)*', name: 'MarketingNotFound', component: MarketingNotFound,
    meta: { title: '页面未找到' },
  },
]

export function createMarketingRouter(history: RouterHistory = createWebHistory()) {
  const publicOrigin = new URL(document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || window.location.origin).origin
  const router = createRouter({
    history,
    routes: marketingRoutes,
    async scrollBehavior(to, from, savedPosition) {
      if (savedPosition) {
        await restoreMarketingPosition(savedPosition)
        return false
      }
      if (to.hash) {
        await scrollToMarketingAnchor(to.hash, to.path === from.path && from.matched.length > 0)
        return false
      }
      focusMarketingPage()
      return { left: 0, top: 0, behavior: 'instant' }
    },
  })
  router.beforeEach(() => { cancelMarketingScroll() })
  router.afterEach(to => {
    updateMarketingSeo(document, to.path, publicOrigin)
  })
  return router
}
