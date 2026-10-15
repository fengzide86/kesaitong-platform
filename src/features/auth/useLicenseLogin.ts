import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Auth, getDeviceId, getDeviceName, showToast } from '@/utils'
import { api, verifyAuthCode } from '@/utils/api'
import { useUserStore } from '@/stores/user'
import { useConnectionStore } from '@/stores/connection'
import { saveRememberedUserCode } from '@/utils/credentialStore'
import { licenseLoginResponseSchema, publicSettingsSchema } from './model'

const stats = [
  { value: '个人', unit: '端', desc: '个人工具箱 · 按任务使用' },
  { value: '团队', unit: '端', desc: '批量工作台 · 共同跟进' },
  { value: '多类', unit: '任务', desc: '商品、物流、营销与发货' },
]

const featureTags = ['商品与物流', '广告与活动', '订单与发货', '执行记录', '人工接手', '本机处理']

const helpSteps = [
  '从为你开通服务的工作人员处获取授权码',
  '在这里输入授权码，点击“登录并开始使用”',
  '当前电脑会自动与授权绑定',
  '进入后只显示已开通、且当前可使用的工具',
  '遇到平台登录验证或需要确认的步骤时，按页面提示完成即可',
]

function validateAuthCode(code: string): { valid: true } | { valid: false; message: string } {
  const trimmed = code.trim()
  if (!trimmed) return { valid: false, message: '请输入授权码' }
  if (trimmed.length < 4) return { valid: false, message: '授权码格式不正确，请检查后重试' }
  if (!/^[A-Za-z0-9-]+$/.test(trimmed)) return { valid: false, message: '授权码只能包含字母、数字和连字符' }
  return { valid: true }
}

