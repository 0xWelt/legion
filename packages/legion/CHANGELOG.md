# @0xwelt/legion

## 0.2.0

### Minor Changes

- [#29](https://github.com/0xWelt/legion/pull/29) [`7f2a359`](https://github.com/0xWelt/legion/commit/7f2a35942702ddfa0642d9a154d33b4f8da47d40) Thanks [@0xWelt](https://github.com/0xWelt)! - Release single npm package with systemd CLI bootstrap.

  - New CLI subcommands: `setup`, `config`, `agent`, `gateway`, `run`.
  - Add `legion gateway` systemd user service management: `install`, `start`, `stop`, `restart`, `status`, `uninstall`.
  - Ship `@0xwelt/legion` as a single self-contained npm package; internal workspace packages are bundled into `dist/bootstrap.mjs`.
  - Add one-click installer at `scripts/install.sh`.
  - Migrate development toolchain to Vite+ and pnpm.
