# Web UI 适配 Flat Session 重构

## 背景

`refactor/flat-session` 已经把 Legion 的核心模型拍平：

- 不再有 `Workdir` / `IMThread` / channel-thread 层级。
- 每个 IM session 直接对应一个 Agent session，使用统一的 `sessionId`。
- `Session` 自带 `path`（workdir）和 `agent`。

`feature/webui` 分支是在拍平之前开发的，前后端都保留了旧的 channel/thread/workdir 概念。本文档说明如何在 rebase 到 main 后把 Web UI 对齐到新模型。

## 主要改动

### 后端：`packages/legion/src/webui/`

#### `provider.ts`

- 移除 `IMThread` 导入与 `onThreadCreate/Delete/Archive` hook。
- `IMMessage` 使用 `sessionId` 替代 `channelId`/`threadId`。
- `IMMessageRef` / `IMTarget` 只保留 `sessionId`。
- 不再实现 `onSessionFork`（Web UI 暂不需要子 session fork）。

#### `server.ts`

- `ClientMessagePayload` 改为 `{ sessionId, content, authorName?, authorId? }`。
- 删除 thread create/delete/archive 的 payload 与 handler。
- `/api/state` 只返回 `{ sessions }`，不再返回 `workdirs`。
- `parseSessions` 兼容新格式 `{ sessions }` 与旧格式 `{ workdirs }` 的 legacy state。
- WebSocket 只处理 `type: 'message'` 并转发 `sessionId`。

### 前端：`packages/legion-webui/src/frontend/`

#### `types.ts`

- 删除 `Workdir`。
- `Session` 增加 `path` 字段。
- `ChatMessage` 使用 `sessionId`。

#### `App.vue`

- 删除 `workdirs`、`activeWorkdir`、`sessionKey()`。
- 只保留 `activeSession`。
- 消息、agent event、状态输出全部按 `sessionId` 索引。
- 新增 `createSession()`：生成新的 `sessionId` 并切换到聊天视图，等待用户第一条消息触发后端自动创建 session。
- `send()` 只发送 `sessionId`。

#### `Sidebar.vue`

- 不再按 workdir 分组，直接列出所有 session。
- 每个 item 显示 `name`、`agent`、`status`。
- 新增 "+ New" 按钮触发 `create-session`。

#### `ChatPane.vue`

- 删除 `workdir` prop，只接收 `session`。
- header 显示 session name、agent badge、path。
- 空状态提示选择或新建 session。

#### `MessageItem.vue`

- 删除 `workdir` prop。

## 行为变化

- Web UI 里的每个 conversation 就是一个独立的 Legion session。
- 新建 conversation 不需要先绑定 workdir；用户发送第一条消息后，后端 `LegionMessageRouter` 会自动创建 session 并绑定默认 agent。
- 用户仍需在聊天中发送 `/workdir <path>` 来绑定工作目录。
- 状态页面读取 `/api/state` 时只拿到 session 列表，不再显示 workdir 数量。

## 开发验证

- `vp check`：通过。
- `vp test`：全部通过。
- `vp run -r build`：成功，Web UI 产物被 copy 到 `packages/legion/dist/webui/`。

## 未决问题

- `/api/config` 的保存逻辑仍是基础实现，后续可以完善成表单化编辑各 runner 配置。

---

创建日期：2026-07-14
最后更新：2026-07-14
