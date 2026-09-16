# TASKS.md — 任务唯一事实来源

## §0 铁律

1. **独立 Agent 循环**：规划 → 清单二审 → 逐一执行 → 回顾审核 → 交叉验证 → 汇报。执行者不得自审。
2. **100% 完成**：所有任务清单必须 100% 高质量执行完毕。未完成→追问原因→继续推进。
3. **禁止虚假审核**：编造审计结论 = 流程作废。审计一律由独立 Agent 出报告落盘。
4. **经验沉淀**：所有开发教训必须写入 `docs/03-lessons/LESSONS.md`，避免同类错误重犯。
5. **服务切换**：ninfer/SGLang 停/起动作登记下方切换日志表。

## 任务表

| ID | 任务 | 验收标准 | 状态 | 证据 |
|---|---|---|---|---|
| T1 | 初始版本 v1.0.0 | 三协议+多轮+图表+导出+双语+主题+模板+钳制 | ✅ | src/llm-perf-bench.html, evidence/ |
| T2 | 项目 Git 化 | main + develop 分支，初始 commit | ✅ | git log |
| T3 | Harness 文档 | TASKS.md + LESSONS.md 创建 | ✅ | docs/ |
| T4 | 摘要区 stat-cards 风格改版 | flex-wrap 分隔卡片网格（标签上/值下），纯 CSS 改动，双语×三主题×三视口验证无空洞无溢出，三套测试全绿 + 独立 Agent 二审 PASS | ✅ | feature/summary-cards → develop（a632bb0），evidence/summary-cards/ |
| T4b | 摘要区改版用户回访两轮调优 | v2 内容自适应卡被否（宽度 1:3.7 参差/分隔线无韵律/行尾悬空）→ v3 统一列宽响应式网格（kv-grid 范式，minmax(230px,1fr)，无分隔线）；列宽全宽度一致、列数 2/4/7/9 自适应、URL 全宽度可读；三套测试全绿 + 独立二审 PASS | ✅ | feature/summary-cards-v2 → develop，evidence/summary-cards-v3/ |
| T4c | 摘要区定稿：均分两行 + 居中 + 通栏分隔网格 | 用户给出明确规格：数条目均分（12→6+6）、通栏自适应边框、内容居中，即完全复用 KPI 卡构造。新增 layoutSummaryGrid()：按"最少行数→最少空格"选列数（单元格下限 230px 保 URL 可读），末项跨列收齐行尾，ResizeObserver 随宽度重算；实测 6+6@1920（侧栏展开）、4+4+4@1280、2×6@640、稀疏 3+2，全部齐平居中零溢出，三套测试全绿 | ✅ | feature/summary-cards-v3 → develop，evidence/summary-cards-v4/ |
| T5 | i18n 键漂移修复（follow-up） | EN 词典补 `chart.tpot.title`；ZH 词典补 `a11y.collapseShort`；双语键数一致 | ✅ | EN 补 `chart.tpot.title:"TPOT (ms)"`（随 T12，导出第 4 面板曾显示原始 key，png-layout 测试断言）；`a11y.collapseShort` 经 T13 全量引用审核确认为双侧死键（UI 仅用 `a11y.collapse`）→ 已随 T13 死键清理删除；最终词典 zh/en 各 197 键完全对称 |
| T6 | 快速模板提示文案过期（follow-up） | `tip.preset` 文案与实际预设一致 | ✅ | 随 T13 完成 2026-09-17：zh/en 双语按 5 档实际预设重写（⚡128–8K 7 点 / 📊256–32K 8 点 / 💬512–64K 8 点 / 🤖512–128K 9 点 / 👨‍💻512–256K 10 点），原文案为旧版 4 档预设（"3 个点/深度扫描/长上下文"均已不存在） |
| T7 | 测试副本同步机制（follow-up） | 引擎/UI 套件读取未跟踪的 tests/llm-perf-bench.html，改为直读 ../src/ 或加同步检查 | ✅ | 随 T13 完成 2026-09-17：engine/ui 两套直读 `../src/llm-perf-bench.html`，browser 测试 file:// 场景运行时从 src 复制到 /data/temp（消除旧副本漂移）；tests/llm-perf-bench.html 副本删除，同步负担归零 |
| T12 | 导出 PNG 布局重构：比例/空白带/头部/页脚四项修复 | 重构 exportPng() 为 measure-first（totalH=Σ绘制同一组 L 常量，杜绝预算/绘制漂移）；删除旧版整幅堆叠遗留（chartBlock 双重计入 1592px、双重 y 前进 1502px、死代码 drawChartBlock）；四项用户缺陷全部消除：①比例 1:1.6 竖条→1.14:1 近横版（2560×2250）②图表↔表格空白带 1142px→41px（<90 断言）③头部重排：标题 26px/信息 pill 13.5px（带宽度钳制+截断）/环境信息 3×2 圆角卡片网格 13px（超长值 measureText 截断）/徽章 17px/meta 12px ④页脚 12.5px+分隔线+规范留白；表格 32/30px 行高 12.5px；新增 tests/bench_png_layout_test.js：浅/深/英三变体 ×（宽 2560 精确/高 [990,1230]/比例 [1.04,1.30]/像素级空白带扫描/主题背景色/页脚存在）+ 主题与语言高度一致性断言；三套既有测试全绿；视觉审核 PASS（judge 通道异常，经 analyze_image 三变体复核） | ✅ | src/llm-perf-bench.html exportPng()，tests/bench_png_layout_test.js，tests/bench-shots/png-layout/ |
| T11 | 进度分母近似（follow-up） | 钳制去重跳过的点（len===lastLen continue）不触发进度钩子：自定义梯度下 ≥2 个连续超限点被钳到同一点时，进度条终点 <100%、d/N 分母偏大（沿袭 status.progress 的既有近似）；修复需在反应式钳制发现上限后重算分母 | ⏳ | 二审 2026-09-16 |
| T10 | 停止按钮进度化 | 跑测期间「停止测试」按钮升级为动态进度按钮：红色底 + --on-accent 20% 亮色填充层（--p 宽度驱动，预热 2% 起步，按 点×重复次数 粒度单调推进），label 带 d/N 计数；语言切换/结束/中止均正确复位；纯 token 配色深浅色自适应；UI 回归断言（存在/推进/单调/清理）；三套测试全绿 | ✅ | feat/progress-stop-button → develop，evidence/progress-button/ |
| T9 | 配置引导提示（横幅+字段红框）自动消失 | 定责：原有功能不完善（非近期优化回归）——run 结束的成功/中止/失败路径均无清理，且 applyChip/连接自动填充绕过 input 事件清理链；修复 F1 开测即清红框、F2 ok>0 即清横幅+红框、F3 程序化修改派发 input 复用清理链（F3 覆盖 chip/连接自动填充/预设模板/代理改写四条旁路）；新增 UI 回归场景 [11b]（错误→chip 修复→重跑成功→断言自动消失）；三套测试全绿 | ✅ | fix/guidance-auto-clear → develop，bench_ui_test.js [11b] |
| T8 | 宽屏布局适配（两轮） | 第一轮 1600px 上限居中被用户否决（"缩小居中做什么"）→ 第二轮撤上限：主区随窗口自适应铺满、左右 16px 对等边距（2560 隐藏=2528px 满宽 16/16；展开=贴侧栏满宽至右缘）；侧栏 392→460px（保留），51 字符 POST 端点全状态完整可读；三套测试全绿 | ✅ | feature/layout-center-and-sidebar + feature/layout-fill-adaptive → develop，evidence/layout-center/ + layout-fill/ |
| T19 | v0.0.1 定档：最终代码质量清理 + 文档规范增强 + git 重建 | 独立 Agent 终审（逐行核对+差分验证）后执行：①修 bug 级残片（engine 测试孤立 `global.`、src 逗号表达式残片、ui 测试补 Path2D stub）②补 5 个使用中未定义的 i18n 键 detail.runsAll/runsPartial/runsTitle/srcServer/srcServerNote（曾致 UI 显示原始键名）③删确定死代码（band 局部遗留、.conn-status .mono、addBlock 失效 cls、state.abortSignal/state.status 只写字段、charts 注释补 Tpot）④chartDefs short lambda 去重 ⑤保留 row.*Min/Max/cv（JSON 契约）⑥README 双语：尺寸更正+使用方法五步+注意事项五条 ⑦基础设施清单 .py→.mjs；4 套测试全绿（ui 因 T18 Path2D 在 jsdom 缺失修复 stub 后转绿）；git 重建完成：清历史 → init main → 单提交 8d4cbbf（14 文件/6664 行）→ tag v0.0.1，.git 5.2MB→280K；推送远端待用户最终确认 | ✅ | 2026-09-17 |
| T18 | 导出 PNG 页脚仓库链接完善（用户反馈"无法跳转/缺图标"，两轮） | 第一轮：UI 底部链接真实验证正常；PNG 位图文字不可点击属格式限制→页脚加 GitHub Octocat 矢量图标（Path2D 13px）+ URL 完整含 https://。第二轮定根因：用户抄写的 'lIm-perf-bench' 实为 'llm' 被 sans-serif 字形混淆（小写 l 与大写 I 在 13px 下近乎同形）→ 新增 CANVAS_MONO 常量，页脚 URL 段改等宽字体渲染 + 颜色加深 text2（测量与绘制同步切字体防段错位）；放大审核逐字符确认 'llm' 可辨；png-layout 三变体回归全绿 | ✅ | 2026-09-17 exportPng() 页脚段 + CANVAS_MONO |
| T17 | 导出 PNG 宽屏化 + 环境卡列宽/顺序/名称优化（用户反馈"图表小数值挤"） | ①整图 1200→1440（2880×2198，1.31:1 宽屏），图表面板 554→674/362→443、行高 224→244/170→186，数值标签间距显著改善；②环境卡左列（处理器/操作系统）55% 加宽——CPU 长值完整显示无截断、右列 45%；③envParts 顺序 memory↔engineModel 互换（行3：内存|模型规格，与侧栏 DOM 顺序一致）；④field.engineModel 文案"模型/量化"→"模型规格"（zh）/"Model / quant"→"Model spec"（en），侧栏 i18n 自动同步；像素断言更新（宽 2880/高 [1030,1170]/比例 [1.20,1.45]）；四套测试全绿 + 视觉审核 PASS | ✅ | 2026-09-17 |
| T16 | 导出 PNG 端点隐私脱敏（用户反馈） | 新增全局 maskEndpointForExport()：http://127.0.0.1/10.x/192.168.x/172.16-31.x/localhost/::1 保留明文（本地内网场景），https 任意 host、http 域名、http 公网 IP → host:port 置为 `***`（路径保留，报告可读）；接入 exportPng POST 行；ui 测试新增 8 条断言（回环/私网/192.168 保留 + https 域名/http 域名/公网 IP/https IP 脱敏 + localhost 保留）；README 中英隐私说明；四套测试全绿 | ✅ | 2026-09-17 |
| T15 | 导出 PNG 头部 v4 深度优化（用户反馈"不专业美观"） | 旧版五行居中堆叠（标题/pill/环境单行卡/徽章/meta）视觉锚点缺失、层级弱、CPU 截断丢信息、全灰单调 → v4 专业报告布局：①左对齐大标题 + 右上角测试时间（一行两用）②左对齐副标题行（协议·模型·模板，替代圆角 pill）③双卡并排信息区：环境信息卡 2列×3行 KV 网格（列宽 397px，CPU 长值基本完整）+ KPI 卡 2×2 彩色大数字（✓成功绿/✗失败红/⊘中止橙/测试点蓝 accent，新增 kpi.* 4 键×2 词典 201/201）④POST 端点左对齐行；无环境字段时 KPI 条全宽单行自适应；2400×2126（1.13:1），四套测试全绿 + 双主题视觉审核 PASS | ✅ | 2026-09-17 exportPng() 头部段重构 |
| T13 | v0.0.1 定档准备：功能完善 + 代码质量 + Proxy 语言统一 + 脱敏 + 文档 | ①语言/主题按钮悬停 tooltip（data-tip 委托机制，双语 tip.lang/tip.theme，删 themeBtn 原生 title 防双提示；语言切换时自动关闭快照残留）②GitHub 仓库链接：UI 底部 footer（官方 mark SVG+mono URL，hover accent，新窗口）+ PNG 导出页脚三段式（llm-perf-bench · repo · 时间），单一常量 GITHUB_REPO_URL（当前占位待替换）③后端 chips 行铺满对齐输入框④死代码清理：JS（esc/fmtSpeed/state.points/state.lastConn）+ i18n 17 死键×2（词典 197/197 对称）+ CSS（legend 组/cols-2/chip-label/--radius）⑤bench_proxy.py→bench_proxy.mjs（node:http 零依赖对等重写，SSE pipe 流式，修复 GET / 404；serve.sh 改 node）全栈统一 HTML+Node 单运行时⑥脱敏：API key 5 处→BENCH_KEY env、/tmp 与 /data/temp 路径 env 可覆盖、删含内网 IP 的代理日志、.gitignore 补 evidence/ 与 tests/bench-shots/⑦文档：README 重写（测试跑法章节）+ LICENSE(GPL-3.0) | ✅ | 阶段 1 完成 2026-09-17，待用户实测后执行阶段 2（清 git → init → tag v0.0.1） |
| T14 | v0.0.1 定档第三轮反馈修复 + 双语文档 | ①chips：ninfer→Ninfer 显示名（data-backend 保持）、LM Studio 换行修复（flex:1 1 auto + min-width:0 + nowrap，内容占比铺满单行）②PNG 再优化：W 1280→1200、PAD 40→36（收窄左右留白）、环境信息卡 3×2 两行→6×1 单行（envPad 12，卡高 54）、表格正文/表头/页脚 12.5→13px；2400×2182（1.10:1），像素断言同步（宽 2400 精确/高 [980,1180]）③双语文档：README.md（中文+English 链接）+ README.en.md（英文对等）+ docs/deployment.md（中英双语部署指南：环境要求/步骤/env 变量/五后端端口表/file:// 离线/FAQ）④gh 仓库创建：环境无 gh CLI/token，用户在本地创建 https://github.com/GeerMrc/llm-perf-bench，GITHUB_REPO_URL 已替换（UI 底部 + PNG 页脚 + 双语 README 同步）；四套测试全绿 + 视觉审核 pass（chips 单行/PNG 浅深主题） | ✅ | 2026-09-17 完成，待用户最终确认定档 |

