#!/bin/sh
# MutBot — install & launch
# Usage: curl -LsSf https://mutbot.ai/install.sh | sh
set -eu

# --- Install uv if not present ---
if ! command -v uv >/dev/null 2>&1; then
    echo "Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    # uv installer adds ~/.local/bin to PATH via shell profile,
    # but current shell session needs explicit export
    export PATH="$HOME/.local/bin:$PATH"
fi

# --- Install mutbot if not present ---
if ! uv tool list 2>/dev/null | grep -q "^mutbot "; then
    echo "Installing mutbot..."
    uv tool install mutbot
fi

# --- Ensure ~/.local/bin is on PATH ---
export PATH="$HOME/.local/bin:$PATH"

# --- Launch ---
echo ""
echo "Starting MutBot..."
echo ""
exec mutbot
