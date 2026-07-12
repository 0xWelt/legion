# Web UI 设计方案

## 背景

Legion 目前通过 Discord、Lark 等 IM provider 与用户交互。为了降低使用门槛，需要提供一个本地 Web UI，让用户可以直接在浏览器中：

1. 以多窗口/多标签形式管理多个聊天 session。
2. 查看服务运行状态。
3. 可视化修改 Legion 配置。

## 参考项目调研

### OpenClaw Control UI

- 仓库：`openclaw/openclaw`
- 位置：`/ui` 目录（`openclaw-control-ui` 私有 workspace 包）
- 技术栈：Lit + Vite
- Gateway 集成方式：
  - Gateway HTTP server 与 WebSocket 监听同一端口（默认 `127.0.0.1:18789`）。
  - 静态 UI 资源构建到 `dist/control-ui/`，由 `src/gateway/control-ui.ts` serve。
  - `src/infra/control-ui-assets.ts` 负责在源码、打包、全局安装等多种布局下解析 `dist/control-ui/index.html`。
  - 提供 `/control-ui-config.json` 作为前端 bootstrap 配置。
- 开发模式：
  - `pnpm ui:dev` 单独启动 Vite dev server（port 5173）。
  - Gateway 独立启动；前端 dev server 可自行代理到 Gateway。

### Kimi Code Web

- 仓库：`MoonshotAI/kimi-code`
- 位置：`apps/kimi-web`（前端）+ `packages/server`（后端）
- 技术栈：Vue 3 + Vite
- Gateway 集成方式：
  - `@moonshot-ai/server` 的 `startServer()` 接收 `webAssetsDir` 参数。
  - `packages/server/src/routes/webAssets.ts` 用 Fastify serve 静态资源。
  - `apps/kimi-code` 构建脚本先把 `apps/kimi-web` build 到 `dist`，再 copy 到 `apps/kimi-code/dist-web`。
  - `kimi server run` / `kimi web` 启动同一进程，监听同一端口。
- 开发模式：
  - `pnpm dev:server` 用 `tsx watch` 跑后端。
  - `pnpm --filter @moonshot-ai/kimi-web run dev` 跑前端 Vite，并把 `/api/v1` proxy 到后端。

### Dify

- 仓库：`langgenius/dify`
- 位置：`web/`（Next.js + Vite via vinext）+ Python API
- 技术栈：Next.js / React + `vp`（Vite+）
- 开发模式：
  - 根 `package.json` 用 `concurrently` 同时启动 `vp run dify-web#dev:vinext` 和 `vp run dify-web#dev:proxy`。
  - 前端 dev proxy 把 API 请求转发到 Python 后端。
- 借鉴点：用 `concurrently` 编排前后端 dev 命令；`vp` 作为统一入口。

## 设计决策

### 1. Gateway 与 Web UI 绑定

参考 OpenClaw 与 Kimi Code，Legion 的 Web UI 也采用「Gateway 进程同时 serve 前端静态资源 + WebSocket/REST API」的模型：

- `legion gateway run`（以及 `legion run`）启动后，内置的 Web UI HTTP server 自动监听 `127.0.0.1:18788`。
- 浏览器访问同一地址即可得到聊天页面、状态页面和设置页面。
- 无需用户单独配置或启动 Web UI 服务。
- Web UI 通过 `MultiIMProvider` 与外部 IM（Discord/Lark 等）同时运行：它始终作为一个 IM provider 存在，消息和回复按 thread/message 路由回对应的 provider。

### 2. 包职责划分

| 包                      | 职责                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `packages/legion-webui` | 纯前端：Vue 3 + Vite，构建产物为 `dist/frontend/`。                                                       |
| `packages/legion`       | Gateway / bootstrap：包含 Web UI 的 HTTP server、WebSocket server、`IMProvider` 实现、配置 contribution。 |
| `packages/legion-api`   | 共享类型：新增 `ServiceManager` / `ServiceStatus`，供 daemon 与 Web UI server 共用，避免循环依赖。        |

### 3. 循环依赖消除

原先：

```text
legion-webui ──import ServiceManager──▶ legion
     ▲                                    │
     └─────────── require by bootstrap ───┘
```

