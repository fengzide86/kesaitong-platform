<template>
  <Transition name="update-drawer">
    <div v-if="visible" class="update-drawer-layer">
      <aside ref="drawerRef" class="update-drawer" role="dialog" aria-labelledby="update-drawer-title" tabindex="-1" @keydown.esc="store.closeDetails">
        <header>
          <div class="update-drawer__emblem"><Download :size="20" /></div>
          <div>
            <p>APPLICATION UPDATE</p>
            <h2 id="update-drawer-title">{{ title }}</h2>
          </div>
          <button type="button" aria-label="关闭更新详情" @click="store.closeDetails"><X :size="19" /></button>
        </header>

        <div class="version-track">
          <span>{{ store.state.availableVersion ? `v${store.state.currentVersion}` : '当前版本' }}</span><i aria-hidden="true" /><strong>{{ store.state.availableVersion ? availableVersion : '检查更新' }}</strong>
        </div>
        <p v-if="downloadSizeLabel" class="download-size">下载文件 {{ downloadSizeLabel }}</p>

        <div v-if="store.state.status === 'checking'" class="state-notice is-checking">
          <LoaderCircle :size="18" class="is-spinning" />
          <div><strong>正在检查新版本</strong><span>检查完成后这里会自动更新，不会遮挡其他页面。</span></div>
        </div>
        <div v-else-if="store.state.status === 'downloading'" class="progress-block">
          <div><span>{{ downloadPhaseLabel }}</span><strong>{{ store.displayPercent }}%</strong></div>
          <div class="progress-track" role="progressbar" aria-label="更新下载进度" :aria-valuenow="store.displayPercent" aria-valuemin="0" aria-valuemax="100">
            <span :style="{ width: `${store.state.percent ?? 0}%` }" />
          </div>
          <p>{{ transferredLabel }}</p>
          <p v-if="speedLabel">{{ speedLabel }}</p>
          <p v-if="store.state.downloadStalled" class="download-hint" role="status">暂未收到新的下载数据。可以继续等待，或取消后重试；当前软件仍可使用。</p>
          <p v-if="store.state.downloadPhase === 'finalizing'" class="download-hint" role="status">正在确认下载结果，完成后才会提示安装。</p>
        </div>
        <div v-else-if="store.state.status === 'cancelling'" class="state-notice is-checking" role="status">
          <LoaderCircle :size="18" class="is-spinning" /><div><strong>正在取消下载</strong><span>正在结束当前请求，请稍等；完成后可以重新下载。</span></div>
        </div>
        <div v-else-if="store.state.status === 'restart_deferred'" class="state-notice is-warning">
          <strong>更新已准备好</strong><span>{{ store.state.canRestart ? '现在可以重启安装，也可以按你的选择在退出软件时安装。' : '当前工作尚未结束，暂不能重启。完成后可以在这里安装。' }}</span>
        </div>
        <div v-else-if="store.state.status === 'error'" class="state-notice is-danger">
          <strong>{{ errorCopy.title }}</strong><span>{{ errorCopy.detail }} 错误编号：{{ store.state.errorCode || 'UPDATE_ERROR' }}</span>
        </div>

        <section class="release-notes">
          <h3>本次更新</h3>
          <ul v-if="store.state.releaseNotes.length">
            <li v-for="note in store.state.releaseNotes" :key="note">{{ note }}</li>
          </ul>
          <p v-else>{{ store.state.availableVersion ? '该版本未提供更新说明。' : '当前已是可用版本。' }}</p>
        </section>

        <footer>
          <template v-if="store.state.status === 'checking'">
            <button class="button secondary" type="button" @click="store.closeDetails">后台检查</button>
          </template>
          <template v-else-if="store.state.status === 'available'">
            <button class="button secondary" type="button" @click="store.deferDownload">稍后</button>
            <button class="button primary" type="button" @click="store.startDownload">下载更新</button>
          </template>
          <template v-else-if="store.state.status === 'downloading'">
            <button class="button secondary" type="button" @click="store.closeDetails">后台下载</button>
            <button class="button danger" type="button" @click="confirmCancel">取消下载</button>
          </template>
          <template v-else-if="store.state.status === 'cancelled'">
            <button class="button primary" type="button" @click="store.startDownload">重新下载</button>
          </template>
          <template v-else-if="store.state.status === 'cancelling'">
            <button class="button secondary" type="button" @click="store.closeDetails">返回工作</button>
            <button class="button primary" type="button" disabled>正在取消…</button>
          </template>
          <template v-else-if="store.state.status === 'error' || store.state.status === 'idle'">
            <button v-if="store.state.status === 'error' && errorCopy.canUseWebsite" class="button secondary" type="button" @click="openDownloadWebsite">打开官网下载</button>
            <button v-if="store.state.canRetryInstall" class="button primary" type="button" @click="store.install">重新尝试安装</button>
            <button v-else-if="store.state.canRetryDownload" class="button primary" type="button" @click="store.startDownload">重新下载</button>
            <button v-else class="button primary" type="button" @click="store.checkManually">重新检查</button>
          </template>
          <template v-else-if="store.state.status === 'downloaded' || store.state.status === 'restart_deferred'">
            <button v-if="store.state.status === 'downloaded'" class="button secondary" type="button" @click="store.deferInstall">退出时安装</button>
            <button class="button primary" type="button" :disabled="!store.state.canRestart" @click="store.install">立即重启</button>
          </template>
          <button v-else class="button primary" type="button" @click="store.closeDetails">知道了</button>
        </footer>
      </aside>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { Download, LoaderCircle, X } from '@lucide/vue'
