<template>
  <main class="password-page">
    <section class="password-card">
      <BrandLockup class="password-brand" audience="admin" layout="horizontal" />
      <span class="eyebrow">后台安全</span>
      <h1>{{ forced ? '首次登录请修改密码' : '修改后台密码' }}</h1>
      <p>{{ forced ? '当前临时密码仅用于首次登录。设置新密码后才能进入工作台。' : '修改后其他设备上的旧登录凭证会立即失效。' }}</p>
      <div v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</div>
      <form @submit.prevent="submit">
        <label for="current-password">当前密码</label>
        <el-input id="current-password" v-model="currentPassword" type="password" show-password autocomplete="current-password" />
        <label for="new-password">新密码</label>
        <el-input id="new-password" v-model="newPassword" type="password" show-password autocomplete="new-password" />
        <small>至少 10 位，且不能与当前密码相同。</small>
        <label for="confirm-password">确认新密码</label>
        <el-input id="confirm-password" v-model="confirmPassword" type="password" show-password autocomplete="new-password" />
        <button type="submit" :disabled="submitting">{{ submitting ? '正在保存…' : '保存新密码' }}</button>
      </form>
      <button v-if="!forced" class="back" type="button" @click="router.back()">返回</button>
      <button class="logout" type="button" @click="logout">退出登录</button>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { changeStaffPassword, logoutStaff } from '@/utils/api'
import { staffAuthResponseSchema } from '@/features/auth/staffModel'
import { authService } from '@/utils/auth'
import { useUserStore } from '@/stores/user'
import { Auth, showToast } from '@/utils'
import BrandLockup from '@/components/brand/BrandLockup.vue'

const router = useRouter()
const userStore = useUserStore()
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const submitting = ref(false)
const errorMessage = ref('')
const forced = computed(() => authService.getUser()?.force_password_reset === true)

async function submit() {
  errorMessage.value = ''
  if (!currentPassword.value) return void (errorMessage.value = '请输入当前密码')
  if (newPassword.value.length < 10) return void (errorMessage.value = '新密码至少 10 位')
  if (newPassword.value === currentPassword.value) return void (errorMessage.value = '新密码不能与当前密码相同')
  if (newPassword.value !== confirmPassword.value) return void (errorMessage.value = '两次输入的新密码不一致')
  submitting.value = true
  try {
    const response = staffAuthResponseSchema.parse(await changeStaffPassword(currentPassword.value, newPassword.value))
    if (!response.success || !response.data) throw new Error(response.message)
    userStore.setLogin({
      token: response.data.token,
      role: response.data.role,
      auth_code: 'backoffice',
      user: { ...response.data, force_password_reset: false },
    })
    Auth.set('backoffice')
    showToast('密码已修改', 'success')
    await router.replace(response.data.role === 'agent' ? '/agent/overview' : '/admin/dashboard')
  } catch (error) {
    errorMessage.value = error instanceof Error && error.message ? error.message : '密码修改失败'
  } finally { submitting.value = false }
}

async function logout() {
  try { await logoutStaff() }
  catch { /* 即使服务端不可达，也必须清理本地临时会话。 */ }
  finally {
    Auth.clear()
    await router.replace('/admin/login')
  }
}
</script>

<style scoped>
.password-page{min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--color-canvas)}.password-card{width:min(460px,100%);padding:34px;border:1px solid var(--color-border);border-radius:20px;background:var(--color-surface);box-shadow:var(--shadow-overlay)}.password-brand{display:flex;margin-bottom:26px;padding-bottom:20px;border-bottom:1px solid var(--color-border)}.eyebrow{color:var(--color-primary);font-size:var(--type-micro);font-weight:800;letter-spacing:.12em}.password-card h1{margin:10px 0 8px;font-size:26px;letter-spacing:-.035em}.password-card>p{margin:0 0 22px;color:var(--color-text-secondary);line-height:1.65}.password-card form{display:grid;gap:9px}.password-card label{margin-top:7px;color:var(--color-text);font-size:var(--type-control);font-weight:700}.password-card small{color:var(--color-text-tertiary)}.password-card form button{min-height:44px;margin-top:14px;border:0;border-radius:10px;color:#fff;background:var(--color-primary);font-weight:800;cursor:pointer}.password-card form button:disabled{opacity:.55;cursor:not-allowed}.error{margin-bottom:14px;padding:10px;border-radius:8px;color:var(--color-danger);background:var(--color-danger-soft);font-size:var(--type-control)}.back,.logout{margin-top:15px;padding:0;border:0;color:var(--color-primary);background:transparent;cursor:pointer}.logout{float:right;color:var(--color-text-secondary)}
</style>
