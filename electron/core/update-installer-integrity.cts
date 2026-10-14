import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'

/** Recheck the local cached installer immediately before shutdown. The
 * updater's in-process cache shortcut only checks existence, not its hash. */
export async function verifyUpdateInstaller(path: string, expectedSha512: string): Promise<void> {
  try {
    const hash = createHash('sha512')
    await pipeline(createReadStream(path), hash, { signal: AbortSignal.timeout(20000) })
    if (hash.digest('base64') !== expectedSha512) {
      throw Object.assign(new Error('Downloaded installer checksum does not match'), { code: 'HASH_MISMATCH' })
    }
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : ''
    if (code === 'HASH_MISMATCH') throw error
    throw Object.assign(new Error('Downloaded installer is not readable'), {
      code: code === 'ENOENT' ? 'INSTALLER_MISSING' : 'INSTALLER_UNREADABLE',
    })
  }
}