## 服务切换日志

| 时间 | 动作 | 操作者 | 显存 | 备注 |
|---|---|---|---|---|
| 2026-09-15 04:58 | 项目重组：ninfer 停 + bench_proxy 停（PID 80622 停，idle ~2500s 门禁过） | 主会话 | 28,680→2 MiB | GPU 干净释放；重组完成后重启 |
| 2026-09-15 05:0x | 用户关机前停服：ninfer 停（PID 97711）+ bench_proxy 停（PID 97815） | 主会话 | 28,678→2 MiB | 用户指令关机前停服；idle 545s（用户授权）；GPU 干净释放；重启时先起 ninfer 再起 proxy |

## Changelog

### develop (2026-09-16, 第七轮)
**停止按钮进度化**（feat/progress-stop-button）：跑测期间红色停止按钮内嵌进度填充层——宽度由 `--p` 驱动（预热 2% → 按 (i×R+r)/(N×R) 粒度推进 → 每点完成跳格，单调不回退），label 显示「停止测试 · d/N」；填充为 `--on-accent` 20% 叠层 + 45% 亮缘，纯 token 深浅色自适应，reduced-motion 自动豁免过渡。data-i18n 移入内层 label span（applyI18n 覆写 textContent 不再破坏按钮结构），refreshDynamicText 同步运行态文案。引擎级 fake DOM 的 style 无 CSSOM API，已做能力守卫。

