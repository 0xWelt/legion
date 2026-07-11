# pnpm 迁移记录

## 背景

项目已完成 Vite+ 工具链迁移（见 `docs/2026-07-11-migrate-to-vite-plus.md` 与 `docs/2026-07-11-vite-plus-toolchain-implementation.md`），接下来将 monorepo 的包管理器从 npm 切换到 pnpm，以利用 pnpm 在 workspace 依赖隔离、磁盘复用、严格依赖校验等方面的优势，为未来更大的 monorepo 规模做准备。

## 调研结论

pnpm 与 npm 在 monorepo 场景下的主要差异：

| 能力             | npm workspaces                      | pnpm workspaces                                                       |
| ---------------- | ----------------------------------- | --------------------------------------------------------------------- |
| 依赖隔离         | 非严格，子包可访问未声明的间接依赖  | 严格，子包只能使用 `package.json` 中显式声明的依赖                    |
| 内部包版本解析   | `*` 或具体版本号                    | 推荐 `workspace:*`，语义明确且发布时可自动替换                        |
| 锁文件           | `package-lock.json`                 | `pnpm-lock.yaml`                                                      |
| postinstall 行为 | npm 默认允许                        | pnpm v11 默认禁止，需 `allowBuilds` 显式声明需要执行 postinstall 的包 |
| CI 生态          | `actions/setup-node` 内置 npm cache | `pnpm/action-setup` + `actions/setup-node` cache pnpm                 |

参考 Dify、Nuxt、Vue 等成熟 monorepo 项目均采用 pnpm workspace，且内部依赖使用 `workspace:*` 协议。

## 改动点

### 1. 新增 `pnpm-workspace.yaml`

```yaml
packages:
  - packages/*
allowBuilds:
  esbuild: true
  protobufjs: true
```

`allowBuilds` 用于显式允许 `esbuild` 与 `protobufjs` 执行 postinstall 脚本，避免 pnpm 默认安全策略导致这些包的二进制产物无法生成。

### 2. 根 `package.json`

- 移除 `workspaces` 字段（改由 `pnpm-workspace.yaml` 声明）。
- 新增 `"packageManager": "pnpm@11.11.0"`，锁定包管理器版本。
- 新增 `devEngines.packageManager`，指定 `name: pnpm`、`version: 11.11.0`、`onFail: download`。

### 3. 各 `packages/*/package.json`

- 内部依赖从 `"*"` 改为 `"workspace:*"`，例如：
  - `"@legion/api": "workspace:*"`
  - `"@legion/discord": "workspace:*"`
- `packages/legion-discord/package.json` 新增直接依赖 `discord-api-types`：pnpm 严格隔离后，子包不能再使用 discord.js 的间接依赖。

### 4. 打破 workspace 循环依赖

迁移前 `legion-discord` 与 `legion-lark` 的测试通过 `devDependencies` 引用 `legion` 包，而 `legion` 本身又依赖 `legion-discord` / `legion-lark`，形成循环。pnpm 对循环依赖的解析比 npm 更严格，会导致构建/安装问题。

处理方式：

1. 把 `COMMAND_DEFINITIONS` 从 `packages/legion/src/core/command-parser.ts` 移到 `packages/legion-api/src/commands.ts`，由 `legion-api` 导出。
2. `packages/legion/src/core/command-parser.ts` 改为 re-export，保持 `legion` 包原有导出不变。
3. `legion-discord` / `legion-lark` 的测试改为从 `legion-api` 导入 `AgentEvent` / `RenderState` / `COMMAND_DEFINITIONS` / `IMCommandDefinition`。
4. 移除 `legion-discord` 与 `legion-lark` 对 `legion` 的 `devDependencies`。

### 5. CI workflow（`.github/workflows/ci.yml`）

- 使用 `pnpm/action-setup@f40ffcd...` 安装 pnpm。
- 使用 `actions/setup-node` 的 `cache: pnpm` 缓存依赖。
- 安装命令改为 `pnpm install --frozen-lockfile`。
- 检查/测试命令改为：
  - `pnpm exec vp check`
  - `pnpm exec vp test`
  - `pnpm run build`

### 6. 锁文件替换

- 删除 `package-lock.json`。
- 运行 `pnpm install` 生成 `pnpm-lock.yaml`。

## 命令矩阵

| 场景                | npm 时期                                | pnpm 时期                                |
| ------------------- | --------------------------------------- | ---------------------------------------- |
| 安装依赖            | `npm install`                           | `pnpm install`                           |
| 开发运行            | `npm run dev`                           | `pnpm dev`                               |
| 构建                | `npm run build`（即 `vp run -r build`） | `pnpm run build`（即 `vp run -r build`） |
| 格式化              | `vp fmt --write`                        | `vp fmt --write`                         |
| Lint                | `vp lint`                               | `vp lint`                                |
| 类型+格式+lint 检查 | `vp check`                              | `vp check`                               |
| 测试                | `vp test`                               | `vp test`                                |

说明：`vp` 仍是唯一命令入口；pnpm 只替代包安装与脚本调用层。

## 验证结果

迁移后执行以下命令均通过：

```bash
pnpm install --frozen-lockfile
pnpm exec vp check     # 98 files formatted，67 files 无 lint/type 问题
pnpm exec vp test      # 17 test files / 147 tests
pnpm exec vp run -r build   # 7 packages built，无 cycle 报错
```

## 已知影响与注意事项

- pnpm 严格依赖隔离可能暴露以前 npm 下“隐式使用间接依赖”的代码；本次迁移已修复 `discord-api-types` 与 `COMMAND_DEFINITIONS` 两处。
- 新增内部包时，记得在依赖方使用 `"workspace:*"`。
- 遇到 postinstall 被拦截时，将对应包加入 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies`。

---

创建日期：2026-07-11
最后更新：2026-07-11
