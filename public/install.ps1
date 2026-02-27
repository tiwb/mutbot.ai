# MutBot — install & launch
# Usage: irm https://mutbot.ai/install.ps1 | iex
$ErrorActionPreference = "Stop"

# --- Install uv if not present ---
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host "Installing uv..." -ForegroundColor Cyan
    irm https://astral.sh/uv/install.ps1 | iex
    # Refresh PATH for current session
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "User") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "Machine")
}

# --- Install mutbot if not present ---
$toolList = uv tool list 2>$null
if ($toolList -notmatch "^mutbot ") {
    Write-Host "Installing mutbot..." -ForegroundColor Cyan
    uv tool install mutbot
}

# --- Launch ---
Write-Host ""
Write-Host "Starting MutBot..."
Write-Host ""
& mutbot
