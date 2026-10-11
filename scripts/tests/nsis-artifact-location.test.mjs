import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const verifier = resolve('scripts/verify-nsis-artifacts.mjs')
test('NSIS verification checks the explicitly selected candidate, never another release directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'kst-nsis-location-'))
  try {
    const candidate = join(root, 'candidate')
    mkdirSync(candidate)
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.8.15', build: { directories: { output: 'absent-old-release' } } }))
    const name = 'KST Setup 1.8.15.exe'
    const bytes = Buffer.from('inert installer fixture, never executed')
    const hash = createHash('sha512').update(bytes).digest('base64')
    writeFileSync(join(candidate, name), bytes)
    writeFileSync(join(candidate, `${name}.blockmap`), 'inert blockmap')
    writeFileSync(join(candidate, 'latest.yml'), `version: 1.8.15\nfiles:\n  - url: ${name}\n    sha512: ${hash}\n    size: ${bytes.length}\npath: ${name}\nsha512: ${hash}\n`)
    const run = () => spawnSync(process.execPath, [verifier], { cwd: root, env: { ...process.env, TOOLBOX_DESKTOP_RELEASE_DIR: candidate }, encoding: 'utf8' })
    const valid = run()
    assert.equal(valid.status, 0, valid.stderr)
    assert.match(valid.stdout, /nsis_sha512=verified/)
    writeFileSync(join(candidate, name), 'changed fixture')
    const changed = run()
    assert.notEqual(changed.status, 0)
    assert.match(changed.stderr, /SHA512 does not match/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
