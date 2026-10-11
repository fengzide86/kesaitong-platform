param(
    [string]$PreviousInstaller = $env:NSIS_PREVIOUS_INSTALLER,
    [string]$PreviousVersion = $(if ($env:NSIS_PREVIOUS_VERSION) { $env:NSIS_PREVIOUS_VERSION } elseif ($env:NSIS_BASELINE_VERSION) { $env:NSIS_BASELINE_VERSION } else { '1.8.5' }),
    [ValidateRange(1, 3)][int]$DiagnosticAttempts = 1,
    [switch]$LegacyInstallLocationHint
)
$ErrorActionPreference = 'Stop'

# /D isolates files, not this AppID's registry/shortcuts. Never use a developer's account.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows') {
    throw 'Real NSIS tests require a disposable GitHub-hosted Windows runner. Use unpacked runtime smoke locally.'
}
if (-not (Test-Path -LiteralPath 'D:\' -PathType Container)) { throw 'NSIS smoke requires D: storage' }
if ($LegacyInstallLocationHint -and (-not $PreviousInstaller -or $DiagnosticAttempts -ne 1)) {
    throw 'LegacyInstallLocationHint requires a pinned old installer and exactly one installation attempt'
}
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $PSScriptRoot 'read-windows-shortcut.ps1')
$metadata = Get-Content (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$identityJson = & node (Join-Path $PSScriptRoot 'nsis-install-identity.mjs') identity
if ($LASTEXITCODE -ne 0) { throw 'Unable to verify the locked NSIS application identity' }
$identity = $identityJson | ConvertFrom-Json
$installRegistryKey = "HKCU:\$($identity.installKey)"
$uninstallRegistryKey = "HKCU:\$($identity.uninstallKey)"
$identityRegistryKeys = @($installRegistryKey, $uninstallRegistryKey,
    "HKLM:\$($identity.installKey)", "HKLM:\$($identity.uninstallKey)",
    "HKCU:\Software\WOW6432Node\$($identity.installKey.Substring(9))",
    "HKCU:\Software\WOW6432Node\$($identity.uninstallKey.Substring(9))",
    "HKLM:\Software\WOW6432Node\$($identity.installKey.Substring(9))",
    "HKLM:\Software\WOW6432Node\$($identity.uninstallKey.Substring(9))")
foreach ($key in $identityRegistryKeys) {
    if (Test-Path -LiteralPath $key) { throw "An installation identity key already exists; preserve it for inspection: $key" }
}
$installer = Join-Path $projectRoot ("release\KST Setup {0}.exe" -f $metadata.version)
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw "NSIS installer missing: $installer" }
$uninstallKeys = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')
foreach ($key in $uninstallKeys) {
    if (-not (Test-Path -LiteralPath $key)) { continue }
    $existing = Get-ChildItem -LiteralPath $key | Get-ItemProperty |
        Where-Object { $_.DisplayName -match '课赛通|AmazonToolbox|amazon-toolbox' }
    if ($existing) { throw 'An existing KST installation is registered; refusing to overwrite/uninstall it' }
}

$smokeId = [guid]::NewGuid().ToString('N')
$smokeRoot = [System.IO.Path]::GetFullPath("D:\AmazonToolboxData\installer-smoke\kst-nsis-smoke-$smokeId")
$installDir = Join-Path $smokeRoot 'app'
$shortcutPaths = @(
    (Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) "$($metadata.build.nsis.shortcutName).lnk"),
    (Join-Path ([Environment]::GetFolderPath('Programs')) "$($metadata.build.nsis.shortcutName).lnk")
)
foreach ($shortcutPath in $shortcutPaths) {
    if (Test-Path -LiteralPath $shortcutPath) { throw "An existing KST shortcut must not be replaced: $shortcutPath" }
}
$diagnostics = Join-Path $projectRoot "test-results\nsis\$smokeId"
New-Item -ItemType Directory -Path $smokeRoot, $diagnostics -Force | Out-Null
@{ kind = 'disposable-nsis'; id = $smokeId } | ConvertTo-Json | Set-Content (Join-Path $smokeRoot 'smoke-owner.json') -Encoding UTF8
$attempts = [System.Collections.Generic.List[object]]::new()
$hadInstallFailure = $false
$startedAt = Get-Date
$previousTemp = $env:TEMP
$previousTmp = $env:TMP
$env:TEMP = Join-Path $smokeRoot 'installer-temp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Path $env:TEMP -Force | Out-Null

