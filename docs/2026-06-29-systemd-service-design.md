# Legion 正式安装、使用方式与 systemd 服务设计

## 背景

当前 Legion 只有开发/调试模式（`pnpm dev` → `tsx` 直接执行源码），没有正式的生产运行方式。需要设计：

1. **正式安装方式**：用户如何获得和安装 Legion
2. **CLI 工具**：统一的命令行入口，覆盖配置、运行、服务管理
3. **配置向导**：首次运行的交互式配置
4. **开机自启**：systemd user service 守护运行

## 参考实现

在动手设计之前，深入阅读了两个成熟项目的源码：

### Hermes Agent (`NousResearch/hermes-agent`)

已安装在本机，其实现方式为：

- **安装**：`setup-hermes.sh` 一键脚本（检测平台 → uv/venv 安装 → .env 创建 → CLI symlink）
- **CLI 入口**：`hermes_cli/main.py`（Python），使用 argparse 解析 `<noun> <verb>` 风格子命令
- **Gateway 运行**：`gateway/run.py` — `start_gateway()` async 函数，负责启动所有平台适配器、管理 agent 缓存（LRU + TTL 驱逐）、session 生命周期
- **服务管理**：`scripts/hermes-gateway`（Python 脚本），动态生成 systemd unit 字符串并写入 `~/.config/systemd/user/hermes-gateway.service`，支持 `install/uninstall/start/stop/restart/status/run` 子命令，同时支持 macOS launchd
- **systemd unit 参数**：`Restart=always`、`RestartSec=5`、`RestartForceExitStatus=75`、`KillMode=mixed`、`TimeoutStopSec=210`、`ExecReload=/bin/kill -USR1 $MAINPID`
- **符号链接**：`~/.local/bin/hermes` → venv 中的 hermes 可执行文件
- **当前状态**：已作为 user service 在本机 enabled 且 running

### OpenClaw (`openclaw/openclaw`)

通过 GitHub API 直接阅读源码，其架构比预想更完整和工程化：

- **安装**：`scripts/install.sh`（curl 一键安装器，自动检测 Node.js 运行时、下载平台对应 binary）
- **CLI 入口**：TypeScript + Commander.js，全类型化的 CLI 框架
- **服务管理**：**TypeScript 实现**（非 shell 脚本）。核心架构：
  - `src/daemon/service.ts` — `GatewayService` 多态接口（`label`、`install`、`uninstall`、`stop`、`restart`、`isLoaded`、`readCommand`、`readRuntime`）
  - `src/daemon/systemd.ts` — Linux systemd 实现（完整的状态管理、linger 检测、unit 文件解析/生成、execStart 读取、legacy name 迁移）
  - `src/daemon/launchd.ts` — macOS launchd 实现（plist 生成/解析、LaunchAgent 安装/卸载、port 管理）
  - `src/daemon/schtasks.ts` — Windows Scheduled Tasks 实现
  - `src/daemon/systemd-unit.ts` — **程序化生成 unit 文件**（`buildSystemdUnit()` 函数），非静态模板
- **Unit 生成**：全参数化，支持 `description`、`programArguments`、`workingDirectory`、`environment`、`environmentFiles`
- **systemd unit 参数**：`Restart=always`、`RestartSec=5`、`RestartPreventExitStatus=78`、`TimeoutStopSec=30`、`TimeoutStartSec=30`、`SuccessExitStatus=0 143`、`OOMPolicy=continue`、`KillMode=control-group`
- **CLI install 命令**（`src/cli/daemon-cli/install.ts`）功能：
  - 检测已安装状态（已安装则跳过或 `--force` 重装）
  - 自动管理 gateway token（生成、嵌入、持久化）
  - 环境变量安全过滤（`isDangerousHostEnvVarName`、`isDangerousHostEnvOverrideVarName`）
  - Version drift 检测（service 版本 ≠ CLI 版本 → 提示修复）
  - `--json` 输出模式（便于脚本调用）
  - `--runtime` 选项（node vs bun）
  - Port 配置与校验
  - Multi-profile 支持（不同 profile 对应不同 service name）
