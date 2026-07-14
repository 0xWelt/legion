---
'@0xwelt/legion': minor
---

Add session fork interface and Discord thread support.

- Introduce optional `IMProvider.onSessionFork` hook and `IMForkEvent`.
- `SessionManager` can fork a session, inheriting `path` and `agent` while resetting `agentSessionId`.
- `LegionCore` listens to fork events, persists the new session, and sends a setup notice.
- `DiscordProvider` emits a fork event when a thread is created under a text channel.
- `MultiIMProvider` forwards fork events from child providers.
- Add `warn` to the `Logger` interface.
