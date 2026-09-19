# 部署指南 / Deployment Guide

## 中文

### 环境要求

| 依赖 | 版本 | 用途 |
|---|---|---|
| Node.js | ≥ 18 | 运行同源代理 `tools/bench_proxy.mjs`（纯 node:http，无任何第三方依赖） |
| 现代浏览器 | Chrome/Edge/Firefox 最新版 | 运行测试页面（纯前端，无构建步骤） |
| 推理后端 | SGLang / ninfer / vLLM / Ollama / LM Studio 任一 | 被测服务 |

> 本地模式无需 npm install、无需构建（纯 node:http 代理）。仓库现已含 `package.json`（仅 dev 依赖 wrangler/miniflare，用于 Cloudflare Workers 开发部署；应用运行时保持零依赖）。

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

### Cloudflare Workers 部署（打榜版完整章节）

**前提**：Cloudflare 账号（Free 档即可）；Node ≥ 18（本地操作用）；应用运行时保持零依赖（package.json 仅 dev 依赖 wrangler/miniflare）。

**手动部署三步**：

```bash
npm install                                    # 安装 dev 依赖
npx wrangler kv namespace create LEADERBOARD   # 记下返回的 id，替换 wrangler.jsonc 中的 PLACEHOLDER_SET_AT_DEPLOY
npx wrangler secret put RATE_LIMIT_SALT         # IP 哈希盐（仅瞬态限流用，不入存储；建议 ≥32 位随机串）
npx wrangler deploy
```

- 部署后根路径即应用（`https://<域名>/` 直接渲染，无跳转；`/src/llm-perf-bench.html` 直连路径保留兼容）；`/api/health|leaderboard|submit` 为打榜 API；`npx wrangler deploy --dry-run` 可作无凭证配置门。
- 云端页面跑测仍由浏览器直连本地后端（Chrome 142+ 首次访问本地地址弹 Local Network Access 授权，选允许；ninfer 不发 CORS 头需本地代理模式，SGLang/vLLM/Ollama 可直连）。
- 打榜为匿名制（本地 UUID+昵称，仅 5 内置场景可打榜）；提交前强制逐字段预览；API Key/完整端点/提示词绝不上传。
- 静态资产走 ETag 缓存，更新后强刷；本地开发用 `node tools/worker_shim.mjs [--demo --host 0.0.0.0]`（真实 worker 模块+内存 KV 垫片，ADR-0001；`--demo` 附带 CORS stub 后端 8799、榜单初始为空，`--seed` 可选注入演示数据）。

### CI 自动部署（GitHub Actions，T60）

仓库内置 `.github/workflows/deploy-cf.yml`：**push 到 `develop` 分支**（文档类改动自动跳过）或手动 `workflow_dispatch` 触发——`npm ci` → Worker 单测+e2e 门（无后端依赖）→ 占位符守卫+`deploy --dry-run` 配置门 → `wrangler deploy` → 注入 `RATE_LIMIT_SALT` secret → workers.dev 健康探测。

**仓库 Secrets 配置（Settings → Secrets and variables → Actions）**：
| Secret | 内容 | 说明 |
|---|---|---|
| `CF_API_TOKEN` | API 令牌 | 最小权限分三档：仅部署=Workers Scripts:Edit；CI 代建 KV=+KV Storage:Edit；启用自定义域名=+Zone 的 Workers Routes:Edit |
| `CF_ACCOUNT_ID` | 账户 ID | Dashboard 右侧可见 |
| `CF_RATE_LIMIT_SALT` | ≥32 位随机串 | 注入为 Worker secret（避免弱盐静默降级） |

可选 Variables：`CF_DEPLOY_URL`（如 `https://llm-perf-bench.<子域>.workers.dev` 或自定义域名）配置后 CI 末尾自动做 `/api/health` 探测。首次启用：本地 `npx wrangler kv namespace create LEADERBOARD` → 将真实 id 替换 `wrangler.jsonc` 的 `PLACEHOLDER_SET_AT_DEPLOY` → 配置三个 Secrets（+可选 Variable）→ push `develop`。**注意：CI 绿 ≠ 本地全绿**（CI 只跑无后端依赖的 worker 套件，页面四套仍需本地后端实跑）。

