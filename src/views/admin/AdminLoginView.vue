<template>
  <main class="login-container">
    <section class="admin-login-shell" aria-label="管理员登录">
      <aside class="admin-context" aria-label="管理端说明">
        <div class="context-brand">
          <BrandLockup audience="admin" layout="horizontal" variant="inverse" />
        </div>
        <div class="context-copy">
          <p class="context-eyebrow">OPERATIONS CONSOLE</p>
          <h2>运营控制中心</h2>
          <p>集中处理授权、订单、服务配置与客户支持，让运营信息保持清晰可控。</p>
        </div>
        <ul class="context-capabilities" aria-label="管理能力">
          <li><span></span>授权与设备管理</li>
          <li><span></span>订单与套餐配置</li>
          <li><span></span>工具与服务运营</li>
        </ul>
        <div class="context-security">
          <span class="security-dot"></span>
          管理端独立验证入口
        </div>
      </aside>

      <div class="login-card">
      <div class="logo-section">
        <BrandMark class="logo-icon" :size="64" decorative />
        <h1>管理员登录</h1>
        <p>使用自己的后台账号登录，自动进入对应工作台</p>
      </div>

        <div class="error-message" :class="{ show: showError }" role="alert" aria-live="assertive">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <span>{{ errorMessage }}</span>
      </div>

      <form @submit.prevent="handleLogin">
        <div class="form-group">
          <label for="adminUsername">管理账号</label>
          <div class="input-wrapper">
            <span class="input-icon" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.1a7.5 7.5 0 0115 0"/></svg>
            </span>
            <input
              ref="usernameInput"
              id="adminUsername"
              v-model="username"
              :disabled="isLoading"
              type="text"
              placeholder="请输入管理账号"
              autocomplete="username"
              autofocus
              required
            >
          </div>
        </div>
        <div class="form-group">
          <label for="adminPassword">管理员密码</label>
          <div class="input-wrapper">
          <span class="input-icon" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
              </svg>
            </span>
            <input
              ref="passwordInput"
              :type="showPassword ? 'text' : 'password'"
              id="adminPassword"
              v-model="password"
              :disabled="isLoading"
              placeholder="请输入管理员密码"
              autocomplete="current-password"
              required
            >
            <button type="button" class="toggle-password" @mousedown.prevent @click="togglePasswordVisibility" :aria-label="showPassword ? '隐藏密码' : '显示密码'" :title="showPassword ? '隐藏密码' : '显示密码'">
              <svg v-if="!showPassword" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/>
              </svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
              </svg>
            </button>
          </div>
        </div>

        <button type="submit" class="btn-login" :disabled="isLoading" :aria-busy="isLoading">
          <svg v-if="isLoading" class="btn-spinner" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
          </svg>
          {{ isLoading ? '验证中...' : '登录管理后台' }}
        </button>
      </form>

      <nav class="footer-links" aria-label="其他操作">
        <a href="#" @click.prevent="goToUserLogin" aria-label="返回用户登录">← 返回用户登录</a>
      </nav>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Auth, showToast } from '@/utils'
import { adminLogin } from '@/utils/api'
import { useUserStore } from '@/stores/user'
import { z } from 'zod'
import BrandLockup from '@/components/brand/BrandLockup.vue'
import BrandMark from '@/components/brand/BrandMark.vue'
import { backofficeRoleSchema } from '@/features/auth/model'

const adminLoginResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().default('登录失败'),
  data: z.object({
    token: z.string(),
    role: backofficeRoleSchema,
    agency_id: z.number().int().positive().nullable().optional(),
    username: z.string().optional(),
    display_name: z.string().optional(),
    staff_id: z.union([z.string(), z.number()]).optional(),
    status: z.enum(['active', 'disabled']).optional(),
    force_password_reset: z.boolean().default(false),
  }).passthrough().optional(),
}).passthrough()