- **install.sh**：curl 安装器，支持 macOS/Linux，自动检测 Node.js（>=22.19）、下载 tarball、使用 `gum` 做 UI

---

## 一、用户旅程总览

### 方式一：Git 仓库安装（当前阶段主推）

```bash
git clone https://github.com/0xWelt/legion.git ~/legion
cd ~/legion
./scripts/setup.sh          # 一键安装：pnpm install + build + 配置向导 + systemd 安装
```

安装完成后：

```bash
# 前台运行（调试）
legion gateway run

# 后台运行（systemd）
legion gateway start

# 查看日志
journalctl --user -u legion-gateway -f

# 查看状态
legion gateway status
```

### 方式二：npm registry 安装（部分支持）

`packages/legion/package.json` 已配置 `bin` 与 `files`，因此发布后可通过 registry 安装：

```bash
npm install -g legion       # 或 npx legion
legion setup                # 配置向导
legion gateway run          # 前台运行
```

> 注意：当前 systemd 服务管理脚本（`scripts/legion-gateway`、`scripts/setup.sh`）仍依赖源码目录结构，registry 安装后暂不支持 `legion gateway install/start` 等后台服务管理。后续 Phase 3 将服务管理逻辑迁移到 TypeScript 后再统一支持。

### 方式三：curl 一键安装（未来，参考 OpenClaw）

```bash
curl -fsSL https://legion.dev/install.sh | bash
```

### 方式四：Docker（未来）

```bash
docker run -d \
  -v ~/.legion:/home/legion/.legion \
  -v /var/run/docker.sock:/var/run/docker.sock \
  ghcr.io/0xwelt/legion:latest
```

---

## 二、CLI 命令矩阵

参考 Hermes 和 OpenClaw 的 CLI 设计，采用 `<noun> <verb>` 风格。

```text
legion
├── setup                      一次性配置向导（交互式）
├── config                     配置管理
│   ├── show                   显示当前配置
│   └── set <key> <value>      修改配置项
├── gateway                    网关生命周期（核心服务）
│   ├── run                    前台运行（调试/测试）
│   ├── install                安装为 systemd 服务（Linux）/ launchd（macOS）
│   │   ├── --force            强制重装
│   │   └── --json             JSON 输出（脚本友好）
│   ├── uninstall              卸载服务
│   ├── start                  启动服务
│   ├── stop                   停止服务
│   ├── restart                重启服务
│   └── status                 查看服务状态
├── agent                      代理管理
│   └── list                   列出可用 agent
├── state                      状态管理
│   └── show                   显示当前状态
└── --version                  显示版本
└── --help                     显示帮助
```

### 当前阶段实现优先级

| 优先级 | 命令                                       | 说明                                 |
| ------ | ------------------------------------------ | ------------------------------------ |
| P0     | `legion gateway run`                       | 前台运行（等同于当前 `npm run dev`） |
| P0     | `legion gateway install/start/stop/status` | systemd 服务管理                     |
| P0     | `legion setup`                             | 首次配置向导                         |
| P1     | `legion config show`                       | 查看配置                             |
| P1     | `legion agent list`                        | 列出 agent                           |
| P2     | `legion config set`                        | 修改配置                             |
| P2     | `legion gateway install --force`           | 强制重装                             |
| P2     | `legion gateway restart`                   | 重启（当前 systemctl restart 即可）  |

---

## 三、安装脚本设计

### `scripts/setup.sh`

