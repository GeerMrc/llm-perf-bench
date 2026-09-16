# LLM Perf Bench

[English](README.en.md) | 简体中文

单文件、零依赖的 LLM 推理性能基准测试工具（浏览器端运行，`file://` 可离线打开；可选 Node 同源代理绕过 CORS）。

仓库：https://github.com/GeerMrc/llm-perf-bench

## 功能

- **三协议兼容**：openai-completions / openai-responses / anthropic（端点自动派生）
- **多轮测量**：每点 N 次重复（默认 ×3），中位数 + min-max 不确定度 + CV 稳定性指标
- **服务端计时优先**（Ⓢ）：ninfer chat 协议的 `serverTimings` 排除网络/代理开销
- **5 面板专业图表**：Prefill / Decode / TTFT / TPOT / E2E（单轴、log₂ X 轴、悬停取值）
- **4 格式导出**：
  - PNG（2x 高清，1440×~1100 CSS／2880 实际像素，1.31:1 宽屏报告：环境信息卡片 + KPI 统计 + 5 面板 + 结果表 + 仓库页脚，深浅主题跟随当前界面；**公网端点自动脱敏**——`https://`、域名、公网 IP 显示为 `***`，仅保留 `http://` 内网/回环地址，安心分享）
  - CSV / Markdown / JSON（含逐轮原始数据）
- **中英双语** + **三态主题**（跟随系统/浅色/深色），全量控件悬停提示（含语言/主题切换按钮）
- **场景模板**：⚡快速验证 / 📊标准 / 💬聊天 64K / 🤖Agent 128K / 👨‍💻Coding 256K
- **模型上限感知钳制**：自动检测 max_model_len，超限点钳制到安全边界
- **引导式校验**：空值→展开侧栏+高亮字段；首点失败→立即停止+精准引导
- **多后端同源代理**：`tools/bench_proxy.mjs`（零依赖 node:http）支持 SGLang/ninfer/vLLM/Ollama/LM Studio 按路径路由，SSE 流式透传

## 快速开始

```bash
# 方式一：起同源代理（推荐，绕过 CORS，局域网可访问）
./serve.sh start            # 等价于 node tools/bench_proxy.mjs（BENCH_PORT=8899）

# 浏览器打开
open http://127.0.0.1:8899/          # 首页自动跳转到 src/llm-perf-bench.html

# 方式二：直接 file:// 打开（需后端服务支持 CORS）
open src/llm-perf-bench.html
```

详细部署步骤见 [docs/deployment.md](docs/deployment.md)。

## 使用方法

1. **配置接口**：在左侧「接口」卡片选择协议（openai-completions / openai-responses / anthropic），点击后端 chip（SGLang / Ninfer / vLLM / Ollama / LM Studio）自动填入地址，或手动填写 Base URL
2. **连接测试**：填写 API Key 与模型名称（可点「拉取」自动获取模型列表），点「测试连接」确认连通
3. **选择模板**：按场景选 ⚡快速 / 📊标准 / 💬聊天 / 🤖Agent / 👨‍💻Coding，或自定义输入长度范围（倍进步长）
4. **开始测试**：跑测期间按钮变为进度按钮，可随时中止；完成后查看 5 面板图表与结果表，点击行可看逐轮详情
5. **导出结果**：工具栏导出 PNG / CSV / MD / JSON；（可选）在「环境信息」卡片填写硬件与引擎信息，会呈现在 PNG 报告头部

## 注意事项

- **API Key 安全**：密钥仅保存在浏览器本地（localStorage），不会上传到任何第三方，也不会写入导出文件
- **file:// 限制**：直接双击打开 HTML 时浏览器直连后端，需后端支持 CORS（SGLang/vLLM/Ollama 默认支持；Ninfer 请走代理模式）
- **PNG 端点脱敏**：导出 PNG 会自动将公网端点（https、域名、公网 IP）显示为 `***`；仅 `http://` 内网/回环地址保留明文
- **模型上限钳制**：超出被测模型 max_model_len 的测试点会自动钳制到安全边界（表格中以 ↓ 标记）
- **多轮测量**：默认每点 ×3 轮取中位数；逐轮原始数据见详情弹窗与 JSON 导出

## 项目结构

```
src/           # 主交付物（单 HTML 文件，零依赖）
tools/         # bench_proxy.mjs（多后端同源代理，node:http 零依赖）
tests/         # 4 套测试：引擎级 / UI 级（jsdom）/ 浏览器级（Chromium）/ PNG 布局回归
docs/          # 部署指南 / 任务追踪（00-plans）/ 经验教训（03-lessons）
evidence/      # 迭代截图证据（本地保留，不入库）
```

## 运行测试

测试需要：Node ≥ 18、本地推理后端（默认 ninfer `127.0.0.1:30001`）、playwright-core 与 jsdom 依赖目录（默认 `/tmp/pw-env`、`/tmp/jsdom-env`，可用 `PW_MODULE` / `JSDOM_MODULE` 环境变量覆盖）。

```bash
export BENCH_KEY=sk-xxxx          # 本地后端 API key（不入库，运行时注入）
./serve.sh start                  # 浏览器级与 PNG 布局测试依赖代理

node tests/bench_engine_test.js   # 引擎级：协议引擎 × 三协议（stub DOM，直打后端）
node tests/bench_ui_test.js       # UI 级：jsdom 全交互流（读写 ../src/llm-perf-bench.html）
node tests/bench_browser_test.js  # 浏览器级：真实跑批 + 4 格式导出 + 双语 + 主题
node tests/bench_png_layout_test.js  # PNG 导出布局回归：双主题 × 英文变体 + 像素级空白带扫描
```

## 开发规范

- 所有任务必须：**制定清单 → 独立 Agent 二审 → 逐一执行 → 独立审核 → 交叉验证**
- 禁止虚假审核、禁止自我以为、禁止跨流程执行
- 经验教训必须沉淀到 `docs/03-lessons/LESSONS.md`
- 服务切换（ninfer/SGLang）必须登记 `docs/00-plans/TASKS.md` 切换日志

## 许可

[GPL-3.0](LICENSE) — 基于 [chaoshen999/llm-tools](https://github.com/chaoshen999/llm-tools)（GPL-3.0）重构。
