<template>
  <AuthEntryShell class="login-page" variant="consumer">
    <AuthEntryBackdrop />
    <section class="login-brand" aria-labelledby="brand-heading">
      <div class="brand-content">
        <h1 id="brand-heading" class="brand-heading" aria-label="课赛通 KST · 跨境电商赛训效率平台">
          <BrandLockup class="login-brand-lockup" audience="login" layout="stacked" decorative />
        </h1>
        <div class="brand-story">
          <p class="brand-kicker">跨境电商赛训效率工具</p>
          <h2 class="brand-title">按要求做完了，<br><em>为什么分数还是上不去？</em></h2>
          <p class="brand-desc">把容易被忽略的评分细节和重复操作交给工具，<br>把时间留给真正影响结果的判断。</p>
          <ul class="pain-points" aria-label="常见困扰">
            <li><span class="pain-marker" aria-hidden="true"></span><span>隐性得分点容易漏</span></li>
            <li><span class="pain-marker" aria-hidden="true"></span><span>重复填写挤占研究时间</span></li>
            <li><span class="pain-marker" aria-hidden="true"></span><span>配置效果需要反复试</span></li>
          </ul>
          <p class="brand-boundary">从准备、配置到结果核对，每一步都保留清晰提示；需要你确认的地方，不会替你做决定。</p>
        </div>
      </div>
    </section>

    <!-- 右侧登录区 -->
    <div class="login-form-section">
      <div class="login-form-card login-card">
        <div class="logo-section">
          <div class="login-card-topline">
            <BrandMark class="logo-icon" :size="48" decorative />
            <div class="connection-status" :class="connectionStatusClass" aria-live="polite">
              <span class="status-dot"></span>
              <span>{{ connectionStatusText }}</span>
            </div>
          </div>
          <h2>登录课赛通</h2>
          <p>输入授权码，开始使用已开通的工具</p>
        </div>

        <form @submit.prevent="handleLogin">
          <div class="form-group">
            <label for="authCode">授权码</label>
            <div class="input-wrapper">
              <span class="input-icon" aria-hidden="true">
                <KeyRound :size="18" />
              </span>
              <input
                ref="authCodeInput"
                type="text"
                id="authCode"
                v-model="authCode"
              :disabled="isLoading"
                placeholder="输入你的授权码"
                autocomplete="one-time-code"
                autocapitalize="characters"
                spellcheck="false"
                autofocus
                required
                @focus="inputFocused = true"
                @blur="inputFocused = false"
              >
            </div>
            <p class="input-hint">授权码由为你开通服务的工作人员提供</p>
          </div>

          <!-- 错误消息 -->
          <div class="error-message" :class="{ show: showError }" role="alert" aria-live="assertive">
            <CircleAlert :size="16" aria-hidden="true" />
            <span>{{ errorMessage }}</span>
          </div>

          <button type="submit" class="btn-login" :disabled="isLoading" :aria-busy="isLoading">
            <span class="btn-content" :class="{ hidden: isLoading && !loginSucceeded }" :aria-hidden="isLoading && !loginSucceeded">
              <Check v-if="loginSucceeded" :size="20" />
              <LogIn v-else :size="20" />
              {{ loginSucceeded ? '登录成功，正在进入' : '登录并开始使用' }}
            </span>
            <span class="btn-loading" :class="{ visible: isLoading && !loginSucceeded }" :aria-hidden="!isLoading || loginSucceeded">
              <Loader :size="20" class="spinner" />
              验证中...
            </span>
          </button>
          <div class="device-info">
            <Monitor :size="15" aria-hidden="true" />
            <span>当前电脑：<strong>{{ deviceName }}</strong></span>
          </div>
        </form>

        <nav class="footer-links" aria-label="其他操作">
          <div class="footer-links-row">
            <a href="#" @click.prevent="showHelp" class="footer-link"><HelpCircle :size="15" />使用帮助</a>
            <a href="#" @click.prevent="showContact" class="footer-link"><Phone :size="15" />联系客服</a>
            <a href="#/user/terms" class="footer-link"><FileText :size="14" />服务条款</a>
          </div>
          <a href="#/admin/login" class="footer-link admin-link"><Shield :size="14" />管理端入口</a>
        </nav>
      </div>

      <!-- 底部版权 -->
      <div class="login-footer">
        <p>© 2026 课赛通 KST</p>
      </div>
    </div>

    <!-- 帮助弹窗 -->
    <div 
      class="modal-overlay" 
      :class="{ show: showHelpModal }" 
      @click.self="closeModals"
      @keydown.esc="closeModals"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-modal-title"
    >
      <div class="modal" ref="helpModalRef">
        <button class="modal-close" @click="closeModals" aria-label="关闭">
          <X :size="20" />
        </button>
        <h3 id="help-modal-title">
          <HelpCircle :size="20" />
          如何使用
        </h3>
        <div class="help-steps">
          <div class="help-step" v-for="(step, i) in helpSteps" :key="i">
            <span class="step-number">{{ i + 1 }}</span>
            <span class="step-text">{{ step }}</span>
          </div>
        </div>
        <div class="modal-notice">
          <AlertTriangle :size="16" />
          当前电脑会自动与授权绑定；如需更换电脑或增加设备，请联系为你开通服务的工作人员。
        </div>
        <div class="modal-btns">
          <button class="btn-confirm" @click="closeModals">我知道了</button>
        </div>
      </div>
    </div>

    <!-- 联系客服弹窗 -->
    <div 
      class="modal-overlay" 
      :class="{ show: showContactModal }" 
      @click.self="closeModals"
      @keydown.esc="closeModals"
      role="dialog"
      aria-modal="true"
      aria-labelledby="contact-modal-title"
    >
      <div class="modal" ref="contactModalRef">
        <button class="modal-close" @click="closeModals" aria-label="关闭">
          <X :size="20" />
        </button>
        <h3 id="contact-modal-title">
          <Phone :size="20" />
          联系客服
        </h3>
        <div class="contact-info">
          <p class="contact-desc">{{ wechatId ? '如有任何问题，请联系客服：' : '暂未提供公开联系方式，请联系为您开通授权的工作人员。' }}</p>
          <div v-if="wechatId" class="wechat-id-box">
            <span class="wechat-label">微信号：</span>
            <span class="wechat-id">{{ wechatId }}</span>
            <button class="copy-btn" @click="copyWechatId" :title="copySuccess ? '已复制' : '复制微信号'">
              <Check v-if="copySuccess" :size="16" />
              <Copy v-else :size="16" />
              {{ copySuccess ? '已复制' : '复制' }}
            </button>
          </div>
          <p v-if="copySuccess" class="copy-success">✓ 已复制到剪贴板</p>
        </div>
        <div class="modal-btns">
          <button class="btn-confirm" @click="closeModals">关闭</button>
        </div>
      </div>
    </div>
  </AuthEntryShell>
</template>

<script setup lang="ts">
import { Check, CircleAlert, KeyRound, Monitor, LogIn, Loader, HelpCircle, Phone, FileText, Shield, X, AlertTriangle, Copy } from '@lucide/vue'
import { useLicenseLogin } from '@/features/auth/useLicenseLogin'
import BrandLockup from '@/components/brand/BrandLockup.vue'
import BrandMark from '@/components/brand/BrandMark.vue'
import AuthEntryShell from '@/components/auth/AuthEntryShell.vue'
import AuthEntryBackdrop from '@/components/auth/AuthEntryBackdrop.vue'

const {
  authCode, authCodeInput, isLoading, loginSucceeded, showError, showHelpModal, showContactModal, copySuccess,
  errorMessage, inputFocused, deviceName, wechatId, helpSteps,
  connectionStatusClass, connectionStatusText, handleLogin, showHelp, showContact, copyWechatId, closeModals,
} = useLicenseLogin()
</script>

<style scoped>
/* ===== 页面布局 ===== */
.login-page {
  display: flex;
  min-height: 100vh;
  font-family: var(--font-family);
}

/* ===== 左侧品牌区 ===== */
.login-brand {
  flex: 1;
  background: linear-gradient(135deg, #0F172A 0%, #1E1B4B 40%, #312E81 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 3rem;
  position: relative;
  overflow: hidden;
}

/* 网格背景 */
.grid-bg {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(14, 165, 233, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(14, 165, 233, 0.06) 1px, transparent 1px);
  background-size: 40px 40px;
  z-index: 1;
}

/* 装饰几何图形 */
.brand-shapes {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
}

.shape {
  position: absolute;
}

.shape-circle-1 {
  width: 320px;
  height: 320px;
  background: radial-gradient(circle, rgba(14, 165, 233, 0.12) 0%, transparent 70%);
  border-radius: 50%;
  top: -80px;
  right: -60px;
  animation: float 8s cubic-bezier(0.16, 1, 0.3, 1) infinite;
}

.shape-circle-2 {
  width: 200px;
  height: 200px;
  background: radial-gradient(circle, rgba(255, 153, 0, 0.08) 0%, transparent 70%);
  border-radius: 50%;
  bottom: -40px;
  left: -30px;
  animation: float 6s ease-in-out infinite reverse;
}

.shape-circle-3 {
  width: 150px;
  height: 150px;
  background: radial-gradient(circle, rgba(14, 165, 233, 0.1) 0%, transparent 70%);
  border-radius: 50%;
  top: 50%;
  right: 15%;
  animation: float 10s cubic-bezier(0.16, 1, 0.3, 1) infinite;
}

.shape-ring-1 {
  width: 180px;
  height: 180px;
  border: 1px solid rgba(14, 165, 233, 0.1);
  border-radius: 50%;
  top: 20%;
  left: 10%;
  animation: spin 20s linear infinite;
}

.shape-ring-2 {
  width: 120px;
  height: 120px;
  border: 1px solid rgba(255, 153, 0, 0.08);
  border-radius: 50%;
  bottom: 25%;
  right: 10%;
  animation: spin 15s linear infinite reverse;
}

.shape-dot-1 {
  width: 6px;
  height: 6px;
  background: rgba(14, 165, 233, 0.3);
  border-radius: 50%;
  top: 30%;
  left: 25%;
  animation: pulse 3s cubic-bezier(0.16, 1, 0.3, 1) infinite;
}

.shape-dot-2 {
  width: 4px;
  height: 4px;
  background: rgba(255, 153, 0, 0.4);
  border-radius: 50%;
  top: 60%;
  right: 30%;
  animation: pulse 4s ease-in-out infinite 1s;
}

.shape-dot-3 {
  width: 5px;
  height: 5px;
  background: rgba(14, 165, 233, 0.3);
  border-radius: 50%;
  bottom: 35%;
  left: 40%;
  animation: pulse 3.5s cubic-bezier(0.16, 1, 0.3, 1) infinite 0.5s;
}

.shape-line-1 {
  width: 60px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(14, 165, 233, 0.2), transparent);
  top: 45%;
  left: 5%;
  transform: rotate(-30deg);
  animation: float 7s cubic-bezier(0.16, 1, 0.3, 1) infinite;
}

