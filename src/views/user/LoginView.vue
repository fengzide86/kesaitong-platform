<template>
  <main class="login-page">
    <!-- 左侧品牌区 -->
    <div class="login-brand">
      <!-- 动态背景网格 -->
      <div class="grid-bg" aria-hidden="true"></div>
      <!-- 装饰几何图形 -->
      <div class="brand-shapes" aria-hidden="true">
        <div class="shape shape-circle-1"></div>
        <div class="shape shape-circle-2"></div>
        <div class="shape shape-circle-3"></div>
        <div class="shape shape-ring-1"></div>
        <div class="shape shape-ring-2"></div>
        <div class="shape shape-dot-1"></div>
        <div class="shape shape-dot-2"></div>
        <div class="shape shape-dot-3"></div>
        <div class="shape shape-line-1"></div>
        <div class="shape shape-line-2"></div>
      </div>

      <div class="brand-content">
        <!-- Logo -->
        <div class="brand-logo">
          <h1 class="brand-heading" aria-label="课赛通 KST · 跨境电商赛训效率平台">
            <BrandLockup class="login-brand-lockup" audience="login" layout="stacked" decorative />
          </h1>
        </div>

        <div class="brand-divider">
          <span class="divider-line"></span>
          <span class="divider-dot"></span>
          <span class="divider-line"></span>
        </div>
        <p class="brand-desc">面向跨境电商赛训与实训场景<br>提供轻量化效率工具，提升操作效率</p>

        <!-- 核心数据 -->
        <div class="brand-stats">
          <div class="stat-item" v-for="(stat, index) in stats" :key="index">
            <div class="stat-number-wrapper">
              <span class="stat-number" :style="{ animationDelay: `${index * 0.2}s` }">{{ stat.value }}</span>
              <span class="stat-unit" data-testid="login-stat-unit">{{ stat.unit }}</span>
            </div>
            <div class="stat-line"></div>
            <div class="stat-desc">{{ stat.desc }}</div>
          </div>
        </div>

        <!-- 功能标签 -->
        <div class="feature-tags">
          <span class="feature-tag" v-for="tag in featureTags" :key="tag">
            <Check :size="12" />
            {{ tag }}
          </span>
        </div>
      </div>
      
      <!-- 扫描线效果 -->
      <div class="scan-line" aria-hidden="true"></div>
    </div>

    <!-- 右侧登录区 -->
    <div class="login-form-section">
      <div class="login-form-card">
        <!-- 顶部装饰 -->
        <div class="card-accent" aria-hidden="true"></div>

        <div class="logo-section">
          <BrandMark class="logo-icon" :size="56" decorative />
          <h2>授权码登录</h2>
          <p>请输入授权码激活您的工具箱</p>
        </div>

        <!-- 错误消息 -->
        <div class="error-message" :class="{ show: showError }" role="alert" aria-live="assertive">
          <CircleAlert :size="18" />
          <span>{{ errorMessage }}</span>
        </div>

        <!-- 连接状态 -->
        <div class="connection-status" :class="connectionStatusClass" aria-live="polite">
          <span class="status-dot"></span>
          <span>{{ connectionStatusText }}</span>
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
                placeholder="请输入您的授权码"
                autocomplete="one-time-code"
                autocapitalize="characters"
                spellcheck="false"
                autofocus
                required
                @focus="inputFocused = true"
                @blur="inputFocused = false"
              >
              <span class="input-highlight" :class="{ active: inputFocused }"></span>
            </div>
          </div>

          <div class="device-info">
            <Monitor :size="16" />
            <span>已检测到设备：<strong>{{ deviceName }}</strong></span>
          </div>

          <button type="submit" class="btn-login" :disabled="isLoading" :aria-busy="isLoading">
            <span class="btn-content" :class="{ hidden: isLoading && !loginSucceeded }" :aria-hidden="isLoading && !loginSucceeded">
              <Check v-if="loginSucceeded" :size="20" />
              <LogIn v-else :size="20" />
              {{ loginSucceeded ? '验证通过，正在进入' : '验证并登录' }}
            </span>
            <span class="btn-loading" :class="{ visible: isLoading && !loginSucceeded }" :aria-hidden="!isLoading || loginSucceeded">
              <Loader :size="20" class="spinner" />
              验证中...
            </span>
          </button>
        </form>

        <nav class="footer-links" aria-label="其他操作">
          <a href="#" @click.prevent="showHelp" class="footer-link">
            <HelpCircle :size="14" />
            使用帮助
          </a>
          <a href="#" @click.prevent="showContact" class="footer-link">
            <Phone :size="14" />
            联系客服
          </a>
          <a href="#/user/terms" class="footer-link">
            <FileText :size="14" />
            服务条款
          </a>
          <a href="#/admin/login" class="footer-link admin-link">
            <Shield :size="14" />
            管理员登录
          </a>
        </nav>
      </div>

      <!-- 底部版权 -->
      <div class="login-footer">
        <p>© 2026 课赛通 KST · 专业 · 高效 · 可信赖</p>
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
          系统会根据套餐自动绑定当前设备，如需更换或增加设备请联系客服。
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
  </main>
</template>

<script setup lang="ts">
import { Check, CircleAlert, KeyRound, Monitor, LogIn, Loader, HelpCircle, Phone, FileText, Shield, X, AlertTriangle, Copy } from '@lucide/vue'
import { useLicenseLogin } from '@/features/auth/useLicenseLogin'
import BrandLockup from '@/components/brand/BrandLockup.vue'
import BrandMark from '@/components/brand/BrandMark.vue'

const {
  authCode, authCodeInput, isLoading, loginSucceeded, showError, showHelpModal, showContactModal, copySuccess,
  errorMessage, inputFocused, deviceName, wechatId, stats, featureTags, helpSteps,
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
  background: var(--color-canvas);
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

/* 底部链接 */
.footer-links {
  display: grid;
  grid-template-columns: repeat(4, max-content);
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin-top: 1.5rem;
}

.footer-link {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: var(--type-control);
  color: var(--color-text-secondary);
  text-decoration: none;
  transition: all 0.2s ease;
  padding: 0.25rem 0.4rem;
  border-radius: 6px;
}

.footer-link:hover {
  color: var(--color-primary);
  background: rgba(14, 165, 233, 0.05);
}

.footer-link svg {
  width: 14px;
  height: 14px;
}

.admin-link {
  color: var(--color-primary);
  font-weight: 500;
}

.admin-link:hover {
  color: var(--color-primary-hover);
  background: rgba(14, 165, 233, 0.08);
}

/* 底部版权 */
.login-footer {
  margin-top: 2rem;
  text-align: center;
}

.login-footer p {
  font-size: var(--type-meta);
  color: var(--color-text-secondary);
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

  .footer-links {
    gap: 0.3rem;
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
.logo-section p,
.login-footer { color: var(--color-text-secondary); }
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
.footer-link { color: var(--color-text-secondary); }
.footer-link:hover { color: var(--color-primary); }
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
  .login-footer { margin-top: 12px; }
}

@media (max-width: 520px) {
  .login-page { align-content: start; padding: 18px 14px; }
  .login-brand-lockup :deep(.kst-lockup-logo) { width: min(100%, 168px); }
  .login-form-card { padding: 24px 18px; }
  .footer-links { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
  .footer-link { justify-content: center; }
  .login-footer p { line-height: 1.5; }
}
</style>
