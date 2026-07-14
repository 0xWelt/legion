# Flat Session 架构重构

## 背景

当前 Legion 的核心模型是两层结构：

- **Workdir** 绑定在 Discord channel / Lark chat 上，作为配置容器（`defaultAgent`、path）。
- **Session** 分为 `main`（channel 级）和 `thread`（thread 级），thread 继承 channel 的 workdir 和默认 agent。

这导致：

1. channel / thread 的层级关系渗透到核心类型（`IMMessage.channelId/threadId`、`Session.type`、`Workdir.defaultAgent`）。
2. `/agent --workdir`、`/workdir` 等命令都在操作“父级 channel”，理解和调试成本高。
3. 新增 IM provider 时必须处理 channel/thread 两种概念。

## 目标

把核心模型拍平为：**每个 IM 会话直接对应一个 Agent session，彼此完全独立**。

- 不再有 channel / thread 的层级划分。
- Discord 的 channel 和 thread、Lark 的 chat 和 thread，都被视为平等的“创建一个 IM session 的方式”。
- 每个 session 自己绑定 path 和 agent，不继承任何父级配置。

## 新模型

### 核心状态

```ts
export interface Session {
  id: string; // IM 侧 opaque session id
  provider: string; // 'discord' | 'lark' | ...
  name: string; // 展示名称
  path: string; // 该 session 绑定的工作目录
  agent: string; // 当前使用的 runner
  agentSessionId?: string;
  status: 'idle' | 'running' | 'error';
  createdAt: string;
  lastUsedAt: string;
}

export interface LegionState {
  sessions: Record<string, Session>;
}
```

`Workdir` 类型和 `InMemoryWorkdirManager` 被移除；`/workdir` 直接设置当前 `Session.path`。

### IM 抽象

```ts
export interface IMMessage {
  id: string;
  provider: string;
  sessionId: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: Date;
}

export interface IMTarget {
  sessionId: string;
  provider: string;
  replyToMessageId?: string;
}

export interface IMMessageRef {
  provider: string;
  sessionId: string;
  messageId: string;
}
```

- `channelId` / `threadId` 不再出现在共享类型里。
- `IMThread` 类型和 `onThreadCreate/Delete/Archive` 从 `IMProvider` 移除。

### Agent 上下文

```ts
export interface SessionContext {
  sessionId: string;
  workdir: string; // 当前 session 的 path
  agentSessionId?: string;
  model?: string;
}
```

字段名保留 `workdir`，但其语义变为“当前 session 的工作目录”，避免修改 runner 实现。

## 改动范围

| 层级        | 文件                                                               | 改动                                                                                          |
| ----------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| API 类型    | `packages/legion-api/src/im/types.ts`                              | 用 `sessionId` 替换 `channelId/threadId`；移除 `IMThread`；移除 thread 生命周期 hook          |
| API 类型    | `packages/legion-api/src/core/types.ts`                            | 移除 `Workdir`；`Session` 增加 `path`，移除 `type`/`workdirId`；`LegionState` 只剩 `sessions` |
| API 类型    | `packages/legion-api/src/agent/types.ts`                           | `SessionContext` 移除 `threadName`                                                            |
| 命令        | `packages/legion-api/src/commands.ts`                              | `/agent` scope 只剩 `global`/`session`                                                        |
| 核心        | `packages/legion/src/core/session-manager.ts`                      | 合并 `createMain/createThread` 为单个 `create`；增加 `setPath`                                |
| 核心        | `packages/legion/src/core/workdir-manager.ts`                      | 删除                                                                                          |
| 核心        | `packages/legion/src/core/message-router.ts`                       | 移除 workdir 依赖；按 `msg.sessionId` 直接解析/创建 session                                   |
| 核心        | `packages/legion/src/core/command-parser.ts`                       | 移除 `--workdir` scope                                                                        |
| 核心        | `packages/legion/src/core/legion-core.ts`                          | `/workdir` 直接设置 `session.path`；移除 thread 生命周期处理；状态迁移旧 workdir/session      |
| 多 provider | `packages/legion/src/im/multi-provider.ts`                         | 移除 thread provider map；按 `target.provider` 路由                                           |
| Provider    | `packages/legion-discord/src/discord-provider.ts`                  | 用实际消息 channel/thread id 作为 `sessionId`；移除 thread 事件监听                           |
| Provider    | `packages/legion-lark/src/event-handler.ts`                        | `sessionId = thread_id ?? chat_id`                                                            |
| Provider    | `packages/legion-lark/src/lark-provider.ts`                        | 按 `sessionId` 路由；内部维护 thread → chat_id 映射用于发送                                   |
| 状态存储    | `packages/legion/src/state/store.ts`                               | 加载时把旧 `workdirs/sessions` 迁移为扁平 `sessions`                                          |
| 入口        | `packages/legion/src/bootstrap.ts`                                 | `/agent` scope choices 更新                                                                   |
| 导出        | `packages/legion-api/src/index.ts`、`packages/legion/src/index.ts` | 移除 `Workdir`、`IMThread` 相关导出                                                           |
| 测试        | 多个 `*.test.ts`                                                   | 更新 fixture 和断言                                                                           |

## Provider 映射规则

### Discord

- 收到消息的 channel 是什么，`sessionId` 就是什么。
- 在普通 channel 里发消息 → session id = channel id。
- 在 thread 里发消息 → session id = thread id。
- 回复时 `resolveChannel(sessionId)` 即可拿到正确 channel/thread。

### Lark

- `sessionId = message.thread_id ?? message.chat_id`。
- 发送消息时仍需要 `chat_id` 作为 `receive_id`：
  - provider 内部维护 `sessionId → chat_id` 映射。
  - 若 `replyToMessageId` 存在，直接回复该消息（自然落在对应 thread 里）。
  - 否则用映射出的 `chat_id` 发送。

## 状态迁移

旧状态：

```json
{
  "workdirs": { "ch-1": { "path": "/tmp/repo-a" } },
  "sessions": {
    "ch-1": { "workdirId": "ch-1", "type": "main", ... },
    "th-1": { "workdirId": "ch-1", "type": "thread", ... }
  }
}
```

迁移后：

```json
{
  "sessions": {
    "ch-1": { "path": "/tmp/repo-a", ... },
    "th-1": { "path": "/tmp/repo-a", ... }
  }
}
```

每个旧 session 都会复制一份所属 workdir 的 `path`，成为完全独立的 flat session。

## 命令变化

- `/workdir <path>`：绑定当前 session 的 path。
- `/workdir`：查看当前 session 的 path。
- `/agent <name>` / `/agent --session <name>`：切换当前 session 的 agent。
- `/agent --global <name>`：切换全局默认 agent。
- `/agent --workdir`：移除。

## 兼容性说明

这是一次 breaking change：

- 旧状态的 workdir/session 会在启动时自动迁移。
- 配置里不再区分 workdir 级 agent，已有 `--workdir` 命令会失效。
- 由于产品尚未正式发布，允许直接 breaking。

---

创建日期：2026-07-14
最后更新：2026-07-14
