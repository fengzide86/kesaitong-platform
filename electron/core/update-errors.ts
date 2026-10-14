export type StableUpdateErrorCode =
  | 'CHECK_TIMEOUT'
  | 'NETWORK_OFFLINE'
  | 'FEED_INVALID'
  | 'HASH_MISMATCH'
  | 'DISK_FULL'
  | 'DOWNLOAD_CANCELLED'
  | 'DOWNLOAD_FAILED'
  | 'CHECK_FAILED'
  | 'INSTALL_BUSY'
  | 'INSTALL_QUIESCE_FAILED'
  | 'INSTALL_QUIESCE_TIMEOUT'
  | 'INSTALL_LAUNCH_FAILED'
  | 'INSTALL_LAUNCH_TIMEOUT'
  | 'INSTALLER_MISSING'
  | 'INSTALLER_UNREADABLE'
  | 'UPDATE_ERROR'

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : ''
    return `${code} ${error.name} ${error.message}`.toLowerCase()
  }
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String((error as { code?: unknown }).code || '').toLowerCase()
  }
  return String(error || '').toLowerCase()
}

export function normalizeUpdateErrorCode(
  error: unknown,
  fallback: StableUpdateErrorCode = 'UPDATE_ERROR',
): StableUpdateErrorCode {
  const value = errorText(error)
  if (value.includes('install_busy')) return 'INSTALL_BUSY'
  if (value.includes('install_quiesce_timeout')) return 'INSTALL_QUIESCE_TIMEOUT'
  if (value.includes('install_launch_timeout')) return 'INSTALL_LAUNCH_TIMEOUT'
  if (value.includes('installer_missing')) return 'INSTALLER_MISSING'
  if (value.includes('installer_unreadable')) return 'INSTALLER_UNREADABLE'
  if (value.includes('update_check_timeout') || value.includes('check timeout') || value.includes('检查超时')) return 'CHECK_TIMEOUT'
  if (value.includes('cancel') || value.includes('aborted')) return 'DOWNLOAD_CANCELLED'
  if (value.includes('enospc') || value.includes('disk full') || value.includes('no space')) return 'DISK_FULL'
  if (value.includes('sha512') || value.includes('checksum') || value.includes('hash mismatch') || value.includes('hash_mismatch')) return 'HASH_MISMATCH'
  if (
    value.includes('internet_disconnected') || value.includes('network_changed')
    || value.includes('enotfound') || value.includes('econnrefused')
    || value.includes('econnreset') || value.includes('timed out')
  ) return 'NETWORK_OFFLINE'
  if (value.includes('latest.yml') || value.includes('yaml') || value.includes('feed') || value.includes('update-info')) return 'FEED_INVALID'
  return fallback
}