.shape-line-2 {
  width: 80px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 153, 0, 0.15), transparent);
  bottom: 40%;
  right: 5%;
  transform: rotate(20deg);
  animation: float 9s ease-in-out infinite reverse;
}

@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-15px); }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes pulse {
  0%, 100% { opacity: 0.4; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.5); }
}

/* 扫描线效果 */
.scan-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, 
    transparent, 
    rgba(14, 165, 233, 0.6), 
    transparent
  );
  box-shadow: 0 0 20px rgba(14, 165, 233, 0.4);
  animation: scanDown 4s cubic-bezier(0.16, 1, 0.3, 1) infinite;
  z-index: 3;
  pointer-events: none;
}

@keyframes scanDown {
  0% { 
    top: -2px; 
    opacity: 0;
  }
  10% {
    opacity: 1;
  }
  90% {
    opacity: 1;
  }
  100% { 
    top: 100%; 
    opacity: 0;
  }
}

/* 品牌内容 */
.brand-content {
  position: relative;
  z-index: 2;
  max-width: 460px;
  animation: fadeInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Logo */
.brand-logo {
  margin-bottom: 2rem;
}

.brand-heading { margin: 0; }
.login-brand-lockup { display: flex; }
.login-brand-lockup :deep(.kst-lockup-logo) { width: min(100%, 270px); max-height: 105px; }
.login-brand-lockup :deep(.kst-lockup-subtitle) { font-size: 13px; }

/* 分隔线 */
.brand-divider {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}

.divider-line {
  width: 40px;
  height: 2px;
  background: linear-gradient(90deg, var(--color-primary), var(--color-premium));
  border-radius: 1px;
}

.divider-dot {
  width: 6px;
  height: 6px;
  background: var(--color-premium);
  border-radius: 50%;
}

/* 描述 */
.brand-desc {
  font-size: 0.9rem;
  color: rgba(255, 255, 255, 0.45);
  line-height: 1.6;
  margin-bottom: 2.5rem;
}

/* 统计数据 */
.brand-stats {
  display: flex;
  gap: 2rem;
  margin-bottom: 2rem;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.stat-number-wrapper {
  display: flex;
  align-items: baseline;
  gap: 2px;
}

.stat-number {
  font-family: var(--font-family);
  font-size: 2.25rem;
  font-weight: 700;
  color: white;
  line-height: 1;
  animation: countUp 0.6s ease forwards;
  opacity: 0;
}

.stat-unit {
  font-family: var(--font-family);
  font-size: 1.25rem;
  font-weight: 600;
  color: #FF9900; /* 直接使用颜色值，确保显示正常 */
}

@keyframes countUp {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.stat-line {
  width: 32px;
  height: 2px;
  background: linear-gradient(90deg, var(--color-primary), transparent);
  border-radius: 1px;
}

.stat-desc {
  font-size: var(--type-control);
  color: rgba(255, 255, 255, 0.4);
  line-height: 1.4;
}

/* 功能标签 */
.feature-tags {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 0.5rem;
}

.feature-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.35rem 0.75rem;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 20px;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.6);
  transition: all 0.3s ease;
  justify-content: center;
  min-width: 0;
  white-space: nowrap;
}

.feature-tag:hover {
  background: rgba(14, 165, 233, 0.15);
  border-color: rgba(14, 165, 233, 0.3);
  color: white;
}

.feature-tag svg {
  color: var(--color-premium);
}

/* ===== 右侧登录区 ===== */
.login-form-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  background:
    radial-gradient(circle at 16% 18%, rgba(45, 95, 202, .045), transparent 30%),
    linear-gradient(118deg, #f8fafc 0%, #f8fafc 42%, #f6f8fb 72%, #f5f7fa 100%);
  position: relative;
}

.login-form-card {
  width: 100%;
  max-width: 420px;
  padding: 2.5rem;
  background: white;
  border-radius: 20px;
  border: 1px solid var(--color-border);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.04), 0 10px 30px -5px rgba(0, 0, 0, 0.06);
  position: relative;
  overflow: hidden;
  animation: slideInRight 0.6s ease forwards;
}

@keyframes slideInRight {
  from { opacity: 0; transform: translateX(20px); }
  to { opacity: 1; transform: translateX(0); }
}

/* 顶部装饰条 */
.card-accent {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--color-primary), var(--color-primary-muted), var(--color-premium));
}

/* Logo 区域 */
.logo-section {
  text-align: center;
  margin-bottom: 2rem;
}

.logo-icon {
  width: 56px;
  height: 56px;
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-muted));
  border-radius: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1rem;
  box-shadow: 0 4px 16px rgba(14, 165, 233, 0.25);
}

.logo-icon { padding: 10px; border: 1px solid rgba(21, 101, 255, .14); }

.logo-section h2 {
  font-family: var(--font-family);
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--color-text);
  margin-bottom: 0.4rem;
}

.logo-section p {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

/* 错误/成功消息 */
.error-message,
.success-message {
  display: none;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-radius: 12px;
  font-size: 0.85rem;
  margin-bottom: 1rem;
  animation: shakeIn 0.4s ease;
}

@keyframes shakeIn {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-4px); }
  75% { transform: translateX(4px); }
}

.error-message.show {
  display: flex;
  background: rgba(239, 68, 68, 0.08);
  color: var(--color-danger);
  border: 1px solid rgba(239, 68, 68, 0.15);
}

.success-message.show {
  display: flex;
  background: rgba(16, 185, 129, 0.08);
  color: var(--color-success);
  border: 1px solid rgba(16, 185, 129, 0.15);
}

.error-message svg,
.success-message svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

/* 连接状态 */
.connection-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
  margin-bottom: 1rem;
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  transition: all 0.3s ease;
}

.connection-status.online {
  background: rgba(16, 185, 129, 0.06);
  color: var(--color-success);
}

.connection-status.offline {
  background: rgba(245, 158, 11, 0.06);
  color: var(--color-warning);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  position: relative;
}

.connection-status.online .status-dot {
  background: var(--color-success);
}

.connection-status.online .status-dot::after {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: 50%;
  background: var(--color-success);
  opacity: 0.3;
  animation: ping 2s ease-in-out infinite;
}

.connection-status.offline .status-dot {
  background: var(--color-warning);
  animation: blink 1.5s ease-in-out infinite;
}

@keyframes ping {
  0% { transform: scale(1); opacity: 0.3; }
  100% { transform: scale(2); opacity: 0; }
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

/* 表单 */
.form-group {
  margin-bottom: 1.25rem;
}

.form-group label {
  display: block;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 0.5rem;
}

.input-wrapper {
  position: relative;
}

.input-icon {
  position: absolute;
  left: 0.875rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text-secondary);
  pointer-events: none;
  transition: color 0.3s ease;
}

.input-wrapper:focus-within .input-icon {
  color: var(--color-primary);
}

.input-icon svg {
  width: 18px;
  height: 18px;
}

.input-wrapper input {
  width: 100%;
  padding: 0.8rem 1rem 0.8rem 2.75rem;
  background: var(--color-canvas);
  border: 1.5px solid var(--color-border);
  border-radius: 12px;
  font-size: 0.9rem;
  font-family: var(--font-family);
  color: var(--color-text);
  caret-color: var(--color-primary);
  cursor: text;
  user-select: text;
  -webkit-user-select: text;
  -webkit-app-region: no-drag !important;
  pointer-events: auto;
  position: relative;
  z-index: 1;
  transition: all 0.3s ease;
  outline: none;
}

.input-wrapper input::placeholder {
  color: var(--color-text-secondary);
}

.input-wrapper input:focus {
  background: white;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.1);
}

/* 设备信息 */
.device-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: var(--color-surface-soft);
  border-radius: 10px;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  margin-bottom: 1.5rem;
  border: 1px solid var(--color-border);
}

.device-info svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--color-text-secondary);
}

.device-info strong {
  color: var(--color-text);
  font-weight: 600;
}

/* 登录按钮 */
.btn-login {
  width: 100%;
  padding: 0.9rem;
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-hover));
  color: white;
  border: none;
  border-radius: 12px;
  font-size: 0.95rem;
  font-weight: 600;
  font-family: var(--font-family);
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  position: relative;
  overflow: hidden;
}

.btn-login::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.1), transparent);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.btn-login:hover:not(:disabled)::before {
  opacity: 1;
}

.btn-login:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(14, 165, 233, 0.35);
}

