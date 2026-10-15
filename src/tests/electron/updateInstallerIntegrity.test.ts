import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { verifyUpdateInstaller as Verify } from '../../../electron/core/update-installer-integrity.cjs'

const require = createRequire(import.meta.url)
const { verifyUpdateInstaller } = require(resolve('dist-electron/electron/core/update-installer-integrity.cjs')) as { verifyUpdateInstaller: typeof Verify }
const directories: string[] = []
const content = 'inert installer integrity fixture'
const digest = createHash('sha512').update(content).digest('base64')

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'kst-update-integrity-'))
  directories.push(directory)
  const file = join(directory, '安装包 fixture.exe')
  writeFileSync(file, content)
  return file
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('cached installer integrity before application shutdown', () => {
  it('streams and accepts the expected SHA512 for a Chinese and space path', async () => {
    await expect(verifyUpdateInstaller(fixture(), digest)).resolves.toBeUndefined()
  })

  it('rejects a removed cached file with a stable code', async () => {
    const file = fixture()
    rmSync(file)
    await expect(verifyUpdateInstaller(file, digest)).rejects.toMatchObject({ code: 'INSTALLER_MISSING' })
  })

  it('rejects changed bytes even though the in-process updater cache path still exists', async () => {
    const file = fixture()
    writeFileSync(file, 'changed fixture')
    await expect(verifyUpdateInstaller(file, digest)).rejects.toMatchObject({ code: 'HASH_MISMATCH' })
  })

  it('classifies an unreadable installer object without exposing its path', async () => {
    const file = fixture()
    await expect(verifyUpdateInstaller(resolve(file, '..'), digest)).rejects.toMatchObject({ code: 'INSTALLER_UNREADABLE', message: 'Downloaded installer is not readable' })
  })
})