改为：

```text
legion-webui (frontend only)
       │
       │ build artifacts
       ▼
     legion (gateway) ──import ServiceManager──▶ legion-api
```

`packages/legion` 不再在运行时 `require/import` `packages/legion-webui`，只在构建时把前端产物 copy 到 `dist/webui/`。

### 4. 静态资源解析

`packages/legion/src/webui/assets.ts` 的 `resolveWebUIAssetRoot()` 兼容以下场景：

- 本地开发：从 `packages/legion-webui/dist/frontend` 读取。
- 生产/全局安装：从 `packages/legion/dist/webui`（与 `bootstrap.mjs` 相邻）读取。
- 找不到资源时仅关闭静态文件服务，API 与 WebSocket 仍可用。

### 5. 生产构建流程

1. `vp run -r build` 先构建所有 workspace 包。
2. `packages/legion-webui` 的 `vite build` 输出到 `dist/frontend/`。
3. `packages/legion` 的 `build` 脚本执行 `vp pack && node scripts/copy-webui-assets.mjs`，把 `packages/legion-webui/dist/frontend` copy 到 `packages/legion/dist/webui/`。
4. 发布 `@0xwelt/legion` 时，`files` 已包含 `dist/`，因此用户 npm 安装后自带 Web UI。

### 6. 开发热重载

- 后端：`tsx watch --watch-path=packages packages/legion/src/bootstrap.ts`
  - 监视整个 `packages/` 目录，任何 workspace 代码变更都会重启 Gateway。
- 前端：`vp dev -- packages/legion-webui`
  - Vite dev server 默认 port 5173，并通过 proxy 把 `/api` 与 `/ws` 转发到后端 `127.0.0.1:18788`。
- 组合命令：`vp run dev:webui` 用 `concurrently` 同时跑前后端。

> **注意**：开发时浏览器必须访问 `http://127.0.0.1:5173`。`http://127.0.0.1:18788` 由后端提供已构建的 `dist/frontend` 静态产物，不会随源码变更自动更新。
>
> 实测：修改 `Sidebar.vue` 中的品牌文字后，约 2.5 秒页面无需刷新即显示新内容，HMR 工作正常。

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

## 架构图

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
                   │ HTTP / WebSocket
                   ▼
┌─────────────────────────────────────────────┐
│         packages/legion (Gateway)            │
│  ┌────────────────────────────────────────┐  │
│  │  WebUIServer (HTTP + WebSocket)        │  │
│  │  - serve dist/webui static assets      │  │
│  │  - /api/state /api/config /api/status  │  │
│  │  - /ws 聊天消息与事件推送               │  │
│  └────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────┐  │
│  │  WebUIProvider (IMProvider impl)       │  │
│  └────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────┐  │
│  │  LegionCore / session / workdir / ...  │  │
│  └────────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

## 关键文件

- `packages/legion/src/webui/server.ts`：HTTP + WebSocket server。
- `packages/legion/src/webui/provider.ts`：`IMProvider` 实现。
- `packages/legion/src/webui/contribution.ts`：`webui` 配置 contribution。
- `packages/legion/src/webui/assets.ts`：生产/开发环境解析前端资源路径。
- `packages/legion/src/webui/factory.ts`：组装 provider。
- `packages/legion/src/bootstrap.ts`：加载 webui contribution，创建 provider，启动 core。
- `packages/legion/scripts/copy-webui-assets.mjs`：构建时拷贝前端产物。
- `packages/legion-webui/`：纯前端 Vue 应用。
- `packages/legion-api/src/daemon/service.ts`：`ServiceManager` / `ServiceStatus` 共享类型。

## 开发命令

```bash
# 仅启动 Gateway（含 Web UI API/WebSocket），前端用 Vite dev server
vp run dev:webui

# 仅启动 Gateway（无前端 dev server，适合测试后端）
vp run dev

# 生产构建
vp run -r build

# 测试
vp test
```

## 未决问题

- `/api/config` 的 `POST` 保存逻辑尚未实现（当前为 TODO）。

---

创建日期：2026-07-12
最后更新：2026-07-12
