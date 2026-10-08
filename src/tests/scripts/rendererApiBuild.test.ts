import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { build, loadConfigFromFile, type UserConfig } from 'vite'

const repository = process.cwd()
const packageMetadata = JSON.parse(readFileSync(resolve(repository, 'package.json'), 'utf8')) as {
  toolbox: { controlApiUrl: string }
  build: { publish: { url: string } }
}
const baseKeys = ['VITE_CONTROL_API_BASE', 'VITE_API_BASE'] as const

async function configuration(command: 'build' | 'serve' = 'build'): Promise<UserConfig> {
  const loaded = await loadConfigFromFile(
    { command, mode: 'production' }, resolve(repository, 'vite.config.ts'), repository, 'silent',
  )
  if (!loaded) throw new Error('The actual renderer build configuration could not be loaded')
  return loaded.config
}

async function compiledApiBase(config: UserConfig, runtimeBase?: string): Promise<{ code: string, base: string }> {
  // Compile the real resolver against the real production env and the loaded
  // defines, without producing artifacts or running the app plugins.
  const result = await build({
    configFile: false,
    root: repository,
    mode: 'production',
    logLevel: 'silent',
    define: config.define,
    build: {
      write: false,
      minify: false,
      lib: { entry: resolve(repository, 'src/shared/api/base.ts'), formats: ['cjs'] },
    },
  })
  const output = Array.isArray(result) ? result[0] : result
  if (!('output' in output)) throw new Error('Expected an in-memory renderer bundle')
  const chunk = output.output.find(item => item.type === 'chunk')
  if (!chunk || chunk.type !== 'chunk') throw new Error('Expected an API resolver chunk')
  const apiExports: { getApiBase?: () => string } = {}
  runInNewContext(chunk.code, {
    exports: apiExports,
    window: {
      location: { protocol: 'https:', origin: 'https://kesaitong.top' },
      electronAPI: runtimeBase ? { runtime: { controlApiBase: runtimeBase } } : undefined,
    },
    localStorage: { getItem: () => null },
  })
  if (!apiExports.getApiBase) throw new Error('Expected the compiled API resolver export')
  return { code: chunk.code, base: apiExports.getApiBase() }
}

describe('renderer API build isolation', () => {
  beforeEach(() => {
    vi.stubEnv('TOOLBOX_BUILD_TARGET', undefined)
    for (const key of baseKeys) vi.stubEnv(key, undefined)
  })

  afterEach(() => vi.unstubAllEnvs())

  it('builds the local browser renderer against its current origin', async () => {
    const config = await configuration()
    for (const key of baseKeys) expect(config.define?.[`import.meta.env.${key}`]).toBe('""')
    const compiled = await compiledApiBase(config)
    expect(compiled.base).toBe('https://kesaitong.top')
    expect(new URL('/api/health/live', compiled.base).origin).toBe('https://kesaitong.top')
    expect(compiled.code).not.toContain(packageMetadata.toolbox.controlApiUrl)
  })

  it('preserves explicit isolated real-backend E2E process overrides', async () => {
    vi.stubEnv('TOOLBOX_BUILD_TARGET', 'web')
    for (const key of baseKeys) vi.stubEnv(key, 'http://127.0.0.1:49173')
    const config = await configuration()
    for (const key of baseKeys) {
      expect(config.define?.[`import.meta.env.${key}`]).toBe('"http://127.0.0.1:49173"')
    }
    expect((await compiledApiBase(config)).base).toBe('http://127.0.0.1:49173')
  })

  it('does not let the desktop env fallback shadow an explicit legacy API-only test override', async () => {
    vi.stubEnv('VITE_API_BASE', 'http://127.0.0.1:49174')
    const config = await configuration()
    expect(config.define?.['import.meta.env.VITE_CONTROL_API_BASE']).toBe('""')
    expect((await compiledApiBase(config)).base).toBe('http://127.0.0.1:49174')
  })

  it('keeps the desktop production fallback, runtime bridge and update feed unchanged', async () => {
    vi.stubEnv('TOOLBOX_BUILD_TARGET', 'electron')
    const config = await configuration()
    for (const key of baseKeys) expect(config.define?.[`import.meta.env.${key}`]).toBeUndefined()
    expect((await compiledApiBase(config)).base).toBe(packageMetadata.toolbox.controlApiUrl)
    expect((await compiledApiBase(config, packageMetadata.toolbox.controlApiUrl)).base)
      .toBe(packageMetadata.toolbox.controlApiUrl)
    expect(packageMetadata.build.publish.url).toBe(`${packageMetadata.toolbox.controlApiUrl}/updates/`)
  })

  it('does not replace development preview API configuration', async () => {
    const config = await configuration('serve')
    for (const key of baseKeys) expect(config.define?.[`import.meta.env.${key}`]).toBeUndefined()
  })
})
