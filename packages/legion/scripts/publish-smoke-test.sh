#!/usr/bin/env bash
set -euo pipefail

# Publish smoke test: verify the built @0xwelt/legion package works when
# installed from a tarball, exactly like a user installing from npm.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LEGION_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_DIR="$(cd "${LEGION_DIR}/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

echo "[smoke] building workspace packages..."
cd "${ROOT_DIR}"
vp run -r build

echo "[smoke] packing @0xwelt/legion..."
cd "${LEGION_DIR}"
TARBALL="$(npm pack --pack-destination "${TMP_DIR}" | tail -n 1)"
TARBALL_PATH="${TMP_DIR}/${TARBALL}"

echo "[smoke] verifying tarball contents..."
cd "${TMP_DIR}"
FILES="$(tar -tzf "${TARBALL_PATH}")"
if ! echo "${FILES}" | grep -qF 'package/dist/bootstrap.mjs'; then
  echo '[smoke] ERROR: dist/bootstrap.mjs is missing from tarball'
  echo "${FILES}"
  exit 1
fi

echo "[smoke] installing tarball in isolated temp directory..."
cd "${TMP_DIR}"
npm init -y >/dev/null
npm install "${TARBALL_PATH}" >/dev/null

echo "[smoke] running CLI via npm bin symlink..."
OUTPUT="$(./node_modules/.bin/legion agent list)"

for expected in 'kimi-code' 'claude-code' 'codex'; do
  if ! echo "${OUTPUT}" | grep -q "${expected}"; then
    echo "[smoke] ERROR: expected runner '${expected}' not found in output:"
    echo "${OUTPUT}"
    exit 1
  fi
done

echo "[smoke] OK: installed tarball CLI works and lists all bundled agents"
