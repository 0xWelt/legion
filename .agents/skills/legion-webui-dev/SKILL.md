# Legion Web UI 开发调试（tmux + Kimi WebBridge）

本 skill 记录如何在本地同时启动 Legion 后端与前端的 dev server，并用 Kimi WebBridge 在真实浏览器里自动化调试 Web UI。

## 适用场景

- 开发 `packages/legion-webui` 时，需要验证前后端完整链路。
- 想自动化点击、输入、截图，检查聊天、状态、设置等页面。
- 希望把调试环境保存在一个可复用的 tmux session 里，断线后可恢复。

## 前置要求

- 项目已切换到 `main` 并安装好依赖（`vp install` 或 `corepack pnpm install`）。
- 已安装 [Kimi WebBridge](https://www.moonshot.cn/kimi-webbridge) 并启动 daemon：
  ```bash
  ~/.kimi-webbridge/bin/kimi-webbridge start
  ```
- 已配置 Legion 所需的环境变量或 `~/.legion/config.json`（例如 agent API key）。

## 1. 启动 dev server（tmux）

推荐用 tmux 把前后端挂在同一个 session，避免 shell 被阻塞。

```bash
# 创建/附加 tmux session
tmux new-session -d -s legion-dev -n dev

# 启动后端 gateway（会同时启动 Web UI server）
tmux send-keys -t legion-dev 'vp run dev' C-m

# 在右侧/下方 split 一个 pane 启动前端 dev server
tmux split-window -h -t legion-dev
tmux send-keys -t legion-dev 'pnpm --filter @0xwelt/legion-webui dev' C-m

tmux attach -t legion-dev
```

启动后：

- 后端：`http://127.0.0.1:18788`
- 前端 dev server：`http://127.0.0.1:5173`

> 注：`package.json` 里的 `dev:webui` 脚本已经封装了 `concurrently` 同时启动前后端，也可以直接 `vp run dev:webui`。

## 2. 用 Kimi WebBridge 访问页面

WebBridge daemon 默认监听 `http://127.0.0.1:10086`。用 `curl` 发送命令，每条命令都要带同一个 `session` 字段，这样浏览器标签会被归入同一组。

```bash
SESSION="legion-webui-debug"

# 打开前端页面
curl -s -X POST http://127.0.0.1:10086/command \
  -H 'Content-Type: application/json' \
  -d "{\"action\":\"navigate\",\"args\":{\"url\":\"http://127.0.0.1:5173\",\"newTab\":true,\"group_title\":\"Legion WebUI debug\"},\"session\":\"$SESSION\"}"

# 获取可交互元素快照
curl -s -X POST http://127.0.0.1:10086/command \
  -H 'Content-Type: application/json' \
  -d "{\"action\":\"snapshot\",\"args\":{},\"session\":\"$SESSION\"}"
```

`snapshot` 返回 accessibility tree，每个可交互元素带有 `@eN` 引用，可直接用于 `click` / `fill`。

## 3. 常用调试操作

### 点击元素

```bash
curl -s -X POST http://127.0.0.1:10086/command \
  -H 'Content-Type: application/json' \
  -d "{\"action\":\"click\",\"args\":{\"selector\":\"@e4\"},\"session\":\"$SESSION\"}"
```

### 输入文本（对 `<textarea>` 可能失败，优先用 `evaluate`）

```bash
# 给 textarea 赋值并触发 input 事件
curl -s -X POST http://127.0.0.1:10086/command \
  -H 'Content-Type: application/json' \
  -d "{\"action\":\"evaluate\",\"args\":{\"code\":\"(() => { const ta = document.querySelector('textarea'); if (!ta) return 'none'; ta.value = '/status'; ta.dispatchEvent(new Event('input', {bubbles: true})); return 'filled'; })()\"},\"session\":\"$SESSION\"}"
```

### 截图

```bash
curl -s -X POST http://127.0.0.1:10086/command \
  -H 'Content-Type: application/json' \
  -d "{\"action\":\"screenshot\",\"args\":{\"format\":\"png\",\"path\":\"/tmp/webui.png\"},\"session\":\"$SESSION\"}"
```

返回的 `path` 可以用 `ReadMediaFile` 读取，直接查看界面效果。

### 获取页面 HTML / 检查 Vue 状态

```bash
curl -s -X POST http://127.0.0.1:10086/command \
  -H 'Content-Type: application/json' \
  -d "{\"action\":\"evaluate\",\"args\":{\"code\":\"document.body.innerHTML.length\"},\"session\":\"$SESSION\"}"
```

## 4. 典型调试脚本示例

下面脚本打开页面、新建 session、发送 `/status`、等待回复并截图：

```python
import requests, json, time

base = 'http://127.0.0.1:10086/command'
session = 'legion-webui-debug'

def post(action, args):
    r = requests.post(base, json={'action': action, 'args': args, 'session': session})
    d = r.json()
    return d.get('data') if d.get('ok') else d

post('navigate', {'url': 'http://127.0.0.1:5173', 'newTab': True, 'group_title': 'Legion WebUI debug'})
time.sleep(2)

snap = post('snapshot', {})
# 找到 "+ New" 按钮并点击
import re
m = re.search(r'"ref":"(@e\d+)".*?"\\+ New"', json.dumps(snap))
if m:
    post('click', {'selector': m.group(1)})
    time.sleep(1)

post('evaluate', {'code': "(() => { const ta = document.querySelector('textarea'); if(ta){ ta.value='/status'; ta.dispatchEvent(new Event('input',{bubbles:true})); } return 'ok'; })()"})
time.sleep(0.5)

snap = post('snapshot', {})
m = re.search(r'"ref":"(@e\d+)".*?"Send"', json.dumps(snap))
if m:
    post('click', {'selector': m.group(1)})

time.sleep(3)
print(post('screenshot', {'format': 'png', 'path': '/tmp/webui-status.png'}))
```

## 5. 常见问题

- **页面白屏 / `.vue` 文件解析失败**：检查 `dev:webui` 是否使用了 `packages/legion-webui/vite.config.ts`（需要 `@vitejs/plugin-vue`）。不要直接用 `vp dev -- packages/legion-webui`，它不会自动加载 Vue 插件。
- **fill 对 textarea 报错**：WebBridge 的 `fill` 对标准 `<textarea>` 可能触发 `extension_error`，用 `evaluate` 直接设置 `value` 并 dispatch `input` 事件更稳定。
- **后端改了但前端没热重载**：`vp run dev` 只 watch `packages/legion/src`，前端 `pnpm --filter @0xwelt/legion-webui dev` 是独立进程。修改共享 API 包后需要两边都重启，或配置 `tsx watch` 监听整个 `packages`。

## 6. 清理

调试结束后可以关闭 WebBridge session 和 tmux：

```bash
# 关闭 WebBridge 当前任务的所有标签
curl -s -X POST http://127.0.0.1:10086/command \
  -H 'Content-Type: application/json' \
  -d '{"action":"close_session","args":{},"session":"legion-webui-debug"}'

# 停止 tmux session
tmux kill-session -t legion-dev
```
