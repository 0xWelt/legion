#!/usr/bin/env bash
# ============================================================================
# Legion Installer
# ============================================================================
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/0xWelt/legion/main/scripts/install.sh | bash
#
# One-click installer for end users. It:
#   1. Checks prerequisites (Node.js >= 20, npm)
#   2. Installs @0xwelt/legion from npm
#   3. Runs the interactive config wizard
#   4. Optionally installs the systemd user service
# ============================================================================

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

LEGION_VERSION="${LEGION_VERSION:-latest}"
NO_SETUP="${LEGION_NO_SETUP:-0}"
NO_SERVICE="${LEGION_NO_SERVICE:-0}"
NO_PROMPT="${LEGION_NO_PROMPT:-0}"

log_info() { echo -e "${CYAN}→${NC} $*"; }
log_ok()   { echo -e "${GREEN}✓${NC} $*"; }
log_warn() { echo -e "${YELLOW}!${NC} $*"; }
log_err()  { echo -e "${RED}✗${NC} $*"; }

node_major_version() {
  if ! command -v node &>/dev/null; then
    return 1
  fi
  local version major
  version="$(node -v 2>/dev/null || true)"
  major="${version#v}"
  major="${major%%.*}"
  if [[ "$major" =~ ^[0-9]+$ ]]; then
    echo "$major"
    return 0
  fi
  return 1
}

check_prerequisites() {
  log_info "Checking prerequisites..."

  if ! command -v node &>/dev/null; then
    log_err "Node.js not found. Please install Node.js >= 20 first:"
    echo "  https://nodejs.org/"
    exit 1
  fi

  local major
  major="$(node_major_version || true)"
  if [[ -z "$major" || "$major" -lt 20 ]]; then
    log_err "Node.js >= 20 required (found: $(node -v 2>/dev/null || echo 'unknown'))"
    exit 1
  fi
  log_ok "Node.js $(node -v)"

  if ! command -v npm &>/dev/null; then
    log_err "npm not found. Please install npm alongside Node.js."
    exit 1
  fi
  log_ok "npm $(npm -v)"
}

install_legion() {
  log_info "Installing @0xwelt/legion@${LEGION_VERSION}..."
  npm install -g "@0xwelt/legion@${LEGION_VERSION}"
  log_ok "@0xwelt/legion installed"
}

run_setup() {
  if [[ "$NO_SETUP" == "1" ]]; then
    log_warn "Skipping setup wizard (LEGION_NO_SETUP=1)"
    return 0
  fi

  log_info "Running setup wizard..."
  legion setup
  log_ok "Configuration saved"
}

install_service() {
  if [[ "$NO_SERVICE" == "1" ]]; then
    return 0
  fi

  if ! command -v systemctl &>/dev/null; then
    log_warn "systemd not detected — skipping service installation"
    return 0
  fi

  if [[ "$NO_PROMPT" == "1" ]]; then
    legion gateway install
    return 0
  fi

  echo ""
  echo -e -n "${CYAN}?${NC} Install systemd user service for auto-start? [Y/n] "
  read -r REPLY
  if [[ ! "$REPLY" =~ ^[Nn]$ ]]; then
    legion gateway install
    echo ""
    log_warn "To start now: ${CYAN}legion gateway start${NC}"
    log_warn "To keep running after logout: ${CYAN}sudo loginctl enable-linger \$USER${NC}"
  else
    log_warn "Skipped. Run ${CYAN}legion gateway install${NC} later."
  fi
}

print_next_steps() {
  echo ""
  echo -e "${GREEN}══ Legion setup complete ══${NC}"
  echo ""
  echo "Quick start:"
  echo "  legion gateway run     # Run in foreground"
  echo "  legion gateway start   # Start as systemd service"
  echo "  legion gateway status  # Check service status"
  echo ""
}

main() {
  echo ""
  echo -e "${CYAN}⚔ Legion Installer${NC}"
  echo ""

  check_prerequisites
  install_legion
  run_setup
  install_service
  print_next_steps
}

main "$@"
