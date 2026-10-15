param([Parameter(ValueFromRemainingArguments = $true)][string[]]$CliArguments)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Test-Node22([string]$Executable) {
    if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { return $false }
    try {
        $nodeVersion = & $Executable -p 'process.versions.node' 2>$null
        return $LASTEXITCODE -eq 0 -and "$nodeVersion".Trim() -eq $requiredNodeVersion
    } catch { return $false }
}

function Test-GitHubCli([string]$Executable) {
    if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { return $false }
    try {
        $githubVersion = & $Executable --version 2>$null
        return $LASTEXITCODE -eq 0 -and ($githubVersion -join "`n") -match '^gh version \d+\.'
    } catch { return $false }
}

try {
    $requiredNodeVersion = (Get-Content -LiteralPath (Join-Path $projectRoot '.node-version') -Raw).Trim()
    if ($requiredNodeVersion -notmatch '^22\.\d+\.\d+$') { throw '.node-version must pin an exact Node.js 22 version.' }
    $toolchains = Join-Path $(if ($env:TOOLBOX_DATA_ROOT) { $env:TOOLBOX_DATA_ROOT } else { 'D:\AmazonToolboxData' }) 'toolchains'
    $nodeExecutable = $null
    if ($env:TOOLBOX_NODE_EXE) {
        if (-not (Test-Node22 $env:TOOLBOX_NODE_EXE)) { throw "TOOLBOX_NODE_EXE must point to the pinned Node.js $requiredNodeVersion executable." }
        $nodeExecutable = $env:TOOLBOX_NODE_EXE
    } else {
        foreach ($pathNode in @(Get-Command node.exe -All -CommandType Application -ErrorAction SilentlyContinue)) {
            if (Test-Node22 $pathNode.Source) { $nodeExecutable = $pathNode.Source; break }
        }
        if (-not $nodeExecutable -and (Test-Path -LiteralPath $toolchains)) {
            $candidates = Get-ChildItem -LiteralPath $toolchains -Directory -Filter 'node-v22.*-win-x64' |
                Where-Object { $_.Name -match '^node-v22\.\d+\.\d+-win-x64$' } |
                Sort-Object { [version]($_.Name -replace '^node-v', '' -replace '-win-x64$', '') } -Descending
            foreach ($candidate in $candidates) {
                $executable = Join-Path $candidate.FullName 'node.exe'
                if (Test-Node22 $executable) { $nodeExecutable = $executable; break }
            }
        }
    }
    if (-not $nodeExecutable) { throw "Node.js $requiredNodeVersion is required. Set TOOLBOX_NODE_EXE to its node.exe path; no runtime will be installed automatically." }
    $env:PATH = (Split-Path -Parent $nodeExecutable) + ';' + $env:PATH

    # The independent website is Node-only. Do not block its preview or recovery
    # on a missing Python installation that this operation will never use.
    $requiresPython = $CliArguments.Count -gt 0 -and $CliArguments[0] -ne 'marketing'
    if ($requiresPython) {
        $pythonExecutable = & $nodeExecutable (Join-Path $PSScriptRoot 'run-python.mjs') --resolve
        if ($LASTEXITCODE -ne 0 -or -not $pythonExecutable) { throw 'No usable project Python was selected. Check TOOLBOX_PYTHON; no environment was installed or modified.' }
        $env:TOOLBOX_PYTHON = "$pythonExecutable".Trim()
        $env:PATH = (Split-Path -Parent $env:TOOLBOX_PYTHON) + ';' + $env:PATH
    }

    $githubCli = $null
    if ($env:TOOLBOX_GH_EXE) {
        if (-not (Test-GitHubCli $env:TOOLBOX_GH_EXE)) { throw 'TOOLBOX_GH_EXE must point to a runnable GitHub CLI gh.exe.' }
        $githubCli = $env:TOOLBOX_GH_EXE
    } else {
        $githubCandidates = @(Get-Command gh.exe -All -CommandType Application -ErrorAction SilentlyContinue | ForEach-Object { $_.Source })
        foreach ($directory in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
            if ($directory) {
                $githubCandidates += Join-Path $directory 'GitHub CLI\gh.exe'
                $githubCandidates += Join-Path $directory 'Programs\GitHub CLI\gh.exe'
            }
        }
        if (Test-Path -LiteralPath $toolchains) {
            $githubCandidates += Get-ChildItem -LiteralPath $toolchains -Directory -Filter 'gh-*' |
                Where-Object { $_.Name -match '^gh-\d+\.\d+\.\d+(?:-windows_amd64)?$' } |
                Sort-Object { [version]($_.Name -replace '^gh-', '' -replace '-windows_amd64$', '') } -Descending |
                ForEach-Object { Join-Path $_.FullName 'bin\gh.exe' }
        }
        foreach ($candidate in ($githubCandidates | Select-Object -Unique)) {
            if (Test-GitHubCli $candidate) { $githubCli = $candidate; break }
        }
    }
    if ($githubCli) { $env:PATH = (Split-Path -Parent $githubCli) + ';' + $env:PATH }
    Set-Location -LiteralPath $projectRoot
    Write-Output "[TOOLBOX] Source: $projectRoot"
    Write-Output "[TOOLBOX] Node 22: $nodeExecutable"
    if ($requiresPython) { Write-Output "[TOOLBOX] Python: $env:TOOLBOX_PYTHON" }
    if ($githubCli) { Write-Output "[TOOLBOX] GitHub CLI: $githubCli" }
    & $nodeExecutable (Join-Path $PSScriptRoot 'toolbox-cli.mjs') @CliArguments
    exit $LASTEXITCODE
} catch {
    Write-Output "[TOOLBOX] Launcher failed: $($_.Exception.Message)"
    exit 1
}
