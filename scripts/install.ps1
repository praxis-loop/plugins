$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Installed = $false

if (Get-Command claude -ErrorAction SilentlyContinue) {
    & claude plugin marketplace add $RepoRoot
    Write-Host "Registered Claude marketplace: praxis-plugins"
    $Installed = $true
} else {
    Write-Host "Claude Code not found; skipped."
}

if (Get-Command codex -ErrorAction SilentlyContinue) {
    $SavedCliErrorAction = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    & codex help plugin *> $null
    $CodexPluginExit = $LASTEXITCODE
    $ErrorActionPreference = $SavedCliErrorAction
    if ($CodexPluginExit -eq 0) {
        & codex plugin marketplace add $RepoRoot
        if ($LASTEXITCODE -ne 0) { throw "Codex marketplace registration failed" }
        Write-Host "Registered Codex marketplace: praxis-plugins"
        $Installed = $true
    } else {
        Write-Host "Codex is installed, but this CLI version has no plugin command; use the Codex desktop plugin page/deeplink."
    }
} else {
    Write-Host "Codex not found; skipped."
}

if (-not $Installed) {
    throw "No installed CLI with plugin support was found."
}

Write-Host "Marketplace registration complete. Install Ponytail from the platform plugin UI/CLI when ready."
