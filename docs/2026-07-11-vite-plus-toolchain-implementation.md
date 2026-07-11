# Legion 全面迁移到 Vite+ 工具链（实现记录）

## 背景

此前项目工具链分散：npm workspaces + `tsc --build` + Vitest + ESLint + Prettier + lefthook。经过调研（见 `docs/2026-07-11-migrate-to-vite-plus.md` 的历史计划），决定一步到位，让 [Vite+](https://voidzero.dev/posts/announcing-vite-plus-alpha) 的 `vp` 成为唯一命令入口。

最终决策：

- 用 **Oxlint** 完全替代 ESLint（`vp lint`）。
- 用 **Oxfmt** 完全替代 Prettier（`vp fmt`）。
- 用 **`vp pack`** 完全替代 `tsc --build`。
- 用 **`vp check`** 做统一的 format + lint + type-check。
- 清理 `package.json` scripts，项目命令统一走 `vp`。

## 实际改动

### 1. 安装与配置

- 全局安装 `vp`，本地安装 `vite-plus` 作为 devDependency。
- 新建根 `vite.config.ts`：
  - `test`：继承原 Vitest 配置（node 环境、workspaces 测试路径、覆盖率）。
  - `fmt`：singleQuote、semi、trailingComma `es5`、printWidth 100、tabWidth 2。
  - `lint`：启用 `typeAware` 与 `typeCheck`，让 Oxlint 基于 TypeScript 类型信息检查。
  - `staged`：`['vp fmt --write', 'vp lint --fix']`。
  - `resolve.tsconfigPaths: true` + 手动 alias，保证 workspace 包名能解析到对应 `src/index.ts`。
- 为每个 `packages/*` 新建 `vite.config.ts`，配置 `vp pack`：
  - entry: `src/index.ts`
  - format: `esm`
  - dts / sourcemap 启用
  - `packages/legion` 额外打包 `bootstrap` 入口，并用 alias 解决 self-import 打包警告。

### 2. 删除的旧工具链

删除以下文件/依赖：

- `.prettierrc`、`.prettierignore`
- `lefthook.yml`
- `eslint.config.mjs`
- `tsconfig.eslint.json`、`tsconfig.eslint.tsbuildinfo`
- `vitest.config.ts`
- `package.json` 中的 `prettier`、`eslint-config-prettier`、`lefthook`、`@eslint/js`、`eslint`、`globals`、`typescript-eslint`、`vite-tsconfig-paths`

### 3. package.json scripts 清理

保留项目特定脚本：

```json
{
  "build": "vp run -r build",
  "dev": "tsx packages/legion/src/bootstrap.ts",
  "start": "node packages/legion/dist/bootstrap.mjs",
  "prepare": "vp config"
}
```

并新增 `packageManager` 字段以锁定 npm 版本：

```json
"packageManager": "npm@11.7.0"
```

移除可由 `vp` 替代的 `typecheck`、`lint`、`lint:fix`、`format`、`format:check`、`test`、`test:watch`、`check`。

### 4. 源码级适配

迁移过程中 Oxlint 的 type-aware 规则报出若干 warning，已按最小侵入原则修复：

- `this.kill()` 在 timeout callback 中 fire-and-forget：改为 `void this.kill()`。
- `IMProvider` 的 handler 类型从 `() => void` 改为 `() => void | Promise<void>`，以允许调用方 `await`。
- 各 provider 与测试 mock 中的 handler 调用点相应调整：同步调用加 `void`，需要等待的用 `for...await` 或 `Promise.resolve(handler(...))`。
- `formatToolInput` 中 `String(input)` 对 `unknown` 的警告：改为先判断 `string/number/bigint/boolean/symbol` 再 `String()`。
- `legion-discord/src/config.ts` 与 `legion-lark/src/config.ts` 中原本无效的 dynamic import（因为对应 provider 也被 index.ts 静态导出）改为静态 import，消除 `vp pack` 的 `INEFFECTIVE_DYNAMIC_IMPORT` 警告。

### 5. 文档更新

- `README.md` 的“开发”节改为 `vp` 命令。
- `AGENTS.md` 新增“工具链与命令入口”节，明确禁止再引入旧工具配置。
- 本文件记录完整实现与迁移后的命令矩阵。

## 迁移后的命令矩阵

| 能力       | 旧命令                      | 新命令                |
| ---------- | --------------------------- | --------------------- |
| 开发运行   | `npm run dev`               | `vp dev`              |
| 构建       | `npm run build` (tsc)       | `vp run -r build`     |
| 格式化     | `npm run format` / Prettier | `vp fmt --write`      |
| 格式化检查 | `npm run format:check`      | `vp fmt --check`      |
| Lint       | `npm run lint` / ESLint     | `vp lint`             |
| Lint 修复  | `npm run lint:fix`          | `vp lint --fix`       |
| 类型检查   | `npm run typecheck` / tsc   | `vp check`（含 type） |
| 测试       | `npm run test` / vitest     | `vp test`             |
| 测试监视   | `npm run test:watch`        | `vp test --watch`     |
| 完整检查   | `npm run check`             | `vp check`            |

## 验证结果

迁移完成后执行：

```bash
vp check        # format + lint + type-check
vp test         # 全部测试
vp run -r build # 全部 workspace 构建
```

结果：

- `vp check`：96 个文件格式正确，66 个文件无 lint/type 警告。
- `vp test`：17 个测试文件、147 个测试全部通过。
- `vp run -r build`：7 个包全部打包成功。

## 已知影响与注意事项

- `vp pack` 的构建产物为 `.mjs` + `.d.mts`，因此各 `packages/*/package.json` 的 `main` / `types` 已改为 `./dist/index.mjs` / `./dist/index.d.mts`。
- Node.js 版本要求保持 `>=20.20.2`；`vp` 会自动管理 Node 版本（通过 `devEngines`）。
- `packageManager` 字段锁定 npm 版本为 `11.7.0`，与 `devEngines.packageManager` 保持一致。
- 后续若需调整 lint 规则或格式化风格，统一修改根 `vite.config.ts`，不要再引入 `.eslintrc`、`.prettierrc` 等独立配置。

---

创建日期：2026-07-11
最后更新：2026-07-11
