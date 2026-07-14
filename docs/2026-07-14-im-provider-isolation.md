# IM Provider 状态隔离设计

## 问题

当前 `LegionCore` 用 **channel ID / thread ID** 作为 `workdir` 和 `session` 的全局唯一键。不同 IM provider（Discord、Lark、Web UI 等）都往同一个 `JsonStateStore` 里读写，导致：

- 不同 provider 的 channel ID 空间可能冲突。
- 一个 provider 的 `/status`、`/workdir` 等操作可能误操作到另一个 provider 的数据。
- 后续加入 Web UI 后，Web UI 的侧边栏会列出 Discord/Lark 创建的 workdir，造成混淆。

设计原则：**每一个 IM provider 应该是独立的，状态和会话不应该互相共享。**

## 设计目标

1. 每个 IM provider 拥有独立的 workdir/session 命名空间。
2. 单 provider 模式（只启用 Discord 或只启用 Lark）行为保持不变。
3. 向后兼容：已有 state 文件中的旧数据可以继续读取；旧数据打上 `provider` 标记，避免被错误归属。
4. Web UI 相关的 provider 过滤在 Web UI PR 中实现，本 PR 只负责核心类型与创建逻辑。

## 方案：给 Workdir/Session 增加 `provider` 字段

### 1. 类型扩展

在 `packages/legion-api/src/core/types.ts` 里给 `Workdir` 和 `Session` 增加 `provider`：

```ts
export interface Workdir {
  id: string;
  provider: string;
  name: string;
  path: string;
  defaultAgent?: string;
  createdAt: string;
}

export interface Session {
  id: string;
  provider: string;
  name: string;
  workdirId: string;
  type: 'main' | 'thread';
  agent: string;
  // ...
}
```

### 2. 创建时写入 provider

- `message-router.ts` 在 `createMain` / `createThread` 时，从 `msg.provider` / `thread.provider` 取值。
- `legion-core.ts` 在 `/workdir` 绑定 workdir 时，把当前 session 的 `provider` 写进 workdir。
- 每个 provider 发送消息时都会带上自己的 `provider` 名称（如 `'discord'`、`'lark'`、`'webui'`）。

### 3. State store 兼容旧数据

`LegionCore.migrateState()` 对没有 `provider` 字段的旧 workdir/session，根据 ID 特征推断 provider：

- Discord snowflake ID（17–19 位纯数字）→ `'discord'`。
- 其他无法识别的旧数据 → `'legacy'`。

这样现有 Discord 用户在升级后，已绑定的 workdir/session 仍然可用，不会被划到别的 provider。

### 4. Web UI 过滤（在 Web UI PR 中实现）

`packages/legion/src/webui/server.ts` 的 `readState()` 返回前端数据时，应过滤：

```ts
workdirs: parsed.workdirs.filter((w) =>> w.provider === 'webui'),
sessions: parsed.sessions.filter((s) => s.provider === 'webui'),
```

本 PR 不修改 Web UI 代码，只确保核心层已经提供 `provider` 字段供后续过滤使用。

### 5. 是否需要 provider 前缀键

可选增强：把 state 文件里的键改成 `${provider}:${id}`，这样即使两个 provider 的 channel ID 完全一样也不会冲突。由于现有 state 迁移成本较高，**第一阶段先只加 `provider` 字段并做迁移**；若后续出现 ID 冲突，再引入前缀键。

## 影响面

- `packages/legion-api/src/core/types.ts`
- `packages/legion/src/core/workdir-manager.ts` / `session-manager.ts`
- `packages/legion/src/core/message-router.ts`
- `packages/legion/src/core/legion-core.ts`
- 核心层相关测试

## 实施顺序

1. 改类型，给 `Workdir` / `Session` 加 `provider`。
2. 改 `workdir-manager.ts` / `session-manager.ts`，在创建接口中加入 `provider`。
3. 改 `message-router.ts`，创建时传入 `msg.provider` / `thread.provider`。
4. 改 `legion-core.ts`，`/workdir` 绑定时写入 `session.provider`；`migrateState()` 给旧数据推断 provider。
5. 跑 `vp test`，补全缺失 `provider` 的测试 fixture。

## 未决问题

- 是否要让 `IMTarget` 也带 `provider`？当前 `MultiIMProvider` 通过消息/线程 ID 映射 provider，暂时不需要。但如果后续支持跨 provider 转发，则需要。
- `'legacy'` 数据是否提供一次性迁移命令？第一阶段不提供，仅保证现有 Discord 数据升级后仍可工作。

---

创建日期：2026-07-14
最后更新：2026-07-14