function Assert-SmokeDescendant([string]$Target) {
    $resolved = [System.IO.Path]::GetFullPath($Target)
    if (-not $resolved.StartsWith(($smokeRoot.TrimEnd('\') + '\'), [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe smoke target: $resolved"
    }
    return $resolved
}
function Stop-SmokeProcesses {
    $prefix = (Assert-SmokeDescendant $installDir).TrimEnd('\') + '\'
    Get-Process | ForEach-Object {
        try {
            if ($_.Path -and $_.Path.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
            }
        } catch { }
    }
}
function Set-LegacyInstallLocationHint([object]$PinnedFixture) {
    if (-not $LegacyInstallLocationHint -or -not $PreviousInstaller -or
        $PinnedFixture.version -notin @('1.8.5', '1.8.7') -or $DiagnosticAttempts -ne 1) {
        throw 'Legacy installation hint is limited to the explicitly selected, verified historical baseline'
    }
    $target = Assert-SmokeDescendant $installDir
    if ($target -notmatch '^D:\\AmazonToolboxData\\installer-smoke\\kst-nsis-smoke-[a-f0-9]{32}\\app$') {
        throw 'Legacy hint target is not the owned isolated D: installation directory'
    }
    $ancestor = $target
    while ($ancestor) {
        if (Test-Path -LiteralPath $ancestor) {
            if ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "Legacy hint target contains a reparse point: $ancestor"
            }
        }
        $ancestor = Split-Path -Path $ancestor -Parent
    }
    if ((Test-Path -LiteralPath $target) -and
        ((-not (Test-Path -LiteralPath $target -PathType Container)) -or
        @(Get-ChildItem -LiteralPath $target -Force).Count -ne 0)) {
        throw 'Legacy hint target must not exist or must be completely empty'
    }
    foreach ($key in $identityRegistryKeys) {
        if (Test-Path -LiteralPath $key) { throw "Refusing to overwrite a pre-existing registry key: $key" }
    }
    # This is the only synthetic registry value. The original NSIS must create
    # its own uninstall registration, version, EXE and shortcuts after this.
    New-Item -Path $installRegistryKey -ErrorAction Stop | Out-Null
    New-ItemProperty -LiteralPath $installRegistryKey -Name 'InstallLocation' -Value $target -PropertyType String -ErrorAction Stop | Out-Null
    $valueNames = @((Get-Item -LiteralPath $installRegistryKey).GetValueNames())
    if ($valueNames.Count -ne 1 -or $valueNames[0] -ne 'InstallLocation' -or
        (Get-ItemPropertyValue -LiteralPath $installRegistryKey -Name InstallLocation) -ne $target -or
        (Test-Path -LiteralPath $uninstallRegistryKey)) { throw 'Legacy hint wrote unexpected registry state' }
    @{ enabled = $true; scope = 'historical-baseline-only'; version = $PinnedFixture.version;
        installerSha512 = $PinnedFixture.sha512; originalInstallerBytesUnchanged = $true;
        applicationGuid = $identity.appGuid; uuidNamespace = $identity.uuidNamespace;
        registryKey = $installRegistryKey; valueName = 'InstallLocation'; value = $target;
        modifiesExistingLocationBranch = $true; validatesOldFreshInstall = $false;
        createsUninstallRegistration = $false; diagnosticAttempts = 1;
        recordedAt = (Get-Date).ToUniversalTime().ToString('o') } |
        ConvertTo-Json -Depth 5 | Set-Content (Join-Path $diagnostics 'legacy-install-location-hint.json') -Encoding UTF8
}
function Assert-InstalledIdentity([string]$ExpectedVersion, [string]$Stage) {
    $archive = Join-Path $installDir 'resources\app.asar'
    $archiveJson = & node (Join-Path $PSScriptRoot 'nsis-install-identity.mjs') asar $archive $ExpectedVersion
    if ($LASTEXITCODE -ne 0) { throw "Installed ASAR verification failed at $Stage" }
    $archiveIdentity = $archiveJson | ConvertFrom-Json
    if (-not (Test-Path -LiteralPath $installRegistryKey) -or -not (Test-Path -LiteralPath $uninstallRegistryKey)) {
        throw "The real installer did not create the required installation/uninstall registrations at $Stage"
    }
    $registration = Get-ItemProperty -LiteralPath $uninstallRegistryKey
    if ($registration.DisplayVersion -ne $ExpectedVersion) { throw "Registered installed version mismatch at $Stage" }
    if ([IO.Path]::GetFullPath((Get-ItemPropertyValue -LiteralPath $installRegistryKey -Name InstallLocation)) -ne $installDir) {
        throw "The real installer registered a different installation directory at $Stage"
    }
    $uninstallMatch = [regex]::Match([string]$registration.UninstallString, '^"([^"]+)"\s+/currentuser$')
    if (-not $uninstallMatch.Success) { throw "Unexpected real uninstall command at $Stage" }
    $uninstallExecutable = Assert-SmokeDescendant $uninstallMatch.Groups[1].Value
    if ((Split-Path -Path $uninstallExecutable -Parent) -ne $installDir -or
        (Split-Path -Path $uninstallExecutable -Leaf) -notlike 'Uninstall*.exe' -or
        -not (Test-Path -LiteralPath $uninstallExecutable -PathType Leaf)) {
        throw "The registered uninstaller does not point to the isolated real binary at $Stage"
    }
    $executable = Join-Path $installDir "$($metadata.build.productName).exe"
    if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw "Installed application executable missing at $Stage" }
    $executableVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($executable).ProductVersion
    if ($executableVersion -notin @($ExpectedVersion, "$ExpectedVersion.0")) {
        throw "Installed application executable version mismatch at $Stage"
    }
    $verifiedShortcuts = @()
    foreach ($shortcutPath in $shortcutPaths) {
        if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) { throw "Real installer shortcut missing: $shortcutPath" }
        $actualTarget = Get-WindowsShortcutTarget $shortcutPath
        if ([IO.Path]::GetFullPath($actualTarget) -ne $executable) { throw "Shortcut targets a different installation: $shortcutPath" }
        $verifiedShortcuts += @{ path = $shortcutPath; target = $actualTarget; reader = 'IShellLinkW/IPersistFile' }
    }
    @{ stage = $Stage; expectedVersion = $ExpectedVersion; asar = $archiveIdentity;
        registeredVersion = $registration.DisplayVersion; uninstallString = $registration.UninstallString;
        installationDirectory = $installDir; executable = $executable; executableVersion = $executableVersion;
        shortcuts = $verifiedShortcuts } |
        ConvertTo-Json -Depth 5 | Set-Content (Join-Path $diagnostics "installed-identity-$Stage.json") -Encoding UTF8
}
function Save-Diagnostics {
    $attempts | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $diagnostics 'install-attempts.json') -Encoding UTF8
    # Capture before retry/cleanup: an access violation alone is not a diagnosis.
    try {
        Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = $startedAt; Id = @(1000, 1001) } -ErrorAction Stop |
            Where-Object { $_.Message -match 'KST|nsis|课赛通' } |
            Select-Object TimeCreated, Id, ProviderName, Message |
            ConvertTo-Json -Depth 4 | Set-Content (Join-Path $diagnostics 'windows-application-errors.json') -Encoding UTF8
    } catch {
        $_.Exception.Message | Set-Content (Join-Path $diagnostics 'event-log-unavailable.txt') -Encoding UTF8
    }
    if (Test-Path -LiteralPath $installDir) {
        Get-ChildItem -LiteralPath $installDir -File -Recurse |
            Select-Object @{ Name = 'RelativePath'; Expression = { $_.FullName.Substring($installDir.Length + 1) } }, Length, LastWriteTimeUtc |
            ConvertTo-Json -Depth 4 | Set-Content (Join-Path $diagnostics 'installed-files.json') -Encoding UTF8
    }
    Get-ChildItem -LiteralPath $smokeRoot -Filter '*.json' -File | Copy-Item -Destination $diagnostics -Force
}
function Invoke-Install([string]$InstallerPath, [string]$Stage) {
    $hash = (Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA512).Hash
    for ($attempt = 1; $attempt -le $DiagnosticAttempts; $attempt++) {
        Write-Output "nsis_stage=$Stage nsis_install_attempt=$attempt"
        $start = Get-Date
        $process = Start-Process -FilePath $InstallerPath -ArgumentList @('/S', '/currentuser', "/D=$installDir") -PassThru -WindowStyle Hidden
        if (-not $process.WaitForExit(120000)) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            throw "NSIS $Stage timed out after 120 seconds"
        }
        $process.Refresh()
        $code = $process.ExitCode
        $hex = [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$code), 0).ToString('X8')
        $attempts.Add(@{ stage = $Stage; attempt = $attempt; exitCode = $code; exitCodeHex = "0x$hex";
            startedAt = $start.ToUniversalTime().ToString('o'); durationMs = ((Get-Date) - $start).TotalMilliseconds; sha512 = $hash })
        if ($code -eq 0) { return }
        $script:hadInstallFailure = $true
        Save-Diagnostics
        if ($code -ne -1073741819 -or $attempt -eq $DiagnosticAttempts) {
            throw "NSIS $Stage failed: $code (0x$hex). Diagnostics: $diagnostics"
        }
        if ((Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA512).Hash -ne $hash) { throw 'Installer changed; refusing diagnostic retry' }
        Write-Warning 'Access violation, root cause unknown. Diagnostic retry only; this gate will remain failed.'
        Stop-SmokeProcesses
        Start-Sleep -Seconds (2 * $attempt)
    }
}
function Invoke-Runtime([string]$Mode, [string]$Version) {
    $executable = Join-Path $installDir ("{0}.exe" -f $metadata.build.productName)
    & node (Join-Path $PSScriptRoot 'packaged-runtime-smoke.mjs') --executable $executable --root $smokeRoot --mode $Mode --version $Version
    if ($LASTEXITCODE -ne 0) { throw "Installed runtime $Mode verification failed" }
}

