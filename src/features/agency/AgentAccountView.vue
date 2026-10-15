<template>
  <section class="account-panel">
    <span class="eyebrow">账号信息</span><h1>个人账号</h1>
    <p>此账号用于客户跟进与授权交付，不具有平台管理权限。</p>
    <dl><dt>显示名称</dt><dd>{{ user?.display_name || '—' }}</dd><dt>登录账号</dt><dd>{{ user?.username || '—' }}</dd><dt>当前角色</dt><dd>代理运营</dd><dt>数据范围</dt><dd>归属本代理的客户、订单、授权及售后</dd></dl>
    <div class="actions">
      <el-button
        type="primary"
        @click="router.push('/admin/change-password')"
      >
        修改密码
      </el-button><el-button
        :loading="leaving"
        @click="logout"
      >
        退出登录
      </el-button>
    </div>
  </section>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAgentProfile } from './useAgentProfile'
import { logoutStaff } from '@/utils/api'
import { Auth } from '@/utils'
const router = useRouter()
const user = useAgentProfile()
const leaving = ref(false)
async function logout(): Promise<void> {
  leaving.value = true
  try { await logoutStaff() } catch { /* Always release this local session. */ }
  finally { Auth.clear(); await router.replace('/admin/login'); leaving.value = false }
}
</script>
<style scoped>
.account-panel{max-width:750px;padding:32px;border:1px solid var(--color-border);border-radius:16px;background:var(--color-surface)}.eyebrow{font-size:11px;letter-spacing:.12em;color:var(--color-primary);font-weight:700}h1{margin:12px 0;font-size:26px}p{color:var(--color-text-secondary);line-height:1.7}dl{display:grid;grid-template-columns:90px 1fr;gap:20px;margin:32px 0}dt{color:var(--color-text-tertiary);font-size:13px}dd{margin:0;overflow-wrap:anywhere;font-size:14px}.actions{display:flex;gap:12px;padding-top:24px;border-top:1px solid var(--color-border)}
</style>
