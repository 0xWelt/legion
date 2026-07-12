---
'@0xwelt/legion': minor
---

Release single npm package with systemd CLI bootstrap.

- New CLI subcommands: `setup`, `config`, `agent`, `gateway`, `run`.
- Add `legion gateway` systemd user service management: `install`, `start`, `stop`, `restart`, `status`, `uninstall`.
- Ship `@0xwelt/legion` as a single self-contained npm package; internal workspace packages are bundled into `dist/bootstrap.mjs`.
- Add one-click installer at `scripts/install.sh`.
- Migrate development toolchain to Vite+ and pnpm.