参考 Hermes 的 `setup-hermes.sh` 和 OpenClaw 的 `install.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Legion Setup Script
# ============================================================================
# Usage:
#   ./scripts/setup.sh
#
# Steps:
# 1. Check prerequisites (node >= 20, pnpm)
# 2. pnpm install (if node_modules missing)
# 3. pnpm run build
# 4. Create ~/.legion/ directory
# 5. Run interactive config wizard (if config.json missing)
# 6. Install systemd service (Linux only, optional)
# 7. Create symlink: ~/.local/bin/legion -> scripts/legion
# ============================================================================

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LEGION_HOME="$HOME/.legion"
BIN_DIR="$HOME/.local/bin"

echo ""
echo -e "${CYAN}⚔ Legion Setup${NC}"
echo ""

# ── Step 1: Prerequisites ──────────────────────────────────────────────
echo -e "${CYAN}→${NC} Checking prerequisites..."

if ! command -v node &>/dev/null; then
    echo -e "${RED}✗${NC} Node.js not found. Install Node.js >= 20 first."
    echo "  https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo -e "${RED}✗${NC} Node.js >= 20 required (found: $(node -v))"
    exit 1
fi
echo -e "${GREEN}✓${NC} Node.js $(node -v)"

# ── Step 2: pnpm install ─────────────────────────────────────────────────
echo -e "${CYAN}→${NC} Installing dependencies..."
if [ ! -d "$PROJECT_DIR/node_modules" ]; then
    cd "$PROJECT_DIR"
    pnpm install
fi
echo -e "${GREEN}✓${NC} Dependencies ready"

# ── Step 3: Build ───────────────────────────────────────────────────────
echo -e "${CYAN}→${NC} Building..."
cd "$PROJECT_DIR"
pnpm run build
echo -e "${GREEN}✓${NC} Build complete"

# ── Step 4: Create legion home directory ────────────────────────────────
mkdir -p "$LEGION_HOME"
echo -e "${GREEN}✓${NC} Created $LEGION_HOME"

# ── Step 5: Config wizard ───────────────────────────────────────────────
if [ ! -f "$LEGION_HOME/config.json" ]; then
    echo -e "${CYAN}→${NC} Running config wizard..."
    cd "$PROJECT_DIR"
    node packages/legion/dist/bootstrap.mjs setup
else
    echo -e "${GREEN}✓${NC} Config already exists: $LEGION_HOME/config.json"
fi

# ── Step 6: Install systemd service ─────────────────────────────────────
if command -v systemctl &>/dev/null; then
    echo ""
    read -p "Install systemd service for auto-start? [Y/n] " -r
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        "$SCRIPT_DIR/legion-gateway" install
        echo ""
        echo -e "${YELLOW}!${NC} To start now: ${CYAN}legion gateway start${NC}"
        echo -e "${YELLOW}!${NC} To keep running after logout: ${CYAN}sudo loginctl enable-linger \$USER${NC}"
    else
        echo -e "${YELLOW}!${NC} Skipped. Run ${CYAN}legion gateway install${NC} later."
    fi
fi

# ── Step 7: Create CLI symlink ─────────────────────────────────────────
echo -e "${CYAN}→${NC} Creating CLI symlink..."
mkdir -p "$BIN_DIR"
ln -sf "$PROJECT_DIR/scripts/legion" "$BIN_DIR/legion"
echo -e "${GREEN}✓${NC} Linked ${CYAN}legion${NC} → $BIN_DIR/legion"

# ── Done ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}══ Legion setup complete ══${NC}"
echo ""
echo "Quick start:"
echo "  legion gateway run                          # Run in foreground"
echo "  legion gateway start                        # Start as service"
echo "  legion gateway status                       # Check service status"
echo "  journalctl --user -u legion-gateway -f       # View logs"
echo ""
```

### 与 Hermes/OpenClaw 的对比

| 特性        | Hermes                | OpenClaw       | Legion                |
| ----------- | --------------------- | -------------- | --------------------- |
| 安装脚本    | `setup-hermes.sh`     | `curl \| bash` | `scripts/setup.sh`    |
| 包管理器    | uv (Python)           | pnpm / bun     | pnpm                  |
| UI 工具     | 无                    | `gum`          | 无（使用 read）       |
| 幂等性      | ✓                     | ✓              | ✓                     |
| CLI symlink | `~/.local/bin/hermes` | 下载的 binary  | `~/.local/bin/legion` |