export function useLicenseLogin() {
  const router = useRouter()
  const route = useRoute()
  const userStore = useUserStore()
  const connection = useConnectionStore()
  const authCode = ref('')
  const authCodeInput = ref<HTMLInputElement | null>(null)
  const isLoading = ref(false)
  const showError = ref(false)
  const showHelpModal = ref(false)
  const showContactModal = ref(false)
  const copySuccess = ref(false)
  const errorMessage = ref('')
  const inputFocused = ref(false)
  const loginSucceeded = ref(false)
  const deviceName = ref('')
  const deviceId = ref('')
  const wechatId = ref('')
  let active = true
  let loginSequence = 0
  onUnmounted(() => { active = false; loginSequence += 1 })

  const connectionStatusClass = computed(() => ({
    online: connection.status === 'online',
    offline: connection.status === 'offline',
    connecting: connection.status === 'unknown' || connection.status === 'degraded' || connection.status === 'recovering',
  }))
  const connectionStatusText = computed(() => {
    if (connection.status === 'online') return '服务可用'
    if (connection.status === 'offline') return '连接不稳定，正在恢复'
    return '正在连接服务'
  })

  async function loadWechatId() {
    try {
      const settings = publicSettingsSchema.parse(await api.get('/api/settings/public'))
      const setting = settings.find(item => item.key === 'wechat_id' || item.key === 'service_wechat')
      if (setting?.value) wechatId.value = setting.value
    } catch {
      // Contact information is optional and must not decide backend availability.
    }
  }

  function focusLoginInput() {
    nextTick(() => {
      const input = authCodeInput.value
      if (!input || isLoading.value) return
      input.focus({ preventScroll: true })
      const end = input.value.length
      input.setSelectionRange?.(end, end)
    })
  }

  async function handleLogin() {
    if (!active || isLoading.value) return
    showError.value = false
    const validation = validateAuthCode(authCode.value)
    if (validation.valid === false) {
      errorMessage.value = validation.message
      showError.value = true
      showToast(validation.message, 'error')
      focusLoginInput()
      return
    }

    isLoading.value = true
    const sequence = ++loginSequence
    const submitted = { code: authCode.value.trim(), deviceId: deviceId.value, deviceName: deviceName.value }
    const current = () => active && sequence === loginSequence
    try {
      const result = licenseLoginResponseSchema.parse(
        await verifyAuthCode(submitted.code, submitted.deviceId, submitted.deviceName),
      )
      if (!current()) return
      if (!result.success) {
        errorMessage.value = result.message
        showError.value = true
        showToast(result.message, 'error')
        return
      }
      if (!result.data) throw new Error('授权登录响应缺少用户信息')

      userStore.setLogin({ token: result.data.token, role: 'user', auth_code: submitted.code, user: result.data })
      userStore.setDevice(submitted.deviceId, submitted.deviceName)
      Auth.set(submitted.code)
      void saveRememberedUserCode(submitted.code)
      if (result.data.platform_scope) {
        localStorage.setItem('toolbox_platform_scope', JSON.stringify(result.data.platform_scope))
      }
      loginSucceeded.value = true
      await new Promise(resolve => window.setTimeout(resolve, 160))
      if (!current()) return
      window.dispatchEvent(new CustomEvent('toolbox:route-track', { detail: { duration: 780 } }))
      await new Promise(resolve => window.setTimeout(resolve, 270))
      if (!current()) return
      const businessAccess = result.data.product_type === 'business'
        && result.data.business_workspace_enabled === true
        && result.data.entitlements?.batch_execution === true
        && result.data.entitlements?.multi_account_workspace === true
      await router.push(businessAccess ? '/business/overview' : '/user/tools')
    } catch (error) {
      if (!current()) return
      const apiError = typeof error === 'object' && error !== null
        ? error as { kind?: string; message?: string; requestId?: string | null }
        : null
      const rawMessage = apiError?.message || (error instanceof Error ? error.message : '')
      const isNetworkFailure = apiError?.kind === 'timeout'
        || apiError?.kind === 'network'
        || /network|fetch|timeout/i.test(rawMessage)
      if (isNetworkFailure) {
        errorMessage.value = '网络暂时无法连接，请稍后重试'
      } else if (apiError?.kind === 'parse' || apiError?.kind === 'validation') {
        errorMessage.value = apiError.requestId
          ? `服务响应异常，问题编号：${apiError.requestId}`
          : '服务响应异常，请稍后重试'
      } else {
        errorMessage.value = rawMessage || '登录未完成，请稍后重试'
      }
      showError.value = true
      showToast(errorMessage.value, 'error')
    } finally {
      if (current()) {
        isLoading.value = false
        if (showError.value) focusLoginInput()
      }
    }
  }

  function showHelp() {
    showHelpModal.value = true
  }

  function showContact() {
    showContactModal.value = true
    copySuccess.value = false
  }

  async function copyWechatId() {
    if (!wechatId.value) return
    try {
      await navigator.clipboard.writeText(wechatId.value)
      copySuccess.value = true
    } catch {
      const textArea = document.createElement('textarea')
      textArea.value = wechatId.value
      textArea.style.position = 'fixed'
      textArea.style.opacity = '0'
      document.body.appendChild(textArea)
      textArea.select()
      try {
        copySuccess.value = document.execCommand('copy')
      } catch {
        showToast('复制失败，请手动复制', 'error')
      } finally {
        document.body.removeChild(textArea)
      }
    }
    if (copySuccess.value) window.setTimeout(() => { copySuccess.value = false }, 2000)
  }

  function closeModals() {
    showHelpModal.value = false
    showContactModal.value = false
  }

  onMounted(() => {
    const handoffCode = sessionStorage.getItem('toolbox_login_handoff_code')
    if (handoffCode) {
      sessionStorage.removeItem('toolbox_login_handoff_code')
      authCode.value = handoffCode
    } else if (typeof route.query?.code === 'string') {
      // 兼容旧的内部测试链接；新管理端使用一次性 sessionStorage 交接，避免授权码留在地址栏。
      authCode.value = route.query.code
    }
    deviceId.value = getDeviceId()
    deviceName.value = getDeviceName()
    void loadWechatId()
    void connection.probe()
    const autoLoginError = localStorage.getItem('toolbox_auto_login_error')
    if (autoLoginError) {
      localStorage.removeItem('toolbox_auto_login_error')
      errorMessage.value = autoLoginError
      showError.value = true
    }
    focusLoginInput()
  })

  return {
    authCode, authCodeInput, isLoading, loginSucceeded, showError, showHelpModal, showContactModal, copySuccess,
    errorMessage, inputFocused, deviceName, wechatId, stats, featureTags, helpSteps,
    connectionStatusClass, connectionStatusText, handleLogin, showHelp, showContact, copyWechatId, closeModals,
  }
}
