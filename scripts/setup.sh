#!/usr/bin/env bash
# ============================================================================
# Legion Setup Script
# ============================================================================
# Usage:
#   ./scripts/setup.sh
#
# One-click setup: install dependencies, build, configure, and optionally
# install the systemd service.
#
# Steps:
# 1. Check prerequisites (node >= 20, pnpm)
# 2. pnpm install (if node_modules missing)
# 3. vp run -r build
# 4. Create ~/.legion/ directory
# 5. Run interactive config wizard (if config.json missing)
# 6. Install systemd service (Linux only, optional)
# 7. Create symlink: ~/.local/bin/legion -> scripts/legion
# ============================================================================

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LEGION_HOME="$HOME/.legion"
BIN_DIR="$HOME/.local/bin"

echo ""
echo -e "${CYAN}⚔ Legion Setup${NC}"
echo ""

# ── Step 1: Prerequisites ──────────────────────────────────────────────
echo -e "${CYAN}→${NC} Checking prerequisites..."

if ! command -v node &>/dev/null; then
  echo -e "${RED}✗${NC} Node.js not found. Install Node.js >= 20 first."
  echo "  https://nodejs.org/"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo -e "${RED}✗${NC} Node.js >= 20 required (found: $(node -v))"
  exit 1
fi
echo -e "${GREEN}✓${NC} Node.js $(node -v)"

if ! command -v pnpm &>/dev/null; then
  echo -e "${RED}✗${NC} pnpm not found. Install pnpm first (https://pnpm.io/installation)."
  exit 1
fi
echo -e "${GREEN}✓${NC} pnpm $(pnpm -v)"

# ── Step 2: pnpm install ────────────────────────────────────────────────
echo -e "${CYAN}→${NC} Installing dependencies..."
cd "$PROJECT_DIR"
pnpm install
echo -e "${GREEN}✓${NC} Dependencies ready"

# ── Step 3: Build ───────────────────────────────────────────────────────
echo -e "${CYAN}→${NC} Building..."
vp run -r build
echo -e "${GREEN}✓${NC} Build complete"

# ── Step 4: Create legion home dir ──────────────────────────────────────
mkdir -p "$LEGION_HOME"
echo -e "${GREEN}✓${NC} Created $LEGION_HOME"

# ── Step 5: Config wizard ───────────────────────────────────────────────
if [ -f "$LEGION_HOME/config.json" ]; then
  echo -e "${GREEN}✓${NC} Config already exists: $LEGION_HOME/config.json"
else
  echo -e "${CYAN}→${NC} Running config wizard..."
  node packages/legion/dist/bootstrap.mjs setup
  echo -e "${GREEN}✓${NC} Config saved"
fi

# ── Step 6: systemd service ─────────────────────────────────────────────
if command -v systemctl &>/dev/null; then
  echo ""
  echo -e -n "${CYAN}?${NC} Install systemd service for auto-start? [Y/n] "
  read -r REPLY
  if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    node packages/legion/dist/bootstrap.mjs gateway install
    echo ""
    echo -e "${YELLOW}!${NC} To start now: ${CYAN}legion gateway start${NC}"
    echo -e "${YELLOW}!${NC} To keep running after logout: ${CYAN}sudo loginctl enable-linger \$USER${NC}"
  else
    echo -e "${YELLOW}!${NC} Skipped. Run ${CYAN}legion gateway install${NC} later."
  fi
else
  echo -e "${YELLOW}!${NC} systemd not detected — skipping service installation."
fi

# ── Step 7: CLI symlink ─────────────────────────────────────────────────
echo -e "${CYAN}→${NC} Creating CLI symlink..."
mkdir -p "$BIN_DIR"
ln -sf "$PROJECT_DIR/scripts/legion" "$BIN_DIR/legion"
echo -e "${GREEN}✓${NC} Linked ${CYAN}legion${NC} → $BIN_DIR/legion"

# ── Done ────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}══ Legion setup complete ══${NC}"
echo ""
echo "Quick start:"
echo "  legion gateway run                          # Run in foreground"
echo "  legion gateway start                        # Start as service"
echo "  legion gateway status                       # Check service status"
echo "  journalctl --user -u legion-gateway -f       # View logs"
echo ""
echo "For development (TypeScript, no build):"
echo "  vp run dev"
echo ""
