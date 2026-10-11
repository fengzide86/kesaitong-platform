import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { NSIS_APP_GUID, NSIS_APP_ID, NSIS_UUID_NAMESPACE, readInstallerIdentity, verifyInstalledAsar } from '../../../scripts/nsis-install-identity.mjs'

const require = createRequire(import.meta.url)
const asar = require('@electron/asar') as { createPackage(source: string, target: string): Promise<void> }
const scratchParent = resolve(process.platform === 'win32' ? 'D:/AmazonToolboxData/installer-smoke' : tmpdir())
const scratchDirectories: string[] = []
const script = readFileSync(resolve('scripts/nsis-install-smoke.ps1'), 'utf8')

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    if (!directory.startsWith(scratchParent + sep) || !basename(directory).startsWith('kst-identity-test-')) throw new Error('Unowned test directory')
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('strict historical installer identity and location hint', () => {
  it('derives the exact registry GUID from the actual locked builder algorithm, not an arbitrary test ID', () => {
    const builder = readFileSync(require.resolve('app-builder-lib/out/targets/nsis/NsisTarget.js'), 'utf8')
    expect(builder).toContain(`UUID.parse("${NSIS_UUID_NAMESPACE}")`)
    expect(builder).toContain('UUID.v5(appInfo.id, ELECTRON_BUILDER_NS_UUID)')
    expect(builder).toContain('APP_GUID: guid')
    expect(readInstallerIdentity()).toEqual({
      appId: 'com.amazon.toolbox', appGuid: '159e8ec2-4c1f-5b99-a3ea-a9467c2587ec',
      builderVersion: '26.15.3', uuidNamespace: NSIS_UUID_NAMESPACE,
      installKey: `Software\\${NSIS_APP_GUID}`,
      uninstallKey: `Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${NSIS_APP_GUID}`,
    })
  })

  it('refuses identity changes and custom GUID overrides', () => {
    expect(() => readInstallerIdentity({ build: { appId: 'other.application' } })).toThrow('Unexpected installation AppID')
    expect(() => readInstallerIdentity({ build: { appId: NSIS_APP_ID, nsis: { guid: NSIS_APP_GUID } } })).toThrow('custom NSIS GUID')
  })

  it.each(['1.8.5', '1.8.7', '1.8.8', '1.8.14'])('checks actual installed ASAR package version %s', async version => {
    mkdirSync(scratchParent, { recursive: true })
    const directory = mkdtempSync(join(scratchParent, 'kst-identity-test-'))
    scratchDirectories.push(directory)
    const source = join(directory, 'package')
    const archive = join(directory, 'app.asar')
    mkdirSync(source)
    writeFileSync(join(source, 'package.json'), JSON.stringify({ name: 'test-only', version }))
    await asar.createPackage(source, archive)
    expect(verifyInstalledAsar(archive, version)).toEqual({ name: 'test-only', version, archivePath: archive })
    expect(() => verifyInstalledAsar(archive, '9.9.9')).toThrow('expected actual installer')
  })

  it('keeps the historical location hint explicit, single-attempt and after old-package hash validation', () => {
    expect(script).toContain('[switch]$LegacyInstallLocationHint')
    expect(script).not.toContain('$LegacyInstallLocationHint = $true')
    expect(script).toContain('$LegacyInstallLocationHint -and (-not $PreviousInstaller -or $DiagnosticAttempts -ne 1)')
    const hashCheck = script.indexOf('throw "Old installer does not match the pinned released $PreviousVersion binary"')
    const hint = script.indexOf('if ($LegacyInstallLocationHint) { Set-LegacyInstallLocationHint $fixture }')
    const oldInstall = script.indexOf("Invoke-Install $PreviousInstaller 'old-version'")
    expect(hashCheck).toBeGreaterThan(0)
    expect(hint).toBeGreaterThan(hashCheck)
    expect(oldInstall).toBeGreaterThan(hint)
    expect(script).toContain("$PinnedFixture.version -notin @('1.8.5', '1.8.7')")
  })

  it('pre-fills only InstallLocation and rejects registry leftovers, nonempty paths and reparse points', () => {
    const hint = script.slice(script.indexOf('function Set-LegacyInstallLocationHint'), script.indexOf('function Assert-InstalledIdentity'))
    expect(hint).toContain('Refusing to overwrite a pre-existing registry key')
    expect(hint).toContain('must not exist or must be completely empty')
    expect(hint).toContain('[IO.FileAttributes]::ReparsePoint')
    expect(hint.match(/New-ItemProperty/g)).toHaveLength(1)
    expect(hint).toContain("-Name 'InstallLocation' -Value $target -PropertyType String")
    expect(hint).not.toContain('-Name DisplayVersion')
    expect(hint).not.toContain('-Name UninstallString')
    expect(hint).toContain('modifiesExistingLocationBranch = $true; validatesOldFreshInstall = $false')
    expect(hint).toContain('createsUninstallRegistration = $false')
  })

  it('tests current-production 1.8.8 from the original fresh installer without a legacy registry hint', () => {
    const workflow = readFileSync(resolve('.github/workflows/test.yml'), 'utf8')
    expect(script).toContain("'1.8.8' = 'nsis-upgrade-fixture-1.8.8.json'")
    const hint = script.slice(script.indexOf('function Set-LegacyInstallLocationHint'), script.indexOf('function Assert-InstalledIdentity'))
    expect(hint).not.toContain("'1.8.8'")
    const currentUpgrade = workflow.split(/\r?\n/).find(line => line.includes("-PreviousVersion '1.8.8'"))
    expect(currentUpgrade).toBeDefined()
    expect(currentUpgrade).toContain("-PreviousInstaller 'D:\\AmazonToolboxData\\installer-fixtures\\KST Setup 1.8.8.exe'")
    expect(currentUpgrade).toContain('-DiagnosticAttempts 1')
    expect(currentUpgrade).not.toContain('-LegacyInstallLocationHint')
    const cachePaths = workflow.match(/D:\/AmazonToolboxData\/installer-fixtures\/KST Setup 1\.8\.8\.exe/g)
    expect(cachePaths).toHaveLength(2)
    const pinnedFetch = workflow.indexOf("NSIS_BASELINE_VERSION: '1.8.8'")
    expect(pinnedFetch).toBeGreaterThan(0)
    expect(pinnedFetch).toBeLessThan(workflow.indexOf('Save only byte-verified 1.8.8 installer fixture'))
  })

  it('requires real old ASAR, registered version, uninstaller, EXE and shortcut evidence before seeding', () => {
    const identity = script.indexOf("Assert-InstalledIdentity $fixture.version 'old-version'")
    expect(identity).toBeGreaterThan(script.indexOf("Invoke-Install $PreviousInstaller 'old-version'"))
    expect(identity).toBeLessThan(script.indexOf("Invoke-Runtime 'seed' $fixture.version"))
    expect(script).toContain('nsis-install-identity.mjs\') asar $archive $ExpectedVersion')
    expect(script).toContain('$registration.DisplayVersion -ne $ExpectedVersion')
    expect(script).toContain('$registration.UninstallString')
    expect(script).toContain('Get-WindowsShortcutTarget $shortcutPath')
    expect(script).toContain('[IO.Path]::GetFullPath($actualTarget) -ne $executable')
    expect(script).toContain('Uninstaller left installation registry keys')
    expect(script).toContain('Uninstaller left application shortcuts')
    expect(script).toContain('registryAndShortcutsRemoved = $true')
  })

  it('pins current production 1.8.14 without weakening old upgrade fixtures', () => {
    const workflow = readFileSync(resolve('.github/workflows/test.yml'), 'utf8')
    expect(script).toContain("'1.8.14' = 'nsis-upgrade-fixture-1.8.14.json'")
    const upgrade = workflow.split(/\r?\n/).find(line => line.includes("-PreviousVersion '1.8.14'"))
    expect(upgrade).toContain('-DiagnosticAttempts 1')
    expect(upgrade).not.toContain('-LegacyInstallLocationHint')
    const fixture = JSON.parse(readFileSync(resolve('scripts/nsis-upgrade-fixture-1.8.14.json'), 'utf8'))
    expect(fixture.version).toBe('1.8.14')
    expect(fixture.sha512).toMatch(/^[a-f0-9]{128}$/)
  })

  it.skipIf(process.platform !== 'win32')('parses the PowerShell harness without executing registry or installer actions', () => {
    const filename = resolve('scripts/nsis-install-smoke.ps1').replaceAll("'", "''")
    const parse = `$parseErrors = $null; $tokens = $null; [System.Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText('${filename}', [Text.Encoding]::UTF8), [ref]$tokens, [ref]$parseErrors) | Out-Null; if ($parseErrors.Count) { $parseErrors | ForEach-Object { Write-Error $_.Message }; exit 1 }`
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', parse], { encoding: 'utf8', timeout: 15_000 })
    expect(result.status, result.stderr).toBe(0)
  })
})