---

## 四、CLI 入口设计

### `scripts/legion` — 主 CLI

```bash
#!/usr/bin/env bash
# ============================================================================
# Legion CLI — unified entry point
# ============================================================================
# Usage: legion <command> [args...]
#
# Thin dispatcher — routes to:
#   - scripts/legion-gateway  (gateway subcommands)
#   - packages/legion/dist/bootstrap.mjs  (run, setup, config, agent, state)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

usage() {
  echo "Legion — Coding Agent IM Bridge"
  echo ""
  echo "Usage: legion <command> [args...]"
  echo ""
  echo "Commands:"
  echo "  setup               First-time config wizard"
  echo "  gateway <action>    Manage the gateway service"
  echo "    run                 Run in foreground"
  echo "    install             Install as systemd/launchd service"
  echo "    uninstall           Uninstall the service"
  echo "    start               Start the service"
  echo "    stop                Stop the service"
  echo "    restart             Restart the service"
  echo "    status              Show service status"
  echo "  config <action>     Manage configuration"
  echo "    show                Display current config"
  echo "  agent <action>      Manage agents"
  echo "    list                List available agents"
  echo "  --version           Show version"
  echo "  --help              Show this help"
  exit 0
}

cmd="${1:-}"

case "$cmd" in
  --help|-h|"")
    usage
    ;;
  --version|-v)
    node -e "console.log(require('$PROJECT_DIR/package.json').version)"
    ;;
  gateway)
    shift
    exec "$SCRIPT_DIR/legion-gateway" "${@:1}"
    ;;
  setup|config|agent|state)
    exec node "$PROJECT_DIR/packages/legion/dist/bootstrap.mjs" "$@"
    ;;
  *)
    echo "Unknown command: $cmd"
    echo "Run 'legion --help' for usage."
    exit 1
    ;;
esac
```

### 命令分发

```text
legion gateway run         → scripts/legion-gateway run
legion gateway install     → scripts/legion-gateway install
legion gateway start       → scripts/legion-gateway start
legion setup               → node bootstrap.js setup
legion config show         → node bootstrap.js config show
legion agent list          → node bootstrap.js agent list
```

- **gateway 子命令**：由 `scripts/legion-gateway` 处理（systemd 交互逻辑）
- **其他子命令**：由 `node bootstrap.js` 处理（复用项目代码）

---

## 五、systemd User Service 设计

### User Service vs System Service

| 维度     | System Service (`/etc/systemd/system/`) | User Service (`~/.config/systemd/user/`) |
| -------- | --------------------------------------- | ---------------------------------------- |
| 权限     | root                                    | 当前用户                                 |
| 开机启动 | 系统启动时                              | 用户登录时 (配合 linger 实现开机启动)    |
| 安装     | 需要 sudo                               | 无需 sudo                                |
| 适用场景 | 服务器                                  | 个人开发机 / 工作站                      |

**选型：User Service** — Hermes 和 OpenClaw 都使用 user service。配合 `loginctl enable-linger` 可在未登录时保持运行。

### 服务管理入口

| 方式                        | 优点                             | 缺点             |
| --------------------------- | -------------------------------- | ---------------- |
| TypeScript（OpenClaw 方式） | 跨平台，类型安全，可复用项目模块 | 需要 node 运行时 |
| Shell 脚本（当前选型）      | 零额外依赖，系统原生             | 平台相关         |

**选型：Shell 脚本** — 当前阶段服务管理逻辑简单（systemctl 薄封装），shell 最直接。未来可演进为 OpenClaw 风格的 TypeScript 实现以获得更好的跨平台支持。

### 系统架构

参考 OpenClaw 的分层设计 —— `service.ts` 定义多态接口，`systemd.ts` / `launchd.ts` 分别实现：

