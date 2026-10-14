import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { updateSnapshotSchema, type UpdateSnapshot } from '@/shared/ipc/update-contract'
import { getVersionReleaseNotes } from './release-api'
import { useOverlayCoordinatorStore } from '@/features/shell/overlay-store'
import { getRuntimeCapabilities } from '@/runtime/capabilities'
import { showToast } from '@/utils'

const PROMPT_KEY = 'toolbox_update_prompt_preferences'
const DAY_MS = 24 * 60 * 60 * 1000

const emptyState: UpdateSnapshot = {
  supported: false,
  status: 'idle',
  currentVersion: '—',
  releaseNotes: [],
  canRestart: false,
}

interface PromptPreference {
  version: string
  until: number
}

function readPromptPreference(): PromptPreference | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PROMPT_KEY) || 'null')
    if (!value || typeof value !== 'object') return null
    const candidate = value as Partial<PromptPreference>
    return typeof candidate.version === 'string' && typeof candidate.until === 'number'
      ? { version: candidate.version, until: candidate.until }
      : null
  } catch {
    return null
  }
}

export const useUpdateStore = defineStore('application-updates', () => {
  const state = ref<UpdateSnapshot>({ ...emptyState })
  const initialized = ref(false)
  const installingDeferredForSession = ref(false)
  const overlay = useOverlayCoordinatorStore()
  // Main-process progress snapshots are intentionally authoritative for state,
  // but they may not carry release notes on every event. Keep notes separately
  // by version so progress updates cannot erase them.
  const releaseNotesByVersion = new Map<string, string[]>()
  const loadingReleaseNoteVersions = new Set<string>()
  let removeStateListener: (() => void) | undefined

  const supported = computed(() => getRuntimeCapabilities().desktopUpdates && state.value.supported)
  const drawerOpen = computed(() => overlay.activeDrawer === 'updates')
  const displayPercent = computed(() => Math.round(state.value.percent ?? 0))
  const promptSuppressed = computed(() => {
    const version = state.value.availableVersion
    if (!version) return false
    const local = readPromptPreference()
    const localUntil = local?.version === version ? local.until : 0
    const mainUntil = state.value.promptSuppressedUntil ? Date.parse(state.value.promptSuppressedUntil) : 0
    return Math.max(localUntil, mainUntil) > Date.now()
  })
  const shouldShowNotice = computed(() => state.value.status === 'available' && !promptSuppressed.value)
  const showHeaderEntry = computed(() => supported.value && [
    'available', 'downloading', 'cancelling', 'downloaded', 'restart_deferred', 'cancelled', 'error',
  ].includes(state.value.status))
  const shouldPromptRestart = computed(() => (
    state.value.status === 'downloaded'
    && state.value.canRestart
    && !installingDeferredForSession.value
    && !overlay.criticalAnnouncementActive
  ))

  function applySnapshot(value: unknown): void {
    const parsed = updateSnapshotSchema.safeParse(value)
    if (!parsed.success) return
    const snapshot = parsed.data
    const version = snapshot.availableVersion
    if (version && snapshot.releaseNotes.length) {
      releaseNotesByVersion.set(version, [...snapshot.releaseNotes])
    }
    const cachedNotes = version ? releaseNotesByVersion.get(version) : undefined
    state.value = version && !snapshot.releaseNotes.length && cachedNotes?.length
      ? { ...snapshot, releaseNotes: [...cachedNotes] }
      : snapshot
    void hydrateReleaseNotes(state.value)
  }

  async function hydrateReleaseNotes(snapshot: UpdateSnapshot): Promise<void> {
    const version = snapshot.availableVersion
    if (
      !version
      || snapshot.releaseNotes.length
      || !['available', 'downloaded', 'restart_deferred'].includes(snapshot.status)
      || releaseNotesByVersion.has(version)
      || loadingReleaseNoteVersions.has(version)
    ) return
    loadingReleaseNoteVersions.add(version)
    try {
      const notes = await getVersionReleaseNotes(version)
      if (notes.length) {
        releaseNotesByVersion.set(version, [...notes])
        if (state.value.availableVersion === version && !state.value.releaseNotes.length) {
          state.value = { ...state.value, releaseNotes: [...notes] }
        }
      }
    } catch {
      // Release notes are optional; a later manual check may retry this version.
    } finally {
      loadingReleaseNoteVersions.delete(version)
    }
  }

  async function initialize(): Promise<void> {
    if (initialized.value || !getRuntimeCapabilities().desktopUpdates || !window.electronAPI?.updates) return
    initialized.value = true
    removeStateListener = window.electronAPI.updates.onState(applySnapshot)
    applySnapshot(await window.electronAPI.updates.getState())
  }

  function dispose(): void {
    removeStateListener?.()
    removeStateListener = undefined
    initialized.value = false
  }

  function openDetails(): void {
    overlay.openDrawer('updates')
  }

  function closeDetails(): void {
    overlay.closeDrawer('updates')
  }

  async function checkManually(): Promise<void> {
    if (!getRuntimeCapabilities().desktopUpdates || !window.electronAPI?.updates || !supported.value) {
      showToast('开发预览无需检查更新', 'info')
      return
    }
    try { localStorage.removeItem(PROMPT_KEY) } catch { /* Main-process preference remains authoritative. */ }
    installingDeferredForSession.value = false
    openDetails()
    applySnapshot(await window.electronAPI.updates.check())
    if (state.value.status === 'idle') showToast('当前已是最新版本', 'success')
  }

  async function startDownload(): Promise<void> {
    if (!window.electronAPI?.updates) return
    applySnapshot(await window.electronAPI.updates.startDownload())
  }

  async function cancelDownload(): Promise<void> {
    if (!window.electronAPI?.updates) return
    applySnapshot(await window.electronAPI.updates.cancelDownload())
  }

  async function deferDownload(): Promise<void> {
    const version = state.value.availableVersion
    try { if (version) localStorage.setItem(PROMPT_KEY, JSON.stringify({ version, until: Date.now() + DAY_MS })) } catch { /* The main process also persists this preference. */ }
    const bridge = window.electronAPI?.updates
    if (bridge) applySnapshot(await bridge.defer({ phase: 'download' }))
    closeDetails()
  }

  async function deferInstall(): Promise<void> {
    installingDeferredForSession.value = true
    const bridge = window.electronAPI?.updates
    if (bridge) applySnapshot(await bridge.defer({ phase: 'install' }))
  }

  function dismissRestartPrompt(): void {
    // Dismissing a dialog is not permission to install on exit.
    installingDeferredForSession.value = true
  }

  async function install(): Promise<void> {
    const bridge = window.electronAPI?.updates
    if (bridge) applySnapshot(await bridge.install())
  }

  return {
    state, supported, initialized, drawerOpen, displayPercent, promptSuppressed, shouldShowNotice,
    showHeaderEntry, shouldPromptRestart, initialize, dispose, openDetails, closeDetails, checkManually,
    startDownload, cancelDownload, deferDownload, deferInstall, dismissRestartPrompt, install,
  }
})