### 自定义域名（<your-domain-zone>，T61）

**建议**：`<your-domain>`（短、语义清晰、纯 ASCII）；备选 `llm-<your-domain>` / `perf.<your-domain-zone>`——由你拍板最终选择。

**前提**：主域 `<your-domain-zone>` 必须作为 zone 托管在**同一个** Cloudflare 账号（在 registrar 将 NS 改为 CF 分配的名称服务器；Free 档即可）。

**启用**（二选一）：
1. 配置文件（推荐）：取消 `wrangler.jsonc` 中 `routes` 注释并填入最终域名 → `npx wrangler deploy`（CF 自动为该主机创建 DNS 记录与证书）
2. Dashboard：Worker → Settings → Domains & Routes → Add → Custom domain 填 `<your-domain>`

**过渡策略**：`workers.dev` 域名默认并存（自定义域名就绪前的访问入口）；确认域名稳定后可在 `wrangler.jsonc` 加 `"workers_dev": false` 收口。自定义域名走 CF 边缘证书（HTTPS 自动），无需自备证书；公网 HTTPS 页面访问本地后端的 LNA 授权提示见上文说明。

### LLM 反向代理生产模板（T70 详版；页内「?」帮助已内置统一高可用模板，本节为逐档拆解详解）

为任意后端（SGLang / ninfer / vLLM / Ollama / LM Studio）提供 https + CORS + SSE 的 nginx 反代配置。**两档**：bench 档够用于本工具跑测；agent 档面向 claude code / codex / DeepSeek harness 等长流场景。

**bench 档（基础，`/etc/nginx/conf.d/<域名>.conf`）**：

```nginx
server {
    listen 443 ssl http2;
    server_name api.example.com;
    ssl_certificate     /etc/nginx/certs/api.example.com.pem;    # 阿里云/LE 证书
    ssl_certificate_key /etc/nginx/certs/api.example.com.key;

    # CORS 四件套 + Vary（always 保证 204/4xx 也带）
    add_header Access-Control-Allow-Origin $http_origin always;
    add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
    add_header Access-Control-Allow-Headers "authorization,content-type,x-api-key,anthropic-version,accept" always;
    add_header Access-Control-Max-Age "600" always;
    add_header Vary "Origin" always;

    client_max_body_size 20m;     # 256K-token 请求体约 1-2MB；默认 1m 会 413

    location / {
        if ($request_method = OPTIONS) { return 204; }   # 预检在代理层应答，绝不打到后端

        # 防双 ACAO：后端（如 SGLang）自带一套 CORS 头时，必须先隐藏再补自己的一套
        proxy_hide_header Access-Control-Allow-Origin;
        proxy_hide_header Access-Control-Allow-Credentials;
        proxy_hide_header Access-Control-Allow-Methods;
        proxy_hide_header Access-Control-Allow-Headers;
        proxy_hide_header Access-Control-Max-Age;

        proxy_pass http://127.0.0.1:28089;      # 后端本机端口
        proxy_http_version 1.1;

        # SSE / 基准测量正确性：响应禁缓冲
        proxy_buffering off;
        proxy_set_header Connection '';
        chunked_transfer_encoding on;

        proxy_connect_timeout 60s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
    }
}
# 另加一个 80→443 跳转 server 块（listen 80; return 301 https://$host$request_uri;）
```

**agent 档增强项**（在 bench 档基础上追加，服务 claude code / codex / DeepSeek harness 等长上下文/长生成/多并发场景）：

```nginx
    # —— 长流与并发强化（server 或 location 级）——
    proxy_read_timeout 1800s;          # 长生成防读超时掐断（30 分钟）
    proxy_send_timeout 1800s;
    keepalive_timeout 300s;            # 客户端连接复用（默认 75s 偏短）
    proxy_next_upstream off;           # SSE 禁止自动重试——防同请求重复生成
    proxy_request_buffering off;       # 流式上传大提示词

    # —— 上游连接池（http 块级）——
    upstream llm_backend {
        server 127.0.0.1:28089;
        keepalive 64;                  # 到后端的长连接池，降低握手开销
    }
    # proxy_pass http://llm_backend; 并在 location 内补：
    #   proxy_set_header Connection '';（与 keepalive 池配套，勿传 close）
```