```text
未来演进方向（Phase 3+）：
src/daemon/
├── service.ts            # GatewayService 多态接口
├── service-types.ts      # 参数和返回类型
├── systemd.ts            # Linux systemd 实现
├── systemd-unit.ts       # 程序化生成 unit 文件
├── systemd-linger.ts     # linger 管理
├── launchd.ts            # macOS launchd 实现
└── constants.ts          # 跨平台服务名称/标签
```

### 工作目录

**选型：`WorkingDirectory=%h/.legion`** — 配置和数据都在该目录下，gateway 产生的临时文件也在此处。

### 文件结构

```text
legion/
├── scripts/
│   ├── setup.sh                # 一键安装脚本
│   ├── legion                  # 主 CLI 入口（dispatch 到各子命令）
│   └── legion-gateway          # gateway 服务管理脚本（bash）
├── packages/
│   └── legion/
│       └── src/
│           └── bootstrap.ts    # 扩展：支持 setup/config/agent 子命令
```

> 注意：不同于 OpenClaw 和 Hermes（它们在代码中程序化生成 unit），Legion Phase 1 使用静态 `.service` 模板 + `sed` 替换占位符。这是一个务实的取舍：当前逻辑不需要区分多 profile、多 runtime 等高级特性。

### systemd unit 设计

借鉴 OpenClaw 的 `buildSystemdUnit()` 输出（`Restart=always`、`KillMode=control-group`、`SuccessExitStatus=0 143` 等），同时结合 Legion 的自有特点：

```ini
[Unit]
Description=Legion Gateway - Coding Agent IM Bridge
Documentation=https://github.com/0xWelt/legion
After=network-online.target
Wants=network-online.target
StartLimitBurst=5
StartLimitIntervalSec=60

[Service]
Type=simple
ExecStart=@NODE_BIN@ @BOOTSTRAP_JS@ run
WorkingDirectory=%h/.legion
Environment="NODE_ENV=production"
Environment="PATH=%h/.nvm/versions/node/v24.13.0/bin:%h/.local/bin:/usr/local/bin:/usr/bin:/bin"
Restart=always
RestartSec=5
RestartPreventExitStatus=78
TimeoutStopSec=30
TimeoutStartSec=30
SuccessExitStatus=0 143
OOMPolicy=continue
KillMode=control-group
KillSignal=SIGTERM
StandardOutput=journal
StandardError=journal

# 资源限制
MemoryMax=1G

# 安全加固
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=%h/.legion

[Install]
WantedBy=default.target
```

### 与 Hermes、OpenClaw 的 systemd 参数对比

| systemd 参数               | Hermes            | OpenClaw        | Legion（本设计） | 说明                         |
| -------------------------- | ----------------- | --------------- | ---------------- | ---------------------------- |
| `Restart`                  | `always`          | `always`        | `always`         | 总是重启（含正常退出）       |
| `RestartSec`               | `5`               | `5`             | `5`              | 5 秒后重试                   |
| `RestartForceExitStatus`   | `75`              | —               | —                | 75 强制重启（Hermes 特有）   |
| `RestartPreventExitStatus` | —                 | `78`            | `78`             | 78 不重启                    |
| `TimeoutStopSec`           | `210`             | `30`            | `30`             | 停止超时（OpenClaw 用 30s）  |
| `TimeoutStartSec`          | —                 | `30`            | `30`             | 启动超时                     |
| `SuccessExitStatus`        | —                 | `0 143`         | `0 143`          | SIGTERM(143) 视为正常退出    |
| `OOMPolicy`                | —                 | `continue`      | `continue`       | OOM 不杀 service             |
| `KillMode`                 | `mixed`           | `control-group` | `control-group`  | 更强：所有 cgroup 进程一起杀 |
| `ExecReload`               | `/bin/kill -USR1` | —               | 预留             | 热重载                       |
| `MemoryMax`                | 无                | 无              | `1G`             | 资源限制                     |
| `NoNewPrivileges`          | 无                | 无              | `yes`            | 安全加固                     |
| `ProtectSystem`            | 无                | 无              | `strict`         | 安全加固                     |
| `ProtectHome`              | 无                | 无              | `read-only`      | 安全加固                     |

