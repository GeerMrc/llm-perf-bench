# 部署指南 / Deployment Guide

## 中文

### 环境要求

| 依赖 | 版本 | 用途 |
|---|---|---|
| Node.js | ≥ 18 | 运行同源代理 `tools/bench_proxy.mjs`（纯 node:http，无任何第三方依赖） |
| 现代浏览器 | Chrome/Edge/Firefox 最新版 | 运行测试页面（纯前端，无构建步骤） |
| 推理后端 | SGLang / ninfer / vLLM / Ollama / LM Studio 任一 | 被测服务 |

> 无需 npm install、无需构建——项目刻意保持零依赖（`package*.json` 均被 gitignore）。

### 部署步骤

**1. 启动推理后端**（任选其一，记下端口）

| 后端 | 默认端口 |
|---|---|
| SGLang | 30000 |
| ninfer | 30001 |
| vLLM | 8000 |
| Ollama | 11434 |
| LM Studio | 1234 |

**2. 启动同源代理**

```bash
./serve.sh start
# 或直接：
node tools/bench_proxy.mjs
```

环境变量（可选）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `BENCH_PORT` | 8899 | 代理监听端口 |
| `BENCH_BIND` | 0.0.0.0 | 绑定地址（默认监听所有网卡，局域网可访问） |
| `BENCH_TARGET` | ninfer | `/v1/*` 裸路径的默认转发后端 |

**3. 浏览器访问**

```
http://<主机IP>:8899/            # 自动跳转到 src/llm-perf-bench.html
```

**4. 页面配置**

1. 在「接口」卡片选择协议（openai-completions / openai-responses / anthropic）
2. 点击对应后端 chip（SGLang / Ninfer / vLLM / Ollama / LM Studio）自动填入同源代理地址；或手动填写 Base URL
3. 填写 API Key 与模型名称（可点「拉取」自动获取模型列表）
4. 点「测试连接」确认连通 → 选择场景模板 → 「开始测试」

### 离线模式（file://）

直接双击打开 `src/llm-perf-bench.html` 即可，无需 Node。限制：浏览器直连后端要求后端开启 CORS（SGLang/vLLM/Ollama 默认支持；ninfer 需走代理模式）。此模式下「同源代理」开关自动禁用。

### 常见问题

| 现象 | 处理 |
|---|---|
| 端口被占用 | `BENCH_PORT=9090 ./serve.sh start` 换端口 |
| 连接测试失败 | 确认后端进程存活、端口正确；走代理时确认代理已启动（`./serve.sh status`） |
| 401/invalid_api_key | 检查 API Key；ninfer 默认密钥见其部署文档 |
| 局域网无法访问 | 检查防火墙放行 `BENCH_PORT`；确认 `BENCH_BIND` 未改为 127.0.0.1 |
| 页面是旧版本 | 代理已对所有响应注入 `Cache-Control: no-cache`，普通刷新即可；仍异常则强刷（Ctrl+Shift+R） |

---

## English

### Requirements

| Dependency | Version | Purpose |
|---|---|---|
| Node.js | ≥ 18 | Runs the same-origin proxy `tools/bench_proxy.mjs` (pure node:http, no third-party deps) |
| Modern browser | Latest Chrome/Edge/Firefox | Runs the bench page (pure frontend, no build step) |
| Inference backend | Any of SGLang / ninfer / vLLM / Ollama / LM Studio | The system under test |

> No `npm install`, no build — the project is deliberately zero-dependency (`package*.json` is gitignored).

### Steps

**1. Start your inference backend** (any one; note the port)

| Backend | Default port |
|---|---|
| SGLang | 30000 |
| ninfer | 30001 |
| vLLM | 8000 |
| Ollama | 11434 |
| LM Studio | 1234 |

**2. Start the same-origin proxy**

```bash
./serve.sh start
# or directly:
node tools/bench_proxy.mjs
```

Optional environment variables:

| Variable | Default | Description |
|---|---|---|
| `BENCH_PORT` | 8899 | Proxy listen port |
| `BENCH_BIND` | 0.0.0.0 | Bind address (all interfaces by default — LAN accessible) |
| `BENCH_TARGET` | ninfer | Default backend for bare `/v1/*` paths |

**3. Open in the browser**

```
http://<host-ip>:8899/            # serves src/llm-perf-bench.html
```

**4. Configure the page**

1. Pick a protocol in the Endpoint card (openai-completions / openai-responses / anthropic)
2. Click the backend chip (SGLang / Ninfer / vLLM / Ollama / LM Studio) to auto-fill the proxied Base URL, or type one manually
3. Enter the API key and model name (or click "Fetch" to list models)
4. "Test connection" → pick a preset → "Start"

### Offline mode (file://)

Double-click `src/llm-perf-bench.html` — no Node required. Limitation: the browser connects to the backend directly, which requires CORS on the backend (SGLang/vLLM/Ollama enable it by default; ninfer needs proxy mode). The proxy toggle is disabled automatically in this mode.

### Troubleshooting

| Symptom | Fix |
|---|---|
| Port already in use | Restart with `BENCH_PORT=9090 ./serve.sh start` |
| Connection test fails | Ensure the backend is alive and the port is right; in proxy mode check `./serve.sh status` |
| 401 / invalid_api_key | Check the API key; see the ninfer docs for its default key |
| Not reachable from LAN | Open `BENCH_PORT` in the firewall; make sure `BENCH_BIND` is not set to 127.0.0.1 |
| Page shows an old version | The proxy injects `Cache-Control: no-cache` on every response — a normal refresh is enough; if stale, hard-refresh (Ctrl+Shift+R) |
