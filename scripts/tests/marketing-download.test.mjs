/* global Response */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { URL } from 'node:url'
import { getPublishedMarketingDownload, marketingInstallerFromManifest, verifyMarketingDownload as verifyDownload } from '../marketing-download.mjs'

const verifyMarketingDownload = options => verifyDownload({ expectedSize: 100, ...options })

const controlUrl = 'https://downloads.kst.test'
const installerUrl = `${controlUrl}/updates/KST%20Setup%201.8.15.exe`
const stable = `${controlUrl}/updates/latest.exe`
function fixture({ status = 302, location = installerUrl, cache = 'no-store, no-cache', fileStatus = 200, length = '100', mime = 'application/octet-stream' } = {}) {
  const calls = []
  const request = async (url, options) => {
    calls.push(url)
    assert.equal(options.method, 'HEAD')
    assert.equal(options.redirect, 'manual')
    assert.equal(options.cache, 'no-store')
    return url === stable
      ? new Response(null, { status, headers: { ...(location ? { location } : {}), 'cache-control': cache } })
      : new Response(null, { status: fileStatus, headers: { 'content-length': length, 'content-type': mime } })
  }
  return { request, calls }
}
test('stable URL verifies no-store first hop and immutable version independently', async () => {
  const f = fixture({ location: '/updates/KST%20Setup%201.8.15.exe' })
  assert.deepEqual(await verifyMarketingDownload({ controlUrl, installerUrl, request: f.request }), { downloadUrl: stable, installerUrl, size: 100 })
  assert.deepEqual(f.calls, [stable, installerUrl])
})
test('explicit current version remains supported without redirects', async () => {
  const f = fixture()
  assert.equal((await verifyMarketingDownload({ controlUrl, installerUrl, configuredUrl: installerUrl, request: f.request })).downloadUrl, installerUrl)
  assert.deepEqual(f.calls, [installerUrl])
})
test('rejects stale, external, credential-bearing and query-bearing configuration before requesting', async () => {
  for (const configuredUrl of [`${controlUrl}/updates/old.exe`, 'https://evil.test/app.exe', `${stable}?token=x`, `https://u:p@downloads.kst.test/updates/latest.exe`]) {
    const f = fixture()
    await assert.rejects(verifyMarketingDownload({ controlUrl, installerUrl, configuredUrl, request: f.request }))
    assert.deepEqual(f.calls, [])
  }
})
test('rejects off-origin, stale, looping, extra hop and insecure targets without following them', async () => {
  for (const location of ['https://evil.test/a.exe', '//evil.test/a.exe', 'http://downloads.kst.test/a.exe', '/updates/old.exe', stable, `${installerUrl}?x=1`, `${installerUrl}#x`, 'https://u:p@downloads.kst.test/updates/KST%20Setup%201.8.15.exe', '']) {
    const f = fixture({ location })
    await assert.rejects(verifyMarketingDownload({ controlUrl, installerUrl, request: f.request }))
    assert.deepEqual(f.calls, [stable])
  }
})
test('rejects cached alias and silent full-file alias', async () => {
  for (const options of [{ cache: 'public, max-age=31536000, immutable' }, { status: 200 }, { status: 301 }, { status: 404 }, { status: 500 }]) {
    const f = fixture(options)
    await assert.rejects(verifyMarketingDownload({ controlUrl, installerUrl, request: f.request }))
    assert.deepEqual(f.calls, [stable])
  }
})
test('rejects missing, redirected, empty or HTML installer and network errors', async () => {
  for (const options of [{ fileStatus: 404 }, { fileStatus: 302 }, { length: '0' }, { length: '' }, { length: 'nan' }, { mime: 'text/html' }]) {
    const f = fixture(options)
    await assert.rejects(verifyMarketingDownload({ controlUrl, installerUrl, request: f.request }))
  }
  await assert.rejects(verifyMarketingDownload({ controlUrl, installerUrl, request: async () => { throw new Error('offline') } }), /offline/)
})

test('requires manifest size before checking any URL', async () => {
  for (const expectedSize of [undefined, 0, -1, NaN, '100', Infinity, 1.5]) {
    const f = fixture()
    await assert.rejects(verifyDownload({ controlUrl, installerUrl, expectedSize, request: f.request }))
    assert.deepEqual(f.calls, [])
  }
})

test('requires exact manifest size and binary MIME rather than any non-HTML response', async () => {
  for (const options of [{ length: '101' }, { length: '99' }, { mime: 'application/json' }, { mime: 'application/xml' }, { mime: 'text/plain' }, { mime: '' }]) {
    const f = fixture(options)
    await assert.rejects(verifyMarketingDownload({ controlUrl, installerUrl, request: f.request }), /大小或文件类型/)
  }
  for (const mime of ['application/octet-stream', 'application/x-msdownload', 'Application/Vnd.Microsoft.Portable-Executable; charset=binary']) {
    assert.equal((await verifyMarketingDownload({ controlUrl, installerUrl, request: fixture({ mime }).request })).size, 100)
  }
})