### 服务管理脚本

`scripts/legion-gateway`：

```bash
#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="legion-gateway"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
UNIT_DST="$HOME/.config/systemd/user/$SERVICE_NAME.service"
DEFAULT_NODE="/usr/bin/node"

cmd="${1:-run}"

find_node() {
  # Priority: explicitly set > which node > nvm node > system node
  if [ -n "${LEGION_NODE_BIN:-}" ]; then
    echo "$LEGION_NODE_BIN"
    return
  fi
  local nvm_node="$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node/" 2>/dev/null | sort -V | tail -1)/bin/node"
  if [ -x "$nvm_node" ]; then
    echo "$nvm_node"
    return
  fi
  command -v node || echo "$DEFAULT_NODE"
}

generate_unit() {
  local node_bin bootstrap_js
  node_bin="$(find_node)"
  bootstrap_js="$PROJECT_DIR/packages/legion/dist/bootstrap.js"

  if [ ! -f "$bootstrap_js" ]; then
    echo "错误: bootstrap.js 不存在，请先执行 npm run build" >&2
    echo "  cd $PROJECT_DIR && npm run build" >&2
    exit 1
  fi

  cat <<SYSTEMD_UNIT
[Unit]
Description=Legion Gateway - Coding Agent IM Bridge
Documentation=https://github.com/0xWelt/legion
After=network-online.target
Wants=network-online.target
StartLimitBurst=5
StartLimitIntervalSec=60

[Service]
Type=simple
ExecStart=${node_bin} ${bootstrap_js} run
WorkingDirectory=%h/.legion
Environment="NODE_ENV=production"
Environment="PATH=${HOME}/.nvm/versions/node/$(ls "${HOME}/.nvm/versions/node/" 2>/dev/null | sort -V | tail -1)/bin:${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin"
Restart=always
RestartSec=5
RestartPreventExitStatus=78
TimeoutStopSec=30
TimeoutStartSec=30
SuccessExitStatus=0 143
OOMPolicy=continue
KillMode=control-group
KillSignal=SIGTERM
StandardOutput=journal
StandardError=journal
MemoryMax=1G
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=%h/.legion

[Install]
WantedBy=default.target
SYSTEMD_UNIT
}

do_install() {
  mkdir -p "$(dirname "$UNIT_DST")"
  generate_unit > "$UNIT_DST"
  systemctl --user daemon-reload
  systemctl --user enable "$SERVICE_NAME"
  echo "✓ Legion Gateway systemd 服务已安装"
  echo ""
  echo "启动服务:"
  echo "  systemctl --user start $SERVICE_NAME"
  echo ""
  echo "查看日志:"
  echo "  journalctl --user -u $SERVICE_NAME -f"
  echo ""
  echo "用户注销后保持运行:"
  echo "  sudo loginctl enable-linger \$USER"
}

do_uninstall() {
  systemctl --user stop "$SERVICE_NAME" 2>/dev/null || true
  systemctl --user disable "$SERVICE_NAME" 2>/dev/null || true
  rm -f "$UNIT_DST"
  systemctl --user daemon-reload
  echo "✓ Legion Gateway systemd 服务已卸载"
}

do_run() {
  local bootstrap_js="$PROJECT_DIR/packages/legion/dist/bootstrap.js"
  if [ ! -f "$bootstrap_js" ]; then
    echo "错误: bootstrap.js 不存在，请先执行 npm run build" >&2
    exit 1
  fi
  echo "启动 Legion Gateway (前台模式)..."
  echo "按 Ctrl+C 停止"
  echo ""
  exec "$(find_node)" "$bootstrap_js" run
}

case "$cmd" in
  install)   do_install ;;
  uninstall) do_uninstall ;;
  start)     systemctl --user start "$SERVICE_NAME" ;;
  stop)      systemctl --user stop "$SERVICE_NAME" ;;
  restart)   systemctl --user restart "$SERVICE_NAME" ;;
  status)    systemctl --user status "$SERVICE_NAME" ;;
  run)       do_run ;;
  *)
    echo "用法: legion-gateway {install|uninstall|start|stop|restart|status|run}"
    exit 1
    ;;
esac
```