const router = useRouter()
const userStore = useUserStore()
const username = ref('')
const password = ref('')
const usernameInput = ref<HTMLInputElement | null>(null)
const passwordInput = ref<HTMLInputElement | null>(null)
const showPassword = ref(false)
const isLoading = ref(false)
const showError = ref(false)
const errorMessage = ref('')
let active = true
onUnmounted(() => { active = false })

function focusPasswordInput() {
  nextTick(() => {
    const input = passwordInput.value
    if (!input || isLoading.value) return
    input.focus({ preventScroll: true })
    const end = input.value.length
    input.setSelectionRange?.(end, end)
  })
}

function focusUsernameInput() {
  nextTick(() => usernameInput.value?.focus({ preventScroll: true }))
}

function togglePasswordVisibility() {
  showPassword.value = !showPassword.value
  focusPasswordInput()
}

function handleLogin() {
  if (!active || isLoading.value) return
  showError.value = false

  if (!username.value.trim()) {
    showToast('请输入管理账号', 'error')
    focusUsernameInput()
    return
  }
  if (!password.value.trim()) {
    showToast('请输入密码', 'error')
    focusPasswordInput()
    return
  }

  isLoading.value = true
  const submittedUsername = username.value.trim()
  adminLogin(submittedUsername, password.value)
    .then((response) => {
      if (!active) return
      const res = adminLoginResponseSchema.parse(response)
      if (res.success) {
        if (!res.data?.token) throw new Error('管理员登录响应缺少访问令牌')
        // 使用 Pinia store 管理登录状态
        userStore.setLogin({
          token: res.data.token,
          role: res.data.role,
          auth_code: 'backoffice',
          user: { ...res.data, username: res.data.username || submittedUsername },
        })
        
        // 保持 Auth 工具类的兼容性
        Auth.set('backoffice')
        
        window.dispatchEvent(new CustomEvent('toolbox:route-track', { detail: { duration: 780 } }))
        const destination = res.data.force_password_reset ? '/admin/change-password' : res.data.role === 'agent' ? '/agent/overview' : '/admin/dashboard'
        Promise.resolve(router.push(destination)).catch(() => {
          if (!active) return
          isLoading.value = false
          focusPasswordInput()
        })
      } else {
        errorMessage.value = res.message
        showError.value = true
        showToast(res.message, 'error')
        isLoading.value = false
        focusPasswordInput()
      }
    })
    .catch((error: unknown) => {
      if (!active) return
      const rawMessage = error instanceof Error ? error.message : ''
      errorMessage.value = /failed to fetch|networkerror|network request failed/i.test(rawMessage)
        ? '无法连接到后端服务，请检查网络或稍后重试'
        : rawMessage || '管理登录失败，请稍后重试'
      showError.value = true
      showToast(errorMessage.value, 'error')
      isLoading.value = false
      focusPasswordInput()
    })
}

function goToUserLogin() {
  router.push('/user/login')
}

onMounted(focusUsernameInput)
</script>

<style scoped>
.login-container {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  width: 100%;
  max-width: 480px;
  padding: 2rem;
  margin: 0 auto;
}

.admin-login-shell {
  width: min(920px, 100%);
  min-height: 520px;
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(380px, .92fr);
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 28px;
  background: var(--color-surface);
  box-shadow: var(--shadow-overlay);
}

