import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assertGitHubPagesProject, assertMarketingMetadata, assertPagesProject, installerFromManifest, marketingToolEnvironment, publicHttpsUrl, readMarketingEnvironment, validateMarketingConfig } from '../marketing-config.mjs'
import { prepareGitHubPagesTree } from '../github-pages-artifact.mjs'

test('marketing config requires explicit HTTPS public origin and valid Pages identity', () => {
  const valid = { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_PAGES_PROJECT: 'kesaitong', KST_MARKETING_SITE_URL: 'https://kesaitong.pages.dev/' }
  assert.equal(validateMarketingConfig(valid).publicUrl, 'https://kesaitong.pages.dev')
  for (const bad of ['http://kst.test', 'https://user:secret@kst.test', 'https://localhost', 'https://kst.test/?token=abc', 'https://kst.test/subpath']) {
    assert.throws(() => validateMarketingConfig({ ...valid, KST_MARKETING_SITE_URL: bad }))
  }
  assert.throws(() => validateMarketingConfig({ ...valid, CLOUDFLARE_ACCOUNT_ID: '' }))
  assert.throws(() => validateMarketingConfig({ ...valid, CLOUDFLARE_PAGES_PROJECT: 'unsafe;project' }))
  assert.throws(() => publicHttpsUrl('https://kst.test/#token', 'url'))
})

