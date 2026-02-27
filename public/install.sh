#!/bin/sh
# MutBot — install & launch
# Usage: curl -LsSf https://mutbot.ai/install.sh | sh
set -eu

# --- Install uv if not present ---
if ! command -v uv >/dev/null 2>&1; then
    echo "Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
fi

# --- Install mutbot (idempotent — skips if already up-to-date) ---
echo "Installing mutbot..."
uv tool install mutbot --upgrade

# Ensure uv tools bin is on PATH
export PATH="$HOME/.local/bin:$PATH"

# --- Launch ---
echo ""
echo "Starting MutBot..."
echo ""
exec mutbot
