import { createHash, randomUUID } from 'node:crypto'
import { session, type WebContents, type WebPreferences } from 'electron'

type Grant = { owner: string; platform: string; partition: string }
type Attachment = { partition: string; generation: number; grant: Grant | null }

/** Main-process grants, not a renderer-selected persistent profile. Old fixed
 * profiles are left on disk, never adopted, migrated or cleared. */
export class WorkspaceBrowserSessions {
  private generation = 0
  private grant: Grant | null = null
  private pending: Attachment[] = []
  private guests = new Map<WebContents, Attachment>()

  get hasGrant(): boolean { return this.grant !== null }
  isOwner(owner: string): boolean { return this.grant?.owner === owner }

  matches(owner: string, platform: string): boolean {
    return this.grant?.owner === owner && this.grant.platform === platform
  }

  prepare(owner: string, platform: string): { partition: string } {
    if (!['amazon', 'aliexpress'].includes(platform)) throw new Error('平台类型无效')
    if (!this.matches(owner, platform)) {
      this.revoke()
      const identity = createHash('sha256').update(JSON.stringify([owner, platform, randomUUID()])).digest('hex')
      this.grant = { owner, platform, partition: `kst-workspace-v2-${identity}` }
    }
    return { partition: this.grant!.partition }
  }

  approve(partition: string | undefined, preferences: WebPreferences): boolean {
    const grant = this.grant?.partition === partition ? this.grant : null
    if (!partition || (!grant && !/^batch-[A-Za-z0-9_-]+$/.test(partition))) return false
    if (this.pending.length >= 256) return false
    this.pending.push({ partition, generation: this.generation, grant })
    preferences.additionalArguments = []
    return true
  }

  attached(guest: WebContents): void {
    // Both hooks are owned by the same main WebContents. Match the actual
    // native Session, never a renderer claim or a private Electron API.
    const index = this.pending.findIndex(item => guest.session === session.fromPartition(item.partition))
    const attachment = index >= 0 ? this.pending.splice(index, 1)[0] : undefined
    if (!attachment || attachment.generation !== this.generation
      || (attachment.grant && attachment.grant !== this.grant)
      || guest.session !== session.fromPartition(attachment.partition)) {
      guest.close({ waitForBeforeUnload: false })
      return
    }
    this.guests.set(guest, attachment)
    guest.once('destroyed', () => this.guests.delete(guest))
  }

  assertGuest(guest: WebContents, owner: string): void {
    const attachment = this.guests.get(guest)
    if (!attachment?.grant || attachment.grant !== this.grant || attachment.grant.owner !== owner
      || attachment.generation !== this.generation || guest.isDestroyed()) {
      throw new Error('BROWSER_OWNER_CHANGED: 浏览器授权已变化，请重新打开工具。')
    }
  }

  revoke(): void {
    const retired = this.grant
    this.generation += 1
    this.grant = null
    // Keep pending generations as tombstones so a delayed did-attach cannot
    // consume a newly issued grant for the same owner's persistent Session.
    for (const guest of this.guests.keys()) {
      if (!guest.isDestroyed()) guest.close({ waitForBeforeUnload: false })
    }
    this.guests.clear()
    // A new non-persistent nonce is mandatory even if disk/cache cleanup fails.
    // The old authenticated session is never silently adopted by a new login.
    if (retired) void session.fromPartition(retired.partition).clearStorageData().catch(() => undefined)
  }
}
