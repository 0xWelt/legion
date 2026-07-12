---
'@0xwelt/legion': minor
'@0xwelt/legion-api': patch
---

Bind Web UI to the gateway: `legion gateway run` now automatically serves the Web UI on the same port. The `packages/legion-webui` workspace is now a pure frontend package; its backend server, provider, and config contribution moved into `packages/legion`.