### develop (2026-09-16, 第六轮)
**配置引导提示自动消失**（fix/guidance-auto-clear）：用户报告"完成一轮测试后红框提示未自动消失"。排查定责为原有功能不完善（旧版代码逐行一致 + 引导 UI 从无完成态清理路径 + 快捷 chip/连接自动填充程序化设值绕过 input 清理监听）。修复：开测校验通过即清全部字段红框；一轮中出现 ≥1 个成功点即清横幅+红框（配置已被证实可用）；applyChip 与模型自动填充改为派发 input 事件复用既有清理链。新增回归场景 [11b]。

### develop (2026-09-16, 第五轮)
**撤主区 1600px 上限，恢复随窗口自适应铺满**：用户明确否决缩小居中方案——"左右边距对等页面窗口大小自适应"。主区现在始终铺满可用宽度，仅保留对称 16px 页边距（侧栏隐藏 2528px 满宽 / 展开贴侧栏满宽至右缘）。侧栏 460px 与端点完整显示保留。教训并入 L-014 精神：用户的"居中"意图需按其参照语境理解，此处实为"边距对等铺满"。

### develop (2026-09-16, 第四轮)
**宽屏布局适配**（feature/layout-center-and-sidebar）：主面板上限 1600px 并居中（侧栏隐藏时整页水平居中；展开时在侧栏右侧剩余空间对称居中；不足 1600px 时照常占满）；workspace gap 改为侧栏 margin（收起归零保证居中严格对称）；侧栏 392→460px（移动端 min(460px,94vw)），最长派生端点（51 字符 mono URL）完整显示。技术要点：居中放在 main-col 子元素上用块级 margin-inline:auto——flex 项上的 auto margin 会先于 flex-grow 吞掉剩余空间导致主列冻结在内容宽度（教训 L-015）。