const manifest = (version = '1.8.15', size = 100) => `version: ${version}\nfiles:\n  - url: unrelated.zip\n    size: 17\n  - url: KST Setup ${version}.exe\n    size: ${size}\npath: KST Setup ${version}.exe\n`

test('manifest matches the selected file size instead of the first file', () => {
  assert.deepEqual(marketingInstallerFromManifest(manifest(), controlUrl, '1.8.15'), { version: '1.8.15', installerUrl, expectedSize: 100 })
  assert.deepEqual(marketingInstallerFromManifest(manifest(), controlUrl), { version: '1.8.15', installerUrl, expectedSize: 100 })
})

test('rejects malformed manifests and ambiguous, invalid or missing installer sizes', () => {
  for (const text of [
    '', 'version: [broken', 'x'.repeat(65537), manifest().replace('size: 100', 'size: "100"'),
    manifest().replace('size: 100', 'size: 0'), manifest().replace('size: 100', 'size: -1'),
    manifest().replace('size: 100', 'size: 1.5'), manifest().replace('size: 100', 'size: 9007199254740992'),
    manifest().replace('    size: 100\n', ''), manifest().replace('KST Setup 1.8.15.exe\n    size', 'missing.exe\n    size'),
    manifest().replace('path:', '  - url: KST Setup 1.8.15.exe\n    size: 100\npath:'),
    `${manifest()}version: 1.8.15\n`, manifest().replaceAll('KST Setup 1.8.15.exe', '../app.exe'),
  ]) assert.throws(() => marketingInstallerFromManifest(text, controlUrl, '1.8.15'))
  assert.throws(() => marketingInstallerFromManifest(manifest('1.8.16'), controlUrl, '1.8.15'), /先正式发布/)
})

test('current download reads no-store, non-redirecting manifest on every invocation', async () => {
  const f = fixture()
  const calls = []
  const request = async (url, options) => {
    calls.push(url)
    if (url.endsWith('/latest.yml')) {
      assert.equal(options.method, 'GET')
      assert.equal(options.cache, 'no-store')
      assert.equal(options.redirect, 'error')
      return new Response(manifest())
    }
    return f.request(url, options)
  }
  for (let pass = 0; pass < 2; pass += 1) {
    assert.deepEqual(await getPublishedMarketingDownload({ controlUrl, expectedVersion: '1.8.15', request }), {
      downloadUrl: stable, installerUrl, size: 100, version: '1.8.15',
    })
  }
  assert.deepEqual(calls, [`${controlUrl}/updates/latest.yml`, stable, installerUrl, `${controlUrl}/updates/latest.yml`, stable, installerUrl])
})

test('explicit version URL cannot hide a concurrent release before publication', async () => {
  let version = '1.8.15'
  const f = fixture()
  const request = (url, options) => url.endsWith('/latest.yml')
    ? Promise.resolve(new Response(manifest(version))) : f.request(url, options)
  const config = { controlUrl, expectedVersion: '1.8.15', configuredUrl: installerUrl, request }
  assert.equal((await getPublishedMarketingDownload(config)).version, '1.8.15')
  assert.deepEqual(f.calls, [installerUrl])
  version = '1.8.16'
  await assert.rejects(getPublishedMarketingDownload(config), /先正式发布/)
  assert.deepEqual(f.calls, [installerUrl], 'changed manifest is rejected before another old installer HEAD')
})

test('changed same-version size and unavailable manifest fail closed', async () => {
  const f = fixture()
  const request = (url, options) => url.endsWith('/latest.yml')
    ? Promise.resolve(new Response(manifest('1.8.15', 101))) : f.request(url, options)
  await assert.rejects(getPublishedMarketingDownload({ controlUrl, expectedVersion: '1.8.15', request }), /大小或文件类型/)
  for (const status of [204, 302, 404, 500]) {
    await assert.rejects(getPublishedMarketingDownload({ controlUrl, request: async () => new Response(null, { status }) }), /清单/)
  }
})

test('production revalidation precedes both publication mutations and stays version-pinned', () => {
  const source = fs.readFileSync(new URL('../publish-marketing.mjs', import.meta.url), 'utf8')
  assert.match(source, /const verifyCurrentDownload = \(\) => getPublishedMarketingDownload\(\{ controlUrl, expectedVersion: metadata\.version, configuredUrl: downloadUrl \}\)/)
  assert.match(source, /await verifyCurrentDownload\(\)\s+command\('git', \['push'/)
  assert.match(source, /await verifyCurrentDownload\(\)\s+node\('node_modules\/wrangler\/bin\/wrangler\.js', \['pages', 'deploy'/)
  assert.match(source, /const currentDownload = await verifyCurrentDownload\(\)/)
  const build = fs.readFileSync(new URL('../build-marketing.mjs', import.meta.url), 'utf8')
  assert.match(build, /getPublishedMarketingDownload\(\{ controlUrl: metadata\.toolbox\.controlApiUrl \}\)/, 'local candidate points to current published core without treating its package version as released')
})