.admin-context {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 46px;
  overflow: hidden;
  color: #fff;
  background:
    radial-gradient(circle at 82% 14%, rgba(255, 255, 255, .16), transparent 30%),
    linear-gradient(145deg, #173b88 0%, #2d5fca 62%, #4776d7 100%);
}

.admin-context::after {
  content: '';
  position: absolute;
  right: -90px;
  bottom: -110px;
  width: 310px;
  height: 310px;
  border: 1px solid rgba(255, 255, 255, .13);
  border-radius: 50%;
  box-shadow: 0 0 0 48px rgba(255, 255, 255, .035), 0 0 0 96px rgba(255, 255, 255, .025);
}

.context-brand,
.context-security {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
}

.context-brand { font-size: 12px; font-weight: 700; letter-spacing: .04em; }

.context-copy { position: relative; z-index: 1; margin-top: auto; }
.context-eyebrow { margin: 0 0 14px; color: rgba(255,255,255,.64); font-size:var(--type-micro); font-weight: 700; letter-spacing: .18em; }
.context-copy h2 { margin: 0 0 16px; color: #fff; font-size: clamp(30px, 3.1vw, 40px); line-height: 1.15; letter-spacing: -.04em; }
.context-copy > p:last-child { max-width: 380px; margin: 0; color: rgba(255,255,255,.74); font-size: 14px; line-height: 1.8; }

.context-capabilities {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 18px;
  margin: 32px 0 34px;
  padding: 0;
  list-style: none;
  color: rgba(255,255,255,.84);
  font-size: 12px;
}

.context-capabilities li { display: flex; align-items: center; gap: 8px; }
.context-capabilities li span { width: 5px; height: 5px; border-radius: 50%; background: #d8c39d; box-shadow: 0 0 0 4px rgba(216,195,157,.12); }
.context-security { gap: 9px; color: rgba(255,255,255,.65); font-size:var(--type-meta); }
.security-dot { width: 7px; height: 7px; border-radius: 50%; background: #8ce1be; box-shadow: 0 0 0 5px rgba(140,225,190,.11); }

.login-card {
  background: white;
  border-radius: 24px;
  padding: 3rem 2.5rem;
  box-shadow: 0 25px 50px rgba(15,23,42,0.1), 0 0 0 1px rgba(226,232,240,0.5);
  width: 100%;
}

.logo-section {
  text-align: center;
  margin-bottom: 2.5rem;
}

.logo-section .logo-icon {
  width: 64px;
  height: 64px;
  border-radius: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 11px;
  border: 1px solid rgba(21, 101, 255, .14);
  background: #fff;
  margin-bottom: 1rem;
  box-shadow: 0 10px 25px rgba(21, 101, 255, .12);
}

.logo-section h1 {
  font-family: var(--font-family);
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--color-primary);
  margin-bottom: 0.5rem;
}

.logo-section p {
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}

.form-group {
  margin-bottom: 1.5rem;
}

.form-group label {
  display: block;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-primary);
  margin-bottom: 0.5rem;
}

.input-wrapper {
  position: relative;
}

.input-wrapper input {
  width: 100%;
  padding: 1rem 1rem 1rem 3rem;
  background: #F8FAFC;
  border: 2px solid var(--color-border);
  border-radius: 12px;
  color: var(--color-text);
  caret-color: var(--color-primary);
  cursor: text;
  user-select: text;
  -webkit-user-select: text;
  -webkit-app-region: no-drag !important;
  pointer-events: auto;
  position: relative;
  z-index: 1;
  font-size: 1rem;
  font-family: var(--font-family);
  transition: all var(--transition);
  outline: none;
}

.input-wrapper input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 4px rgba(14,165,233,0.1);
  background: white;
}

.input-wrapper input:focus-visible {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 4px rgba(14,165,233,0.2);
}

.input-icon {
  position: absolute;
  left: 1rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text-secondary);
  pointer-events: none;
}

.input-icon svg {
  width: 20px;
  height: 20px;
}

