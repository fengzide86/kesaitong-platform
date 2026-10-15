import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { npmEnvironment, resolveNpm } from './npm-toolchain.mjs'

const root = process.cwd()
const sha = process.env.TOOLBOX_CI_ATTESTED_SHA || ''
const npmToolchain = resolveNpm({ projectRoot: root, environment: process.env })

if (!/^[0-9a-f]{40}$/i.test(sha)) {
  throw new Error('生产发布必须提供同一提交的 TOOLBOX_CI_ATTESTED_SHA')
}

function runNodeScript(filename) {
  const result = spawnSync(npmToolchain.nodeExecutable, [path.join(root, 'scripts', filename)], {
    cwd: root,
    env: npmEnvironment(npmToolchain, process.env),
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

console.log(`[release] reuse CI attestation ${sha}`)
runNodeScript('verify-release-configuration.mjs')
runNodeScript('verify-release-mariadb-gate.mjs')
console.log('[release] attested checks passed; local release keeps only packaging and deployment checks')
