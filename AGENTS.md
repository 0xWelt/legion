# Agent 协作规范

## 文档绘图规范

在编写项目文档（尤其是 `docs/2026-06-14-mvp-design.md`）时，如果需要绘制结构性图表，遵循以下边界：

| 图表类型 | 推荐方式 | 说明 |
|---|---|---|
| 高层架构图 | **Mermaid** | 表达系统分层、模块边界、依赖方向 |
| 流程图 / 状态图 | **Mermaid** | 表达决策流程、状态流转、时序交互 |
| 节点内部明细 | **ASCII 文字列表 或 Mermaid Markdown 字符串** | 放在 Mermaid 节点内或段落中 |
| 层级结构明细 | **ASCII 树状图** | 缩进结构稳定，不依赖框线对齐 |
| 复杂带连线框线图 | **禁止** | 不用 `┌─┐`、`│`、`──` 等字符拼接框线和箭头 |

### 核心原则

1. **上层框架和流程用 Mermaid**：整体结构、模块关系、消息路由、状态流转等用 Mermaid 绘制，保证可渲染、可维护。
2. **内部细节可用 ASCII 树状图或列表**：Mermaid 节点内部的内容、目录结构、配置示例等，用缩进树或文字列表表达，因为缩进结构对字体和对齐不敏感。
3. **避免手写复杂 ASCII 框线图**：带框线和斜向/复杂连线的 ASCII 图在不同编辑器、字体、终端下容易错位，应改用 Mermaid。

### Mermaid 节点内容排版

- 单个节点需要展示多行内容时，优先使用 **Markdown 字符串**：用 `"`...`"` 包裹，内部用 `**标题**` 加粗，用换行分隔条目。
- 需要在节点内保留 `<`、`>` 等特殊字符时，要么使用 Markdown 字符串并配合 `htmlLabels: false`，要么用 HTML 实体（如 `&lt;` / `&gt;`）转义。
- Mermaid Markdown 字符串对 `-` / `*` / `+` 列表的渲染支持不稳定，节点内建议避免使用；节点外的普通 Markdown / ASCII 块可以正常使用列表。
- 如果条目很多或需要复杂层级，不要把节点拆得过细，应把详细结构放到节点下方的 ASCII 树状图或文字列表中。

### 优先使用的 Mermaid 图表类型

- `flowchart`：架构分层、消息路由、依赖关系
- `sequenceDiagram`：时序交互
- `erDiagram`：实体关系
- `stateDiagram-v2`：状态流转

### 示例

高层架构用 Mermaid，节点内部用 Markdown 字符串写多行内容（`**标题**` 加粗，换行分隔条目）：

```mermaid
---
config:
  htmlLabels: false
---
flowchart LR
    agent["`**Agent 适配层**
Kimi Code
Claude Code
Codex CLI
...`"] --> core["`Legion Core`"]
    core --> im["`**IM 适配层**
Discord
飞书
Slack
...`"]
```

节点内部明细用 ASCII 树状图：

```text
Legion Core
├── Message Router
├── Command Parser
├── Session Manager
└── State Store
```

## 开发工作流规范

### 代码提交前

每次提交前必须保证以下命令通过：

```bash
npm run lint
npm run typecheck
npm run test
npm run format:check
```

这些检查已通过 husky + lint-staged 在 `git commit` 时自动触发，但本地提前运行可以减少 amend/rebase 次数。

### lint-staged 与 pre-commit

- 提交时会自动对 staged 文件运行 `prettier --write` 和 `eslint --fix`。
- 不要绕过 pre-commit（如 `git commit --no-verify`），除非明确知道自己在处理紧急特例。
- 如果 pre-commit 自动修复了文件，需要重新 stage 并再次提交。

### 格式化

- 使用项目配置的 Prettier，不要依赖编辑器默认设置。
- 不要手动调整引号、分号、换行等风格问题，交给 `npm run format`。

## 提交信息规范

采用 **Conventional Commits** 格式：

```
<type>(<scope>): <subject>

<body>

<footer>
```

### type 说明

| type | 用途 |
|---|---|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档变更（README、设计稿、注释） |
| `style` | 不影响代码含义的格式调整（空格、分号等） |
| `refactor` | 重构，既不修复 bug 也不添加功能 |
| `perf` | 性能优化 |
| `test` | 添加或修改测试 |
| `chore` | 构建、工具链、依赖等杂项 |

### scope 说明

scope 可选，用于说明影响范围：

- `core`：Legion Core
- `agent`：Agent 适配层
- `im`：IM 适配层
- `discord`：Discord 具体实现
- `config`：配置管理
- `docs`：文档
- `ci`：CI / 构建流程

### 示例

```
feat(discord): add message router for channel and thread

docs: update mvp design with workspace binding flow

chore(ci): add github actions workflow
```