**三连验证**（配置生效后必做）：

```bash
nginx -t && nginx -s reload
# ① ACAO 恰好一条（输出必须为 1；出现 2 即双头，浏览器必拒）
curl -s -D - -o /dev/null -H "Origin: https://<your-domain>" \
  -H "Authorization: Bearer <KEY>" https://api.example.com/v1/models | grep -ic access-control-allow-origin
# ② 预检 204
curl -s -o /dev/null -w "%{http_code}\n" -X OPTIONS -H "Origin: https://<your-domain>" \
  -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: authorization,content-type" \
  https://api.example.com/v1/chat/completions
# ③ 实请求 200 + 模型列表
curl -s -H "Origin: https://<your-domain>" -H "Authorization: Bearer <KEY>" \
  https://api.example.com/v1/models
```

**排错对照表**：

| 症状 | 根因 | 处置 |
|---|---|---|
| 401/403 鉴权失败 | Key 与端点错配（最高频） | 核对该端点专属 Key；页面不保存 Key，换端点必重填 |
| 浏览器报重复 Access-Control-Allow-Origin | 后端自带 CORS + 代理又加一套 | location 内 proxy_hide_header 五行后再 add_header |
| 预检 OPTIONS 404 | 代理把预检转给了后端 | location 内 `if OPTIONS return 204` |
| 跑测中断流（连接中断/生成途中断开） | 反代读超时/中间网关掐长连接/服务端中止 | 看 access.log：无条目=未达代理（查中间层）；有条目被截断=查上游日志；超时参数按 agent 档调大 |
| https 页面填 http://内网或公网 IP | 混合内容硬拦截（与 CORS 无关） | 端点上 https，或页面填 http://127.0.0.1:8899/<backend>（回环豁免） |
| 413 Request Entity Too Large | 默认 client_max_body_size 1m | 调至 ≥20m |

### Cloudflare Workers KV 额度与存储模型

**免费额度（Workers Free / KV Free，2026-09 核对官方定价页）**：读 100,000 次/日、写 1,000 次/日、删除 1,000 次/日、列表 1,000 次/日、存储 1 GB。Workers Free 另含 100,000 请求/日（静态资产请求不计费）。

**每次打榜提交的 KV 操作（写放大）**：
| 键 | 数量 | TTL |
|---|---|---|
| `lb:{preset}:{metric}:{scoreKey}:{uuid}:{ts}`（三榜同值不同序） | 3 | 180 天 |
| `u:{uuid}:{preset}`（用户指针：指向其当前榜键，新提交替换旧成绩防重复占榜） | 1 | 180 天 |
| `rl:{ipHash}`（最小提交间隔） | 1 | 60 秒 |
| `dq:{uuid}:{yyyymmdd}`（日配额计数） | 1 | 24 小时 |

- **6 写/提交**（另含替换旧键的删除，删除额度独立 1 千/日）→ 免费写额度支撑约 **160 提交/日**；每 UUID 日配额 20 次 + 同 IP 60 秒间隔（均为软限流，防误不防恶——KV 最终一致性下计数近似）。
- **读路径**：打开排行榜 = 1 次 list（metadata 随键返回，无需逐条 get）；`/api/health` 探测不计 KV。
- **存储增长模型**：条目 value ≤2KB×3 键 + metadata ≤1KB×3 键 ≈ **9KB/提交**（原始上限，RECON-P2 修正：metadata 随三榜键各存一份）；180 天 TTL 自动回收。理论上限 1GB ≈ 11 万条未过期提交，远超实际负载；如需主动清理，删除额度 1,000 次/日充裕。
- **estRank 一致性注记**：提交返回的名次为提交时刻快照近似值；KV 边缘收敛最长 60 秒或更久，榜单刷新可能短暂不含最新提交，属预期行为。

