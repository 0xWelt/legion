---
'@0xwelt/legion': minor
---

Align the Web UI branch with the flat session refactor.

- Remove the legacy `channelId`/`threadId`/`Workdir` model from the Web UI backend and frontend.
- Use a single `sessionId` for messages, targets, and state.
- Update the Web UI sidebar to list sessions directly and add a "New" session button.
- Simplify the Web UI server's `/api/state` endpoint to return only sessions.
