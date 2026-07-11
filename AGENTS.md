# Agent 协作规范

## 1. 文档职责划分

项目中的 Markdown 文档按读者分层，避免把开发记录塞进用户文档：

| 文件/目录   | 读者                         | 内容范围                                             |
| ----------- | ---------------------------- | ---------------------------------------------------- |
| `README.md` | 最终用户（使用 Legion 的人） | 项目简介、前置要求、配置步骤、使用命令、快速开始     |
| `docs/`     | 开发者 / 维护者 / Agent      | 设计稿、调研、开发记录、实现细节、调试方法、已知限制 |
| `AGENTS.md` | Agent（本工具）              | Agent 协作规范、代码风格、目录约定等                 |

- 不要往 `README.md` 里放源码级实现细节、调试脚本、内部决策过程。
- 需要记录“为什么这样实现”“踩过什么坑”“内部限制”时，写到 `docs/` 下的文档里，并遵循下方的日期规范。

## 2. 文档日期规范

`docs/` 目录下的记录类 Markdown 文档（如实现记录、设计文档、决策记录）必须满足：

1. **文件名前缀日期**：使用 `YYYY-MM-DD-` 开头，例如 `2026-06-14-first-implementation.md`。
2. **文末日期区块**：在文档末尾包含如下日期区块：

```markdown
---

创建日期：YYYY-MM-DD
最后更新：YYYY-MM-DD
```

- 新文档创建时，`创建日期` 与 `最后更新` 相同。
- 每次对文档进行实质性修改后，更新 `最后更新` 日期。
- 日期使用 `YYYY-MM-DD` 格式（例如 `2026-06-14`）。

## 3. 源码阅读规范

### 3a. 外部依赖源码

当 Legion 需要与外部工具（如 Kimi Code CLI）的私有输出格式、协议或行为做对接时，**必须先把对应项目的源码 clone 到本地并阅读相关源码**，而不是仅依赖运行观察、二进制字符串搜索或社区二手资料。

- 例如对接 Kimi Code CLI 的输出格式时，应 clone `https://github.com/MoonshotAI/kimi-code.git`（或确认当前使用的 fork/版本），找到 `apps/kimi-code/src/cli/run-prompt.ts` 等关键文件。
- 阅读源码后，把关键结论（如 `PROMPT_BLOCK_BULLET = '• '`、`text` 模式下 tool call/result 为 no-op、`tool.progress` 直接写 stderr 等）记录到 `docs/` 下的开发记录中。
- 如果源码结论与之前的启发式实现有冲突，优先按源码修正实现。

### 3b. 参考实现源码（设计调研）

当设计某个功能而存在**同类/兄弟项目已经实现过**时，**必须先去阅读这些项目的实际源码**，而不是仅凭推测、迁移脚本、配置文件逆向推断。信息来源优先级：

1. **GitHub 源码**（直接 `gh api` 读取、clone 到本地阅读关键模块）
2. **官方文档**（README、`docs/`、CLI `--help`）
3. **联网搜索**（WebSearch、官方博客/公告）
4. **本地已安装的文件**（如配置、systemd unit、脚本）——仅作为辅助佐证

具体操作：

- 已知项目在 GitHub 上→使用 `gh api` 浏览目录树，定位关键文件后读取完整内容
- 未知 owner →使用 `gh search repos` 搜索
- 本地已安装→阅读安装目录下的源码，同时通过 `git remote -v` 找到上游 repo
- **交叉验证**：将源码、文档、本地运行配置三者互相对照，避免片面理解

**反例警示**：在设计 systemd 服务方案时，初始版仅凭 Hermes 的迁移脚本对 OpenClaw 做了"同为 user-level systemd 方案"的推断性描述，未实际阅读 OpenClaw 源码。后续补读 `openclaw/openclaw` 的 `src/daemon/service.ts`、`src/daemon/systemd.ts`、`src/daemon/systemd-unit.ts`、`src/cli/daemon-cli/install.ts` 等模块后，发现遗漏了大量关键设计（如 `buildSystemdUnit()` 程序化生成 unit、`KillMode=control-group`、`SuccessExitStatus=0 143`、`OOMPolicy=continue`、GatewayService 多态接口、跨平台 service 抽象、`--json` 输出、version drift 检测、token 管理等）。这些信息仅靠推断完全无法获得。

## 4. 先调研、后实现

在实现新功能或对接新外部依赖前，**必须先完成充分的信息搜集**，避免凭少量运行观察或主观臆测直接写代码。典型步骤包括：

1. **阅读官方文档**：命令帮助、`--help`、README、开发者文档。
2. **联网搜索**：查找官方/社区对输出协议、事件类型、版本差异的说明。
3. **阅读源码**：按第 3 节要求 clone 源码并定位关键文件（事件定义、CLI 入口、序列化逻辑）。
4. **运行验证**：在本地用最小用例跑真实命令，确认事件顺序、字段含义和边界行为。
5. **记录结论**：把协议/事件矩阵、踩坑点、未支持的能力写到 `docs/` 下的日期前缀文档中，再开始编码。