.toggle-password {
  position: absolute;
  right: 1rem;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  padding: 0.5rem;
  min-width: 44px;
  min-height: 44px;
  cursor: pointer;
  color: var(--color-text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.2s ease-out;
  border-radius: 6px;
}

.toggle-password:hover {
  color: var(--color-primary);
}

.toggle-password:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.toggle-password svg {
  width: 20px;
  height: 20px;
}

.btn-login {
  width: 100%;
  min-height: 48px;
  padding: 1rem;
  color: white;
  border: none;
  border-radius: 12px;
  font-size: 1rem;
  font-weight: 600;
  font-family: var(--font-family);
  cursor: pointer;
  transition: all 0.2s ease-out;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.btn-login:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 15px 30px rgba(14,165,233,0.3);
}

.btn-login:active:not(:disabled) {
  transform: translateY(0);
}

.btn-login:focus-visible {
  outline: 3px solid rgba(14,165,233,0.4);
  outline-offset: 2px;
}

.btn-login:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

.btn-spinner {
  animation: spin 1s linear infinite;
  width: 20px;
  height: 20px;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.error-message {
  display: none;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: rgba(220,38,38,0.08);
  border: 1px solid rgba(220,38,38,0.2);
  border-radius: 10px;
  margin-bottom: 1.5rem;
  font-size: 0.85rem;
  color: var(--color-danger);
}

.error-message.show {
  display: flex;
}

.error-message svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.footer-links {
  text-align: center;
  margin-top: 2rem;
  display: flex;
  justify-content: center;
}

.footer-links a {
  color: var(--color-text-secondary);
  text-decoration: none;
  font-size: 0.85rem;
  transition: color 0.2s ease-out;
  padding: 0.25rem 0.5rem;
  border-radius: 6px;
}

.footer-links a:hover {
  color: var(--color-primary);
}

.footer-links a:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .btn-spinner {
    animation: none;
  }
  .btn-login,
  .toggle-password,
  .footer-links a {
    transition: none;
  }
}

@media (max-width: 480px) {
  .login-card {
    padding: 2rem 1.5rem;
  }
  .login-container {
    padding: 1rem;
  }
}

/* v6 管理端登录 */
.login-container {
  max-width: none;
  padding: 32px;
  background:
    radial-gradient(circle at 16% 18%, rgba(45, 95, 202, .07), transparent 28%),
    var(--color-canvas);
}
.login-card {
  width: 100%;
  padding: 48px 42px;
  border: 0;
  border-radius: 0;
  background: var(--color-surface);
  box-shadow: none;
  align-self: center;
}
.logo-section .logo-icon { background: #fff; box-shadow: 0 10px 24px rgba(21, 101, 255, .12); }
.logo-section h1 { color: var(--color-text); letter-spacing: -.025em; }
.logo-section p { color: var(--color-text-secondary); }
.input-wrapper input {
  border-color: var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text);
  background: var(--color-surface);
  caret-color: var(--color-primary);
}
.input-wrapper input:focus { border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-focus-ring); }
.input-icon,
.toggle-password { color: var(--color-text-tertiary); }
.toggle-password:hover { color: var(--color-primary); background: var(--color-primary-soft); }
.btn-login { border-radius: var(--radius-md); background: var(--color-primary); box-shadow: 0 8px 20px rgba(45, 95, 202, .18); }
.btn-login:hover:not(:disabled) { background: var(--color-primary-hover); box-shadow: 0 11px 26px rgba(45, 95, 202, .24); transform: translateY(-1px); }
.error-message { color: var(--color-danger); border-color: rgba(195, 61, 73, .18); background: var(--color-danger-soft); }
.footer-links a { color: var(--color-text-secondary); }
.footer-links a:hover { color: var(--color-primary); }

@media (max-width: 760px) {
  .admin-login-shell { min-height: 0; grid-template-columns: 1fr; border-radius: var(--radius-xl); }
  .admin-context { padding: 24px 28px; }
  .context-copy { margin-top: 24px; }
  .context-copy h2 { margin-bottom: 8px; font-size: 25px; }
  .context-copy > p:last-child,
  .context-capabilities { display: none; }
  .context-security { margin-top: 20px; }
  .login-card { padding: 34px 30px; }
  .logo-section { margin-bottom: 28px; }
  .logo-section .logo-icon { width: 52px; height: 52px; border-radius: 15px; }
}

@media (max-width: 480px) {
  .login-container { padding: 16px; }
  .admin-context { padding: 20px 22px; }
  .context-brand :deep(.kst-lockup-subtitle) { font-size:var(--type-micro); }
  .login-card { padding: 30px 22px; }
}
</style>