.btn-login:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: 0 2px 8px rgba(14, 165, 233, 0.25);
}

.btn-login:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.btn-content,
.btn-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  transition: all 0.3s ease;
}

.btn-content.hidden {
  opacity: 0;
  transform: translateY(-10px);
  position: absolute;
}

.btn-loading {
  opacity: 0;
  transform: translateY(10px);
  position: absolute;
}

.btn-loading.visible {
  opacity: 1;
  transform: translateY(0);
  position: relative;
}

.btn-login svg {
  width: 20px;
  height: 20px;
}

.spinner {
  animation: spin 0.8s linear infinite;
}

/* ===== 弹窗 ===== */
.modal-overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.6);
  backdrop-filter: blur(8px);
  z-index: 1000;
  align-items: center;
  justify-content: center;
}

.modal-overlay.show {
  display: flex;
}

.modal {
  background: white;
  border-radius: 20px;
  padding: 2rem;
  max-width: 440px;
  width: 90%;
  box-shadow: 0 25px 50px rgba(0, 0, 0, 0.15);
  position: relative;
  animation: modalIn 0.3s ease;
}

@keyframes modalIn {
  from { opacity: 0; transform: scale(0.95) translateY(10px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

.modal-close {
  position: absolute;
  top: 1rem;
  right: 1rem;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.modal-close:hover {
  background: var(--color-surface-soft);
  color: var(--color-text);
}

.modal h3 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: var(--font-family);
  font-size: 1.1rem;
  color: var(--color-text);
  margin-bottom: 1.25rem;
}

.modal h3 svg {
  width: 20px;
  height: 20px;
  color: var(--color-primary);
}

/* 帮助步骤 */
.help-steps {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
}

.help-step {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.step-number {
  width: 24px;
  height: 24px;
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-muted));
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 700;
  flex-shrink: 0;
}

.step-text {
  font-size: 0.875rem;
  color: var(--el-text-color-regular);
  line-height: 1.5;
  padding-top: 2px;
}

.modal-notice {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: rgba(245, 158, 11, 0.06);
  border: 1px solid rgba(245, 158, 11, 0.15);
  border-radius: 10px;
  font-size: var(--type-control);
  color: #92400E;
  margin-bottom: 1.5rem;
}

.modal-notice svg {
  flex-shrink: 0;
  margin-top: 1px;
}

.modal-btns {
  display: flex;
  justify-content: flex-end;
}

.btn-confirm {
  padding: 0.625rem 1.5rem;
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-hover));
  color: white;
  border: none;
  border-radius: 10px;
  font-weight: 600;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.3s ease;
}

.btn-confirm:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(14, 165, 233, 0.3);
}

/* 联系客服弹窗 */
.contact-info {
  margin-bottom: 1.5rem;
}

.contact-desc {
  font-size: 0.9rem;
  color: var(--color-text);
  margin-bottom: 1rem;
}

.wechat-id-box {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: var(--color-surface-soft);
  border-radius: 10px;
  border: 1px solid var(--color-border);
}

.wechat-label {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.wechat-id {
  flex: 1;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-primary);
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
}

.copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.375rem 0.75rem;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: var(--type-control);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.copy-btn:hover {
  background: var(--color-primary-hover);
  transform: translateY(-1px);
}

.copy-btn svg {
  width: 14px;
  height: 14px;
}

.copy-success {
  margin-top: 0.5rem;
  font-size: var(--type-meta);
  color: var(--color-success);
  text-align: center;
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* ===== 响应式 ===== */
@media (max-width: 1024px) {
  .login-page {
    flex-direction: column;
  }

  .login-brand {
    padding: 2.5rem 2rem;
    min-height: 320px;
  }

  .brand-stats {
    gap: 1.5rem;
  }

  .stat-number {
    font-size: 1.75rem;
  }

  .login-form-section {
    padding: 2rem 1.5rem;
  }
}

@media (max-width: 640px) {
  .login-brand {
    min-height: 260px;
    padding: 2rem 1.5rem;
  }

  .brand-desc {
    display: none;
  }

  .brand-stats {
    gap: 1rem;
  }

  .stat-number {
    font-size: 1.5rem;
  }

  .stat-desc {
    font-size: 0.7rem;
  }

  .feature-tags {
    display: none;
  }

  .login-form-card {
    padding: 1.75rem;
  }
}

/* v6 明亮精密主题：保留承诺内容，移除深色赛博装饰 */
.login-page { background: var(--color-canvas); }
.login-brand {
  flex: 1.08;
  padding: clamp(40px, 6vw, 88px);
  color: var(--color-text);
  background: var(--color-surface-premium);
  border-right: 1px solid var(--color-border);
}
.grid-bg,
.brand-shapes,
.scan-line { display: none; }
.brand-content { max-width: 540px; animation-duration: var(--motion-signature); }
.login-form-card .logo-icon {
  background: #fff;
  box-shadow: 0 10px 24px rgba(21, 101, 255, .12);
}
.brand-desc { color: var(--color-text-secondary); }
.brand-divider .divider-line { background: var(--color-border-strong); }
.brand-divider .divider-dot { background: var(--color-premium); box-shadow: none; }
.brand-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  padding: 22px 0;
  border-top: 1px solid var(--color-border);
  border-bottom: 1px solid var(--color-border);
}
.stat-item {
  min-width: 0;
  padding: 0 22px;
  border-right: 1px solid var(--color-border);
}
.stat-item:first-child { padding-left: 0; }
.stat-item:last-child { padding-right: 0; border-right: 0; }
.stat-number-wrapper { min-height: 48px; }
.stat-number {
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: clamp(38px, 3.2vw, 48px);
  font-weight: 720;
  letter-spacing: -.045em;
  background: none;
  text-shadow: none;
  -webkit-background-clip: initial;
  -webkit-text-fill-color: var(--color-text);
}
.stat-unit {
  display: inline-flex;
  min-width: 1.15em;
  align-items: baseline;
  color: var(--color-premium);
  opacity: 1;
  -webkit-text-fill-color: var(--color-premium);
  font-size: clamp(15px, 1.25vw, 19px);
  font-weight: 700;
  letter-spacing: .02em;
  white-space: nowrap;
}
.stat-line { width: 28px; margin-top: 2px; background: var(--color-premium); opacity: .45; }
.stat-desc { max-width: 150px; color: var(--color-text-secondary); line-height: 1.55; }
.feature-tag {
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  background: rgba(252, 252, 253, .72);
  box-shadow: none;
}
.feature-tag svg { color: var(--color-success); }
.login-form-section { flex: .92; padding: clamp(32px, 5vw, 72px); background: var(--color-canvas); }
.login-form-card {
  max-width: 460px;
  padding: clamp(28px, 4vw, 44px);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background: var(--color-surface);
  box-shadow: var(--shadow-medium);
}
.card-accent { height: 3px; background: linear-gradient(90deg, var(--color-primary), var(--color-premium)); }
.logo-section h2 { color: var(--color-text); letter-spacing: -.02em; }
.logo-section p { color: var(--color-text-secondary); }
.connection-status { border-color: var(--color-border); background: var(--color-surface-soft); }
.connection-status.online { color: var(--color-success); }
.form-group label { color: var(--color-text); font-weight: 700; }
.input-wrapper input {
  border-color: var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text);
  background: var(--color-surface);
  caret-color: var(--color-primary);
}
.input-wrapper input:focus { border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-focus-ring); }
.input-icon { color: var(--color-text-tertiary); }
.device-info { color: var(--color-text-secondary); background: var(--color-surface-soft); }
.device-info svg { color: var(--color-primary); }
.btn-login {
  border-radius: var(--radius-md);
  background: var(--color-primary);
  box-shadow: 0 8px 20px rgba(45, 95, 202, .18);
}
.btn-login:hover:not(:disabled) { background: var(--color-primary-hover); box-shadow: 0 11px 26px rgba(45, 95, 202, .24); }
.error-message { color: var(--color-danger); border-color: rgba(195, 61, 73, .18); background: var(--color-danger-soft); }
.success-message { color: var(--color-success); border-color: rgba(22, 138, 99, .18); background: var(--color-success-soft); }
.modal-overlay { background: var(--color-overlay); backdrop-filter: blur(5px); }
.modal { border: 1px solid var(--color-border); border-radius: var(--radius-xl); box-shadow: var(--shadow-overlay); }

@media (max-width: 1024px) and (min-width: 900px) {
  .login-page { flex-direction: row; }
  .login-brand {
    flex: .94;
    min-width: 0;
    min-height: 100vh;
    padding: 36px 30px;
    border-right: 1px solid var(--color-border);
    border-bottom: 0;
  }
  .login-form-section { flex: 1.06; min-width: 0; padding: 32px 24px; }
  .brand-content { max-width: 460px; }
  .login-brand-lockup :deep(.kst-lockup-logo) { width: min(100%, 230px); }
  .brand-desc { margin-bottom: 24px; }
  .brand-stats { gap: 0; padding: 18px 0; margin-bottom: 18px; }
  .stat-item { padding: 0 12px; }
  .stat-number { font-size: 30px; }
  .stat-desc { font-size:var(--type-meta); }
  .feature-tags { gap: 5px; }
  .feature-tag { padding: 6px 4px; font-size:var(--type-micro); }
  .login-form-card { padding: 30px 28px; }
}