> Phase 2+ 可改为 TypeScript 实现（参考 OpenClaw），以获得更好的错误处理、`--json` 输出、已安装检测等功能。

---

## 六、bootstrap.ts 扩展

当前 `bootstrap.ts` 只做一件事：启动 gateway。需扩展支持 CLI 子命令。

### 当前代码

```typescript
// bootstrap.ts (现状)
if (import.meta.url === `file://${process.argv[1]}`) {
  bootstrap().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

### 改造方案

```typescript
async function main() {
  const command = process.argv[2];

  switch (command) {
    case 'setup':
      await runSetup();
      break;
    case 'config':
      await configCommand(process.argv.slice(3));
      break;
    case 'agent':
      await agentCommand(process.argv.slice(3));
      break;
    case 'state':
      await stateCommand(process.argv.slice(3));
      break;
    case undefined:
    case 'run':
    default:
      // 保持向后兼容：无参数 = run
      await bootstrap();
      break;
  }
}

async function runSetup() {
  const { configContributions } = await loadContributions();
  const config = await loadConfig(configContributions);
  await saveConfig(DEFAULT_CONFIG_PATH, config);
  console.log(`配置已保存到 ${DEFAULT_CONFIG_PATH}`);
}

async function configCommand(args: string[]) {
  const sub = args[0];
  switch (sub) {
    case 'show': {
      const { configContributions } = await loadContributions();
      const config = await loadConfig(configContributions);
      console.log(JSON.stringify(config, null, 2));
      break;
    }
    default:
      console.log('Usage: legion config show');
  }
}

async function agentCommand(args: string[]) {
  const sub = args[0];
  switch (sub) {
    case 'list': {
      const { agentContributions } = await loadContributions();
      const runnerFactory = new DefaultAgentRunnerFactory();
      for (const agent of agentContributions) {
        await agent.register(runnerFactory);
      }
      console.log(runnerFactory.list().join('\n'));
      break;
    }
    default:
      console.log('Usage: legion agent list');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

---

## 七、三项目实现对比

| 维度                | Hermes                            | OpenClaw                     | Legion（本设计）                                  |
| ------------------- | --------------------------------- | ---------------------------- | ------------------------------------------------- |
| 运行环境            | Python (uv/venv)                  | Node.js (pnpm)               | Node.js (pnpm)                                    |
| 安装脚本            | `setup-hermes.sh`                 | `scripts/install.sh`（curl） | `scripts/setup.sh`                                |
| CLI 入口            | `hermes_cli/main.py`（argparse）  | Commander.js（TypeScript）   | `scripts/legion`（bash dispatcher）               |
| 服务管理实现        | Python (`scripts/hermes-gateway`) | TypeScript (`src/daemon/`)   | Bash (`scripts/legion-gateway`)                   |
| systemd unit 生成   | 脚本内字符串拼接                  | 程序化 `buildSystemdUnit()`  | heredoc 模板（当前）                              |
| 跨平台              | systemd + launchd                 | systemd + launchd + schtasks | systemd（Phase 3+ launchd）                       |
| `Restart`           | `always`                          | `always`                     | `always`                                          |
| `KillMode`          | `mixed`                           | `control-group`              | `control-group`                                   |
| `RestartSec`        | `5s`                              | `5s`                         | `5s`                                              |
| `TimeoutStopSec`    | `210s`                            | `30s`                        | `30s`                                             |
| `OOMPolicy`         | —                                 | `continue`                   | `continue`                                        |
| `SuccessExitStatus` | —                                 | `0 143`                      | `0 143`                                           |
| 安全加固            | 无                                | 无                           | `NoNewPrivileges` / `ProtectSystem` / `MemoryMax` |
| 符号链接            | `~/.local/bin/hermes`             | 下载的 binary                | `~/.local/bin/legion` → scripts/legion            |
| Token 管理          | —                                 | ✓（嵌入 service unit）       | 预留                                              |
| Version drift 检测  | —                                 | ✓                            | 预留                                              |
| `--json` 输出       | —                                 | ✓                            | 预留                                              |
| Multi-profile 支持  | —                                 | ✓                            | 预留                                              |

---

## 八、灰度上线计划

### Phase 1：当前 PR（最小可用服务管理）

1. 创建 `scripts/legion-gateway`（服务管理脚本，heredoc 生成 unit）
2. 创建 `scripts/legion`（主 CLI 入口，bash dispatcher）
3. 创建 `scripts/setup.sh`（一键安装脚本）
4. 扩展 `bootstrap.ts` 支持 `setup` / `config show` / `agent list` 子命令
5. 更新 `package.json` scripts（`dev` → `start:dev`，`start` → production mode）
6. 本地验证全流程：setup → install → start → status → stop

### Phase 2：graceful shutdown + 健壮性（后续）

当前 `bootstrap.ts` 在 SIGINT 时直接 `process.exit(0)`，需要改造：

```typescript
let shuttingDown = false;

