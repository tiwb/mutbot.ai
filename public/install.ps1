# MutBot — install & launch
# Usage: irm https://mutbot.ai/install.ps1 | iex
$ErrorActionPreference = "Stop"

# --- Install uv if not present ---
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host "Installing uv..." -ForegroundColor Cyan
    irm https://astral.sh/uv/install.ps1 | iex
    # Refresh PATH to pick up uv
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "User") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "Machine")
}

# --- Install mutbot (idempotent — skips if already up-to-date) ---
Write-Host "Installing mutbot..." -ForegroundColor Cyan
uv tool install mutbot --upgrade

# Refresh PATH to pick up uv tools bin
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "User") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "Machine")

# --- Launch ---
Write-Host ""
Write-Host "Starting MutBot..."
Write-Host ""
& mutbot