### develop (2026-09-16, 第三轮·定稿)
**摘要区按用户明确规格定稿**（feature/summary-cards-v3）：数条目均分两行（12→6+6）、通栏 1px 分隔线自适应边框、单元格内容居中——与 KPI 卡同款构造。`layoutSummaryGrid()` 以"最少行数→最少空格"择列（下限 230px 保 URL 完整），末项跨列收齐行尾，ResizeObserver 随宽度重算。v3 无分隔线 airy 网格同样被用户否决（左对齐参差感），教训入 L-014（修订）。

### develop (2026-09-16, 第二轮)
**摘要区两轮用户回访调优**（feature/summary-cards-v2）：

- v2 内容自适应卡（`flex:0 1 auto` + 单元格 border 分隔）：用户否决——卡宽 65–239px（1:3.7）悬殊、分隔线间距 42–130px 无韵律、行尾悬空参差
- v3 定稿：统一列宽响应式网格 `repeat(auto-fill, minmax(230px,1fr))` + gap 8/24px + 无分隔线（复用详情弹窗 kv-grid 已接受范式；安静元信息层与下方带分隔线 KPI 卡形成层级对比）
- 实测：列宽全宽度完全一致（242px@1920），列数随视口 2(640)/4(1280)/7(1920)/9(2560) 自适应，31 字符服务地址 URL 全宽度完整可读，稀疏 5 卡自然无色块，深浅色/双语正常；三套测试终态全绿 + 独立二审 PASS（P2 误标深色证据已重拍，dt 溢出保护已采纳恢复）

