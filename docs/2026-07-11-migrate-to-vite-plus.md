# Legion 迁移到 Vite+ 工具链

## 背景

Vite+（VoidZero 推出的统一 JavaScript 工具链）在 2026 年成为前端/Node.js 生态的热点。它把 Vite、Vitest、Oxlint、Oxfmt、Rolldown、tsdown、Vite Task 整合进一个 `vp` CLI，目标是用单一入口管理 runtime、包管理器和前端/Node 工具链。

Legion 当前工具链比较分散：

| 能力      | 当前工具                   |
| --------- | -------------------------- |
| 包管理    | npm workspaces             |
| 构建      | `tsc --build`              |
| 测试      | Vitest                     |
| Lint      | ESLint + typescript-eslint |
| Format    | Prettier                   |
| Git Hooks | lefthook                   |
| 任务运行  | npm scripts                |

本调研参考了 Dify（langgenius/dify）等已采用 Vite+ 的成熟项目，制定适合 Legion（Node.js CLI / monorepo）的迁移方案。

## 参考项目调研

### Dify (`langgenius/dify`)

Dify 是目前公开可见的、规模较大的 Vite+ 早期采用者之一。直接读取其源码后的关键发现：

- **根 `package.json`** 已将 `vite-plus` 列为 devDependency，并用 `packageManager: "pnpm@11.10.0"` 锁定包管理器。
- **根 `vite.config.ts`** 极其精简：

  ```ts
  import { defineConfig } from 'vite-plus';

  export default defineConfig({
    staged: {
      '*': 'eslint --fix --pass-on-unpruned-suppressions',
    },
    fmt: {
      singleQuote: true,
      semi: false,
    },
  });
  ```

- **仍然保留 ESLint**：Dify 使用 `@antfu/eslint-config`，并未迁移到 Oxlint。Vite+ 目前只负责 staged hooks 和 formatter 配置。
- **测试已交给 `vp test`**：`web/package.json` 中 `"test": "vp test"`。
- **任务运行用 `vp run`**：根目录 `type-check: "vp run -r type-check"`、`lint:fix: "vp run lint --fix"`。
- **prepare hook**：`"prepare": "vp config"`，用于安装 Vite+ 的 git hooks。
- **包管理**：pnpm workspace + `catalog:` 依赖管理；用 `pnpm-workspace.yaml` 的 `overrides` 把 `vite` 指向 `@voidzero-dev/vite-plus-core@0.2.4`。

结论：Dify 的实践是**渐进式采用**——先让 Vite+ 接管 formatter、staged hooks、任务运行和测试入口，但保留成熟且高度定制的 ESLint 配置，避免 Oxlint 规则覆盖不足带来的风险。

### Halo

Halo 项目有一个公开的 "Migrate to vite-plus tooling" 提交，迁移范围包括：

- package.json scripts 改为 `vp dev/build/test/pack/fmt`
- 测试 import 从 `"vitest"` 改为 `"vite-plus/test"`
- `env.d.ts` 中类型引用改为 `vite-plus/client`
- 删除 `tsdown.config.ts`，改用 `vite.config.ts` 里的 `pack` 字段配置
- monorepo 各包分别配置 `pack`（entry、deps、outputs、dts 等）

Halo 的迁移比 Dify 更激进，说明**纯 Node.js / monorepo / 库项目**也可以用 Vite+ 的 `vp pack` 替代 `tsdown`/`tsc`。

### VoidZero 官方

