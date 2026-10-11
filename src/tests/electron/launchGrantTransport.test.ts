import { fork } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('compiled Runner grant HTTP transport', () => {
  it.each([
    { scenario: 'current JSON endpoint', mode: 'reject', expectedCode: 'GRANT_REJECTED',
      paths: ['/api/tools/launch-grant/verify'] },
    { scenario: '404 primary with JSON-compatible legacy alias', mode: 'legacy', expectedCode: 'INPUT_REQUIRED',
      paths: ['/api/tools/launch-grant/verify', '/api/tools/launch-token/verify'] },
    { scenario: 'query-only old backend rejects JSON with 422', mode: 'query-only', expectedCode: 'GRANT_REJECTED',
      paths: ['/api/tools/launch-grant/verify'] },
  ])('sends only JSON for $scenario, never query credentials', async ({ mode, expectedCode, paths }) => {
    const requests: Array<{ url: string; method: string; body: string; version: string; contentType: string }> = []
    const server = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', chunk => { body += chunk })
      request.on('end', () => {
        requests.push({ url: request.url || '', method: request.method || '', body,
          version: String(request.headers['x-toolbox-version'] || ''), contentType: String(request.headers['content-type'] || '') })
        const verification = request.url?.endsWith('/verify')
        if (verification && mode === 'legacy' && request.url?.includes('launch-grant')) {
          response.writeHead(404, { 'Content-Type': 'application/json' })
          response.end(JSON.stringify({ detail: 'Not Found' }))
        } else if (verification && mode === 'legacy') {
          response.writeHead(200, { 'Content-Type': 'application/json' })
          response.end(JSON.stringify({ success: true, data: { valid: true, tool_id: 'tool_listing_script' } }))
        } else {
          response.writeHead(verification && mode === 'query-only' ? 422 : 200, { 'Content-Type': 'application/json' })
          response.end(JSON.stringify({ success: false, message: 'isolated gate refusal' }))
        }
      })
    })
    await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('loopback fixture unavailable')
    const root = mkdtempSync(join(tmpdir(), 'kst-grant-transport-'))
    const child = fork(resolve('dist-electron/electron/automation-runner.cjs'), [], {
      env: { ...process.env, TOOLBOX_RUNNER_MOCK: 'false', ELECTRON_RUN_AS_NODE: '1',
        TOOLBOX_CONTROL_API_URL: `http://127.0.0.1:${address.port}`, TOOLBOX_CLIENT_VERSION: '1.8.15',
        TOOLBOX_PROFILE_ROOT: join(root, 'profiles'), TOOLBOX_ARTIFACT_ROOT: join(root, 'artifacts') },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    try {
      const result = await new Promise<Record<string, unknown>>((resolveFailure, rejectFailure) => {
        const timer = setTimeout(() => rejectFailure(new Error('grant fixture timed out')), 10_000)
        child.once('error', error => { clearTimeout(timer); rejectFailure(error) })
        child.on('message', raw => {
          const message = raw as { type?: string; event?: { type?: string; error?: Record<string, unknown> } }
          if (message.type === 'event' && message.event?.type === 'run.failed') {
            clearTimeout(timer)
            resolveFailure(message.event.error || {})
          }
        })
        child.send({ type: 'command', id: 'transport-start', command: 'start', payload: { tool: {
          id: 'tool_listing_script', name: 'isolated grant boundary', platformKey: 'amazon', executionMode: 'live',
          scriptKey: 'amazon.listing_script.v1', scriptStatus: 'script_ready', targetUrl: 'http://localhost:8732/',
          launchGrant: { token: 'isolated-private-grant', signatureRequired: false },
          // Successful alias validation stops at input checks, before opening a browser.
          executionContext: { mode: 'single', sessionId: 'isolated-grant', input: { sku: '' } },
        } } })
      })
      expect(result.code).toBe(expectedCode)
      const verification = requests.filter(request => request.url.includes('/verify'))
      expect(verification).toEqual(paths.map(url => ({ url, method: 'POST',
        body: JSON.stringify({ token: 'isolated-private-grant' }), version: '1.8.15', contentType: 'application/json' })))
      expect(requests.every(request => !request.url.includes('isolated-private-grant') && !request.url.includes('?token='))).toBe(true)
    } finally {
      if (child.connected) child.send({ type: 'command', id: 'transport-stop', command: 'shutdown', payload: {} })
      await new Promise<void>(resolveExit => {
        if (child.exitCode !== null || child.signalCode !== null) return resolveExit()
        const timer = setTimeout(() => { child.kill(); resolveExit() }, 2_000)
        child.once('exit', () => { clearTimeout(timer); resolveExit() })
      })
      await new Promise<void>((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose()))
      rmSync(root, { recursive: true, force: true })
    }
  }, 15_000)
})
