# Web UI 设计方案

## 背景

Legion 目前通过 Discord、Lark 等 IM provider 与用户交互。为了降低使用门槛，需要提供一个本地 Web UI，让用户可以直接在浏览器中：

1. 以多窗口/多标签形式管理多个聊天 session。
2. 查看服务运行状态。
3. 可视化修改 Legion 配置。

## 参考项目

### OpenClaw Control UI

- 仓库：`openclaw/openclaw`
- 位置：`/ui` 目录
- 技术栈：Lit + Vite + 自研 `@openclaw/uirouter`
- 布局特点：
  - 左侧可折叠/可调整宽度的 sidebar，包含 workspace / session 列表。
  - 中间主区域为聊天面板，支持分屏（split layout）同时显示多个 session。
  - 右侧为详情层（thinking / diff / file preview 等）。
  - 设置以弹窗/overlay 形式呈现。
- 可借鉴：sidebar + 聊天主区域 + 右侧面板的三栏布局；session 列表按 workspace 分组。

### Kimi Code Web

- 仓库：`MoonshotAI/kimi-code`
- 位置：`apps/kimi-web`
- 技术栈：Vue 3 + Vite
- 布局特点：
  - 左侧 sidebar：workspace 列表 + session 列表。
  - 中间 `ConversationPane`：显示当前 session 的消息流、输入框、工具卡片。
  - 右侧 `aside`：可展开/可调整宽度的详情面板。
  - 设置使用 `SettingsDialog` modal。
  - 前端通过 REST + WebSocket 与后端 daemon 通信。
- 可借鉴：Vue 的响应式数据流、workspace/session 双级导航、modal 设置页。

## 功能需求

### 1. 多窗口聊天页面

- 左侧 sidebar 列出所有 workdir 及其下的 session。
- 点击 session 在右侧打开对应的聊天窗口。
- 一个聊天窗口对应一个 Legion `session`。
- 支持同时打开多个聊天窗口（多标签/多面板）。
- 聊天窗口内显示：
  - 消息历史（用户消息、agent 回复、工具调用/结果、思考过程、错误）。
  - 输入框，支持发送文本和常用 slash 命令（`/workdir`、`/agent`、`/status`、`/help`）。
  - 当前 agent、当前 workdir 的显示。
- 首次进入未绑定 workdir 的 session 时，提示用户先发送 `/workdir <path>`。

### 2. 服务状态页面

- 显示 `legion gateway status` 的 JSON 结果：
  - unit 是否 loaded
  - active 状态（active / inactive / failed / ...）
  - 是否 enabled
- 提供快捷操作按钮：start / stop / restart。
- 显示当前 LegionCore 内部状态（可选，通过读取 `~/.legion/state.json`）：
  - workdir 数量
  - session 数量
  - 各 session 当前状态（idle / running / error）

### 3. 设置页面

- 表单化编辑 `~/.legion/config.json` 的内容：
  - `defaultAgent`
  - `agents` 下各 runner 的配置（binary、env 等）
  - `stateStore.path`
  - 各 IM provider 配置（discord、lark、webui）
- 保存时写回配置文件。
- 对 webui 自身的配置项：监听端口、auth token、是否启用。

## 技术选型

| 层级     | 选型                                         | 理由                                                                                  |
| -------- | -------------------------------------------- | ------------------------------------------------------------------------------------- |
| 前端框架 | Vue 3 + TypeScript                           | 与参考的 kimi-web 一致，响应式数据流适合实时聊天；团队熟悉度高；Vite+ 对 Vue 支持好。 |
| UI 组件  | 自研轻量组件 + 必要时引入无样式库            | 保持 bundle 小，避免引入重型组件库。                                                  |
| 通信协议 | WebSocket + REST                             | WebSocket 用于 agent 事件流式推送；REST 用于配置读写、状态查询。                      |
| 后端接入 | 新增 `packages/legion-webui` 作为 IMProvider | 与 Discord/Lark 同级接入 LegionCore，复用现有 session/workdir/路由逻辑。              |
| 构建工具 | Vite+ (`vp pack`)                            | 与现有工具链统一；前端用 Vite dev server，后端用 tsx / node 运行。                    |

## 架构设计