@media (max-width: 899px) {
  .login-page {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-content: center;
    min-height: 100svh;
    padding: 24px;
  }
  .login-brand {
    min-height: auto;
    padding: 0;
    border: 0;
    background: transparent;
    overflow: visible;
  }
  .brand-content { width: min(100%, 460px); max-width: none; margin: 0 auto; }
  .brand-divider, .brand-desc, .brand-stats { display: none; }
  .brand-logo { margin-bottom: 14px; }
  .brand-heading { display: flex; justify-content: center; }
  .login-brand-lockup { align-items: center; }
  .login-brand-lockup :deep(.kst-lockup-logo) { width: min(100%, 190px); max-height: 68px; object-position: center; }
  .login-brand-lockup :deep(.kst-lockup-subtitle) { font-size: var(--type-micro); text-align: center; }
  .feature-tags { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
  .feature-tag { padding: 6px 4px; font-size:var(--type-meta); background: var(--color-surface); }
  .login-form-section { padding: 16px 0 0; background: transparent; }
  .login-form-card { max-width: 460px; padding: 26px 28px; }
}

@media (max-width: 520px) {
  .login-page { align-content: start; padding: 18px 14px; }
  .login-brand-lockup :deep(.kst-lockup-logo) { width: min(100%, 168px); }
  .login-form-card { padding: 24px 18px; }
}

/* v7 视觉收口：痛点优先、单一阅读轴、低频品牌动效 */
.login-page {
  min-height: 100svh;
  color: var(--color-text);
  background: #f4f6f9;
  font-family: Inter, "PingFang SC", "Microsoft YaHei", sans-serif;
}
.login-brand {
  flex: 1.08;
  min-width: 0;
  padding: clamp(42px, 6vw, 88px);
  isolation: isolate;
  overflow: hidden;
  background: #f8f9fb;
  border-right: 1px solid #e2e7ef;
}
.brand-content { width: min(100%, 570px); max-width: 570px; z-index: 2; animation: loginContentIn 480ms var(--ease-emphasized, cubic-bezier(.2,.8,.2,1)) both; }
.brand-shapes { display: none; }
.grid-bg { display: block; opacity: .34; z-index: 0; background-size: 56px 56px; background-image: linear-gradient(rgba(45,95,202,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(45,95,202,.035) 1px, transparent 1px); }
.login-brand::after { content: ''; position: absolute; width: 68px; height: 1px; top: 20%; left: 8%; z-index: 1; background: linear-gradient(90deg, transparent, rgba(45,95,202,.28), transparent); transform: rotate(-28deg); animation: brandMeteor 16s ease-in-out infinite; pointer-events: none; }
.brand-logo { margin-bottom: 30px; }
.login-brand-lockup :deep(.kst-lockup-logo) { width: min(100%, 270px); }
.brand-kicker { margin: 0 0 11px; color: var(--color-primary); font-size: 13px; font-weight: 800; letter-spacing: .12em; }
.brand-desc { margin: 0 0 28px; color: #182033; font-size: clamp(25px, 2.4vw, 38px); font-weight: 760; letter-spacing: -.045em; line-height: 1.23; }
.brand-desc em { color: var(--color-primary); font-style: normal; }
.brand-divider { width: min(100%, 300px); margin: 0 0 23px; justify-content: flex-start; }
.brand-divider .divider-line:first-child { flex: 0 0 68px; }
.brand-divider .divider-line:last-child { flex: 1; opacity: .45; }
.brand-divider .divider-dot { width: 5px; height: 5px; margin: 0 9px; background: var(--color-premium); }
.brand-stats.pain-points { display: grid; grid-template-columns: 1fr; gap: 0; margin: 0 0 20px; padding: 0; border: 0; }
.pain-item { display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: 11px; align-items: start; min-width: 0; padding: 14px 0; border: 0; border-bottom: 1px solid #e2e7ef; }
.pain-item:last-child { border-bottom: 0; }
.pain-index { padding-top: 2px; color: var(--color-premium); font-family: var(--font-mono); font-size: 13px; font-weight: 800; letter-spacing: .08em; }
.pain-item strong { display: block; margin-bottom: 3px; color: #182033; font-size: 16px; font-weight: 750; }
.pain-item p { margin: 0; color: #667085; font-size: 13px; line-height: 1.55; }
.brand-boundary { max-width: 430px; margin: 0 0 24px; color: #667085; font-size: 12px; line-height: 1.65; }
.feature-tags { display: flex; align-items: center; flex-wrap: wrap; gap: 0; color: #667085; font-size: 12px; }
.feature-tags-label { margin-right: 13px; color: #98a2b3; font-size: 11px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
.feature-tag { display: inline-flex; align-items: center; gap: 5px; padding: 0 12px; border: 0; border-left: 1px solid #d8dee8; border-radius: 0; color: #667085; background: transparent; font-size: 12px; line-height: 1.5; }
.feature-tag svg { color: var(--color-primary); }
.scan-line { display: block; top: 0; left: 0; right: 0; height: 1px; z-index: 3; opacity: 0; background: linear-gradient(90deg, transparent, rgba(45,95,202,.24), transparent); animation: brandScan 12s 1.4s ease-in-out infinite; pointer-events: none; }
.login-form-section { flex: .92; min-width: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: clamp(36px, 5vw, 76px); background: #f4f6f9; }
.login-form-card { width: min(100%, 440px); max-width: 440px; padding: 38px 40px 32px; border: 1px solid #dfe5ed; border-radius: 18px; background: #fff; box-shadow: 0 18px 46px rgba(24,32,51,.10); animation: loginCardIn 520ms 50ms var(--ease-emphasized, cubic-bezier(.2,.8,.2,1)) both; }
.card-accent { height: 2px; margin: -38px -40px 31px; background: linear-gradient(90deg, var(--color-primary), rgba(169,133,82,.8), transparent); }
.login-form-card .logo-icon { background: #fff; border: 1px solid #e2e7ef; border-radius: 13px; box-shadow: 0 7px 18px rgba(45,95,202,.10); animation: logoBreath 6s ease-in-out infinite; }
.logo-section { margin-bottom: 23px; }
.logo-section h2 { margin-top: 16px; color: #182033; font-size: 24px; font-weight: 760; letter-spacing: -.035em; }
.logo-section p { margin-top: 7px; color: #667085; font-size: 14px; line-height: 1.6; }
.connection-status { min-height: 34px; margin: 0 0 20px; padding: 0 11px; border: 1px solid #e2e7ef; border-radius: 9px; color: #667085; background: #f8f9fb; font-size: 12px; }
.form-group { margin-bottom: 16px; }
.form-group label { margin-bottom: 7px; color: #182033; font-size: 14px; font-weight: 700; }
.input-wrapper input { height: 50px; padding: 0 42px; border: 1px solid #d8dee8; border-radius: 9px; color: #182033; background: #fff; font-size: 15px; }
.input-wrapper input::placeholder { color: #98a2b3; }
.input-wrapper input:focus { border-color: var(--color-primary); box-shadow: 0 0 0 3px rgba(45,95,202,.12); }
.device-info { min-height: 36px; margin-bottom: 22px; padding: 6px 11px; border-radius: 8px; color: #667085; background: #f8f9fb; font-size: 12px; }
.device-info strong { color: #344054; font-weight: 650; }
.btn-login { min-height: 50px; border-radius: 9px; background: var(--color-primary); box-shadow: 0 8px 20px rgba(45,95,202,.18); font-size: 15px; font-weight: 700; }
.btn-login:hover:not(:disabled) { background: var(--color-primary-hover); box-shadow: 0 11px 26px rgba(45,95,202,.24); transform: translateY(-1px); }
@keyframes loginContentIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
@keyframes loginCardIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
@keyframes logoBreath { 0%, 100% { box-shadow: 0 7px 18px rgba(45,95,202,.10); } 50% { box-shadow: 0 9px 24px rgba(45,95,202,.18); } }
@keyframes brandScan { 0%, 18% { opacity: 0; transform: translateY(-10px); } 28% { opacity: .8; } 46% { opacity: 0; transform: translateY(100vh); } 100% { opacity: 0; transform: translateY(100vh); } }
@keyframes brandMeteor { 0%, 62% { opacity: 0; transform: translate(-10px, -10px) rotate(-28deg); } 67% { opacity: .7; } 76%, 100% { opacity: 0; transform: translate(35vw, 18vh) rotate(-28deg); } }
@media (max-width: 1024px) and (min-width: 900px) {
  .login-brand { padding: 36px 30px; }
  .brand-desc { font-size: 29px; }
  .pain-item { padding: 11px 0; }
  .login-form-section { padding: 32px 24px; }
  .login-form-card { padding-left: 30px; padding-right: 30px; }
  .card-accent { margin-left: -30px; margin-right: -30px; }
}
@media (max-width: 899px) {
  .login-page { display: grid; grid-template-columns: minmax(0, 1fr); align-content: center; padding: 28px 24px; }
  .login-brand { padding: 0; border: 0; background: transparent; }
  .brand-content { width: min(100%, 460px); max-width: none; margin: 0 auto; }
  .brand-logo { margin-bottom: 16px; }
  .brand-heading { justify-content: center; }
  .login-brand-lockup { align-items: center; }
  .login-brand-lockup :deep(.kst-lockup-logo) { width: min(100%, 190px); }
  .brand-kicker, .brand-desc { display: block; }
  .brand-kicker { margin-bottom: 7px; text-align: center; }
  .brand-desc { margin: 0 auto 16px; font-size: clamp(23px, 5.5vw, 30px); text-align: center; }
  .brand-stats, .brand-boundary { display: none; }
  .feature-tags { justify-content: center; margin-bottom: 8px; row-gap: 8px; }
  .feature-tags-label { flex-basis: 100%; margin: 0; text-align: center; }
  .feature-tag { padding: 0 7px; }
  .login-form-section { padding: 16px 0 0; background: transparent; }
  .login-form-card { width: min(100%, 440px); padding: 30px 28px 26px; }
  .card-accent { margin: -30px -28px 27px; }
}
@media (max-width: 520px) {
  .login-page { align-content: start; padding: 18px 14px 24px; }
  .brand-stats.pain-points { display: grid; grid-template-columns: 1fr; gap: 0; margin-bottom: 16px; }
  .pain-item { grid-template-columns: 28px minmax(0, 1fr); gap: 8px; padding: 9px 0; }
  .pain-item strong { font-size: 14px; }
  .pain-item p { font-size: 12px; line-height: 1.45; }
  .login-form-card { padding: 26px 18px 22px; }
  .card-accent { margin: -26px -18px 24px; }
  .feature-tags .feature-tag:nth-child(2) { border-left: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .brand-content, .login-form-card, .login-form-card .logo-icon, .scan-line, .login-brand::after, .brand-shapes *, .btn-login { animation: none !important; transition: none !important; transform: none !important; }
}

/* v8：把登录页收束成“识别问题 → 说明范围 → 立即进入”的单一阅读轴。 */
.login-brand {
  position: relative;
  background:
    radial-gradient(circle at 78% 18%, rgba(45,95,202,.07), transparent 31%),
    linear-gradient(135deg, #fafbfc 0%, #f5f7fa 58%, #eef3f9 100%);
}
.login-brand::before {
  content: '';
  position: absolute;
  width: 520px;
  height: 520px;
  right: -210px;
  bottom: -270px;
  border: 1px solid rgba(45,95,202,.12);
  border-radius: 50%;
  box-shadow: 0 0 0 44px rgba(45,95,202,.025), 0 0 0 88px rgba(45,95,202,.018);
  pointer-events: none;
}
.brand-content { position: relative; }
.brand-desc { max-width: 470px; }
.brand-stats.pain-points { max-width: 520px; }
.pain-item { grid-template-columns: 31px minmax(0, 1fr); }
.pain-item strong { font-size: 15px; }
.pain-item p { max-width: 28em; }
.feature-tags { max-width: 520px; gap: 0; }
.feature-tag { padding-left: 13px; padding-right: 13px; }
.feature-tags-secondary {
  flex-basis: 100%;
  margin: 8px 0 0 84px;
  color: #98a2b3;
  font-size: 11px;
  white-space: nowrap;
}
.feature-tags-secondary::before { content: '辅助记录 ·'; margin-right: 8px; color: #b1bac8; }
.login-form-card { box-shadow: 0 22px 56px rgba(24,32,51,.12), 0 1px 2px rgba(24,32,51,.04); }
.connection-status { letter-spacing: .01em; }
.btn-login { transition: background-color 180ms ease, box-shadow 180ms ease, transform 180ms ease; }

@media (max-width: 899px) {
  .login-brand::before { width: 340px; height: 340px; right: -160px; bottom: -180px; }
  .feature-tags-secondary { margin: 3px 0 0; text-align: center; }
  .feature-tags-secondary::before { display: none; }
}

@media (max-width: 520px) {
  .feature-tags { gap: 5px 0; }
  .feature-tag { padding-left: 8px; padding-right: 8px; font-size: 11px; }
  .feature-tags-secondary { font-size: 10px; }
}

@media (prefers-reduced-motion: reduce) {
  .login-brand::before { transition: none !important; }
}

/* v9：按已确认的 2 号方向改为斜向精密流线；保留品牌层级，不使用同心圆。 */
.login-brand {
  background:
    linear-gradient(135deg, #fbfcfe 0%, #f4f7fb 57%, #eaf0f8 100%);
}
.login-brand::before {
  inset: 0;
  width: auto;
  height: auto;
  right: auto;
  bottom: auto;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  background:
    linear-gradient(118deg, transparent 0 57%, rgba(48, 93, 188, .06) 57.1% 57.35%, transparent 57.5%),
    linear-gradient(118deg, transparent 0 69%, rgba(35, 144, 157, .055) 69.1% 69.3%, transparent 69.45%);
  pointer-events: none;
}
.grid-bg {
  opacity: .42;
  background-size: 84px 84px, 132px 132px;
  background-image:
    repeating-linear-gradient(116deg, rgba(45, 95, 202, .055) 0 1px, transparent 1px 84px),
    repeating-linear-gradient(24deg, rgba(31, 120, 139, .032) 0 1px, transparent 1px 132px);
  -webkit-mask-image: linear-gradient(110deg, rgba(0,0,0,.9), rgba(0,0,0,.18) 72%, transparent 100%);
  mask-image: linear-gradient(110deg, rgba(0,0,0,.9), rgba(0,0,0,.18) 72%, transparent 100%);
}
.brand-shapes {
  display: block;
  z-index: 1;
}
.precision-line {
  position: absolute;
  display: block;
  height: 1px;
  transform-origin: left center;
  opacity: .75;
  pointer-events: none;
  filter: drop-shadow(0 0 7px rgba(45, 95, 202, .08));
}
.precision-line-a {
  width: 118%;
  left: -22%;
  top: 24%;
  transform: rotate(-20deg);
  background: linear-gradient(90deg, transparent 0%, rgba(45,95,202,.05) 12%, rgba(45,95,202,.58) 48%, rgba(216,160,75,.55) 71%, transparent 100%);
  animation: precisionDriftA 24s ease-in-out infinite;
}
.precision-line-b {
  width: 94%;
  left: 6%;
  top: 42%;
  transform: rotate(-20deg);
  background: linear-gradient(90deg, transparent, rgba(29,102,128,.32) 36%, rgba(45,95,202,.46) 66%, transparent);
  animation: precisionDriftB 29s ease-in-out infinite reverse;
}
.precision-line-c {
  width: 80%;
  left: -8%;
  top: 66%;
  transform: rotate(-20deg);
  background: linear-gradient(90deg, transparent, rgba(216,160,75,.48) 45%, rgba(45,95,202,.25) 75%, transparent);
  animation: precisionDriftC 22s ease-in-out infinite;
}
.precision-line-d {
  width: 58%;
  left: 28%;
  top: 82%;
  transform: rotate(-20deg);
  background: linear-gradient(90deg, transparent, rgba(35,144,157,.28) 40%, rgba(45,95,202,.22) 80%, transparent);
  animation: precisionDriftD 26s ease-in-out infinite reverse;
}
.precision-node {
  position: absolute;
  width: 7px;
  height: 7px;
  border: 1px solid rgba(216,160,75,.7);
  border-radius: 50%;
  background: rgba(255,255,255,.72);
  box-shadow: 0 0 0 5px rgba(216,160,75,.08);
  animation: precisionNodePulse 5.8s ease-in-out infinite;
}
.precision-node-a { top: 23%; left: 47%; }
.precision-node-b { top: 41%; left: 71%; animation-delay: 1.3s; border-color: rgba(45,95,202,.55); box-shadow: 0 0 0 5px rgba(45,95,202,.07); }
.precision-node-c { top: 65%; left: 26%; animation-delay: 2.2s; border-color: rgba(35,144,157,.55); box-shadow: 0 0 0 5px rgba(35,144,157,.07); }
@keyframes precisionDriftA { 0%,100% { transform: translate3d(0,0,0) rotate(-20deg); opacity: .48; } 50% { transform: translate3d(18px,8px,0) rotate(-19deg); opacity: .82; } }
@keyframes precisionDriftB { 0%,100% { transform: translate3d(0,0,0) rotate(-20deg); opacity: .34; } 50% { transform: translate3d(-14px,6px,0) rotate(-21deg); opacity: .7; } }
@keyframes precisionDriftC { 0%,100% { transform: translate3d(0,0,0) rotate(-20deg); opacity: .28; } 50% { transform: translate3d(12px,-5px,0) rotate(-19deg); opacity: .62; } }
@keyframes precisionDriftD { 0%,100% { transform: translate3d(0,0,0) rotate(-20deg); opacity: .2; } 50% { transform: translate3d(-10px,-4px,0) rotate(-21deg); opacity: .5; } }
@keyframes precisionNodePulse { 0%,100% { transform: scale(1); opacity: .5; } 50% { transform: scale(1.18); opacity: .95; } }
@media (prefers-reduced-motion: reduce) {
  .precision-line,
  .precision-node { animation: none !important; }
}

/* v10：把用户端精密线收束为一组完整的斜向动势，避免零散悬浮线。 */
.login-brand::before {
  background:
    linear-gradient(116deg, transparent 0 31%, rgba(45,95,202,.055) 31.1% 31.35%, transparent 31.5%),
    linear-gradient(116deg, transparent 0 48%, rgba(31,120,139,.045) 48.1% 48.3%, transparent 48.45%),
    linear-gradient(116deg, transparent 0 72%, rgba(216,160,75,.05) 72.1% 72.3%, transparent 72.45%);
  animation: precisionFieldDrift 20s ease-in-out infinite;
}
.login-brand::after {
  content: '';
  position: absolute;
  width: 124%;
  height: 220px;
  left: -34%;
  top: 58%;
  z-index: 1;
  pointer-events: none;
  background: linear-gradient(110deg, transparent 0%, rgba(45,95,202,.035) 33%, rgba(45,95,202,.10) 51%, rgba(216,160,75,.055) 62%, transparent 79%);
  clip-path: polygon(0 46%, 100% 0, 100% 54%, 0 100%);
  transform: rotate(-8deg) translate3d(-2%, 0, 0);
  opacity: .75;
  animation: precisionBandDrift 18s cubic-bezier(.4,0,.2,1) infinite;
}
.precision-plane {
  position: absolute;
  left: -18%;
  top: 20%;
  width: 124%;
  height: 1px;
  transform: rotate(-20deg);
  background: linear-gradient(90deg, transparent, rgba(45,95,202,.18) 31%, rgba(35,144,157,.24) 54%, rgba(216,160,75,.2) 73%, transparent);
  filter: drop-shadow(0 0 13px rgba(45,95,202,.1));
  animation: precisionPlaneDrift 22s ease-in-out infinite reverse;
}
.precision-line-a { opacity: .92; animation-duration: 19s; }
.precision-line-b { opacity: .58; animation-duration: 23s; }
.precision-line-c { opacity: .48; animation-duration: 21s; }
.precision-line-d { opacity: .36; animation-duration: 25s; }
@keyframes precisionFieldDrift { 0%,100% { transform: translate3d(-1%,0,0); opacity: .62; } 50% { transform: translate3d(2%,1%,0); opacity: .9; } }
@keyframes precisionBandDrift { 0%,16% { transform: rotate(-8deg) translate3d(-7%, 0, 0); opacity: .24; } 48% { opacity: .72; } 78%,100% { transform: rotate(-8deg) translate3d(7%, 2%, 0); opacity: .18; } }
@keyframes precisionPlaneDrift { 0%,100% { transform: rotate(-20deg) translate3d(0,0,0); opacity: .38; } 50% { transform: rotate(-19deg) translate3d(15px,5px,0); opacity: .82; } }
@media (prefers-reduced-motion: reduce) {
  .login-brand::before,
  .login-brand::after,
  .precision-plane { animation: none !important; transform: none !important; }
}

/* v11：以概念图 2 为唯一基准；覆盖历史 v7-v10 叠加层，避免装饰越叠越大。 */
.login-page.auth-entry-shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  width: 100%;
  min-height: 100vh;
  overflow: hidden;
  background:
    radial-gradient(circle at 16% 18%, rgba(45, 95, 202, .045), transparent 30%),
    linear-gradient(118deg, #f8fafc 0%, #f8fafc 42%, #f6f8fb 72%, #f5f7fa 100%);
}
.login-page.auth-entry-shell > .login-brand {
  flex: initial;
  min-height: 100vh;
  padding: clamp(34px, 5vw, 72px);
  background: transparent;
  border-right: 0;
}
.login-page.auth-entry-shell > .login-brand::before,
.login-page.auth-entry-shell > .login-brand::after,
.login-page.auth-entry-shell .grid-bg,
.login-page.auth-entry-shell .scan-line { display: none !important; }
.login-page.auth-entry-shell > .login-brand .brand-shapes {
  inset: 0;
  width: auto;
  height: auto;
  opacity: 1;
  background: none;
  filter: none;
  transform: none;
}
.login-page.auth-entry-shell > .login-form-section {
  min-height: 100vh;
  padding: 48px clamp(28px, 5vw, 76px);
  background: transparent;
}
.login-page.auth-entry-shell .login-form-card {
  width: min(420px, 100%);
  max-width: 100%;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background: var(--color-surface);
  box-shadow: var(--shadow-medium);
}
.login-page.auth-entry-shell .brand-content { position: relative; z-index: 1; }
@media (max-width: 760px) {
  .login-page.auth-entry-shell { grid-template-columns: 1fr; overflow-y: auto; }
  .login-page.auth-entry-shell > .login-brand { min-height: 330px; padding: 32px 24px 28px; }
  .login-page.auth-entry-shell > .login-form-section { min-height: 0; padding: 24px 18px 66px; }
}

/* v12：把登录页左侧从抽象背景改成真实产品结构预览；不改变登录行为。 */
.login-page.auth-entry-shell > .login-brand { position: relative; }
.login-page.auth-entry-shell > .login-brand .brand-product-scene {
  position: relative;
  z-index: 1;
  width: min(100%, 500px);
  margin-top: 22px;
}
.login-page.auth-entry-shell .brand-content { width: min(100%, 560px); max-width: 560px; }
.login-page.auth-entry-shell .brand-boundary { max-width: 455px; }
.login-page.auth-entry-shell .feature-tags { max-width: 480px; }
.login-page.auth-entry-shell .brand-shapes { display: none !important; }

@media (max-width: 1180px) and (min-width: 761px) {
  .login-page.auth-entry-shell > .login-brand .brand-product-scene { width: min(100%, 470px); margin-top: 18px; }
  .login-page.auth-entry-shell .brand-content { width: min(100%, 500px); max-width: 500px; }
  .login-page.auth-entry-shell .pain-item p { max-width: 24em; }
}

@media (max-width: 760px) {
  .login-page.auth-entry-shell > .login-brand { min-height: 0; }
  .login-page.auth-entry-shell > .login-brand .brand-product-scene {
    position: static;
    width: min(100%, 500px);
    margin: 18px auto 0;
  }
  .login-page.auth-entry-shell .brand-content { max-width: none; }
}

/* v13：收窄信息密度；辅助范围保持一行，不再把标签拆成第二栏。 */
.login-page.auth-entry-shell .brand-boundary { max-width: 430px; margin-bottom: 16px; }
.login-page.auth-entry-shell .feature-tags-secondary {
  flex-basis: auto;
  margin: 0 0 0 8px;
  color: #98a2b3;
  white-space: nowrap;
}
.login-page.auth-entry-shell .feature-tags-secondary::before { content: '·'; margin-right: 8px; color: #b1bac8; }
.login-page.auth-entry-shell .brand-product-scene { margin-top: 18px; }
@media (max-width: 760px) {
  .login-page.auth-entry-shell .brand-stats.pain-points { display: none !important; }
  .login-page.auth-entry-shell .feature-tags-secondary { margin: 0; }
  .login-page.auth-entry-shell .feature-tags-secondary::before { display: none; }
}

/* 回到最初的流程示意版：背景只做轻微呼吸，不改变阅读轴。 */
.login-page {
  display: grid;
  grid-template-columns: minmax(0, 1.06fr) minmax(0, 1fr);
  min-height: 100vh;
  min-height: 100svh;
  overflow: hidden;
  color: var(--color-text);
  background: var(--color-surface);
  font-family: var(--font-family);
}
.login-brand {
  position: relative;
  min-width: 0;
  display: flex;
  padding: 48px;
  overflow: hidden;
  isolation: isolate;
  border-right: 1px solid var(--color-border);
  background: radial-gradient(ellipse at 12% 74%, rgba(45,95,202,.045), transparent 65%), var(--color-surface-premium);
}
.login-brand::before {
  content: '';
  position: absolute;
  inset: -12% -8%;
  z-index: -1;
  pointer-events: none;
  background: radial-gradient(ellipse at 18% 68%, rgba(45,95,202,.10), transparent 42%), radial-gradient(ellipse at 75% 28%, rgba(169,133,82,.045), transparent 36%);
  opacity: .55;
  transform: translate3d(0, 0, 0) scale(1);
  animation: auth-surface-breathe 22s ease-in-out infinite;
}
.login-brand::after {
  content: '';
  position: absolute;
  top: 18%;
  left: 8%;
  width: 120px;
  height: 1px;
  pointer-events: none;
  background: linear-gradient(90deg, transparent, rgba(45,95,202,.20), transparent);
  transform: rotate(-20deg);
  opacity: .48;
  animation: auth-surface-glint 18s ease-in-out infinite;
}
.brand-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: space-between;
  gap: 48px;
  max-width: 480px;
  margin: 0 auto;
}
.brand-heading { margin: 0; line-height: 1; }
.login-brand-lockup :deep(.kst-lockup-logo) { width: 112px; height: 40px; }
.login-brand-lockup :deep(.kst-lockup-subtitle) { font-size: 12px; font-weight: 500; }
.brand-story { padding: 8px 0; }
.brand-kicker { margin: 0 0 20px; color: var(--color-primary); font-size: 13px; font-weight: 600; letter-spacing: .1em; }
.brand-title { margin: 0; color: var(--color-text); font-size: clamp(28px, 3vw, 40px); font-weight: 650; line-height: 1.5; letter-spacing: -.045em; }
.brand-desc { margin: 20px 0 0; color: var(--color-text-secondary); font-size: 14px; line-height: 1.9; }
.brand-note { margin: 0; color: var(--color-text-secondary); font-size: 12px; line-height: 1.6; }
.brand-illustration { margin: 40px 0 0; }
.illustration-scene { position: relative; display: grid; gap: 16px; padding: 4px 0; }
.illustration-guide { position: absolute; top: 32px; bottom: 32px; left: 40px; width: 1px; background: var(--color-border-strong); transform: rotate(-24deg); transform-origin: top center; }
.workflow-card { position: relative; z-index: 1; display: flex; align-items: center; gap: 16px; width: calc(100% - 64px); min-height: 76px; padding: 16px 20px; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); box-shadow: var(--shadow-low); animation: auth-workflow-float 9s ease-in-out infinite; }
.workflow-card-select { margin-right: 64px; }
.workflow-card-prepare { margin-left: 32px; border-color: #c6d5f3; animation-delay: -3s; }
.workflow-card-record { margin-left: 64px; animation-delay: -6s; }
.workflow-icon { display: inline-grid; flex: 0 0 40px; place-items: center; width: 40px; height: 40px; border-radius: var(--radius-md); color: var(--color-primary); background: var(--color-primary-soft); }
.workflow-card-record .workflow-icon { color: #876838; background: var(--color-premium-soft); }
.workflow-copy { min-width: 0; display: grid; gap: 4px; }
.workflow-copy strong { font-size: 14px; font-weight: 600; line-height: 1.5; }
.workflow-copy span { color: var(--color-text-secondary); font-size: 12px; line-height: 1.5; }
.workflow-number { margin-left: auto; color: #8993a4; font: 12px/1 var(--font-mono); }
.illustration-caption { margin: 16px 0 0; color: var(--color-text-secondary); font-size: 12px; line-height: 1.6; }
.login-form-section { min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 24px; padding: 48px; background: var(--color-surface); }
.login-form-card { width: 100%; max-width: 440px; padding: 40px; border: 1px solid var(--color-border); border-radius: var(--radius-xl); background: var(--color-surface); box-shadow: var(--shadow-low); }
.logo-section { margin-bottom: 40px; }
.login-card-topline { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.logo-icon { padding: 4px; }
.logo-section h2 { margin: 0; color: var(--color-text); font-size: 28px; font-weight: 650; line-height: 1.4; letter-spacing: -.025em; }
.logo-section p { margin: 12px 0 0; color: var(--color-text-secondary); font-size: 14px; line-height: 1.7; }
.connection-status { display: inline-flex; align-items: center; gap: 8px; color: var(--color-text-secondary); font-size: 12px; line-height: 1.5; }
.status-dot { flex: 0 0 auto; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.connection-status.online { color: var(--color-success); }
.connection-status.offline { color: var(--color-warning); }
.connection-status.connecting { color: var(--color-text-secondary); }
.form-group { margin-bottom: 24px; }
.form-group label { display: block; margin-bottom: 12px; font-size: 14px; font-weight: 600; line-height: 1.5; }
.input-wrapper { position: relative; }
.input-icon { position: absolute; z-index: 1; top: 50%; left: 16px; color: var(--color-text-secondary); transform: translateY(-50%); pointer-events: none; }
.input-wrapper input { display: block; width: 100%; min-width: 0; height: 56px; box-sizing: border-box; padding: 16px 16px 16px 48px; border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); outline: none; color: var(--color-text); background: var(--color-surface); font-size: 15px; line-height: 1.5; caret-color: var(--color-primary); transition: border-color var(--motion-fast), box-shadow var(--motion-fast); }
.input-wrapper input::placeholder { color: var(--color-text-secondary); opacity: .8; }
.input-wrapper input:hover:not(:disabled) { border-color: #a4b3cc; }
.input-wrapper input:focus { border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-focus-ring); }
.input-wrapper input:disabled { cursor: wait; background: var(--color-surface-soft); }
.input-hint { margin: 12px 0 0; color: var(--color-text-secondary); font-size: 12px; line-height: 1.65; }
.error-message { display: none; align-items: flex-start; gap: 8px; margin: -8px 0 20px; padding: 12px; border: 1px solid rgba(195,61,73,.18); border-radius: var(--radius-md); color: var(--color-danger); background: var(--color-danger-soft); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
.error-message.show { display: flex; }
.error-message svg { flex: 0 0 auto; margin-top: 2px; }
.btn-login { position: relative; display: grid; place-items: center; width: 100%; min-height: 52px; padding: 12px 16px; border: 1px solid transparent; border-radius: var(--radius-md); color: #fff; background: var(--color-primary); font-size: 15px; font-weight: 600; line-height: 1.6; cursor: pointer; transition: background-color var(--motion-fast), transform var(--motion-press); }
.btn-login:hover:not(:disabled) { background: var(--color-primary-hover); }
.btn-login:active:not(:disabled) { transform: translateY(1px); }
.btn-login:disabled { cursor: wait; }
.btn-content, .btn-loading { display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
.btn-content.hidden { visibility: hidden; }
.btn-loading { position: absolute; inset: 0; visibility: hidden; }
.btn-loading.visible { visibility: visible; }
.spinner { animation: auth-spinner 1.2s linear infinite; }
.device-info { display: flex; justify-content: center; align-items: center; gap: 8px; margin-top: 20px; color: var(--color-text-secondary); font-size: 12px; line-height: 1.6; }
.device-info svg { flex: 0 0 auto; margin-top: 0; }
.device-info > span { min-width: 0; overflow-wrap: anywhere; text-align: center; }
.device-info strong { font-weight: 500; }
@keyframes auth-surface-breathe { 0%, 100% { opacity: .40; transform: translate3d(0, 0, 0) scale(1); } 50% { opacity: .72; transform: translate3d(14px, -8px, 0) scale(1.025); } }
@keyframes auth-surface-glint { 0%, 22% { opacity: 0; transform: translate3d(-12px, -4px, 0) rotate(-20deg); } 38% { opacity: .46; } 56%, 100% { opacity: 0; transform: translate3d(130px, 92px, 0) rotate(-20deg); } }
@keyframes auth-workflow-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
@keyframes auth-spinner { to { transform: rotate(360deg); } }
@media (max-width: 1199px) and (min-width: 900px) {
  .login-brand { padding: 40px 32px; }
  .brand-content { gap: 40px; }
  .login-brand-lockup :deep(.kst-lockup-logo) { width: 96px; height: 36px; }
  .brand-title { font-size: 32px; }
  .login-form-section { padding: 40px 32px; }
  .login-form-card { padding: 32px; }
  .workflow-card { width: calc(100% - 48px); gap: 12px; padding: 16px; }
  .workflow-card-select { margin-right: 48px; }
  .workflow-card-prepare { margin-left: 24px; }
  .workflow-card-record { margin-left: 48px; }
  .workflow-number { display: none; }
}
@media (max-width: 899px) {
  .login-page { grid-template-columns: minmax(0, 1fr); align-content: center; gap: 32px; padding: 40px 24px 24px; overflow-y: auto; background: var(--color-surface-premium); }
  .login-brand { padding: 0; border: 0; background: transparent; }
  .brand-content { align-items: center; gap: 0; max-width: 440px; }
  .brand-story, .brand-note { display: none; }
  .login-form-section { gap: 20px; padding: 0; background: transparent; }
}
@media (max-width: 479px) {
  .login-page { align-content: start; gap: 24px; padding: 32px 16px 24px; }
  .login-form-card { padding: 32px 24px; }
  .logo-section { margin-bottom: 32px; }
  .logo-section h2 { font-size: 26px; }
  .logo-section p { font-size: 13px; }
  .login-card-topline { margin-bottom: 20px; }
}
@media (prefers-reduced-motion: reduce) {
  .login-brand::before, .login-brand::after, .workflow-card, .spinner { animation: none !important; }
  .input-wrapper input, .btn-login, .footer-link, .modal-overlay { transition: none !important; }
  .btn-login:active:not(:disabled) { transform: none; }
}

/* 目标版登录页：沿用已确认的双栏比例，只保留克制的品牌线条。 */
.login-page.auth-entry-shell {
  grid-template-columns: minmax(0, 1.04fr) minmax(400px, .96fr);
  padding: 0;
  overflow-y: auto;
  background: var(--auth-entry-background);
}

.login-page.auth-entry-shell > .login-brand {
  position: relative;
  min-height: 100vh;
  min-height: 100svh;
  padding: clamp(42px, 6vw, 84px) clamp(32px, 7vw, 104px);
  overflow: hidden;
  isolation: isolate;
  border-right: 0;
  background: transparent;
}

.login-page.auth-entry-shell > .login-brand::before,
.login-page.auth-entry-shell > .login-brand::after,
.login-page.auth-entry-shell .grid-bg,
.login-page.auth-entry-shell .scan-line {
  display: none !important;
}

.login-page.auth-entry-shell .brand-shapes {
  display: block !important;
  inset: 0;
  width: auto;
  height: auto;
  opacity: 1;
  background: transparent !important;
  filter: none !important;
  transform: none !important;
}

.login-page.auth-entry-shell .brand-content {
  position: relative;
  z-index: 1;
  width: min(100%, 560px);
  max-width: 560px;
  min-height: 100%;
  margin: 0;
  justify-content: space-between;
  gap: 48px;
}

.login-page.auth-entry-shell .brand-heading {
  margin: 0;
}

.login-page.auth-entry-shell .login-brand-lockup :deep(.kst-lockup-logo) {
  width: 206px;
  height: auto;
  max-height: 76px;
}

.login-page.auth-entry-shell .login-brand-lockup :deep(.kst-lockup-subtitle) {
  color: #68758a;
  font-size: 12px;
  letter-spacing: .08em;
}

.login-page.auth-entry-shell .brand-story {
  max-width: 520px;
  margin-top: auto;
  padding: 0 0 18px;
}

.login-page.auth-entry-shell .brand-kicker {
  margin: 0 0 20px;
  color: #496fb9;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: .13em;
}

.login-page.auth-entry-shell .brand-title {
  max-width: 500px;
  margin: 0;
  color: #1e2b43;
  font-size: clamp(30px, 3.55vw, 52px);
  font-weight: 680;
  line-height: 1.28;
  letter-spacing: -.045em;
}

.login-page.auth-entry-shell .brand-title em {
  color: #4169b4;
  font-style: normal;
}

.login-page.auth-entry-shell .brand-desc {
  max-width: 460px;
  margin: 24px 0 0;
  color: #68758a;
  font-size: 15px;
  line-height: 1.9;
}

.login-page.auth-entry-shell .pain-points {
  display: grid;
  gap: 13px;
  margin: 30px 0 0;
  padding: 0;
  color: #3e4d66;
  font-size: 14px;
  line-height: 1.5;
  list-style: none;
}

.login-page.auth-entry-shell .pain-points li {
  display: flex;
  align-items: center;
  gap: 11px;
}

.login-page.auth-entry-shell .pain-marker {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #5c7ec3;
  box-shadow: 0 0 0 5px rgba(92, 126, 195, .09);
}

.login-page.auth-entry-shell .brand-boundary {
  max-width: 470px;
  margin: 28px 0 0;
  color: #8a95a6;
  font-size: 12px;
  line-height: 1.75;
}

.login-page.auth-entry-shell > .login-form-section {
  position: relative;
  z-index: 1;
  min-height: 100vh;
  min-height: 100svh;
  padding: 48px clamp(24px, 5.5vw, 82px);
  background: transparent;
}

.login-page.auth-entry-shell .login-form-card {
  width: min(100%, 420px);
  max-width: 420px;
  padding: 42px 40px 32px;
  border: 1px solid rgba(28, 48, 83, .11);
  border-radius: 22px;
  background: #fff;
  box-shadow: 0 22px 60px rgba(38, 57, 89, .09);
}

.login-page.auth-entry-shell .logo-section {
  margin-bottom: 34px;
}

.login-page.auth-entry-shell .login-card-topline {
  margin-bottom: 28px;
}

.login-page.auth-entry-shell .logo-section h2 {
  color: #1e2b43;
  font-size: 27px;
  font-weight: 680;
}

.login-page.auth-entry-shell .logo-section p {
  margin-top: 10px;
  color: #758197;
}

.login-page.auth-entry-shell .form-group label {
  color: #35435b;
}

.login-page.auth-entry-shell .input-wrapper input {
  border-color: #d8e0eb;
  background: #fff;
}

.login-page.auth-entry-shell .input-wrapper input:focus {
  border-color: #587bc0;
  box-shadow: 0 0 0 3px rgba(88, 123, 192, .13);
}

.login-page.auth-entry-shell .btn-login {
  min-height: 52px;
  border-radius: 12px;
  background: #456fbe;
  box-shadow: 0 8px 18px rgba(69, 111, 190, .16);
}

.login-page.auth-entry-shell .btn-login:hover:not(:disabled) {
  background: #3b63a9;
  box-shadow: 0 10px 22px rgba(69, 111, 190, .22);
}

.login-page.auth-entry-shell .device-info {
  margin-top: 18px;
  color: #7c8798;
}

.login-page.auth-entry-shell .footer-links {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--color-border);
}

.login-page.auth-entry-shell .footer-links-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px 8px;
  width: 100%;
  min-width: 0;
}

.login-page.auth-entry-shell .footer-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 32px;
  padding: 4px;
  border-radius: 6px;
  color: #5b6a80;
  font-size: 13px;
  line-height: 1.5;
  text-decoration: none;
  white-space: nowrap;
  transition: color 160ms ease, background-color 160ms ease;
}

.login-page.auth-entry-shell .footer-link:hover {
  color: #456fbe;
  background: rgba(69, 111, 190, .05);
}

.login-page.auth-entry-shell .footer-link svg {
  flex: 0 0 14px;
  width: 14px;
  height: 14px;
}

.login-page.auth-entry-shell .admin-link {
  color: #778398;
  font-weight: 500;
}

.login-page.auth-entry-shell .login-footer {
  flex: 0 0 auto;
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.6;
  text-align: center;
}

@media (max-width: 900px) and (min-width: 761px) {
  .login-page.auth-entry-shell > .login-brand { padding-inline: 42px; }
  .login-page.auth-entry-shell .brand-title { font-size: 36px; }
  .login-page.auth-entry-shell .login-form-card { padding-inline: 30px; }
}

@media (max-width: 760px) {
  .login-page.auth-entry-shell {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }

  .login-page.auth-entry-shell > .login-brand {
    min-height: 480px;
    padding: 34px 24px 28px;
    border-right: 0;
    border-bottom: 0;
  }

  .login-page.auth-entry-shell .brand-content {
    min-height: 0;
    gap: 28px;
  }

  .login-page.auth-entry-shell .brand-story { margin-top: 0; padding-bottom: 0; }
  .login-page.auth-entry-shell .brand-title { font-size: clamp(30px, 8vw, 42px); }
  .login-page.auth-entry-shell .brand-desc { font-size: 14px; }
  .login-page.auth-entry-shell .pain-points { gap: 10px; margin-top: 22px; }
  .login-page.auth-entry-shell .brand-boundary { margin-top: 20px; }
  .login-page.auth-entry-shell > .login-form-section {
    min-height: 0;
    padding: 28px 18px 24px;
  }
  .login-page.auth-entry-shell .login-form-card { padding: 34px 24px 28px; }
}

@media (max-width: 420px) {
  .login-page.auth-entry-shell > .login-brand { min-height: 470px; padding-inline: 20px; }
  .login-page.auth-entry-shell .login-brand-lockup :deep(.kst-lockup-logo) { width: 174px; }
  .login-page.auth-entry-shell .brand-kicker { margin-bottom: 14px; font-size: 12px; }
  .login-page.auth-entry-shell .brand-title { font-size: 29px; }
  .login-page.auth-entry-shell .brand-desc { margin-top: 16px; font-size: 13px; }
  .login-page.auth-entry-shell .pain-points { font-size: 13px; }
  .login-page.auth-entry-shell .login-form-card { padding-inline: 20px; }
}

@media (prefers-reduced-motion: reduce) {
  .login-page.auth-entry-shell *,
  .login-page.auth-entry-shell *::before,
  .login-page.auth-entry-shell *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}

/* 最终视觉收束：让品牌信息保持一条清晰阅读轴，装饰线退到右侧背景。 */
.login-page.auth-entry-shell > .login-brand {
  background: transparent;
}

.login-page.auth-entry-shell .brand-shapes {
  right: -18%;
  left: 18%;
  opacity: .48;
  transform: none;
  clip-path: inset(0 0 0 12%);
}

.login-page.auth-entry-shell .brand-content {
  width: min(100%, 610px);
  max-width: 610px;
}

.login-page.auth-entry-shell .brand-story {
  display: block;
}

.login-page.auth-entry-shell .brand-title {
  max-width: 590px;
  font-size: clamp(32px, 3.15vw, 46px);
  line-height: 1.2;
}

.login-page.auth-entry-shell .brand-desc {
  max-width: 500px;
  line-height: 1.8;
}

.login-page.auth-entry-shell > .login-form-section {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
  box-sizing: border-box;
}

.login-page.auth-entry-shell .login-form-card {
  flex: 0 0 auto;
  width: min(100%, 420px);
  height: auto;
  min-height: 0;
  overflow: visible;
}

@media (max-width: 760px) {
  .login-page.auth-entry-shell .brand-shapes {
    right: -6%;
    left: 0;
    opacity: .32;
    clip-path: inset(0 0 0 30%);
  }
}

/* 可读性与层级优化：正文先于装饰，关键操作保持高对比。 */
.login-page.auth-entry-shell .brand-shapes {
  inset: -8% -10% -8% 8%;
  opacity: .24;
  clip-path: none;
  mask-image: linear-gradient(90deg, transparent 0%, transparent 34%, rgba(0, 0, 0, .42) 53%, #000 78%);
  transform: scale(1.08);
  transform-origin: 70% 50%;
}

.login-page.auth-entry-shell .brand-kicker {
  margin-bottom: 16px;
  color: #2f5fae;
  font-size: 14px;
  letter-spacing: .08em;
}

.login-page.auth-entry-shell .brand-title {
  max-width: 610px;
  color: #17243a;
  font-size: clamp(34px, 3.35vw, 50px);
  line-height: 1.16;
}

.login-page.auth-entry-shell .brand-title em { color: #2f63b8; }

.login-page.auth-entry-shell .brand-desc {
  max-width: 520px;
  color: #52617a;
  font-size: 16px;
  font-weight: 500;
  line-height: 1.85;
}

.login-page.auth-entry-shell .pain-points {
  max-width: 540px;
  gap: 0;
  margin-top: 26px;
  color: #35455f;
  font-size: 15px;
}

.login-page.auth-entry-shell .pain-points li {
  min-height: 44px;
  box-sizing: border-box;
  border-bottom: 1px solid rgba(63, 86, 124, .14);
}

.login-page.auth-entry-shell .pain-points li:last-child { border-bottom: 0; }

.login-page.auth-entry-shell .brand-boundary {
  max-width: 500px;
  color: #6f7d91;
  font-size: 13px;
}

.login-page.auth-entry-shell .login-form-card {
  width: min(100%, 440px);
  padding: 46px 44px 34px;
  border-radius: 24px;
  box-shadow: 0 24px 64px rgba(38, 57, 89, .12);
}

.login-page.auth-entry-shell .logo-section h2 {
  color: #17243a;
  font-size: 30px;
}

.login-page.auth-entry-shell .logo-section p {
  color: #5f6d83;
  font-size: 14px;
}

.login-page.auth-entry-shell .form-group label {
  color: #263752;
  font-size: 14px;
}

.login-page.auth-entry-shell .input-wrapper input {
  min-height: 58px;
  color: #1e2c44;
  font-size: 16px;
  border-color: #c9d4e4;
}

.login-page.auth-entry-shell .input-wrapper input::placeholder { color: #74829a; }

.login-page.auth-entry-shell .input-hint {
  color: #6a7890;
  font-size: 13px;
}

.login-page.auth-entry-shell .btn-login {
  min-height: 56px;
  font-size: 16px;
}

.login-page.auth-entry-shell .device-info { color: #52617a; }

@media (max-width: 760px) {
  .login-page.auth-entry-shell .brand-shapes {
    inset: -10% -22% -8% -10%;
    opacity: .18;
    clip-path: none;
    mask-image: linear-gradient(90deg, transparent 0%, transparent 38%, rgba(0, 0, 0, .38) 62%, #000 92%);
    transform: scale(1.08);
  }

  .login-page.auth-entry-shell > .login-brand::after {
    inset: -10% -22% -8% 26%;
  }
  .login-page.auth-entry-shell .brand-title {
    max-width: 350px;
    font-size: clamp(28px, 7.5vw, 34px);
    letter-spacing: -.05em;
    text-wrap: balance;
  }
  .login-page.auth-entry-shell .brand-desc { font-size: 15px; }
  .login-page.auth-entry-shell .login-form-card { width: min(100%, 420px); padding: 34px 24px 28px; }
}

@media (max-width: 420px) {
  .login-page.auth-entry-shell .login-form-card { padding-inline: 20px; }
}
</style>