try {
    if ($PreviousInstaller) {
        $fixtureFiles = @{ '1.8.5' = 'nsis-upgrade-fixture.json'; '1.8.7' = 'nsis-upgrade-fixture-1.8.7.json'; '1.8.8' = 'nsis-upgrade-fixture-1.8.8.json'; '1.8.14' = 'nsis-upgrade-fixture-1.8.14.json' }
        if (-not $fixtureFiles.ContainsKey($PreviousVersion)) { throw "Unsupported pinned NSIS baseline: $PreviousVersion" }
        $fixture = Get-Content (Join-Path $PSScriptRoot $fixtureFiles[$PreviousVersion]) -Raw | ConvertFrom-Json
        if ($fixture.version -ne $PreviousVersion -or
            (Get-Item -LiteralPath $PreviousInstaller).Length -ne $fixture.size -or
            (Get-FileHash -LiteralPath $PreviousInstaller -Algorithm SHA512).Hash.ToLowerInvariant() -ne $fixture.sha512) {
            throw "Old installer does not match the pinned released $PreviousVersion binary"
        }
        if ($LegacyInstallLocationHint) { Set-LegacyInstallLocationHint $fixture }
        Invoke-Install $PreviousInstaller 'old-version'
        if ((Get-FileHash -LiteralPath $PreviousInstaller -Algorithm SHA512).Hash.ToLowerInvariant() -ne $fixture.sha512) {
            throw 'Original historical installer bytes changed during baseline preparation'
        }
        Assert-InstalledIdentity $fixture.version 'old-version'
        Invoke-Runtime 'seed' $fixture.version
        Invoke-Install $installer 'upgrade'
        Assert-InstalledIdentity $metadata.version 'upgrade'
    } else {
        Invoke-Install $installer 'clean-install'
        Assert-InstalledIdentity $metadata.version 'clean-install'
        Invoke-Runtime 'seed' $metadata.version
    }
    Invoke-Runtime 'check' $metadata.version
    Stop-SmokeProcesses
    $sentinel = Join-Path $smokeRoot 'unrelated-install\keep.txt'
    New-Item -ItemType Directory -Path (Split-Path $sentinel) -Force | Out-Null
    'Unrelated application must survive KST uninstall' | Set-Content -LiteralPath $sentinel -Encoding UTF8
    $userFiles = @('user-credential.bin', 'update-preferences.json', 'customer-file.txt')
    $userHashes = @{}
    foreach ($name in $userFiles) { $userHashes[$name] = (Get-FileHash -LiteralPath (Join-Path $smokeRoot "user-data\$name")).Hash }
    $uninstaller = Get-ChildItem -LiteralPath $installDir -Filter 'Uninstall*.exe' -File | Select-Object -First 1
    if (-not $uninstaller) { throw 'NSIS uninstaller missing' }
    $uninstall = Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -PassThru -WindowStyle Hidden
    if (-not $uninstall.WaitForExit(120000)) { throw 'NSIS uninstall timed out' }
    $uninstall.Refresh()
    if ($uninstall.ExitCode -ne 0) { throw "NSIS uninstall failed: $($uninstall.ExitCode)" }
    $deadline = (Get-Date).AddSeconds(20)
    $installedExe = Join-Path $installDir ("{0}.exe" -f $metadata.build.productName)
    while ((Get-Date) -lt $deadline) {
        $remainingRegistry = @($identityRegistryKeys | Where-Object { Test-Path -LiteralPath $_ })
        $remainingShortcuts = @($shortcutPaths | Where-Object { Test-Path -LiteralPath $_ })
        if (-not (Test-Path -LiteralPath $installedExe) -and $remainingRegistry.Count -eq 0 -and $remainingShortcuts.Count -eq 0) { break }
        Start-Sleep -Milliseconds 200
    }
    if (Test-Path -LiteralPath $installedExe) { throw 'Uninstaller returned but installed executable remains' }
    if ($remainingRegistry.Count -ne 0) { throw "Uninstaller left installation registry keys: $($remainingRegistry -join ', ')" }
    if ($remainingShortcuts.Count -ne 0) { throw "Uninstaller left application shortcuts: $($remainingShortcuts -join ', ')" }
    if (-not (Test-Path -LiteralPath $sentinel)) { throw 'Uninstall removed an unrelated sibling directory' }
    foreach ($name in $userFiles) {
        if ((Get-FileHash -LiteralPath (Join-Path $smokeRoot "user-data\$name")).Hash -ne $userHashes[$name]) {
            throw "Uninstall changed preserved user data: $name"
        }
    }
    if ($hadInstallFailure) { throw 'A diagnostic retry recovered, but an installer crash occurred; gate remains failed' }
    @{ status = 'passed'; upgradeFrom = $(if ($PreviousInstaller) { $fixture.version } else { $null }); version = $metadata.version;
        userDataPreserved = $true; unrelatedDirectoryPreserved = $true; registryAndShortcutsRemoved = $true;
        legacyInstallLocationHint = [bool]$LegacyInstallLocationHint;
        oldFreshInstallValidated = [bool]($PreviousInstaller -and -not $LegacyInstallLocationHint) } |
        ConvertTo-Json | Set-Content (Join-Path $diagnostics 'result.json') -Encoding UTF8
    Write-Output 'nsis_install_smoke=passed'
} finally {
    Stop-SmokeProcesses
    Save-Diagnostics
    $env:TEMP = $previousTemp
    $env:TMP = $previousTmp
    # Preserve the isolated root for runner inspection; never erase an installation after a crash.
    Write-Output "nsis_diagnostics=$diagnostics"
}
