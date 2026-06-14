# Agent 协作规范

## 1. 文档职责划分

项目中的 Markdown 文档按读者分层，避免把开发记录塞进用户文档：

| 文件/目录 | 读者 | 内容范围 |
|---|---|---|
| `README.md` | 最终用户（使用 Legion 的人） | 项目简介、前置要求、配置步骤、使用命令、快速开始 |
| `docs/` | 开发者 / 维护者 / Agent | 设计稿、调研、开发记录、实现细节、调试方法、已知限制 |
| `AGENTS.md` | Agent（本工具） | Agent 协作规范、代码风格、目录约定等 |

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

## 3. 外部依赖源码阅读规范

当 Legion 需要与外部工具（如 Kimi Code CLI）的私有输出格式、协议或行为做对接时，**必须先把对应项目的源码 clone 到本地并阅读相关源码**，而不是仅依赖运行观察、二进制字符串搜索或社区二手资料。

- 例如对接 Kimi Code CLI 的输出格式时，应 clone `https://github.com/MoonshotAI/kimi-code.git`（或确认当前使用的 fork/版本），找到 `apps/kimi-code/src/cli/run-prompt.ts` 等关键文件。
- 阅读源码后，把关键结论（如 `PROMPT_BLOCK_BULLET = '• '`、`text` 模式下 tool call/result 为 no-op、`tool.progress` 直接写 stderr 等）记录到 `docs/` 下的开发记录中。
- 如果源码结论与之前的启发式实现有冲突，优先按源码修正实现。
