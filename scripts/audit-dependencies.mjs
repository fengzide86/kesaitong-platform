import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export function checkAudit(runtime, full, policy, now = new Date()) {
  if (!runtime?.metadata?.vulnerabilities || !full?.metadata?.vulnerabilities || runtime.error || full.error) {
    throw new Error('Dependency audit returned no valid report; refusing to treat network/registry errors as clean.')
  }
  if (runtime.metadata.vulnerabilities.total !== 0) throw new Error('Runtime dependencies have known vulnerabilities.')
  const findings = new Map()
  for (const item of Object.values(full.vulnerabilities || {})) {
    for (const advisory of item.via || []) {
      if (typeof advisory === 'string') continue
      const id = /GHSA-[\w-]+$/.exec(advisory.url || '')?.[0]
      if (!id) throw new Error('Unrecognized advisory identity; manual review is required.')
      findings.set(`${advisory.name}:${id}`, advisory)
    }
  }
  if (full.metadata.vulnerabilities.total > 0 && findings.size === 0) throw new Error('Audit omitted advisory details.')
  if (findings.size && (!(Date.parse(policy.expires + 'T23:59:59Z') >= now.getTime()))) {
    throw new Error('Build dependency risk review has expired.')
  }
  for (const key of findings.keys()) {
    if (!policy.entries.some(entry => `${entry.package}:${entry.advisory}` === key && entry.reason)) {
      throw new Error(`Unreviewed dependency advisory: ${key}`)
    }
  }
  return { runtimeFindings: 0, reviewedBuildAdvisories: findings.size, reviewExpires: policy.expires }
}

function audit(args) {
  const cli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
  const result = spawnSync(process.execPath, [cli, 'audit', '--json', ...args], { encoding: 'utf8', timeout: 120000, windowsHide: true })
  if (result.error || ![0, 1].includes(result.status)) throw new Error('Unable to complete npm dependency audit.')
  return JSON.parse(result.stdout)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const policy = JSON.parse(fs.readFileSync(new URL('./dependency-risk-allowlist.json', import.meta.url), 'utf8'))
  const result = checkAudit(audit(['--omit=dev']), audit([]), policy)
  process.stdout.write(`dependency_audit=${JSON.stringify(result)}\n`)
}