**用户侧真实 workerd 冒烟清单**（本仓库开发机 glibc 2.31 无法运行 workerd，ADR-0001/附录 A-1——部署后请按此清单复验）：
1. `npx wrangler dev`（需 glibc ≥ 2.32 的环境）→ 打开 `http://127.0.0.1:8787/` 应直接渲染应用页（无跳转）
2. `curl -s localhost:8787/api/health` 返回 `{"ok":true,...}`
3. 顶栏奖杯图标可见、打开排行榜；跑一轮测试后点工具栏**上传图标**提交打榜 → 预览内填昵称并确认 → 榜单刷新见新条目
4. `npx wrangler deploy --dry-run` 零警告（CI 亦可跑）

---

## English

### Requirements

| Dependency | Version | Purpose |
|---|---|---|
| Node.js | ≥ 18 | Runs the same-origin proxy `tools/bench_proxy.mjs` (pure node:http, no third-party deps) |
| Modern browser | Latest Chrome/Edge/Firefox | Runs the bench page (pure frontend, no build step) |
| Inference backend | Any of SGLang / ninfer / vLLM / Ollama / LM Studio | The system under test |

> Local mode needs no `npm install` and no build (a pure node:http proxy). The repo now ships a `package.json` holding dev-only deps (wrangler/miniflare) for Cloudflare Workers development & deploy; the app runtime stays zero-dependency.

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

### CI Auto-Deploy (GitHub Actions, T60)

The repo ships `.github/workflows/deploy-cf.yml`: triggered by **pushes to `develop`** (doc-only changes skipped) or manual `workflow_dispatch` — `npm ci` → worker unit+e2e gates (backend-free) → placeholder guard + `deploy --dry-run` config gate → `wrangler deploy` → inject the `RATE_LIMIT_SALT` secret → workers.dev health probe.

**Repo secrets (Settings → Secrets and variables → Actions)**: `CF_API_TOKEN` (least privilege tiers: deploy-only = Workers Scripts:Edit; CI-created KV = +KV Storage:Edit; custom domain = +Zone Workers Routes:Edit), `CF_ACCOUNT_ID`, `CF_RATE_LIMIT_SALT` (random ≥32 chars). Optional variable: `CF_DEPLOY_URL` (e.g. `https://llm-perf-bench.<subdomain>.workers.dev` or the custom domain) enables a trailing `/api/health` probe. First enable: create the KV namespace, replace `PLACEHOLDER_SET_AT_DEPLOY` in `wrangler.jsonc`, set the three secrets (+optional variable), push `develop`. Note: CI green ≠ full local green (page suites still need the local backend).

### Custom Domain (<your-domain-zone>, T61)

**Recommendation**: `<your-domain>` (short, clear, ASCII-only); alternatives `llm-bench.` / `perf.` — your final call.

**Prerequisite**: the `<your-domain-zone>` zone must be hosted on the SAME Cloudflare account (point the registrar nameservers to CF; free tier is fine).

**Enable** (either): 1) uncomment `routes` in `wrangler.jsonc` with the final host → `npx wrangler deploy` (CF auto-creates the DNS record + edge certificate); or 2) Dashboard → Worker → Settings → Domains & Routes → Custom domain. The `workers.dev` domain stays enabled as the transition entry; add `"workers_dev": false` once the custom domain is confirmed. HTTPS is automatic via CF edge certs.

### Cloudflare Workers Deployment (leaderboard edition, full chapter)

**Prerequisites**: a Cloudflare account (free tier works); Node ≥ 18 for local tooling; the app runtime stays zero-dependency.

**Manual deploy**:
```bash
npm install                                    # dev dependencies
npx wrangler kv namespace create LEADERBOARD   # put the returned id into wrangler.jsonc (replace PLACEHOLDER_SET_AT_DEPLOY)
npx wrangler secret put RATE_LIMIT_SALT         # IP-hash salt (transient rate-limiting only; use a random string >= 32 chars)
npx wrangler deploy
```
After deploy the root URL IS the app (served inline, no redirect; the /src path stays for back-compat). Assets are ETag-cached (force-reload after updates). Local dev: `node tools/worker_shim.mjs [--demo --host 0.0.0.0]` (real worker modules + in-memory KV shim, ADR-0001; `--demo` adds the CORS stub backend on 8799 with an EMPTY board, `--seed` optionally injects demo rows).

### LLM Reverse-Proxy Production Template (T70 detailed; the in-page '?' help now ships the unified template — this section is the per-tier breakdown)

