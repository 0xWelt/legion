# Legion

Legion 是 coding agent 与 IM 平台之间的连接层。它让你在 Discord 等 IM 客户端里，与本地电脑上的多个 coding agent session、多个项目目录（workdir）进行交互——相当于把 terminal 里的 agent 体验搬到了聊天窗口。

## 核心映射

以 Discord 为例，Legion 把本地开发体验映射到 IM 的原生结构上：

| 本地开发 | Legion |
|---|---|
| 一个项目目录 | 一个 Discord Channel（即 main session） |
| 一个独立对话上下文 | 一个 Discord Thread（即 sub session） |
| 同一窗口的不同标签页共享同一个项目目录 | 同一 Channel 下的所有 Thread 共享同一个 workdir |
| agent 的输出与工具调用 | Channel / Thread 里的消息与卡片 |

## 整体架构

```mermaid
flowchart LR
    Agents["Coding Agent CLI\n(Kimi Code / Claude Code / ...)"] --> Core["Legion Core"]
    Core --> IMs["IM 平台\n(Discord / Slack / ...)"]
```

- **Agent 侧**：封装 coding agent CLI，把它们的私有输出转成统一事件。
- **Core**：维护 Session 与 workdir 绑定状态，处理命令与消息路由。
- **IM 侧**：对接具体 IM 平台，把事件渲染成消息。

Agent 层和 IM 层相互独立：接入新的 agent 或新的 IM 平台，都不需要改动 Core。当前已接入 Kimi Code、Claude Code 与 Discord。

## 功能简介

- **远程使用 Kimi Code**：在 Discord Channel 或 Thread 里发消息，Legion 会在本地调用 `kimi` 并把结果发回 Discord。
- **Channel 是主 Session，Thread 是独立子 Session**：每个 Channel 绑定一个本地项目目录（workdir），该 Channel 下的所有 Thread 共享这个 workdir，但对话上下文相互隔离。
- **命令与 Slash Command**：同一套命令既支持文本消息，也支持 Discord 原生 Slash Command 补全。
- **状态持久化**：workdir 绑定、Session、默认 runner 等状态保存在 `~/.legion/state.json`，重启后自动恢复。

## 快速开始

### 前提

