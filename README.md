# LLM Perf Bench

基于 Cloudflare Workers 部署的 LLM 推理性能测试与打榜工具。单页面应用 + 打榜 API + Workers KV 排行榜，一键部署、匿名打榜、脱敏提交。

## 功能

- **推理基准测试**：三协议（openai-completions / openai-responses / anthropic）× 多轮测量（中位数+min-max+CV）× 服务端计时优先（Ⓢ）
- **打榜排行榜**：三指标分榜（解码速度 / 预填充速度 / 首 Token 延迟）× 5 档场景模板过滤 × 匿名参与（本地 UUID + 昵称，无需账号）
- **脱敏提交**：API Key / 完整端点地址 / 提示词与输出全文 **绝不上传**——提交前强制逐字段预览
- **每人每场景一条**：重复提交自动替换旧成绩，不占榜；60 秒防刷间隔 + 每日 20 次配额（软限流）
- **5 面板图表 + 4 格式导出**（PNG 2x 报告图 / CSV / Markdown / JSON），PNG 公网端点自动部分遮蔽
- **中英双语 + 三态主题** + 页内「?」部署配置帮助弹窗（统一反代模板+参数说明+排错指南）
- 奖杯 favicon、打榜双入口图标（顶栏查看 🏆 / 工具栏提交 ⬆）、导出合并菜单

## 快速开始

### ① 直接使用已部署的版本

打开 `https://<your-domain>/` → 填写你的 LLM 服务地址 + API Key → 跑测 → 打榜。

> 远端 http 端点需先配好 https 反代（[页内「?」帮助](src/llm-perf-bench.html) 或 [deployment.md](docs/deployment.md) 内含完整 nginx 模板与参数说明）。

### ② 自部署（Cloudflare Workers 三步）

```bash
npm install
npx wrangler kv namespace create LEADERBOARD   # 将返回的 id 填入 wrangler.jsonc
npx wrangler secret put RATE_LIMIT_SALT         # 随机 ≥32 位串
npx wrangler deploy
```

部署后根路径即应用（无跳转），`/api/*` 为打榜 API。详见 [deployment.md](docs/deployment.md)。

### ③ 本地开发（开发者模式）

```bash
./serve.sh start                # 本地代理（http://127.0.0.1:8899，同源无 CORS）
node tools/worker_shim.mjs --demo --host 0.0.0.0   # 本地垫片（真实 Worker 模块+内存 KV，端口 8787）
```

## 使用方法

1. **配置接口**：选择协议（openai-completions / openai-responses / anthropic）→ 填写 Base URL + API Key + 模型名（可点「拉取」自动获取）
2. **选场景模板**：⚡快速(7点) / 📊标准(8点) / 💬聊天(8点) / 🤖Agent(9点) / 👨‍💻Coding(10点) / 自定义
3. **跑测**：点击「开始测试」，实时进度 + 图表 + 表格
4. **打榜**（可选）：跑完测试后点工具栏**上传图标**提交——预览将上传字段 → 确认提交
5. **查看榜单**：点顶栏**奖杯图标**——三指标 Tab 切换 × 场景过滤 × 我的名次高亮

## 注意事项

- **远端后端需 https**：HTTPS 页面不能直接请求非本机 `http://` 地址（混合内容硬拦截）；两种解法：端点上 https 或经本地反向代理后填 `http://127.0.0.1:8899/<backend>`
- **本地后端直连**：HTTPS 页面可以访问 `http://127.0.0.1:xxxx`（回环豁免），首次会弹"本地网络访问"授权请允许
- **API Key 安全**：密钥仅存在于页面内存，刷新即清（不持久化），也不会写入导出文件或上传排行榜
- **打榜限流**：60 秒内仅可提交一次（防刷）；每设备每天 20 次
- **静态资源走 ETag 缓存**：更新后如见旧版请强刷（Ctrl+Shift+R）
- **自定义域名**：`wrangler.jsonc` 中取消 `routes` 注释并填入你的域名（需域名 zone 托管在同一 CF 账号）

## 项目结构

```
src/
├── llm-perf-bench.html       # 单文件应用（UI + 协议引擎 + 图表 + 导出 + 打榜前端）
└── worker/
    ├── index.mjs             # Worker 入口（静态资产 + /api/* 路由 + 根路径直服）
    ├── api.mjs               # 三端点处理器（health / leaderboard / submit）
    ├── sanitize.mjs          # 服务端白名单脱敏 + 限流 + 去重
    └── kv.mjs                # KV 键模型（字典序排名 scoreKey 编码）
tools/
├── bench_proxy.mjs           # 本地同源代理（node:http，多后端路由）
└── worker_shim.mjs           # Node 垫片（真实 Worker 模块 + 内存 KV，glibc < 2.32 环境用）
tests/                        # 8 个测试文件（引擎/UI/浏览器/PNG/Worker 单测/e2e/冒烟/截图）
docs/
└── deployment.md             # 部署指南（CF Workers + 反代模板 + 本地开发，中英双语）
.github/workflows/            # CI 自动部署（push develop → 测试门 → wrangler deploy）
```

## 运行测试

测试需要 Node ≥ 18；页面四套需本地推理后端 + `BENCH_KEY`；Worker 三套无需后端。

```bash
npm install

# Worker 侧（无需推理后端）
node --test tests/worker_api_test.js
node tests/worker_e2e_test.js
node tests/leaderboard_smoke.mjs

# 页面四套（需本地推理后端，默认 ninfer 127.0.0.1:30001）
node tests/bench_engine_test.js
node tests/bench_ui_test.js        # 需 /tmp/jsdom-env（npm i jsdom）
node tests/bench_browser_test.js   # 需 /tmp/pw-env（playwright-core）+ ./serve.sh start
node tests/bench_png_layout_test.js # 同上

node tests/leaderboard_shots.mjs   # 排行榜验收截图重生成（垫片源）
```

## 开发规范

- 所有任务必须：**制定清单 → 独立 Agent 二审 → 逐一执行 → 独立审核 → 交叉验证**
- 禁止虚假审核、禁止自我以为、禁止跨流程执行
- 经验教训必须沉淀到 `docs/03-lessons/LESSONS.md`
- 服务切换必须登记 `docs/00-plans/TASKS.md` 切换日志
- 会话入口协议详见 `CLAUDE.md`/`AGENTS.md`

## 许可

[GPL-3.0](LICENSE) — 基于 [chaoshen999/llm-tools](https://github.com/chaoshen999/llm-tools)（GPL-3.0）重构。