### develop (2026-09-16)
**摘要区（主测试区第二行）stat-cards 风格改版**（feature/summary-cards，3 commits）：

- 纯 CSS 改造 `.statbar > .summary-grid`：flex-wrap 行内 dt/dd 文本条 → 分隔卡片网格（`gap:1px`+`background:var(--border)` 分隔线，L-004 模式；单元格标签上 10.5px 灰 / 值下 12.5px 加粗左对齐；值溢出省略 + title 悬停）
- `flex: 1 1 190px` 使每行自动撑满，5–12 项任意数量/任意视口（1920/1280/640）均无尾部空洞色块；auto-fit grid 方案因尾行空槽露出 border 色块被否（二审发现）
- `.statbar` 横向 padding 归零，与 stat-cards/chart-grid 通栏对齐；深浅色零额外适配（纯 token）
- 顺带修复 bench_browser_test.js 既有漂移（页面路径 /src/、chip data-backend 选择器、canvasTtft、7 点计数、模型断言部署无关化），套件从"不可运行"恢复为全绿
- 验证：引擎级 67 项 + UI 级（jsdom）+ 浏览器级（Chromium 实跑 ninfer）三套全绿；程序化布局断言 + 像素分析 + 双语×三主题×三视口截图；独立 Agent 二审 PASS（3×P3 均为既有问题，已登记 T5–T7）
- 测试环境恢复记录：/tmp/jsdom-env（npm i jsdom）、/tmp/pw-env（playwright-core@1.44.0 匹配 ~/.cache/ms-playwright/chromium-1117 + `cli.js install-deps chromium`）

