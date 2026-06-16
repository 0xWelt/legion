# Claude Code Runner 实现记录

## 背景

Legion 已经支持 Kimi Code 作为 coding agent（`legion-kimi-code`）。用户希望把 Claude Code CLI 也接入进来，作为另一个可选的 coding agent。

## 目标

- 新增 `legion-claude-code` package，实现 `AgentRunner` 接口。
- 通过本地已配置好的 `claude` 命令进行端到端验证。
- 保持与 `legion-kimi-code` 一致的代码结构和测试风格。

## 关键结论：Claude Code CLI 的 print 模式输出格式

在实现前，先用真实命令观察了输出格式：

```bash
claude -p "say hi" --output-format stream-json --verbose
```

输出是 **NDJSON**，每行一个 JSON 对象。关键事件类型：

| `type` | 含义 | Legion 事件映射 |
|---|---|---|
| `system` / `init` | 会话初始化，含 `session_id` | `session_init` |
| `assistant` | 助手回复，内含 `content` 数组 | `thinking` / `text` / `tool_call` |
| `user` | 用户/工具侧消息，内含 `tool_result` | `tool_result` |
| `result` | 最终总结，含 `usage` / `modelUsage` / `total_cost_usd` | `usage` + `complete` |

`assistant.content` 数组中的元素类型：

- `{"type":"thinking","thinking":"..."}`
- `{"type":"text","text":"..."}`
- `{"type":"tool_use","id":"...","name":"...","input":{...}}`

`user.content` 数组中的元素类型：

- `{"type":"tool_result","tool_use_id":"...","content":"...","is_error":...}`

### 流式行为

通过真实命令（含 `sleep` 的工具调用）观察到的流式特征：

- **每一行都是一个完整 JSON 对象**，不是字符级流。例如 `assistant` 事件里的 `thinking` 或 `text` 在该行出现时已经是完整的一段内容。
- **不同 block 按顺序分行输出**：一次简单的工具调用会观察到如下顺序：
  1. `system/init`
  2. `assistant` + `thinking`
  3. `assistant` + `tool_use`
  4. `user` + `tool_result`（在工具实际执行完后才出现）
  5. `assistant` + `thinking`
  6. `assistant` + `text`
  7. `result`
- 因此 Runner 只需要 **按行读取并立即 yield**，就能保证事件顺序与 Claude 的输出顺序一致。

`result` 事件的 `modelUsage` 字段是一个以模型名为 key 的对象，例如 `modelUsage["kimi-for-coding"]`。优先从这里读取 token 和费用；如果拿不到，再回退到顶层的 `usage` 和 `total_cost_usd`。

## 实现要点

### 1. Package 结构

复制 `legion-kimi-code` 的目录结构和配置：

```
packages/legion-claude-code/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # 导出 claudeCodeAgentContribution
│   └── claude-code-runner.ts # ClaudeCodeRunner 实现
└── tests/
    ├── agent-contribution.test.ts
    └── claude-code-runner.test.ts
```

### 2. `ClaudeCodeRunner`

- 命令：`claude -p <prompt> --output-format stream-json --verbose --permission-mode bypassPermissions`
- 默认权限模式：`bypassPermissions`，即完全无人值守、不弹出权限确认。可通过 `AgentConfig.permissionMode` 覆盖，例如 `"plan"` 或 `"default"`。
- 会话续期：如果 `SessionContext.agentSessionId` 存在，追加 `--resume <session_id>`。
- 超时：300 秒，与 Kimi runner 一致。
- 逐行读取 stdout，解析 JSON 后转成 `AgentEvent`。
- `stdio` 设置为 `['ignore', 'pipe', 'pipe']`：
  - stdin 设为 `ignore` 是为了避免 Claude 等待 stdin 输入时打印 `Warning: no stdin data received in 3s...` 警告。
  - stdout 用于读取 NDJSON 事件。
  - stderr 不需要读取（Claude 的进度/警告信息会走 stderr，但 Legion 只关心结构化 stdout）。

### 3. 注册到 Legion

修改了以下文件：

- `packages/legion/src/bootstrap.ts`：把 `legion-claude-code` 加入 `CANDIDATE_MODULES`。
- `tsconfig.json`：添加 path mapping 和 project reference。
- `vitest.config.ts`：添加 alias。

### 4. 测试

单元测试覆盖：

- 正确拼接命令参数（含 `--resume`）。
- 解析 `system/init` 为 `session_init`。
- 解析 `assistant/thinking` 为 `thinking`。
- 解析 `assistant/text` 为 `text`。
- 解析 `assistant/tool_use` + `user/tool_result` 为 `tool_call` / `tool_result`。
- 从 `modelUsage` 和顶层 `usage` 解析 `usage` 事件。
- `result` 为 error 时发出 `error` 事件。
- 非法 JSON 行被忽略。
- `interrupt()` 发送 `SIGINT`。
- **流式事件顺序**：新增 `streaming event sequences` 测试组，覆盖：
  - thinking -> text 顺序
  - 完整 tool-use 往返（thinking -> tool_use -> tool_result -> text）
  - 单个 `assistant` 消息中包含 mixed content blocks
  - 单个 `user` 消息中包含多个 `tool_result`
  - thinking / tool_use / tool_result / text 交错顺序

端到端验证：

- `claude-code` runner 真实调用 `claude` 命令，成功收到 `session_init`、`thinking`、`text`、`usage`、`complete`。
- 会话续期验证：第一次运行让 Claude 记住 "magic word is klaatu"，第二次用 `--resume` 追问，Claude 正确回忆出 klaatu。

## 已知限制

- 仅实现了 `stream-json` 输出模式。Claude Code 也支持 `text` / `json`，但 Legion 的事件驱动模型更适合流式 JSON。
- `--verbose` 必须同时提供，否则 `stream-json` 会报错。
- Claude Code 的 tool_use ID 和 tool_result ID 由 Claude 自己生成，Legion 只负责透传。

## 后续可改进

- 支持 `--permission-mode` 等额外参数透传。
- 如果未来需要非流式场景，可考虑增加 `claude-code-text` runner。

---

创建日期：2026-06-16
最后更新：2026-06-16
