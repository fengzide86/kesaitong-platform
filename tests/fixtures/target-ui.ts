/** Local UI acceptance only; this file is not a production entry or a live platform adapter. */
import { createApp, h } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory, RouterView } from 'vue-router'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import '@/assets/css/main.css'
import UserLayout from '@/layouts/UserLayout.vue'
import AdminLayout from '@/layouts/AdminLayout.vue'
import ToolsView from '@/views/user/ToolsView.vue'
import UpdateReleasesView from '@/views/admin/UpdateReleasesView.vue'
import { targetObservation, targetPreview, targetProfile, targetReceipt } from '@/tests/features/target-fixtures'
import type { TargetsBridge } from '@/shared/ipc/target-contract'

if (!import.meta.env.DEV || !['localhost', '127.0.0.1'].includes(location.hostname)) throw new Error('Local UI fixture only')
const admin = new URL(location.href).searchParams.has('admin')
const recovery = new URL(location.href).searchParams.has('recovery')
const profiles = [targetProfile(), { ...targetProfile('pending'), profile: { ...targetProfile('pending').profile, id: 'competition-a', name: '比赛练习入口', entryUrl: 'https://competition.example/entry', allowedRoutes: [{ origin: 'https://competition.example', pathPrefix: '/', role: 'entry' }] } }]
let storedReceipt: ReturnType<typeof targetReceipt> | null = recovery ? targetReceipt('needs_review') : null
let lastPlan = targetPreview()
const targets: TargetsBridge = {
  open: async () => {}, refresh: async () => {}, detect: async () => targetObservation(),
  preflight: async request => { lastPlan = targetPreview(); lastPlan.plan.input = request.input; lastPlan.plan.context.scenario = request.scenario; lastPlan.plan.context.stage = request.stage; if (request.scenario === 'competition') { lastPlan.canExecute = false; lastPlan.blockers = ['UI 夹具仅展示：比赛阶段缺少平台核验，不能执行。'] }; return structuredClone(lastPlan) },
  execute: async () => { storedReceipt = targetReceipt(); storedReceipt.stage = lastPlan.plan.context.stage; return structuredClone(storedReceipt) },
  reconcile: async () => storedReceipt || targetReceipt('needs_review'), listReceipts: async () => storedReceipt ? [structuredClone(storedReceipt)] : [], close: async () => {},
}
Object.defineProperty(window, 'electronAPI', { configurable: true, value: { automation: {}, targets } })
sessionStorage.setItem('toolbox_role', admin ? 'super_admin' : 'user')
localStorage.setItem('toolbox_user', JSON.stringify({ id: 'ui-fixture', name: '验收用户', plan_name: '验收套餐', plan_code: 'Y15', platform_scope: ['amazon'] }))
const fixtureTool = { id: 'template-target-test', name: '配送模板', description: 'UI 验收夹具：创建一份模板并回读核验，不访问真实平台。', capability_key: 'logistics_template', task_ids: ['shipping'], platform_key: 'amazon', status: 'online', availability: 'live_beta', release_status: 'available', script_status: 'script_ready', supports_live_single: true, available_plans: ['Y15'], requires_target_profile: true, target_capability: 'template.create.v1', capability_tags: ['多网址识别', '保存后回读'], preparation_notes: ['先选择已审核的入口并确认当前课程和店铺。'] }
window.fetch = async input => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin)
  // All control-plane reads are inert fixtures; an unexpected destination fails closed.
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('UI fixture blocks external requests')
  let data: unknown = []
  if (url.pathname === '/api/tools') data = [fixtureTool]
  else if (url.pathname.endsWith('/target-profiles')) data = structuredClone(profiles)
  else if (url.pathname === '/api/platforms') data = [{ key: 'amazon', name: '亚马逊' }]
  return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
const router = createRouter({ history: createMemoryHistory(), routes: [
  { path: '/user', component: UserLayout, children: [{ path: 'tools', name: 'UserTools', component: ToolsView, meta: { title: '工具箱' } }] },
  { path: '/admin', component: AdminLayout, children: [{ path: 'updates', name: 'AdminUpdates', component: UpdateReleasesView, meta: { title: '应用更新' } }] },
] })
await router.push(admin ? '/admin/updates' : '/user/tools')
const app = createApp({ render: () => h('div', [h('div', { style: 'position:relative;z-index:99999;background:#fff3d8;color:#6f4a0c;padding:8px 16px;font:12px/1.5 sans-serif' }, '仅本地 UI 验收夹具 · 数据与桥均为测试替身 · 不访问真实平台，不证明业务可用'), h(RouterView)]) })
app.use(createPinia()).use(router).use(ElementPlus).mount('#fixture-app')