### v1.0.0 (2026-09-15)
初始版本，基于 chaoshen999/llm-tools (GPL-3.0) 全面重构：

**协议引擎**
- 三协议适配（openai-completions / openai-responses / anthropic），端点自动派生，URL 归一化
- 统一 SSE 管线：容忍 \r\n、跳过 `:` 心跳行、按协议区分完成信号
- 模型上限感知钳制（主动+反应式），自动拉取 max_model_len
- 引导式校验：空值→侧栏展开+字段高亮；首点失败→立即停止+精准引导

**测量精度**
- 多轮测量（默认 ×3）：中位数 + min-max + CV 稳定性
- 服务端计时优先（Ⓢ）：chat 协议 ninfer 的 serverTimings 排除网络开销
- 防前缀缓存：每轮独立随机前缀

**图表**
- 5 面板专业图表（Prefill/Decode/TTFT/TPOT/E2E），单轴、log₂ X 轴
- 统计卡片行（中位数 TTFT/Prefill/Decode/成功率）
- 悬停十字线 + tooltip（含 min-max 范围 + 来源标注）
- 导出 PNG 2x 高清（含全部面板 + 表格 + 统计卡片 + 页脚）

**UI/UX**
- App Shell（100vh 应用外壳）：侧栏可收起 + 主面板
- 中英双语 + 三态主题（跟随系统/浅色/深色）
- 场景模板（5 档）：⚡快速 / 📊标准 / 💬聊天 / 🤖Agent / 👨‍💻Coding
- 全矢量图标（16px 细线轮廓风格）
- zinc 灰阶极简配色，语义色仅用于状态

**基础设施**
- bench_proxy.mjs：多后端路由（SGLang/ninfer/vLLM/Ollama/LM Studio）
- Cache-Control: no-cache 防浏览器缓存旧版
- 三级测试：引擎级（67 项）+ UI 级（jsdom）+ 浏览器级（Chromium）

**开发历程摘要**
从原始 llm-test-performance.html（3KB，单协议，无主题）经过 20+ 轮迭代：
布局重构 ×3（文档式→App Shell→比例优化）→ 图表重构 ×3（双轴→单系列→5 面板）→
图标矢量化 → i18n 审计 → 多轮测量 → 服务端计时 → TPOT 新增 → UI 一致性统一 →
模型名标准化（Qwen3.8-27B-NVFP4）→ 项目 Git 化
