# Session Fork 设计

## 背景

在 `refactor/flat-session` 之后，Legion 的会话模型已经被拍平：每个 IM session 直接对应一个 Agent session，channel/thread/chat 都被一视同仁。用户希望在保留这种扁平结构的同时，提供一种“fork”能力：

- 允许一个 IM session 继承另一个 session 的设置（主要是 `path`/`agent`）来创建新 session。
- Discord 里创建子频道（thread）的行为，对应于从 main channel 的 IM session fork 出一个新 session。
- 其他 IM provider 暂时不需要实现，只保留接口即可。

## 设计目标

1. **不重新引入层级**：fork 只是创建时复制父 session 的字段，之后两个 session 完全独立。
2. **provider 无关**：fork 的触发方式由 provider 决定（Discord 用 `threadCreate`），核心只做复制与持久化。
3. **向后兼容**：新增 `onSessionFork?` 是可选接口，已有 provider 不受影响。

## 接口设计

### API 类型

```ts
export interface IMProvider {
  // ... 已有方法

  /**
   * 可选 hook：当 provider 创建子 IM session 时触发。
   */
  onSessionFork?(handler: (event: IMForkEvent) => void | Promise<void>): void;
}

export interface IMForkEvent {
  provider: string;
  parentSessionId: string;
  childSessionId: string;
  name?: string;
}
```

### SessionManager

新增 `fork(parentSessionId, childSessionId, name?)`：

- 复制父 session 的 `provider`、`path`、`agent`。
- 重置 `agentSessionId`（每个 session 必须有独立的 agent session）。
- 状态重置为 `idle`。
- 如果父 session 不存在，返回 `undefined`，由调用方决定 fallback。

### LegionCore

启动时订阅 `imProvider.onSessionFork?`：

- 收到 fork 事件后，若父 session 存在则调用 `sessionManager.fork`。
- 若父 session 不存在，则创建一个带有默认 agent 的新 session（兜底，避免子频道无法使用）。
- 持久化状态，并向子 session 发送一条通知，告知继承的 `workdir` 和 `agent`。

### DiscordProvider

在 `threadCreate` 事件中：

- 校验 `guildId`。
- 构造 `IMForkEvent`（`parentSessionId = thread.parentId`，`childSessionId = thread.id`）。
- 触发所有注册的 fork handler。

`channelCreate` 保持原有行为：为新 text channel 发送 workspace guide。

### MultiIMProvider

- 启动时为每个子 provider 注册 `onSessionFork`。
- 收到事件后补全 `provider` 字段并向上转发。

## 行为示例

1. 用户在 `#general` 频道绑定 `/workdir /tmp/project` 并切换 `/agent claude-code`。
2. 用户在 `#general` 中创建 thread `#feature-1`。
3. Discord provider 发出 fork 事件：`parentSessionId = #general.id`，`childSessionId = #feature-1.id`。
4. LegionCore 复制设置，创建 session `#feature-1.id`，其 `path` 与 `agent` 和 `#general` 相同。
5. 在 `#feature-1` 中发送的第一条消息即进入已绑定好 workdir/agent 的 session。

## 测试覆盖

- `InMemorySessionManager.fork`：复制与重置字段、父不存在返回 `undefined`。
- `LegionCore.handleFork`：正常 fork 与父不存在时的 fallback。
- `DiscordProvider`：`threadCreate` 触发 fork 事件、跨 guild 被忽略。
- `MultiIMProvider`：fork 事件跨 provider 转发。

---

创建日期：2026-07-14
最后更新：2026-07-14
