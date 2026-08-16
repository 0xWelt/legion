# @0xwelt/legion-api

## 0.1.1

### Patch Changes

- [#44](https://github.com/0xWelt/legion/pull/44) [`611a2b2`](https://github.com/0xWelt/legion/commit/611a2b2241f8009ff4a89e2bf05ba96df64d4277) Thanks [@0xWelt](https://github.com/0xWelt)! - Support multiple simultaneous IM providers via `MultiIMProvider`. The gateway now collects all configured IM platforms instead of stopping at the first one, enabling Web UI to run alongside Discord/Lark.

- [#42](https://github.com/0xWelt/legion/pull/42) [`ef14427`](https://github.com/0xWelt/legion/commit/ef144278a3d3ef1a6f50a462209f2746058adf2c) Thanks [@0xWelt](https://github.com/0xWelt)! - Bind Web UI to the gateway: `legion gateway run` now automatically serves the Web UI on the same port. The `packages/legion-webui` workspace is now a pure frontend package; its backend server, provider, and config contribution moved into `packages/legion`.
