---
'@0xwelt/legion': major
---

Refactor: flatten the session model so that every IM session maps one-to-one to an Agent session.

BREAKING CHANGE: removes the workdir/thread hierarchy. Discord channels/threads and Lark chats/threads are now treated equally as independent IM sessions, each with its own `path` and agent binding. The `/workdir` command now sets the working path for the current session. Existing state files are migrated automatically on first load.
