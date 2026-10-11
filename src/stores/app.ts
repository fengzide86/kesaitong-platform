/**
 * 应用状态管理
 * 管理应用级别的全局状态
 * 
 * 使用 Composition API 风格（与 platform.js 保持一致）
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

type UnknownRecord = Record<string, unknown>

export interface ActiveTool extends UnknownRecord {
  id?: string | number
  name?: string
  module?: string
  category?: string
  platformKey?: string
  capabilityKey?: string
  scriptStatus?: 'demo_ready' | 'browser_ready' | 'script_ready' | 'script_not_ready' | 'blocked'
  targetUrl?: string
  executionMode?: 'demo' | 'live' | 'preflight'
  scenarioId?: string
  demoRunId?: string
  launchGrant?: {
    token?: string
    scriptKey?: string
    runnerApiVersion?: number
    expiresAt?: string
    expiresIn?: number
    toolVersion?: string
    toolManifest?: unknown
    toolSignature?: string
    signingKeyId?: string
    signatureRequired?: boolean
  }
  executionContext?: {
    mode?: 'single' | 'batch'
    sessionId?: string
    batchId?: string
    itemId?: string
    input?: UnknownRecord
    fileInputKeys?: string[]
  }
}

export const useAppStore = defineStore('app', () => {
  // ===== State =====
  
  // 应用信息
  const appName = ref('课赛通 KST')
  const version = ref(import.meta.env.VITE_APP_VERSION || 'unknown')
  
  // 加载状态
  const loading = ref(false)
  const loadingText = ref('')
  
  // 侧边栏状态
  const sidebarCollapsed = ref(false)
  
  // 系统设置
  const settings = ref<UnknownRecord | null>(null)
  
  // 套餐列表（缓存）
  const plans = ref<UnknownRecord[]>([])
  
  // 工具分类（缓存）
  const toolCategories = ref<UnknownRecord[]>([])

  // 工具面板状态（单窗口分屏模式）
  const toolVisible = ref(false)
  const toolUrl = ref('')
  const currentTool = ref<ActiveTool | null>(null) // { id, name, module, category, platformKey, targetUrl }

  // ===== Getters =====
  
  // 获取应用版本
  const getVersion = computed(() => version.value)
  
  // 获取系统设置
  const getSettings = computed(() => settings.value)

  // 工具面板是否可见
  const isToolVisible = computed(() => toolVisible.value)

  // ===== Actions =====
  
  /**
   * 设置加载状态
   * @param {boolean} isLoading - 是否加载中
   * @param {string} text - 加载提示文字
   */
  function setLoading(isLoading: boolean, text = '') {
    loading.value = isLoading
    loadingText.value = text
  }

  /**
   * 切换侧边栏折叠状态
   */
  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  /**
   * 设置侧边栏折叠状态
   * @param {boolean} collapsed - 是否折叠
   */
  function setSidebarCollapsed(collapsed: boolean) {
    sidebarCollapsed.value = collapsed
  }

  /**
   * 设置系统设置
   * @param {Object} newSettings - 系统设置
   */
  function setSettings(newSettings: UnknownRecord) {
    settings.value = newSettings
  }

  /**
   * 设置套餐列表
   * @param {Array} newPlans - 套餐列表
   */
  function setPlans(newPlans: UnknownRecord[]) {
    plans.value = newPlans
  }

  /**
   * 设置工具分类
   * @param {Array} categories - 工具分类列表
   */
  function setToolCategories(categories: UnknownRecord[]) {
    toolCategories.value = categories
  }

  /**
   * 打开工具（分屏模式）
   */
  function openTool(tool: ActiveTool) {
    currentTool.value = tool
    toolUrl.value = tool.targetUrl || ''
    toolVisible.value = true
  }

  /**
   * 关闭工具
   */
  function closeTool() {
    toolVisible.value = false
    toolUrl.value = ''
    currentTool.value = null
  }

  /**
   * 重置应用状态
   */
  function reset() {
    settings.value = null
    plans.value = []
    toolCategories.value = []
    toolVisible.value = false
    toolUrl.value = ''
    currentTool.value = null
  }

  return {
    // State
    appName,
    version,
    loading,
    loadingText,
    sidebarCollapsed,
    settings,
    plans,
    toolCategories,
    toolVisible,
    toolUrl,
    currentTool,
    // Getters
    getVersion,
    getSettings,
    isToolVisible,
    // Actions
    setLoading,
    toggleSidebar,
    setSidebarCollapsed,
    setSettings,
    setPlans,
    setToolCategories,
    openTool,
    closeTool,
    reset,
  }
})
