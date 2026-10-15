<template>
  <AuthEntryShell class="login-container" variant="admin" aria-label="后台账号登录">
      <AuthEntryBackdrop variant="admin" />
      <aside class="admin-context" aria-label="管理端说明">
        <div class="admin-context-content">
        <div class="context-brand">
          <BrandLockup audience="admin" layout="stacked" subtitle="团队工作台" />
        </div>
        <div class="context-body">
        <div class="context-copy">
          <p class="context-eyebrow">团队协作入口</p>
          <h2>团队日常，<br>一处打理。</h2>
          <p>面向运营、客服与代理的协作入口。</p>
        </div>
        <ul class="context-capabilities" aria-label="管理能力">
          <li><KeyRound :size="17" aria-hidden="true" /><span>客户授权</span></li>
          <li><Headset :size="17" aria-hidden="true" /><span>工单支持</span></li>
          <li><UsersRound :size="17" aria-hidden="true" /><span>代理交付</span></li>
        </ul>
        </div>
        </div>
      </aside>

      <section class="admin-form-panel" aria-labelledby="admin-login-heading">
      <div class="login-card">
      <div class="logo-section">
        <div class="login-card-topline">
          <span class="entry-symbol" aria-hidden="true"><Shield :size="24" /></span>
          <span class="entry-label">后台账号</span>
        </div>
        <h1 id="admin-login-heading">管理端登录</h1>
        <p class="context-security">登录后按账号权限开放对应功能</p>
      </div>

        <div class="error-message" :class="{ show: showError }" role="alert" aria-live="assertive">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <span>{{ errorMessage }}</span>
      </div>

      <form @submit.prevent="handleLogin">
        <div class="form-group">
          <label for="adminUsername">后台账号</label>
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
              placeholder="输入后台账号"
              autocomplete="username"
              autofocus
              required
            >
          </div>
        </div>
        <div class="form-group">
          <label for="adminPassword">密码</label>
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
              placeholder="输入密码"
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
          {{ isLoading ? '验证中...' : '登录并进入工作台' }}
          <ArrowRight v-if="!isLoading" :size="18" aria-hidden="true" />
        </button>
      </form>

      <nav class="footer-links" aria-label="其他操作">
        <a href="#" @click.prevent="goToUserLogin" aria-label="返回用户登录">← 返回用户登录</a>
      </nav>
      </div>
      <p class="form-footnote">© 2026 课赛通 KST</p>
      </section>
  </AuthEntryShell>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Auth, showToast } from '@/utils'
import { adminLogin } from '@/utils/api'
import { useUserStore } from '@/stores/user'
import { z } from 'zod'
import BrandLockup from '@/components/brand/BrandLockup.vue'
import AuthEntryShell from '@/components/auth/AuthEntryShell.vue'
import AuthEntryBackdrop from '@/components/auth/AuthEntryBackdrop.vue'
import { ArrowRight, Headset, KeyRound, Shield, UsersRound } from '@lucide/vue'
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

<style scoped src="./admin-login.css"></style>
