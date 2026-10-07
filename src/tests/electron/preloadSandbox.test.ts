import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync(resolve('dist-electron/electron/preload.cjs'), 'utf8')

function loadSandbox(automation: boolean) {
  const exposed: Record<string, Record<string, unknown>> = {}
  const ipc = { invoke: vi.fn().mockResolvedValue({ success: true }), on: vi.fn(), removeListener: vi.fn(), send: vi.fn() }
  const imports: string[] = []
  const listeners = new Map<string, () => void>()
  runInNewContext(source, {
    require: (name: string) => {
      imports.push(name)
      if (name !== 'electron') throw new Error(`Sandbox cannot require ${name}`)
      return { contextBridge: { exposeInMainWorld: (key: string, value: Record<string, unknown>) => { exposed[key] = value } }, ipcRenderer: ipc }
    },
    process: { argv: ['electron', '--toolbox-control-api-base=http://127.0.0.1:8000', '--toolbox-device-id=DEV-FIXTURE',
      '--toolbox-device-name=Fixture%20Device', `--toolbox-automation-enabled=${automation}`] },
    module: { exports: {} }, exports: {}, console, URL, setTimeout, clearTimeout,
    window: { addEventListener: (name: string, listener: () => void) => listeners.set(name, listener) },
  })
  return { bridge: exposed.electronAPI, ipc, imports, listeners }
}

describe('compiled preload in Electron sandbox require restrictions', () => {
  it('exposes the real bridge without relative or package require calls', () => {
    const { bridge, imports } = loadSandbox(true)
    expect(imports).toEqual(['electron'])
    expect(bridge?.runtime).toEqual({ controlApiBase: 'http://127.0.0.1:8000', deviceId: 'DEV-FIXTURE', deviceName: 'Fixture Device' })
    expect(bridge).toHaveProperty('credentialStore')
    expect(bridge).toHaveProperty('automation')
    expect(bridge).toHaveProperty('batch')
    expect(bridge).toHaveProperty('artifacts')
  })

  it('keeps runtime capability gates when bundled', () => {
    const { bridge } = loadSandbox(false)
    expect(bridge).not.toHaveProperty('automation')
    expect(bridge).not.toHaveProperty('batch')
    expect(bridge).not.toHaveProperty('freight')
    expect(bridge).not.toHaveProperty('artifacts')
    expect(bridge).toHaveProperty('updates')
    expect(bridge).toHaveProperty('credentialStore')
  })

  it('retains IPC argument validation, not only bridge names', async () => {
    const { bridge, ipc } = loadSandbox(true)
    const credentials = bridge?.credentialStore as { saveUserCode: (value: unknown) => Promise<boolean> }
    expect(() => credentials.saveUserCode(null)).toThrow()
    expect(ipc.invoke).not.toHaveBeenCalled()
    await credentials.saveUserCode('FIXTURE-CODE')
    expect(ipc.invoke).toHaveBeenCalledWith('credential-save-user-code', 'FIXTURE-CODE')
  })

  it('clears evidence on expired/cleared authentication and validates artifact responses', async () => {
    const { bridge, ipc, listeners } = loadSandbox(true)
    const artifacts = bridge?.artifacts as { read: (request: unknown) => Promise<unknown> }
    await expect(artifacts.read({ runId: 'run_1', kind: 'screenshot', path: '/private' })).rejects.toThrow()
    expect(ipc.invoke).not.toHaveBeenCalled()
    listeners.get('toolbox:auth-cleared')?.()
    expect(ipc.invoke).toHaveBeenCalledWith('artifacts:clear')
    ipc.invoke.mockResolvedValueOnce({ status: 'available', kind: 'screenshot', dataUrl: 'file:///private.png' })
    await expect(artifacts.read({ runId: 'run_1', kind: 'screenshot' })).rejects.toThrow()
  })
})
