# @0xwelt/legion

## 0.2.2

### Patch Changes

- [#35](https://github.com/0xWelt/legion/pull/35) [`31e7121`](https://github.com/0xWelt/legion/commit/31e712139a62849b881a65fc771c8e8dd7759821) Thanks [@0xWelt](https://github.com/0xWelt)! - Add shebang to `src/bootstrap.ts` so the published `dist/bootstrap.mjs` is executable after `npm install -g`.

## 0.2.1

### Patch Changes

- [#33](https://github.com/0xWelt/legion/pull/33) [`368dda3`](https://github.com/0xWelt/legion/commit/368dda3487fadf4553b779be4ca26778522a9236) Thanks [@0xWelt](https://github.com/0xWelt)! - Move bundled internal workspace dependencies to `devDependencies` so the published package no longer depends on unreleased workspace packages.

## 0.2.0

### Minor Changes

- [#29](https://github.com/0xWelt/legion/pull/29) [`7f2a359`](https://github.com/0xWelt/legion/commit/7f2a35942702ddfa0642d9a154d33b4f8da47d40) Thanks [@0xWelt](https://github.com/0xWelt)! - Release single npm package with systemd CLI bootstrap.

  - New CLI subcommands: `setup`, `config`, `agent`, `gateway`, `run`.
  - Add `legion gateway` systemd user service management: `install`, `start`, `stop`, `restart`, `status`, `uninstall`.
  - Ship `@0xwelt/legion` as a single self-contained npm package; internal workspace packages are bundled into `dist/bootstrap.mjs`.
  - Add one-click installer at `scripts/install.sh`.
  - Migrate development toolchain to Vite+ and pnpm.
