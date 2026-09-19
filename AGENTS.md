# CLAUDE.md — 会话入口协议（本项目最高操作规范）

> 本文件与 `AGENTS.md` 为同内容双入口（覆盖异构 Agent 工具）。任何会话（执行/审核/交叉验证）开工前必须先读本文件并遵循其中协议。

## 0. 项目概览

LLM Perf Bench **v0.1.0**：基于 Cloudflare Workers 的 LLM 推理性能测试与打榜工具（Workers 静态资产 + 同源 API + KV 排行榜）。GPL-3.0。

## 1. 铁律（TASKS.md §0，共 7 条）

1. **独立 Agent 循环**：规划 → 清单二审 → 逐一执行 → 回顾审核 → 交叉验证 → 汇报。执行者不得自审。
2. **100% 完成**：所有任务清单必须 100% 高质量执行完毕。未完成→追问原因→继续推进。
3. **禁止虚假审核**：编造审计结论 = 流程作废。审计一律由独立 Agent 出报告落盘（`docs/00-plans/`）。
4. **经验沉淀**：所有开发教训必须写入 `docs/03-lessons/LESSONS.md`。
5. **服务切换**：ninfer/SGLang/wrangler dev/serve.sh 等停/起动作登记 TASKS.md 切换日志表。
6. **单任务串行与五项 DoD 门禁**：同一时刻仅一个任务 🔄；置 ✅ 需五项 DoD 齐备（①代码完成 ②相关测试全绿 ③独立 Agent 审核 PASS ④证据落盘 tracked ⑤TASKS 行更新+原子 commit）。
7. **基线冻结与变更留痕**：计划基线正文只读，调整只追加其附录 A；git 历史清理/rewind/force-push 属重大变更，须用户确认并同步改写证据列。

## 2. 跨会话冷启动序列

1. 读本文件（或 AGENTS.md）
2. 读 `docs/00-plans/PROGRESS.md` 最新 handoff
3. 读 `docs/00-plans/TASKS.md` 任务表
4. `git log --oneline -5`
5. 恢复 🔄 断点或取下一个 ⏳ 任务
6. **任何会话无权凭记忆推进，文件即状态**

## 3. 异常收尾恢复协议

发现 🔄 无 handoff / 工作区脏 / 证据悬空 → **禁止推进**：快照→溯核→补写恢复条目→恢复流程。

## 4. 任务生命周期与仲裁规则

- ⏳→🔄→✅/⛔；置 ✅ 需五项 DoD（铁律 6）
- 任务状态权威 = TASKS.md；进行中断点权威 = PROGRESS.md 最新 handoff
- 台账定界：会话级过程只进 PROGRESS；特性级摘要只进 TASKS Changelog；计划偏离只进附录 A

## 5. 变更与提交规范

- 计划正文冻结；变更只追加附录 A；影响验收标准/范围须用户确认
- 小修快通道判据（全部满足）：≤50 行、不触验收标准/对外接口/依赖清单/基线承诺项
- commit 前缀：任务 `T{n}:`、子任务 `T{n}a:`、追踪/文档类 `docs:`
- 分支规范：`feature/*` 开发 → Phase 收尾对账通过后合入 `develop`；`main` 合并/tag/推送远端待用户最终确认

## 6. 对账机制

- 全量对账（每 Phase 收尾，独立 Agent）：输入 = TASKS 表 + git log + 测试实跑 + 计划基线
- 轻量对账：每累计 5 条 handoff 或 10 个任务 commit 触发
- CI 绿 ≠ 本地全绿（CI 只跑无后端依赖的 Worker 套件）

## 7. 测试命令与环境

```bash
npm install

# Worker 侧（无需推理后端）
node --test tests/worker_api_test.js
node tests/worker_e2e_test.js
node tests/leaderboard_smoke.mjs

# 页面四套（需本地后端，默认 ninfer 127.0.0.1:30001，需 BENCH_KEY 环境变量）
node tests/bench_engine_test.js
node tests/bench_ui_test.js        # 需 /tmp/jsdom-env
node tests/bench_browser_test.js   # 需 /tmp/pw-env + ./serve.sh start
node tests/bench_png_layout_test.js # 同上

node tests/leaderboard_shots.mjs   # 截图重生成（垫片源）
```

环境重建：`mkdir -p /tmp/jsdom-env && cd /tmp/jsdom-env && npm i jsdom`；`mkdir -p /tmp/pw-env && cd /tmp/pw-env && npm i playwright-core@1.44.0`。

## 8. 证据策略

- 任务行证据双锚点：commit hash + 文件路径 + 任务 ID
- 轻证据写入任务行或 handoff（tracked）
- 关键验收证据入 `docs/04-bench/`（tracked）
- 独立审核报告入 `docs/00-plans/`（tracked）

## 9. 会话收尾

在 `docs/00-plans/PROGRESS.md` 置顶追加一条 handoff，字段：日期/关联任务/基准 commit/git status 摘要/完成任务/断点/测试状态/运行中服务/决策摘要/阻塞。
