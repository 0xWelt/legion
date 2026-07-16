---
'@0xwelt/legion': patch
---

Improve Web UI conversation and settings experience.

- Chat pane now shows a status bar with the current session's agent, workdir, and status.
- Assistant messages are rendered as structured segments (text, thinking, tool call, tool result, error).
- Status and Settings pages are merged into a single Settings page showing gateway, general config, agents, and IM providers.
- IM provider status is now provider-defined via the new `IMProvider.getStatus()` interface; the core no longer hardcodes provider-specific checks.
- Web UI status page also lists providers that are not yet configured so they can be configured in place.
- Session state changes from `/workdir`, `/agent`, and agent runs are pushed to the Web UI in real time.
- Config loading now follows 12-factor precedence: environment variables override `~/.legion/config.json` values.
