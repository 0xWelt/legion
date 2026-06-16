# Discord Components V2 渲染实现

## 背景

之前 Discord 的 agent 输出使用 embed 渲染，把 `thinking`、`text`、`tool_call`、`tool_result` 分别放进 description 和 fields 里。这导致：

1. 顺序被人为分组打乱（thinking 进 field、text 进 description）。
2. 字段长度受限（embed 整体 6000 字符，单个 field 1024）。
3. 无法真正折叠/线性展示流式事件。

## 决策

切换到 Discord **Components V2**，用 `Container` + `TextDisplay` 按事件到达顺序线性排列所有片段。

## 实现要点

### 1. 线性排列，不做特殊排序

`legion-api` 的 `event-accumulator` 已经负责把同类型 delta 合并成连续段。`DiscordProvider` 保持原有顺序，每个 `OutputSegment` 放进一个带颜色标识的 `Container`：

- `text` → 蓝色 `0x3498db`
- `thinking` → 灰色 `0x95a5a6`
- `tool_call` → 黄色 `0xf39c12`
- `tool_result` → 绿色 `0x2ecc71`
- `error` → 红色 `0xff0000`

每个 `Container` 内部用 `TextDisplay` 展示内容，并保留类型前缀：

- `text` → 纯文本
- `thinking` → `💭 ` 前缀
- `tool_call` → `🔧 toolName` + JSON 代码块
- `tool_result` → `✅ toolName` + `text` 代码块
- `error` → `❌ ` 前缀

### 2. 使用原始 JSON 组件

当前 `discord.js@14.26.4` 尚未导出 `ContainerBuilder` / `TextDisplayBuilder`，但 `MessageFlags.IsComponentsV2` 已可用。因此直接构造 API 原始结构：

```ts
{ type: 17, components: [...], accent_color: 0x3498db } // Container
{ type: 10, content: '...' }                            // TextDisplay
flags: 1 << 15                                          // IsComponentsV2
```

类型上引入 `discord-api-types/v10` 的 `APIMessageTopLevelComponent` / `APIContainerComponent` / `APITextDisplayComponent` 作为类型导入（仅类型，运行时无新增依赖）。

### 3. 限制与分页

- **单条消息总字符 4000**：单个 Container 内所有 `TextDisplay.content` 之和不超过 4000。
- **单 Container 最多 10 个组件**：超过时拆分到新的 Container。
- **自动拆成多条消息**：当一次 agent 回复超过上述限制时，不再截断内容，而是拆成多条 Discord 消息连续发送。第一条消息保留 reply 关系，后续消息作为跟帖发送。`RenderState.replyMessageRefs` 记录所有分页消息的引用，后续 flush 会同步编辑；如果页数减少，多余旧消息会被删除。
- **工具返回值截断显示**：`tool_result` 的输出只保留尾部最后 950 个字符，前面补 `...`，避免单个工具返回过长撑爆整页。
- **runner stderr 错误回显到 IM**：`claude-code-runner` 和 `kimi-code-runner` 现在用 `stdio: ['ignore', 'pipe', 'pipe']` 启动子进程，并通过 `process.stderr.on('data', ...)` 捕获 stderr；进程退出前把 stderr 内容作为 `error` 事件发出，避免 CLI 报错但 IM 里静默无回复。
- **legion-core 兜底**：`LegionCore` 对 `runner.run()` 加 `try/catch`，任何未捕获的 runner 异常都会被转换为 `{ type: 'error', message, fatal: true }` 并走 `renderEvent` 渲染；如果渲染也失败，才回退到 `sendText`。
- **reply 失败回退**：保留 `sendWithFallback`，当回复目标被删除时自动转为普通发送。

### 4. 状态颜色

Container 的 `accent_color`：

- 正常：蓝色 `0x3498db`
- 出现 `error` 段：红色 `0xff0000`

## 已知限制

- 暂不添加 `Separator` 等视觉分隔组件，保持最小实现；后续可视效果再调整。
- 工具输入 JSON 仍限制 1500 字符，避免单个代码块过长。

---

创建日期：2026-06-17
最后更新：2026-06-17