process.on('SIGTERM', async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('Received SIGTERM, shutting down gracefully...');
  await core.stop(); // 停止接受新消息，等待现有 agent 任务完成
  process.exit(0);
});
```

同时加上：

- 已安装检测（提示用户而不是重复安装）
- `--force` 支持（强制重装）
- 注册 `RestartPreventExitStatus=78` 对应的优雅停止 exit code

### Phase 3：TypeScript 服务管理层（后续）

参考 OpenClaw，将 `scripts/legion-gateway` 重写为 TypeScript：

- `src/daemon/service.ts` — `GatewayService` 多态接口
- `src/daemon/systemd.ts` — systemd 实现
- `src/daemon/systemd-unit.ts` — `buildSystemdUnit()` 程序化生成
- `src/daemon/launchd.ts` — macOS 支持
- CLI 输出 `--json` 选项（脚本友好）
- Version drift 检测

### Phase 4：npm registry 包 + Docker（后续）

- `npm install -g legion` / `npx legion`：已具备基础条件（`bin` + `files`），但完整的 registry 安装体验（含 systemd 服务管理）需等待 Phase 3 的服务管理 TypeScript 化。
- Docker 镜像。
- curl 一键安装 (`install.sh`)。

---

## 九、风险与注意事项

1. **WSL2 systemd 支持**：当前 WSL2 已内置 systemd（`/etc/wsl.conf` 中 `[boot] systemd=true`），`systemctl --user` 正常工作。

2. **Agent 子进程清理**：Gateway fork 的 agent 进程（claude-code, kimi-code 等），`KillMode=control-group` 会杀掉整个 cgroup，比 `mixed` 更强力。`SuccessExitStatus=0 143` 确保被 SIGTERM 杀死不触发 restart loop。

3. **首次运行无配置**：`bootstrap.ts` 在无配置文件时会进入交互式配置向导。systemd 服务在无 TTY 的情况下会失败。因此 `setup` 命令**必须**在首次 `start` 前执行。

4. **node 路径探测**：`find_node()` 自动检测 nvm 管理的 node，避免硬编码版本号。OpenClaw 也有类似的路径解析逻辑。

5. **Restart=always 的风险**：与 OpenClaw 一致使用 `Restart=always`。正常退出 (exit 0) 会被视为异常并重启。如果需要正常退出不重启，应使用 `exit 78`（`RestartPreventExitStatus=78`）或 `systemctl --user stop`。

---

创建日期：2026-06-29
最后更新：2026-07-11