test('only allowlisted marketing settings are loaded and process values win', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kst-marketing-config-'))
  try {
    fs.writeFileSync(path.join(directory, '.env.marketing.local'), '# local\nKST_MARKETING_SITE_URL="https://kst.test"\nCLOUDFLARE_PAGES_PROJECT=kst-site\nCLOUDFLARE_API_TOKEN=never-load\nVITE_CONTROL_API_BASE=https://wrong.test\n')
    assert.deepEqual(readMarketingEnvironment(directory, { CLOUDFLARE_PAGES_PROJECT: 'override' }), { KST_MARKETING_SITE_URL: 'https://kst.test', CLOUDFLARE_PAGES_PROJECT: 'override' })
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('installer discovery rejects unpublished versions and external/path-traversal files', () => {
  assert.equal(installerFromManifest('version: 1.8.8\npath: KST Setup 1.8.8.exe\n', 'https://api.kst.test', '1.8.8'), 'https://api.kst.test/updates/KST%20Setup%201.8.8.exe')
  assert.throws(() => installerFromManifest('version: 1.8.7\npath: KST Setup 1.8.7.exe', 'https://api.kst.test', '1.8.8'))
  for (const filename of ['../evil.exe', 'https://evil.test/a.exe', 'folder/a.exe', 'folder\\a.exe', 'file.zip', 'file.exe?token=a']) {
    assert.throws(() => installerFromManifest(`version: 1.8.8\npath: ${filename}`, 'https://api.kst.test', '1.8.8'))
  }
})

test('post-deploy contract includes commit and correct installer, not only product version', () => {
  const expected = { version: '1.8.8', commitSha: 'abc', publicUrl: 'https://kst.test', downloadUrl: 'https://api.kst.test/a.exe' }
  assertMarketingMetadata(expected, expected)
  for (const field of Object.keys(expected)) assert.throws(() => assertMarketingMetadata({ ...expected, [field]: 'stale' }, expected))
})

test('CLI data is outside source and telemetry disabled', () => {
  const root = path.join(os.tmpdir(), 'kst-test-data')
  const env = marketingToolEnvironment({ TOOLBOX_DATA_ROOT: root })
  assert.equal(env.WRANGLER_SEND_METRICS, 'false')
  assert.equal(env.XDG_CONFIG_HOME, path.join(root, 'cloudflare', 'config'))
})

test('Pages project check uses the pinned Wrangler CLI JSON format', () => {
  assertPagesProject([{ 'Project Name': 'kesaitong', 'Project Domains': 'kesaitong.pages.dev, kesaitong.top' }], 'kesaitong', 'https://kesaitong.pages.dev')
  assertPagesProject([{ 'Project Name': 'kesaitong', 'Project Domains': 'kesaitong.pages.dev, kesaitong.top' }], 'kesaitong', 'https://kesaitong.top')
  assert.throws(() => assertPagesProject([], 'kesaitong', 'https://kesaitong.pages.dev'))
  assert.throws(() => assertPagesProject([{ 'Project Name': 'another-project' }], 'kesaitong', 'https://kesaitong.pages.dev'))
  assert.throws(() => assertPagesProject({ error: 'not logged in' }, 'kesaitong', 'https://kesaitong.pages.dev'))
  assert.throws(() => assertPagesProject([{ 'Project Name': 'kesaitong', 'Project Domains': 'kesaitong.pages.dev' }], 'kesaitong', 'https://unbound.example.test'))
})

test('GitHub Pages validates the exact public user site and existing branch config', () => {
  const values = { KST_MARKETING_PROVIDER: 'github-pages', GITHUB_PAGES_REPOSITORY: 'kst-team/kst-team.github.io', KST_MARKETING_SITE_URL: 'https://kst-team.github.io' }
  const config = validateMarketingConfig(values)
  assert.equal(config.provider, 'github-pages')
  assert.equal(config.downloadUrl, '')
  const pages = { html_url: `${config.publicUrl}/`, source: { branch: 'main', path: '/' }, build_type: 'legacy' }
  assertGitHubPagesProject(pages, config)
  for (const invalid of [{ ...values, GITHUB_PAGES_REPOSITORY: 'other/kst-team.github.io' }, { ...values, KST_MARKETING_SITE_URL: 'https://other.github.io' }, { ...values, KST_MARKETING_PROVIDER: 'unknown' }]) assert.throws(() => validateMarketingConfig(invalid))
  assert.throws(() => assertGitHubPagesProject({ ...pages, source: { branch: 'develop', path: '/' } }, config))
  assert.throws(() => assertGitHubPagesProject({ ...pages, html_url: 'https://other.github.io' }, config))
  assert.throws(() => assertGitHubPagesProject({ ...pages, build_type: 'workflow' }, config))
  assert.throws(() => assertGitHubPagesProject({ ...pages, cname: 'unexpected.test' }, config))
})

test('GitHub Pages custom origin requires the same user repository and a matching existing CNAME', () => {
  const values = { KST_MARKETING_PROVIDER: 'github-pages', GITHUB_PAGES_REPOSITORY: 'kst-team/kst-team.github.io', KST_MARKETING_SITE_URL: 'https://kesaitong.top' }
  const config = validateMarketingConfig(values)
  assert.equal(config.publicUrl, 'https://kesaitong.top')
  const pages = { html_url: `${config.publicUrl}/`, cname: 'kesaitong.top', source: { branch: 'main', path: '/' }, build_type: 'legacy' }
  assertGitHubPagesProject(pages, config)
  assertGitHubPagesProject({ ...pages, cname: 'KESAITONG.TOP' }, config)
  for (const cname of [null, undefined, '', 'www.kesaitong.top', 'other.test']) {
    assert.throws(() => assertGitHubPagesProject({ ...pages, cname }, config))
  }
  for (const invalid of [
    { ...values, GITHUB_PAGES_REPOSITORY: 'other/kst-team.github.io' },
    { ...values, GITHUB_PAGES_REPOSITORY: 'kst-team/another-repo' },
    { ...values, KST_MARKETING_SITE_URL: 'https://other.github.io' },
    { ...values, KST_MARKETING_SITE_URL: 'https://github.io' },
    { ...values, KST_MARKETING_SITE_URL: 'https://192.0.2.1' },
    { ...values, KST_MARKETING_SITE_URL: 'https://kesaitong.top:9443' },
    { ...values, KST_MARKETING_SITE_URL: 'https://user:secret@kesaitong.top' },
    { ...values, KST_MARKETING_SITE_URL: 'https://kesaitong.top/subpath' },
  ]) assert.throws(() => validateMarketingConfig(invalid))
  assert.throws(() => assertGitHubPagesProject({ ...pages, html_url: 'https://kst-team.github.io/' }, config))
  assert.throws(() => assertGitHubPagesProject({ ...pages, source: { branch: 'main', path: '/docs' } }, config))
  assert.throws(() => assertGitHubPagesProject({ ...pages, source: { branch: 'develop', path: '/' } }, config))
  assert.throws(() => assertGitHubPagesProject({ ...pages, build_type: 'workflow' }, config))
})

function pagesFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kst-pages-test-'))
  const artifact = path.join(root, 'artifact'), checkout = path.join(root, 'checkout')
  fs.mkdirSync(artifact); fs.mkdirSync(checkout)
  const metadata = { kind: 'kst-marketing', sourcePolicy: 'marketing-only-v1', publicUrl: 'https://kst.github.io' }
  for (const directory of [artifact, checkout]) {
    fs.writeFileSync(path.join(directory, 'marketing-version.json'), JSON.stringify(metadata))
    fs.writeFileSync(path.join(directory, 'index.html'), '<html><head></head><body>课赛通</body></html>')
    fs.writeFileSync(path.join(directory, '404.html'), '<html><head></head><body>404</body></html>')
  }
  fs.mkdirSync(path.join(checkout, '.git')); fs.writeFileSync(path.join(checkout, '.git', 'HEAD'), 'preserve')
  return { root, artifact, checkout, publicUrl: metadata.publicUrl, tracked: ['index.html', '404.html', 'marketing-version.json'] }
}

test('GitHub artifact keeps history, builds direct public routes and embeds browser policy', () => {
  const f = pagesFixture()
  try {
    fs.mkdirSync(path.join(f.checkout, 'assets'))
    fs.writeFileSync(path.join(f.checkout, 'assets/old-12345678.js'), 'old')
    prepareGitHubPagesTree(f.artifact, f.checkout, [...f.tracked, 'assets/old-12345678.js'], f.publicUrl)
    assert.equal(fs.readFileSync(path.join(f.checkout, '.git/HEAD'), 'utf8'), 'preserve')
    assert.equal(fs.existsSync(path.join(f.checkout, 'assets/old-12345678.js')), false)
    assert.equal(fs.existsSync(path.join(f.checkout, '.nojekyll')), true)
    for (const name of ['index.html', '404.html', 'terms/index.html', 'user/terms/index.html', 'competition/index.html', 'course/index.html', 'tools/index.html', 'demo/index.html']) assert.match(fs.readFileSync(path.join(f.checkout, name), 'utf8'), /connect-src 'none'/)
  } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
})

test('GitHub artifact refuses unknown target or incoming files before changing any file', () => {
  for (const where of ['checkout', 'artifact']) {
    const f = pagesFixture()
    try {
      fs.writeFileSync(path.join(f[where], 'private.txt'), 'never publish')
      assert.throws(() => prepareGitHubPagesTree(f.artifact, f.checkout, where === 'checkout' ? [...f.tracked, 'private.txt'] : f.tracked, f.publicUrl))
      assert.equal(fs.readFileSync(path.join(f.checkout, 'index.html'), 'utf8'), '<html><head></head><body>课赛通</body></html>')
      assert.equal(fs.readFileSync(path.join(f[where], 'private.txt'), 'utf8'), 'never publish')
    } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
  }
})

test('GitHub artifact rejects a different site and traversal without deleting the old build', () => {
  const f = pagesFixture()
  try {
    assert.throws(() => prepareGitHubPagesTree(f.artifact, f.checkout, f.tracked, 'https://other.github.io'))
    assert.throws(() => prepareGitHubPagesTree(f.artifact, f.checkout, [...f.tracked, '../index.html'], f.publicUrl))
    assert.equal(fs.existsSync(path.join(f.checkout, 'index.html')), true)
  } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
})

function setFixturePublicUrl(directory, publicUrl) {
  const filename = path.join(directory, 'marketing-version.json')
  const metadata = JSON.parse(fs.readFileSync(filename, 'utf8'))
  fs.writeFileSync(filename, JSON.stringify({ ...metadata, publicUrl }))
}

test('GitHub artifact creates a CNAME for a custom site and preserves its binding on updates', () => {
  for (const existingCname of [false, true]) {
    const f = pagesFixture()
    try {
      const customUrl = 'https://kesaitong.top'
      setFixturePublicUrl(f.artifact, customUrl)
      setFixturePublicUrl(f.checkout, customUrl)
      const tracked = [...f.tracked]
      if (existingCname) {
        fs.writeFileSync(path.join(f.checkout, 'CNAME'), 'kesaitong.top\n')
        tracked.push('CNAME')
      }
      prepareGitHubPagesTree(f.artifact, f.checkout, tracked, customUrl)
      assert.equal(fs.readFileSync(path.join(f.checkout, 'CNAME'), 'utf8'), 'kesaitong.top\n')
      assert.equal(fs.readFileSync(path.join(f.checkout, '.git/HEAD'), 'utf8'), 'preserve')
    } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
  }
})

test('GitHub artifact requires an explicit old origin when migrating to a custom domain', () => {
  const f = pagesFixture()
  try {
    const customUrl = 'https://kesaitong.top'
    const previousPublicUrl = 'https://fengzide86.github.io'
    setFixturePublicUrl(f.checkout, previousPublicUrl)
    setFixturePublicUrl(f.artifact, customUrl)
    assert.throws(() => prepareGitHubPagesTree(f.artifact, f.checkout, f.tracked, customUrl))
    assert.throws(() => prepareGitHubPagesTree(f.artifact, f.checkout, f.tracked, customUrl, { previousPublicUrl: 'https://other.github.io' }))
    assert.throws(() => prepareGitHubPagesTree(f.artifact, f.checkout, f.tracked, 'https://other.github.io', { previousPublicUrl }))
    assert.equal(fs.readFileSync(path.join(f.checkout, 'index.html'), 'utf8'), '<html><head></head><body>课赛通</body></html>')
    // GitHub may already have committed the new binding before our first upload.
    fs.writeFileSync(path.join(f.checkout, 'CNAME'), 'kesaitong.top\n')
    prepareGitHubPagesTree(f.artifact, f.checkout, [...f.tracked, 'CNAME'], customUrl, { previousPublicUrl })
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.checkout, 'marketing-version.json'), 'utf8')).publicUrl, customUrl)
    assert.equal(fs.readFileSync(path.join(f.checkout, 'CNAME'), 'utf8'), 'kesaitong.top\n')
  } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
})

