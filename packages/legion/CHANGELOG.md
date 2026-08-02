# @0xwelt/legion

## 1.0.0

### Major Changes

- [#50](https://github.com/0xWelt/legion/pull/50) [`66bf7b0`](https://github.com/0xWelt/legion/commit/66bf7b04226dc3226c98db79899190f7ed9fe313) Thanks [@0xWelt](https://github.com/0xWelt)! - Refactor: flatten the session model so that every IM session maps one-to-one to an Agent session.

  BREAKING CHANGE: removes the workdir/thread hierarchy. Discord channels/threads and Lark chats/threads are now treated equally as independent IM sessions, each with its own `path` and agent binding. The `/workdir` command now sets the working path for the current session. Existing state files are migrated automatically on first load.

### Minor Changes

- [#44](https://github.com/0xWelt/legion/pull/44) [`611a2b2`](https://github.com/0xWelt/legion/commit/611a2b2241f8009ff4a89e2bf05ba96df64d4277) Thanks [@0xWelt](https://github.com/0xWelt)! - Support multiple simultaneous IM providers via `MultiIMProvider`. The gateway now collects all configured IM platforms instead of stopping at the first one, enabling Web UI to run alongside Discord/Lark.

- [#51](https://github.com/0xWelt/legion/pull/51) [`7a4f0d9`](https://github.com/0xWelt/legion/commit/7a4f0d9d172629aaa745d989ec49bacdfdcf7c90) Thanks [@0xWelt](https://github.com/0xWelt)! - Add session fork interface and Discord thread support.

  - Introduce optional `IMProvider.onSessionFork` hook and `IMForkEvent`.
  - `SessionManager` can fork a session, inheriting `path` and `agent` while resetting `agentSessionId`.
  - `LegionCore` listens to fork events, persists the new session, and sends a setup notice.
  - `DiscordProvider` emits a fork event when a thread is created under a text channel.
  - `MultiIMProvider` forwards fork events from child providers.
  - Add `warn` to the `Logger` interface.

- [#42](https://github.com/0xWelt/legion/pull/42) [`ef14427`](https://github.com/0xWelt/legion/commit/ef144278a3d3ef1a6f50a462209f2746058adf2c) Thanks [@0xWelt](https://github.com/0xWelt)! - Align the Web UI branch with the flat session refactor.

  - Remove the legacy `channelId`/`threadId`/`Workdir` model from the Web UI backend and frontend.
  - Use a single `sessionId` for messages, targets, and state.
  - Update the Web UI sidebar to list sessions directly and add a "New" session button.
  - Simplify the Web UI server's `/api/state` endpoint to return only sessions.

- [#42](https://github.com/0xWelt/legion/pull/42) [`ef14427`](https://github.com/0xWelt/legion/commit/ef144278a3d3ef1a6f50a462209f2746058adf2c) Thanks [@0xWelt](https://github.com/0xWelt)! - Bind Web UI to the gateway: `legion gateway run` now automatically serves the Web UI on the same port. The `packages/legion-webui` workspace is now a pure frontend package; its backend server, provider, and config contribution moved into `packages/legion`.

### Patch Changes

- [#52](https://github.com/0xWelt/legion/pull/52) [`1f89f6d`](https://github.com/0xWelt/legion/commit/1f89f6ddca3622a57378230fa1c2f2a9ab8f5124) Thanks [@0xWelt](https://github.com/0xWelt)! - Fix Web UI new-session input being disabled and ensure dev server uses the webui package Vite config.

- [#49](https://github.com/0xWelt/legion/pull/49) [`b2d5e8c`](https://github.com/0xWelt/legion/commit/b2d5e8cbd7e517236f075dac6af41e44ed14c68d) Thanks [@0xWelt](https://github.com/0xWelt)! - Add `provider` field to `Workdir`/`Session` and create workdir/session per IM provider, preventing state sharing between providers.

## 0.2.3

### Patch Changes

- [#37](https://github.com/0xWelt/legion/pull/37) [`f6b66d2`](https://github.com/0xWelt/legion/commit/f6b66d276861cf477be7bbae17b59f588363ce50) Thanks [@0xWelt](https://github.com/0xWelt)! - Resolve the real path of `process.argv[1]` when detecting the main module, so the CLI works correctly when invoked through npm's bin symlink.

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
