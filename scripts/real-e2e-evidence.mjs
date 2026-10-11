// Preserve real backend stacks without publishing isolated test credentials.
import { stripVTControlCharacters } from 'node:util'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

export function redactRealE2eLog(value, secrets = []) {
  let text = stripVTControlCharacters(String(value))
  for (const secret of secrets.filter(item => typeof item === 'string' && item.length > 0).sort((a, b) => b.length - a.length)) {
    text = text.replaceAll(secret, '[TEST-SECRET]')
  }
  return text
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT-REDACTED]')
    .replace(/E2E-[A-Z]-[a-f0-9]+/g, '[TEST-LICENSE]')
    .replace(/KST-[A-F0-9]{24}/g, '[GENERATED-LICENSE]')
    .replace(/((?:authorization|cookie|set-cookie)\s*:\s*)[^\r\n]+/gi, '$1[REDACTED]')
}

export async function finalizeRealE2eEvidence(runtime, { closeLog, secrets = [] }, io = { readFile, writeFile, rm }) {
  const errors = []
  let owned = false
  try { owned = await io.readFile(join(runtime, '.kst-real-e2e-owned'), 'utf8') === 'kst-real-e2e-v1' }
  catch { /* Never delete from an unverified directory. */ }
  if (!owned) errors.push('ownership-check')
  try { await closeLog() }
  catch { errors.push('log-close') }
  if (!owned) return errors
  try {
    let credentials = {}
    try { credentials = JSON.parse(await io.readFile(join(runtime, 'credentials.json'), 'utf8')) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    await io.writeFile(join(runtime, 'process-redacted.log'), redactRealE2eLog(
      await io.readFile(join(runtime, 'process.log'), 'utf8'),
      [...secrets, ...Object.values(credentials)],
    ))
  } catch { errors.push('evidence-write') }
  finally {
    try { await io.rm(join(runtime, 'credentials.json'), { force: true }) }
    catch { errors.push('credential-cleanup') }
  }
  // Report phase names only, never exception text containing credential values.
  return errors
}
