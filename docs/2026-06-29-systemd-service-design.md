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

### 方式二：npm registry 安装

`packages/legion/package.json` 已配置 `bin` 与 `files`，发布后可通过 registry 安装：

```bash
npm install -g legion       # 或 npx legion
legion setup                # 配置向导
legion gateway install      # 安装 systemd 服务
legion gateway start        # 启动后台服务
```

服务管理逻辑已迁移到 TypeScript（`packages/legion/src/daemon/`），因此 registry 安装与源码安装使用完全相同的 `legion gateway` 子命令，systemd unit 中通过 `import.meta.url` 自动定位当前 `bootstrap.mjs` 路径。

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
# 3. vp run -r build
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
vp run -r build
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
        node packages/legion/dist/bootstrap.mjs gateway install
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
#   - packages/legion/dist/bootstrap.mjs  (setup, config, agent, gateway, run)

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
  setup|config|agent|state|gateway)
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
legion gateway run         → node bootstrap.mjs gateway run
legion gateway install     → node bootstrap.mjs gateway install
legion gateway start       → node bootstrap.mjs gateway start
legion setup               → node bootstrap.mjs setup
legion config show         → node bootstrap.mjs config show
legion agent list          → node bootstrap.mjs agent list
```

所有子命令统一由 `node bootstrap.mjs` 处理；`gateway` 子命令在 `bootstrap.ts` 中再分派到 `src/daemon/` 的 TypeScript 服务管理实现。

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

**选型：TypeScript** — 服务管理逻辑已迁移到 `packages/legion/src/daemon/`，由 `bootstrap.ts` 的 `gateway` 子命令统一调度。该实现跨平台抽象（当前仅 Linux systemd，后续可扩展 launchd），并自动根据 `import.meta.url` 生成 ExecStart，支持源码安装与 npm registry 安装两种模式。

### 系统架构

参考 OpenClaw 的分层设计 —— `service.ts` 定义多态接口，`systemd.ts` 负责 Linux 实现，`unit.ts` 程序化生成 unit 文件：

```text
packages/legion/src/daemon/
├── service.ts            # GatewayService 多态接口
├── systemd.ts            # Linux systemd 实现
├── unit.ts               # 程序化生成 unit 文件
├── paths.ts              # 可执行文件/路径解析
└── index.ts              # gateway 子命令调度
```

`systemd.ts` 中的 `SystemdServiceManager` 已实现：

- `install(force?)` — 检测已安装状态、生成 unit、daemon-reload、enable
- `uninstall` — stop、disable、删除 unit、daemon-reload
- `start/stop/restart` — systemctl 薄封装
- `status` — 解析 `systemctl status` 输出并返回 JSON

与 OpenClaw 和 Hermes 不同，Legion 的 unit 生成直接使用当前运行的 `bootstrap.mjs` 绝对路径（通过 `import.meta.url` 解析），因此无需区分源码目录或 registry 安装路径。

### 工作目录

**选型：`WorkingDirectory=%h/.legion`** — 配置和数据都在该目录下，gateway 产生的临时文件也在此处。

### 文件结构

```text
legion/
├── scripts/
│   ├── setup.sh                # 一键安装脚本
│   └── legion                  # 源码安装时的 CLI 入口（dispatch 到 bootstrap.mjs）
├── packages/
│   └── legion/
│       └── src/
│           ├── bootstrap.ts    # CLI 子命令入口：setup/config/agent/gateway/run
│           └── daemon/         # TypeScript 服务管理实现
```

> 与 OpenClaw 一致，`daemon/unit.ts` 使用 `buildSystemdUnit()` 程序化生成 unit 文件，并自动嵌入当前运行的 `bootstrap.mjs` 路径，同时支持源码安装与 registry 安装。

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

### 服务管理实现

服务管理已迁移到 TypeScript（`packages/legion/src/daemon/`）。`SystemdServiceManager` 实现了 `ServiceManager` 接口：

- `install({ force? })` — 检测已安装状态、生成 unit、daemon-reload、enable
- `uninstall()` — stop、disable、删除 unit、daemon-reload
- `start / stop / restart` — systemctl 薄封装
- `status()` — 解析 `systemctl status` 并返回 JSON

unit 文件由 `buildSystemdUnit()` 程序化生成，参数与上表一致。`ExecStart` 使用运行时解析的 `bootstrap.mjs` 绝对路径，因此源码安装和 npm registry 安装共用同一份代码。

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
| 服务管理实现        | Python (`scripts/hermes-gateway`) | TypeScript (`src/daemon/`)   | TypeScript (`packages/legion/src/daemon/`)        |
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

1. 在 `packages/legion/src/daemon/` 中实现 TypeScript 服务管理层（`service.ts` / `systemd.ts` / `unit.ts` / `paths.ts` / `index.ts`）
2. 扩展 `bootstrap.ts` 支持 `setup` / `config show` / `agent list` / `gateway` 子命令
3. 创建 `scripts/legion`（源码安装时的 bash dispatcher）
4. 创建 `scripts/setup.sh`（一键安装脚本）
5. 本地验证全流程：setup → install → start → status → stop

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

### Phase 3：跨平台服务管理层扩展（后续）

当前已实现 Linux systemd 的 TypeScript 服务管理。后续可参考 OpenClaw 扩展：

- `src/daemon/launchd.ts` — macOS 支持
- CLI 输出 `--json` 选项（脚本友好）
- Version drift 检测

### Phase 4：npm registry 包 + Docker

- ✅ `npm install -g legion` / `npx legion`：已支持，且 `legion gateway install/start/stop/status` 在 registry 安装下也可用。
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
