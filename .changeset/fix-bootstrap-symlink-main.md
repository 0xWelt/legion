---
'@0xwelt/legion': patch
---

Resolve the real path of `process.argv[1]` when detecting the main module, so the CLI works correctly when invoked through npm's bin symlink.
