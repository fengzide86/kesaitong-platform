import { authService } from '@/utils/auth'

interface PendingUpload { version: string; since: number }

// Route changes must not erase an uncertain write. Keep only non-secret metadata
// for this renderer/login; no files, paths or authentication values are retained.
const pendingByOwner = new Map<string, PendingUpload>()
let sessionEpoch = 0
if (typeof window !== 'undefined') {
  window.addEventListener('toolbox:auth-cleared', () => {
    sessionEpoch += 1
    pendingByOwner.clear()
  })
}

function currentOwner(): string {
  const user = authService.getUser()
  return `${authService.getRole()}:${String(user?.id ?? user?.staff_id ?? user?.user_id ?? user?.auth_code_id ?? user?.username ?? 'anonymous')}`
}

export function createReleaseUploadSession() {
  const owner = currentOwner()
  const epoch = sessionEpoch
  const isCurrent = (): boolean => epoch === sessionEpoch && owner === currentOwner()
  return {
    isCurrent,
    read: (): PendingUpload | undefined => isCurrent() ? pendingByOwner.get(owner) : undefined,
    remember(version: string): void {
      if (isCurrent()) pendingByOwner.set(owner, { version, since: Date.now() })
    },
    clear(version: string): void {
      if (isCurrent() && pendingByOwner.get(owner)?.version === version) pendingByOwner.delete(owner)
    },
  }
}
