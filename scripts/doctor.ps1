$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Write-Host "Repository: $RepoRoot"
Write-Host "Runtime: node $(& node --version), npm $(& npm --version)"

Push-Location $RepoRoot
try {
    & npm test
    if ($LASTEXITCODE -ne 0) { throw "npm test failed" }
    & node tools/pluginctl check --offline
    if ($LASTEXITCODE -ne 0) { throw "pluginctl check failed" }

    Write-Host ""
    Write-Host "CLI availability:"
    if (Get-Command claude -ErrorAction SilentlyContinue) { Write-Host "  OK: Claude Code" } else { Write-Host "  INFO: Claude Code not found" }
    if (Get-Command codex -ErrorAction SilentlyContinue) {
        $SavedCliErrorAction = $ErrorActionPreference
        $ErrorActionPreference = "SilentlyContinue"
        & codex help plugin *> $null
        $CodexPluginExit = $LASTEXITCODE
        $ErrorActionPreference = $SavedCliErrorAction
        if ($CodexPluginExit -eq 0) { Write-Host "  OK: Codex with plugin command" } else { Write-Host "  INFO: Codex found, but this version has no plugin command" }
    } else {
        Write-Host "  INFO: Codex not found"
    }

    Write-Host ""
    Write-Host "Git sync status:"
    $Status = & git status --short
    if ($Status) {
        Write-Host "  WARN: uncommitted working tree changes"
        $Status | ForEach-Object { Write-Host "    $_" }
    } else {
        Write-Host "  OK: working tree clean"
    }

    $SavedErrorAction = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    $Upstream = & git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>$null
    $UpstreamExit = $LASTEXITCODE
    $ErrorActionPreference = $SavedErrorAction
    if ($UpstreamExit -eq 0) {
        $Counts = (& git rev-list --left-right --count '@{u}...HEAD') -split '\s+'
        if ([int]$Counts[1] -eq 0) { Write-Host "  OK: no unpushed commits" } else { Write-Host "  WARN: $($Counts[1]) unpushed commit(s)" }
        if ([int]$Counts[0] -eq 0) { Write-Host "  OK: no remote commits to pull" } else { Write-Host "  WARN: $($Counts[0]) remote commit(s) to pull" }
    } else {
        Write-Host "  WARN: current branch has no upstream"
    }
} finally {
    Pop-Location
}