- Node.js >= 20
- npm
- 至少一个已安装并可运行的 coding agent CLI：
  - [Kimi Code CLI](https://github.com/MoonshotAI/kimi-code)（命令行输入 `kimi` 可用）
  - [Claude Code CLI](https://code.claude.com/)（命令行输入 `claude` 可用）
- 一个 Discord Bot Token 和允许运行的 Server（Guild）ID

#### 获取 Discord Bot Token 与 Guild ID

1. 打开 [Discord Developer Portal](https://discord.com/developers/applications) 并登录。
2. 点击右上角 **New Application**，输入应用名称后创建。
3. 进入左侧 **Bot** 页面：
   - 点击 **Add Bot**（如果还没有 Bot）。
   - 在 **Privileged Gateway Intents** 里开启：
     - `GUILDS`
     - `GUILD_MESSAGES`
     - `MESSAGE_CONTENT`
   - 点击 **Reset Token**，复制生成的 Token（即 `LEGION_DISCORD_BOT_TOKEN`）。
4. 进入左侧 **OAuth2 > URL Generator**：
   - 在 **Scopes** 里勾选 `bot`。
   - 在 **Bot Permissions** 里勾选：`View Channels`、`Send Messages`、`Send Messages in Threads`、`Create Public Threads`、`Read Message History`、`Embed Links`、`Attach Files`。
   - 复制生成的 URL，在浏览器中打开，把 Bot 加入你的 Server。
5. 在 Discord 客户端里获取 Guild ID：
   - 进入 **用户设置 > 高级 > 开发者模式**，开启它。
   - 右键你的 Server 名称，选择 **复制服务器 ID**（即 `LEGION_DISCORD_ALLOWED_GUILD_ID`）。

### 1. 安装

```bash
git clone <仓库地址>
cd legion
npm install
```

### 2. 启动 Legion

```bash
npm run dev
```

首次启动会交互式询问 Discord bot token 和 allowed guild id，并写入 `~/.legion/config.json`。后续启动直接读取该文件，不再询问。

你也可以通过环境变量预填，跳过交互：

```bash
export LEGION_DISCORD_BOT_TOKEN="your-bot-token"
export LEGION_DISCORD_ALLOWED_GUILD_ID="your-guild-id"
npm run dev
```

### 3. 绑定工作目录

1. 把 Bot 加入对应的 Discord Server。
2. 在 Server 中创建一个 Text Channel。
3. 在 Channel 中发送：

   ```text
   /workdir /path/to/your/repo
   ```

   或输入 `/workdir` 查看当前已绑定的路径。

### 4. 开始对话

在 Channel 中直接发消息，例如：

```text
给这个项目补充一个 README
```

Legion 会调用本地默认 agent（如 `kimi` 或 `claude`），并把回复、思考、工具调用与结果发送回该 Channel。

### 5. 使用 Thread 隔离上下文

在 Channel 中创建 Thread，即可开启一个独立 Session。不同 Thread 之间互不影响，Thread 会与所在 Channel 共享同一个 workdir。

## 常用命令

| 命令 | 作用 |
|---|---|
| `/workdir <path>` | 绑定/查看当前 Channel 的 workdir |
| `/status` | 查看当前 workdir 与 Session 的状态 |
| `/agent [--global\|--workdir\|--session] [name]` | 查看或切换 runner，默认只影响当前 Session |
| `/help` | 显示可用命令说明 |

所有命令同时支持文本消息和 Discord Slash Command。

## Coding Agent 支持矩阵

可通过 `/agent <name>` 切换不同 runner。生效优先级：**Session > Workdir > Global**。未设置时依次向上继承。

Legion 默认以各 runner 能达到的最高自动权限运行，不需要在配置里手动开启。

| Runner | 非交互式 | 恢复会话 | 流式返回 | 无人值守 | 用量/费用 |
|---|---|---|---|---|---|
| `kimi-code` | `kimi -p`<br>✅ | `--session <id>`<br>✅ | `--output-format stream-json`<br>⚠️ 1. thinking 完全不输出；2. assistant text 不会逐 token 流式推送，而是生成完整一段后才一次性返回 | `kimi -p` 自动使用 auto 模式<br>✅ | ✅ |
| `claude-code` | `claude -p`<br>✅ | `--resume <id>`<br>✅ | `--output-format stream-json --verbose --include-partial-messages`<br>✅ 支持 token 级流式（text / thinking / tool input JSON delta） | `--permission-mode bypassPermissions`<br>✅ | ✅ |
| `codex` | `codex exec`<br>✅ | `codex exec resume <id>`<br>✅ | `codex exec --json`<br>⚠️ JSONL 按 item 输出，text 与 tool result 均为完成时一次性返回，无 token 级流式 | `--dangerously-bypass-approvals-and-sandbox`<br>✅ | ✅ |

## IM 支持矩阵

| 平台 | Workspace 映射 | Session 映射 | 命令入口 / 输入中提示 | 流式回复 | 内容折叠 | 消息长度限制 |
|---|---|---|---|---|---|---|
| Discord | Text Channel | Channel / Thread | ✅ 原生 Slash Command<br>✅ 输入中提示 | Components V2 线性渲染，文本块级编辑 + debounce（⚠️ 超长内容自动拆分为多条消息） | 按事件类型分色 Container（text / thinking / tool_call / tool_result / error） | 单条 4000 字符（Components V2），超长自动拆分 |
| Lark（飞书） | Chat（群聊） | Chat / 回复消息 | 文本命令解析（⚠️ 无原生 slash command）<br>❌ 无 typing 提示 | 单张交互卡片全量更新（⚠️ 同 Chat 内只有一张汇总卡片，多 session 并行时互相覆盖） | 折叠面板 | 主文本 3000 / 面板 2000 |

## 配置示例

`~/.legion/config.json`：

```json
{
  "discord": {
    "botToken": "...",
    "allowedGuildId": "..."
  },
  "defaultAgent": "kimi-code"
}
```

将 `defaultAgent` 改为 `claude-code` 可把 Claude Code 设为默认 agent。

状态默认持久化到 `~/.legion/state.json`，一般无需额外配置。

## 安全提示

- Legion 运行在**你自己可控的环境**中，所有 agent 操作等价于你本人执行，没有额外沙箱。
- 建议把 Bot 所在的 Channel 设为私有，仅允许可信用户访问。
- Bot Token、Guild ID 等敏感信息保存在 `~/.legion/config.json`，不会进入项目仓库。
- 通过 `/workdir` 绑定的目录会被 agent 读写，请谨慎绑定系统敏感路径。

## 开发

项目采用 TypeScript + npm workspaces，核心命令：

```bash
npm run dev        # 开发运行
npm run build      # 构建
npm run typecheck  # 类型检查
npm run lint       # 代码检查
npm run test       # 运行测试
npm run format     # 格式化
```

更详细的架构设计、接口说明、实现记录与调试方法请见 [`docs/`](docs/)。

## 未来计划

- [ ] **IM 侧展示用量信息**：每次对话结束后，在 Discord / Lark 消息中展示所用模型与 token 消耗（input / output / cache）。当前 `UsageEvent` 已由 runner 发出，但 IM provider 尚未渲染。

## License

MIT
