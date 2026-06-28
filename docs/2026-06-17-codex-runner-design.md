# Codex Runner 设计文档

## 背景

Legion 已经支持 Kimi Code 和 Claude Code 两个 coding agent runner。为了覆盖更多用户已有的 CLI 工具，决定接入 OpenAI Codex CLI（`codex`）。该工具在非交互模式下提供 `codex exec --json`，以 JSON Lines（JSONL）形式输出运行期事件，适合被外部程序消费。

## 调研过程

在实现前，我们完成了以下信息搜集（符合 `AGENTS.md` 中“先调研、后实现”的要求）：

1. **官方文档**：阅读 `codex exec --help` 与 OpenAI Developers 站点的 [Non-interactive mode](https://developers.openai.com/codex/noninteractive) 页面，确认 `--json` 输出的事件类型与字段。
2. **联网搜索**：搜索 `codex exec --json` 的 JSONL 事件格式、社区适配器实现，确认 exec 模式仅支持 item 级事件，没有 token 级 delta。
3. **源码阅读**：clone `https://github.com/openai/codex.git`，阅读：
   - `sdk/typescript/src/events.ts`：事件类型定义
   - `sdk/typescript/src/items.ts`：item 类型定义
   - `codex-rs/exec/src/exec_events.rs`：exec 模式事件结构
   - `codex-rs/exec/src/event_processor_with_jsonl_output_tests.rs`：JSONL 输出测试，验证事件形态
4. **本地验证**：在 `/tmp` 下创建临时目录，多次运行 `codex exec --json`，观察真实输出的事件顺序和字段。

## Codex CLI 事件协议

### 调用方式

```bash
codex exec \
  --json \
  --dangerously-bypass-approvals-and-sandbox \
  [-m <model>] \
  [-]
```

- 提示词通过 **stdin** 传入，命令行参数用 `-` 占位。这样可避免 Codex 把 `Reading additional input from stdin...` 打印到 stderr。
- 恢复已有会话：

```bash
codex exec --json --dangerously-bypass-approvals-and-sandbox resume <thread_id> -
```

### 事件类型

`codex exec --json` 输出的事件类型如下：

| Codex 事件 | 说明 | Legion 映射 |
|---|---|---|
| `thread.started` | 新会话创建，携带 `thread_id` | `session_init` |
| `turn.started` | 一轮开始 | 忽略 |
| `turn.completed` | 一轮结束，携带 usage | `usage` + `complete` |
| `turn.failed` | 整轮失败 | fatal `error` |
| `error` | 顶层错误 | fatal `error` |
| `item.started` | item 开始 | 视 item 类型映射为 `tool_call` / `thinking` / `error` |
| `item.updated` | item 进度更新 | 仅追踪，不 emit 事件 |
| `item.completed` | item 完成 | 视 item 类型映射为 `text` / `thinking` / `tool_result` / `error` |

### Item 类型

| Codex item 类型 | 说明 | Legion 映射 |
|---|---|---|
| `agent_message` | 模型最终回复 | `text` |
| `reasoning` | 模型推理内容 | `thinking` |
| `command_execution` | shell 命令执行 | `tool_call` / `tool_result` |
| `file_change` | 文件增删改 | `tool_call` / `tool_result` |
| `mcp_tool_call` | MCP 工具调用 | `tool_call` / `tool_result` |
| `web_search` | 网络搜索 | `tool_call` |
| `todo_list` | 计划/待办列表 | 忽略 |
| `error` | item 级错误 | 非 fatal `error` |

## Legion AgentEvent 映射

### `session_init`

```json
{"type":"session_init","agentSessionId":"<thread_id>"}
```

来自 `thread.started.thread_id`。Legion 后续用 `agentSessionId` 恢复会话。

### `text`

来自 `item.completed` 的 `agent_message.text`。注意 Codex CLI 在 `exec --json` 模式下不会流式推送 text delta，而是整段生成后一次性输出。

### `thinking`

来自 `item.completed` / `item.started` 的 `reasoning.text`。同样不会逐 token 推送。

### `tool_call` / `tool_result`

- `command_execution`：
  - `toolName`：`command_execution`
  - `input`：`{ command }`
  - `output`：`aggregated_output`
- `file_change`：
  - `toolName`：`file_change`
  - `input`：`{ changes }`
  - `output`：`completed` / `failed`
- `mcp_tool_call`：
  - `toolName`：`mcp:<server>:<tool>`
  - `input`：`arguments`
  - `output`：优先 `result.structured_content`，其次 `result.content`，出错时为 `error.message`
- `web_search`：
  - `toolName`：`web_search`
  - `input`：`{ query }`
  - 无 `tool_result`（Codex 不暴露搜索结果内容）

### `error`

- `turn.failed` 与顶层 `error` → `fatal: true`
- item 级 `error` → `fatal: false`
- 子进程 stderr 中非过滤内容 → `fatal: true`

### `usage`

来自 `turn.completed.usage`：

```json
{
  "type":"usage",
  "inputTokens": <input_tokens>,
  "outputTokens": <output_tokens>,
  "cacheReadTokens": <cached_input_tokens>,
  "cacheCreationTokens": 0
}
```

Codex 不直接提供 costUsd，因此留空。

### `complete`

子进程退出后 emit：

```json
{"type":"complete","exitCode":0}
```

## 流式支持说明

### 与 Claude Code 的差异

Claude Code 提供 `--include-partial-messages`，可输出 token 级的 `text_delta`、`thinking_delta`、`input_json_delta`，因此 Legion 的 `ClaudeCodeRunner` 能做到接近逐字的实时渲染。

Codex CLI 的 `exec --json` **没有等价能力**。它的“流式”体现在：

- 多个 item 会按完成顺序逐个输出；
- 长命令执行时，`item.started` 会先出现，`item.completed` 在命令结束后才出现；
- 但单个 `agent_message` 的文本、reasoning、命令参数都是整段出现后一次性输出。

因此 `CodexRunner` 已经完整消费了 Codex CLI 能提供的全部流式能力，但视觉体验上不会是逐字打字效果。

### item.updated 的处理

Codex 会在命令执行过程中发送 `item.updated`，其中 `aggregated_output` 会逐步累积。当前实现选择：

- 收到 `item.updated` 时仅标记该 item 已见过；
- 最终 `tool_result` 只在 `item.completed` 时 emit。

这样可以避免在 IM 中反复刷新同一段输出造成闪烁。如果未来需要显示“命令正在输出中”的实时感，可以改为在 `item.updated` 时 emit 增量 `tool_result`，但需配合渲染层做 append 处理。

## 实现细节

### 子进程管理

- `stdio: ['pipe', 'pipe', 'pipe']`
- 提示词写入 stdin 后立即 `end()`
- stderr 收集后过滤掉 `Reading additional input from stdin...` 提示
- 支持 `interrupt()`（SIGINT）和 `kill()`（SIGKILL）
- 默认超时 300 秒

### 会话恢复

Codex 使用 `thread_id` 标识会话。恢复命令：

```bash
codex exec --json ... resume <thread_id> -
```

Legion 将 `thread_id` 保存在 `session_init.agentSessionId` 中，后续通过 `SessionContext.agentSessionId` 传入。

### 健壮性

- Malformed JSON 行被忽略；
- 未遇到 `item.started` 就直接收到 `item.completed` 时，会补 emit 一个 `tool_call`；
- 所有未知事件类型默认忽略。

## 测试

### 单元测试

`packages/legion-codex/tests/codex-runner.test.ts` 覆盖：

- 基本 spawn 参数
- resume 参数
- 自定义 model
- `command_execution` 的 `tool_call` / `tool_result`
- `agent_message` → `text`
- `reasoning` → `thinking`
- `file_change` / `mcp_tool_call` / `web_search`
- `turn.failed` / 顶层 `error` / item 级 `error`
- `item.updated` 不重复 emit
- usage 事件
- stdin 写入
- stderr 过滤
- 进程中断

### 集成测试

在 `/tmp` 临时目录中直接调用真实 `codex`：

- 创建文件
- resume 后继续删除文件

## 已知限制

1. **无 token 级流式**：Codex CLI `exec --json` 本身不支持，因此无法实现逐字渲染。
2. **web_search 无结果**：Codex 的 `web_search` item 只暴露 `query`，不暴露搜索结果，因此只映射为 `tool_call`。
3. **todo_list 忽略**：计划/待办列表未映射为可见事件，避免信息过载。
4. **costUsd 缺失**：Codex 不直接返回成本，usage 事件不包含 `costUsd`。
5. **命令输出整段显示**：虽然 `item.updated` 存在，但当前只在 `item.completed` 时 emit 一次 `tool_result`。

---

创建日期：2026-06-17
最后更新：2026-06-17