```text
┌─────────────────────────────────────────────┐
│                Browser                       │
│  ┌──────────┐ ┌──────────────────────────┐  │
│  │ Sidebar  │ │      Chat Tabs/Panes     │  │
│  │(workdirs │ │   (one pane per session) │  │
│  │ & sessions│ │                          │  │
│  └──────────┘ └──────────────────────────┘  │
│           Settings / Status modals           │
└──────────────────┬──────────────────────────┘
                   │ WebSocket / HTTP
                   ▼
┌─────────────────────────────────────────────┐
│  packages/legion-webui                       │
│  ┌─────────────┐  ┌────────────────────────┐ │
│  │ HTTP server │  │   IMProvider impl      │ │
│  │ /api/config │  │  (onMessage/sendText/  │ │
│  │ /api/status │  │   renderEvent/...)     │ │
│  └─────────────┘  └────────────────────────┘ │
└──────────────────┬──────────────────────────┘
                   │ IMProvider interface
                   ▼
┌─────────────────────────────────────────────┐
│           LegionCore                         │
│    (session manager / workdir manager /      │
│     message router / agent runner)           │
└─────────────────────────────────────────────┘
```

### IMProvider 实现要点

`packages/legion-webui` 需要实现 `IMProvider`：

- `start()`：启动 HTTP + WebSocket 服务器，监听配置中的端口（默认 `127.0.0.1:18788`）。
- `onMessage(handler)`：当 Web 客户端发送消息时，构造 `IMMessage` 并调用 handler。
- `sendText(target, text)` / `renderEvent(target, event, state)`：将 Core 的回复/事件通过 WebSocket 推送到对应客户端。
- `registerCommands(commands)`：把命令定义缓存起来，前端请求时返回，用于 slash 命令补全。

`channelId` / `threadId` 映射：

- `channelId` 对应 workdir id。
- `threadId` 对应 session id。
- 主会话（main session）没有 `threadId`。

### 前端状态管理

- 使用 Vue 的 `ref` / `reactive` 做本地状态。
- 通过 `useWebSocket` composable 维护与后端的 WS 连接。
- 收到事件后更新对应 session 的消息列表。

### 配置持久化

- 前端通过 `GET /api/config` 读取当前配置。
- 通过 `POST /api/config` 保存修改。
- 后端直接读写 `~/.legion/config.json`，调用现有的 `loadConfig` / `saveConfig`。

## `vp dev` 前后端热重载方案

`vp dev` 是 Vite+ 的前端开发服务器。要同时实现前后端热重载，采用以下方案：

1. **前端热重载**：`vp dev` 启动 Vite dev server，代理 `/api` 和 `/ws` 到后端端口。
2. **后端热重载**：使用 `tsx watch` 启动 `packages/legion-webui/src/server.ts`。
3. **组合脚本**：在根 `package.json` 新增 `dev:webui` 脚本，内部使用 `concurrently` 或类似工具同时启动前后端：
   ```json
   "dev:webui": "concurrently \"vp dev -- packages/legion-webui\" \"tsx watch packages/legion-webui/src/server.ts\""
   ```
4. 开发时运行 `vp run dev:webui`，前端改动由 Vite HMR 处理，后端 TS 改动由 `tsx watch` 自动重启。

> 注：如果 Vite+ 后续原生支持多入口/后端代理配置，可进一步简化。

## 实现步骤

1. 新建 `packages/legion-webui` workspace 包。
2. 实现 `IMProvider` 和 HTTP/WebSocket 服务器。
3. 实现 `ConfigContribution`，key 为 `webui`。
4. 在 `packages/legion/src/bootstrap.ts` 的 `CANDIDATE_MODULES` 中引入 `legion-webui`。
5. 开发前端页面：
   - `App.vue`：三栏布局 shell。
   - `Sidebar.vue`：workdir / session 列表。
   - `ChatPane.vue`：单个 session 的聊天视图。
   - `StatusView.vue`：服务状态。
   - `SettingsView.vue`：配置表单。
6. 配置 `vite.config.ts` 让 `vp dev` 能 serve 前端，并代理 API 到后端。
7. 新增 `dev:webui` 脚本和 e2e 测试。
8. PR 合并并发布。

## 未决问题

- 是否需要把 webui 配置为默认 provider？目前仍保留 Discord/Lark 可选，webui 通过 `config.webui` 启用。
- 是否让 webui 在 gateway 模式下自动启动？建议初期仅在 `legion gateway run` 时启动，避免与 IM provider 冲突。

---

创建日期：2026-07-12
最后更新：2026-07-12