官方文档（[Announcing Vite+ Alpha](https://voidzero.dev/posts/announcing-vite-plus-alpha)）明确：

- Vite+ 包含 Vite、Vitest、Oxlint、Oxfmt、Rolldown、tsdown、Vite Task。
- `vp pack` 基于 tsdown，可用于库和独立可执行文件（`exe`）。
- 配置统一放在 `vite.config.ts` 的 `pack`、`test`、`lint`、`fmt`、`run`、`staged` 等字段。
- Oxlint 是 ESLint 兼容但规则子集；Oxfmt 是 Prettier 兼容但仍在 beta。

## 对 Legion 的适用性分析

Legion 与 Dify/Halo 的差异：

| 维度               | Legion             | Dify                | Halo                 |
| ------------------ | ------------------ | ------------------- | -------------------- |
| 类型               | Node.js CLI / 服务 | Next.js + Node 后端 | 博客/CMS，含前端和库 |
| 前端入口           | 无                 | 有                  | 有                   |
| monorepo           | npm workspaces     | pnpm workspaces     | 未知                 |
| 构建需求           | `tsc` 输出 `dist/` | Next.js 构建        | 库打包 + 应用构建    |
| 是否需要 `vp dev`  | 否                 | 是                  | 是                   |
| 是否需要 `vp pack` | 可选               | 是                  | 是                   |

因此 Legion 当前阶段最适合：

1. 用 Vite+ 替代 Prettier（Oxfmt）。
2. 用 Vite+ 替代 lefthook（`staged` + `vp prepare`）。
3. 用 `vp test` 统一测试入口。
4. 用 `vp run` 统一 monorepo 任务（可选）。
5. **保留 ESLint**（参考 Dify），不迁移到 Oxlint，因为现有 typescript-eslint 规则（如 `consistent-type-imports`）在 Oxlint 中支持不完整。
6. **保留 `tsc --build`**（参考 Dify 仍用 `tsc` 做 type-check），不立即用 `vp pack` 替代构建；待 Vite+ 稳定后再评估。

## 迁移方案

### 阶段一：低风险统一（本次执行）

目标：让 Vite+ 接管 formatter、staged hooks、测试入口，保留 ESLint 和 tsc 构建。

1. **安装 Vite+**
   - 全局 `vp`：`curl -fsSL https://vite.plus | bash`
   - 本地 devDependency：`npm install -D vite-plus`

2. **创建根 `vite.config.ts`**
   - 合并当前 `vitest.config.ts` 的测试配置到 `test` 字段。
   - 配置 `fmt` 字段，继承 `.prettierrc`（singleQuote、semi、trailingComma、printWidth、tabWidth）。
   - 配置 `staged` 字段，替换 lefthook：
     ```ts
     staged: {
       '*.{ts,mjs,json,md,yml,yaml}': ['vp fmt --write', 'eslint --fix'],
     }
     ```
   - 保留 `resolve.alias` 以兼容现有 workspace paths。

3. **删除 `vitest.config.ts`**
   - 功能并入 `vite.config.ts`。

4. **更新根 `package.json` scripts**

   ```json
   {
     "dev": "tsx packages/legion/src/bootstrap.ts",
     "start": "node packages/legion/dist/bootstrap.js",
     "build": "tsc --build",
     "typecheck": "tsc --noEmit -p tsconfig.eslint.json",
     "lint": "eslint .",
     "lint:fix": "eslint . --fix",
     "format": "vp fmt --write",
     "format:check": "vp fmt --check",
     "test": "vp test",
     "test:watch": "vp test --watch",
     "check": "vp fmt --check && eslint . && vp test && tsc --noEmit -p tsconfig.eslint.json",
     "prepare": "vp config"
   }
   ```

5. **删除 lefthook 相关配置**
   - 删除 `lefthook.yml`。
   - 从 `devDependencies` 移除 `lefthook`。

6. **删除 Prettier 相关配置**
   - 删除 `.prettierrc`。
   - 从 `devDependencies` 移除 `prettier`、`eslint-config-prettier`。

7. **更新 CI**
   - 将 `npm run format:check`、`npx eslint .`、`npm run test` 改为 `vp fmt --check`、`eslint .`、`vp test`。

8. **验证**
   - `vp config` 安装 hooks。
   - `vp fmt --check` 通过。
   - `eslint .` 通过。
   - `vp test` 通过。
   - `tsc --build` 仍成功。
   - 提交代码时 staged hooks 正常工作。

### 阶段二：深度统一（未来评估）

待 Vite+ 稳定后，再考虑：

- 用 Oxlint 完全替代 ESLint（需先验证规则覆盖）。
- 用 `vp pack` 替代 `tsc --build`（需先验证 project references 和 declaration 输出）。
- 用 `vp env` 管理 Node.js 版本，添加 `.node-version`。
- 评估是否从 npm 切换到 pnpm（Dify/Halo 都用 pnpm，但切换成本较高，非本次目标）。

## 风险与回滚

| 风险                             | 应对措施                                                               |
| -------------------------------- | ---------------------------------------------------------------------- |
| Vite+ alpha 不稳定               | 本次只改 lint/format/test/hooks，构建不动；保留 package-lock.json 备份 |
| Oxfmt 与 Prettier 格式化差异     | 一次性 `vp fmt --write` 后提交；若差异过大可回滚 `.prettierrc`         |
| `vp test` 与原 Vitest 配置不兼容 | 保留原 `vitest.config.ts` 直到验证通过                                 |
| ESLint staged hook 行为变化      | 先测试 commit，确认 fix 后文件被重新 stage                             |

## 引用

- [Dify 根 package.json](https://github.com/langgenius/dify/blob/main/package.json)
- [Dify 根 vite.config.ts](https://github.com/langgenius/dify/blob/main/vite.config.ts)
- [Dify web package.json](https://github.com/langgenius/dify/blob/main/web/package.json)
- [VoidZero - Announcing Vite+ Alpha](https://voidzero.dev/posts/announcing-vite-plus-alpha)
- [voidzero-dev/vite-plus](https://github.com/voidzero-dev/vite-plus)

---

创建日期：2026-07-11
最后更新：2026-07-11