import { useUpdateStore } from './store'

const store = useUpdateStore()
const route = useRoute()
const drawerRef = ref<HTMLElement | null>(null)
let returnFocus: HTMLElement | null = null
const isRestrictedRoute = computed(() => ['UserLogin', 'AdminLogin'].includes(String(route.name)))
const visible = computed(() => store.drawerOpen && !isRestrictedRoute.value)
watch(isRestrictedRoute, value => { if (value) store.closeDetails() })
watch(visible, async value => {
  if (value) {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    drawerRef.value?.focus({ preventScroll: true })
  } else {
    returnFocus?.focus({ preventScroll: true })
    returnFocus = null
  }
})
const availableVersion = computed(() => store.state.availableVersion ? `v${store.state.availableVersion}` : '检查新版本')
const errorCopy = computed(() => {
  switch (store.state.errorCode) {
    case 'NETWORK_OFFLINE':
    case 'CHECK_TIMEOUT':
      return { title: '暂时无法连接更新服务', detail: '请检查网络后重新检查。', canUseWebsite: false }
    case 'DISK_FULL':
      return { title: '磁盘空间不足', detail: '请释放磁盘空间后重新下载。', canUseWebsite: false }
    case 'HASH_MISMATCH':
      return { title: '下载文件校验失败', detail: '请重新下载；如果仍然失败，可以打开官网下载。', canUseWebsite: true }
    case 'FEED_INVALID':
      return { title: '更新清单暂时不可用', detail: '请稍后重新检查，也可以打开官网下载。', canUseWebsite: true }
    case 'INSTALL_BUSY':
      return { title: '当前任务尚未结束', detail: '完成或退出当前任务后再安装更新。', canUseWebsite: false }
    case 'INSTALL_QUIESCE_FAILED':
    case 'INSTALL_QUIESCE_TIMEOUT':
      return { title: '暂时无法安全结束本机服务', detail: '可以重新尝试安装；如果仍然失败，请重新打开软件后再试。', canUseWebsite: false }
    case 'INSTALL_LAUNCH_FAILED':
    case 'INSTALL_LAUNCH_TIMEOUT':
      return { title: '安装程序未能启动', detail: '请重新下载以恢复更新状态，或打开官网下载。若要继续使用原版本，请重新打开软件；本机服务可能已结束。', canUseWebsite: true }
    case 'INSTALLER_MISSING':
      return { title: '更新文件已失效', detail: '本机安装文件已不存在，请重新下载后再安装。', canUseWebsite: true }
    case 'INSTALLER_UNREADABLE':
      return { title: '无法读取更新文件', detail: '请检查磁盘或安全软件限制，再重新下载。', canUseWebsite: true }
    case 'DOWNLOAD_CANCELLED':
      return { title: '更新下载已取消', detail: '可以重新检查并再次下载。', canUseWebsite: false }
    case 'DOWNLOAD_FAILED':
      return { title: '更新下载失败', detail: '请重新检查；如果仍然失败，可以打开官网下载。', canUseWebsite: true }
    default:
      return { title: '本次更新未能完成', detail: '请重新检查；如果仍然失败，可以打开官网下载。', canUseWebsite: true }
  }
})
const title = computed(() => ({
  idle: '检查应用更新', checking: '正在检查更新', available: '发现新版本', downloading: '正在获取新版本', cancelling: '正在取消下载',
  downloaded: '更新已下载完成', restart_deferred: '完成当前工作后重启', installing: '正在安全重启',
  cancelled: '更新下载已取消', error: '更新遇到问题',
})[store.state.status])
const marketingSiteUrl = computed(() => String(import.meta.env.VITE_MARKETING_SITE_URL || 'https://kesaitong.top').trim())
const downloadPhaseLabel = computed(() => store.state.downloadPhase === 'preparing' ? '正在准备下载' : store.state.downloadPhase === 'finalizing' ? '正在确认下载结果' : '正在后台下载')
const speedLabel = computed(() => store.state.downloadPhase === 'transferring' && store.state.bytesPerSecond != null && !store.state.downloadStalled ? `当前速度 ${formatBytes(store.state.bytesPerSecond)}/秒` : '')
const transferredLabel = computed(() => {
  if (store.state.transferredBytes == null || store.state.totalBytes == null) return '正在获取下载信息'
  return `${formatBytes(store.state.transferredBytes)} / ${formatBytes(store.state.totalBytes)}`
})
const downloadSizeLabel = computed(() => store.state.downloadBytes == null ? '' : formatBytes(store.state.downloadBytes))
function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
async function confirmCancel(): Promise<void> {
  try {
    await ElMessageBox.confirm('取消后可以重新下载，不会影响当前版本。', '取消更新下载？', {
      confirmButtonText: '取消下载', cancelButtonText: '继续下载', type: 'warning',
    })
    await store.cancelDownload()
  } catch { /* Continue the current download. */ }
}
async function openDownloadWebsite(): Promise<void> {
  const url = marketingSiteUrl.value
  if (!url) return
  if (window.electronAPI?.openExternal) {
    try {
      await window.electronAPI.openExternal(url)
    } catch {
      // Keep the update drawer usable even if the OS browser refuses the link.
    }
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
</script>

<style scoped>
.update-drawer-layer{position:fixed;inset:0;z-index:var(--z-drawer);background:rgba(24,32,51,.18)}.update-drawer{position:absolute;top:0;right:0;width:min(440px,100vw);height:100vh;display:flex;flex-direction:column;padding:26px;border-left:1px solid var(--color-border);outline:0;background:var(--color-surface);box-shadow:-22px 0 60px rgba(24,32,51,.14);overflow:auto}.update-drawer>header{display:grid;grid-template-columns:44px 1fr auto;align-items:center;gap:13px}.update-drawer__emblem{width:44px;height:44px;display:grid;place-items:center;border-radius:12px;color:var(--color-primary);background:var(--color-primary-soft)}.update-drawer header p{margin:0;color:var(--color-premium);font-size:var(--type-micro);font-weight:800;letter-spacing:.14em}.update-drawer h2{margin:4px 0 0;color:var(--color-text);font-size:21px}.update-drawer header>button{width:36px;height:36px;display:grid;place-items:center;border:0;border-radius:10px;color:var(--color-text-secondary);background:transparent;cursor:pointer}.version-track{display:flex;align-items:center;gap:12px;margin:26px 0 20px;padding:14px;border:1px solid var(--color-border);border-radius:12px;background:var(--color-surface-soft);font-size:var(--type-meta)}.version-track i{flex:1;height:1px;background:linear-gradient(90deg,var(--color-border-strong),var(--color-primary))}.version-track strong{color:var(--color-primary);font-size:var(--type-control)}.progress-block{padding:15px;border-radius:12px;background:var(--color-primary-soft)}.progress-block>div:first-child{display:flex;justify-content:space-between;font-size:var(--type-control)}.progress-track{height:8px;margin-top:10px;overflow:hidden;border-radius:99px;background:#dbe4f8}.progress-track span{display:block;height:100%;border-radius:inherit;background:var(--color-primary);transition:width var(--motion-fast)}.progress-block p{margin:8px 0 0;color:var(--color-text-secondary);font-size:var(--type-meta);text-align:right}.state-notice{display:grid;gap:5px;padding:14px;border-radius:12px;font-size:var(--type-control)}.state-notice span{font-size:var(--type-meta);line-height:1.6}.is-warning{color:var(--color-warning);background:var(--color-warning-soft)}.is-danger{color:var(--color-danger);background:var(--color-danger-soft)}.release-notes{margin-top:22px}.release-notes h3{margin:0 0 12px;font-size:var(--type-card)}.release-notes ul{display:grid;gap:10px;margin:0;padding-left:21px}.release-notes li,.release-notes p{color:var(--color-text-secondary);font-size:var(--type-control);line-height:1.65}.update-drawer footer{display:flex;justify-content:flex-end;gap:10px;margin-top:auto;padding-top:28px}.button{min-height:40px;padding:0 16px;border:1px solid transparent;border-radius:10px;font:700 var(--type-control)/1 var(--font-family);cursor:pointer}.primary{color:#fff;background:var(--color-primary)}.secondary{border-color:var(--color-border);color:var(--color-text-secondary);background:var(--color-surface)}.danger{border-color:rgba(195,61,73,.2);color:var(--color-danger);background:var(--color-danger-soft)}.button:disabled{opacity:.5;cursor:not-allowed}.update-drawer-enter-active,.update-drawer-leave-active{transition:opacity var(--motion-fast)}.update-drawer-enter-active .update-drawer,.update-drawer-leave-active .update-drawer{transition:transform var(--motion-normal) var(--ease-emphasized)}.update-drawer-enter-from,.update-drawer-leave-to{opacity:0}.update-drawer-enter-from .update-drawer,.update-drawer-leave-to .update-drawer{transform:translateX(28px)}
@media(max-width:768px){.update-drawer-layer{display:flex;align-items:flex-end}.update-drawer{position:relative;top:auto;right:auto;width:100%;height:auto;max-height:80vh;padding:20px;border-top:1px solid var(--color-border);border-left:0;border-radius:18px 18px 0 0}.update-drawer-enter-from .update-drawer,.update-drawer-leave-to .update-drawer{transform:translateY(28px)}}
@media(prefers-reduced-motion:reduce){.update-drawer-enter-active,.update-drawer-leave-active,.update-drawer-enter-active .update-drawer,.update-drawer-leave-active .update-drawer,.progress-track span{transition:none}}
.update-drawer-layer{background:transparent;pointer-events:none}.update-drawer{pointer-events:auto}
.download-size{margin:-10px 0 18px;color:var(--color-text-secondary);font-size:var(--type-meta);text-align:right}
.progress-block .download-hint{text-align:left;line-height:1.6;color:var(--color-text-secondary)}
.update-drawer footer{flex-wrap:wrap}
.is-checking{grid-template-columns:auto 1fr;align-items:center;color:var(--color-primary);background:var(--color-primary-soft)}
.is-checking>div{display:grid;gap:4px}
.is-spinning{animation:update-drawer-spin 1s linear infinite}
@keyframes update-drawer-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.is-spinning{animation:none}}
</style>
