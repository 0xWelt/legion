---
'@0xwelt/legion': patch
---

Improve Web UI conversation and settings experience.

- Chat pane now shows a status bar with the current session's agent, workdir, and status.
- Assistant messages are rendered as structured segments (text, thinking, tool call, tool result, error).
- Status page displays gateway, IM provider, and agent states.
- Settings page provides a semantic editor for default agent, agents list, and IM provider JSON, with explicit save.
- Session state changes from `/workdir`, `/agent`, and agent runs are now pushed to the Web UI in real time.