test('GitHub artifact rejects mismatched target or incoming CNAME without overwriting files', () => {
  for (const where of ['checkout', 'artifact']) {
    const f = pagesFixture()
    try {
      const customUrl = 'https://kesaitong.top'
      setFixturePublicUrl(f.artifact, customUrl)
      setFixturePublicUrl(f.checkout, customUrl)
      fs.writeFileSync(path.join(f[where], 'CNAME'), 'other.test\n')
      const tracked = where === 'checkout' ? [...f.tracked, 'CNAME'] : f.tracked
      assert.throws(() => prepareGitHubPagesTree(f.artifact, f.checkout, tracked, customUrl), /CNAME/)
      assert.equal(fs.readFileSync(path.join(f.checkout, 'index.html'), 'utf8'), '<html><head></head><body>课赛通</body></html>')
      assert.equal(fs.readFileSync(path.join(f[where], 'CNAME'), 'utf8'), 'other.test\n')
    } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
  }
})

test('GitHub artifact refuses an untracked CNAME, an unexpected user-site CNAME and stale incoming metadata', () => {
  const f = pagesFixture()
  try {
    fs.writeFileSync(path.join(f.checkout, 'CNAME'), 'other.test\n')
    assert.throws(() => prepareGitHubPagesTree(f.artifact, f.checkout, f.tracked, f.publicUrl), /CNAME/)
    assert.equal(fs.readFileSync(path.join(f.checkout, 'index.html'), 'utf8'), '<html><head></head><body>课赛通</body></html>')
    fs.unlinkSync(path.join(f.checkout, 'CNAME'))
    setFixturePublicUrl(f.artifact, 'https://other.github.io')
    assert.throws(() => prepareGitHubPagesTree(f.artifact, f.checkout, f.tracked, f.publicUrl), /制品来源/)
    assert.equal(fs.readFileSync(path.join(f.checkout, 'index.html'), 'utf8'), '<html><head></head><body>课赛通</body></html>')
  } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
})