Nginx configs giving any backend (SGLang / ninfer / vLLM / Ollama / LM Studio) https + CORS + SSE. Two tiers: the bench tier suffices for this tool; the agent tier targets claude code / codex / DeepSeek harness style long streams.

**Bench tier** — take the Chinese section above as the copy-paste source; the essentials: TLS certs + the four CORS `add_header ... always` lines + `Vary Origin`; `if ($request_method = OPTIONS) { return 204; }` inside location; the five `proxy_hide_header Access-Control-Allow-*` lines BEFORE your own add_header set (prevents duplicate-ACAO when the backend ships its own CORS, e.g. SGLang); `client_max_body_size 20m`; `proxy_buffering off` + `Connection ''` + chunked for SSE/measurement correctness; 600s send/read timeouts. Add an :80 → :443 redirect server block.

**Agent tier additions**: `proxy_read/send_timeout 1800s`, `keepalive_timeout 300s`, `proxy_next_upstream off` (SSE must never auto-retry), `proxy_request_buffering off`, and an `upstream` block with `keepalive 64`.

**Three-step verification** (always run after a change): (1) `curl -s -D - -o /dev/null -H "Origin: <page>" -H "Authorization: Bearer <KEY>" https://<host>/v1/models | grep -ic access-control-allow-origin` — MUST print 1; (2) the OPTIONS preflight returns 204; (3) the real GET returns 200 with the model list.

**Troubleshooting table**: 401/403 = key/endpoint mismatch (top cause; the page never persists keys); duplicate ACAO in the browser console = add the proxy_hide_header set; OPTIONS 404 = answer preflights at the proxy; mid-run stream cuts = check the proxy access.log (no entry → never reached the proxy, inspect middle layers; truncated entry → check the upstream log) and raise timeouts per the agent tier; an https page with an http:// LAN/public URL = mixed content (use https on the endpoint or the loopback local proxy); 413 = raise client_max_body_size.

### Cloudflare Workers KV Quota & Storage Model (leaderboard backend)

**Free tier (Workers Free / KV Free)**: 100,000 reads/day, 1,000 writes/day, 1,000 deletes/day, 1,000 lists/day, 1 GB storage; Workers Free adds 100,000 requests/day (static-asset requests are free).

**KV operations per leaderboard submit (write amplification)**:

| Key | Count | TTL |
|---|---|---|
| `lb:{preset}:{metric}:{scoreKey}:{uuid}:{ts}` (three boards, same value) | 3 | 180 days |
| `rl:{ipHash}` (min submit interval) | 1 | 60 s |
| `dq:{uuid}:{yyyymmdd}` (daily quota counter) | 1 | 24 h |

- **6 writes/submit** (plus deletes of replaced keys, from the separate 1k/day delete budget) → the free write budget supports ~**160 submits/day**; per-UUID daily quota 20 + per-IP 60 s interval (both soft limits — best-effort under KV eventual consistency).
- **Read path**: opening the board = 1 list call (metadata ships with keys; no per-entry gets); `/api/health` probes cost no KV.
- **Storage growth**: value ≤2KB×3 + metadata ≤1KB×3 ≈ **9KB/submit** (raw ceiling); the 180-day TTL reclaims automatically. 1 GB ≈ 110k unexpired submits — far beyond realistic load; the 1,000 deletes/day budget is ample for manual cleanup.
- **estRank note**: the rank returned at submit time is an approximate snapshot; KV edge convergence takes up to 60s or longer, so a board refresh may briefly miss the newest submission — expected behavior.

**User-side real-workerd smoke checklist** (this repo's dev host runs glibc 2.31 and cannot execute workerd — ADR-0001/Appendix A-1; re-verify after deploy):
1. `npx wrangler dev` (needs glibc ≥ 2.32) → `http://127.0.0.1:8787/` should render the app directly (no redirect)
2. `curl -s localhost:8787/api/health` → `{"ok":true,...}`
3. Topbar trophy visible → open the board; after a run click the toolbar upload icon to submit → set nickname in the preview → confirm → refresh shows the new entry
4. `npx wrangler deploy --dry-run` with zero warnings (CI-friendly)