**反例警示**：在实现 `legion-codex` runner 时，曾因未先完整阅读 Codex CLI 源码和 SDK 事件定义，仅凭几次 `codex exec --json` 的运行观察就推断事件类型，导致初版遗漏了 `item.updated`、`turn.failed`、顶层 `error`、以及 `reasoning`/`file_change`/`mcp_tool_call`/`web_search`/`todo_list` 等多种 item 类型。后续虽通过补读源码修正，但产生了不必要的返工。以后接到类似任务，必须完成上述 1–5 步后再提交第一版实现。

## 5. 工具链与命令入口

项目统一使用 [pnpm](https://pnpm.io/) 作为包管理器，并使用 [Vite+](https://voidzero.dev/posts/announcing-vite-plus-alpha) 工具链，`vp` 是唯一的命令入口。

- **包管理**：所有依赖安装/脚本运行统一走 `pnpm`。workspace 内部包依赖使用 `workspace:*` 协议，不再使用 npm 的 `*` 隐式 workspace 版本。
- **格式化**：`vp fmt` / `vp fmt --write`（Oxfmt，替代 Prettier）。
- **Lint**：`vp lint` / `vp lint --fix`（Oxlint，替代 ESLint + typescript-eslint）。
- **类型检查**：`vp check` 会自动运行类型检查（tsgo）；不再使用 `tsc --noEmit`。
- **测试**：`vp test`（Vitest，配置在根 `vite.config.ts` 的 `test` 字段）。
- **构建**：`vp pack`（每个 `packages/*` 的 `vite.config.ts` 配置 `pack`）；根构建入口为 `vp run -r build`。
- **Git Hooks**：由 `vp config` / `prepare` 自动安装，配置在根 `vite.config.ts` 的 `staged` 字段；不再使用 lefthook。

因此：

- 不要新增 `.prettierrc`、`.prettierignore`、`lefthook.yml`、`eslint.config.mjs` 等旧工具配置。
- 不要往 `package.json` 的 `scripts` 里塞 `format`、`format:check`、`lint`、`lint:fix`、`typecheck`、`test`、`check` 等可由 `vp` 替代的脚本；只保留项目特定的脚本（如 `dev`、`start`、`build`、`prepare`）。
- 修改代码风格或 lint 规则时，优先改根 `vite.config.ts` 里的 `fmt` / `lint` 字段，而不是新建独立的配置文件。

## 6. 版本发布

项目使用 [Changesets](https://github.com/changesets/changesets) 管理 monorepo 版本和 CHANGELOG，并通过 `changesets/action` 在 GitHub Actions 中自动发布。

### 6.1 日常开发

- 任何对用户可见的改动（新功能、bug 修复、破坏性变更）在提交 PR 时都应该附带一个 `.changeset/*.md` 文件。
- 使用 `pnpm changeset`（或 `pnpm exec changeset`）交互式创建 changeset。
- changeset 的语义只描述本次变更，不要手动修改 `package.json` 版本号。

### 6.2 发布流程

1. 带有 changeset 的 PR 合并到 `main`。
2. `.github/workflows/release.yml` 检测到 `main` 分支推送，运行 `pnpm version-packages`。
3. 如果存在未消费的 changeset，`changesets/action` 会创建一个标题为 **"chore: release packages"** 的 PR，里面包含版本号更新和聚合后的 CHANGELOG。
4. 维护者 review 并合并该 PR。
5. PR 合并后，`release.yml` 再次触发，执行 `pnpm publish-packages`，将包发布到 npm 并生成 GitHub Release。

### 6.3 关键配置

- 所有 workspace 包被配置为 `fixed`，版本号始终保持一致，避免用户安装时出现内部版本不一致。
- 根 `package.json` 保持 `private: true`，不会被发布。
- 发布需要仓库管理员在 GitHub Settings → Secrets 中配置 `NPM_TOKEN`。
- 启用 npm provenance（`NPM_CONFIG_PROVENANCE=true`），发布到 registry 的包会附带可验证的来源证明。

### 6.4 发版脚本

根 `package.json` 提供以下专用脚本：

- `pnpm changeset`：交互式创建 changeset。
- `pnpm version-packages`：根据 changeset 更新版本号和 CHANGELOG（通常由 CI 执行）。
- `pnpm publish-packages`：构建所有包并发布到 npm（通常由 CI 执行）。

### 6.5 注意事项

- 不要新增 `.changeset/config.json` 之外的独立发布配置文件。
- 不要手动打 tag 触发发布；所有发布动作都通过合并 "chore: release packages" PR 完成。
- 若首次发布因 npm 包名被占用失败，需要改为 scoped 包名（如 `@legion-monorepo/legion`）并同步更新 `.changeset/config.json` 和 workspace 引用。
