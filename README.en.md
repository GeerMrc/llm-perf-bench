# LLM Perf Bench

LLM inference benchmarking and leaderboard deployed on Cloudflare Workers. Single-page app + leaderboard API + Workers KV ranking — one-command deploy, anonymous submissions, sanitized uploads.

## Features

- **Inference benchmarking**: three protocols (openai-completions / openai-responses / anthropic) × multi-run measurement (median + min-max + CV) × server-side timing preferred (Ⓢ)
- **Leaderboard**: three metric boards (Decode / Prefill / TTFT) × 5 preset filters × anonymous participation (local UUID + nickname, no account needed)
- **Sanitized submissions**: API keys / full endpoint URLs / prompts & outputs are **never uploaded** — mandatory field-by-field preview before submitting
- **One entry per user per preset**: resubmitting replaces your old record; 60s anti-spam interval + 20/day soft quota
- **5 chart panels + 4-format exports** (PNG 2x report / CSV / Markdown / JSON), automatic partial masking of public endpoints in PNG
- **Bilingual (中文/English) + tri-state theme** + in-page "?" deployment help dialog (unified reverse-proxy template + parameter reference + troubleshooting)
- Trophy favicon, dual board entries (topbar 🏆 view / toolbar ⬆ submit), merged export menu

## Quick Start

### ① Use a deployed instance

Open `https://<your-domain>/` → enter your LLM service URL + API key → run → submit to the board.

> Remote http endpoints need an https reverse proxy first (see the in-page "?" help or [deployment.md](docs/deployment.md) for the complete nginx template).

### ② Self-deploy (Cloudflare Workers, three steps)

```bash
npm install
npx wrangler kv namespace create LEADERBOARD   # put the returned id into wrangler.jsonc
npx wrangler secret put RATE_LIMIT_SALT         # random string >= 32 chars
npx wrangler deploy
```

The root URL IS the app (no redirect); `/api/*` is the leaderboard API. See [deployment.md](docs/deployment.md).

### ③ Local development (developer mode)

```bash
./serve.sh start                # local proxy (http://127.0.0.1:8899, same-origin, no CORS)
node tools/worker_shim.mjs --demo --host 0.0.0.0   # local shim (real Worker modules + in-memory KV, port 8787)
```

## How to Use

1. **Configure**: pick a protocol → enter Base URL + API Key + model name (or click "Fetch")
2. **Pick a preset**: ⚡Quick(7pt) / 📊Standard(8pt) / 💬Chat(8pt) / 🤖Agent(9pt) / 👨‍💻Coding(10pt) / Custom
3. **Run**: click "Start Test" — live progress + charts + table
4. **Submit** (optional): after a run, click the toolbar **upload icon** — preview the sanitized fields → confirm
5. **View the board**: click the topbar **trophy icon** — three metric tabs × preset filters × your rank highlighted

## Notes

- **Remote backends need https**: an HTTPS page cannot fetch non-loopback `http://` URLs (mixed-content hard block); fix = https on the endpoint, or go through a local reverse proxy (`http://127.0.0.1:8899/<backend>`)
- **Local backends**: HTTPS pages CAN access `http://127.0.0.1:xxxx` (loopback exempt); allow the one-time "local network access" prompt
- **API key safety**: the key lives only in page memory (never persisted, never exported, never uploaded to the board)
- **Rate limiting**: one submission per 60s (anti-spam); 20/day per device
- **Static assets are ETag-cached**: force-reload (Ctrl+Shift+R) after updates
- **Custom domain**: uncomment `routes` in `wrangler.jsonc` and enter your domain (zone must be on the same CF account)

## Project Layout

```
src/
├── llm-perf-bench.html       # single-file app (UI + protocol engine + charts + exports + board frontend)
└── worker/
    ├── index.mjs             # Worker entry (static assets + /api/* routing + root serves the app)
    ├── api.mjs               # three endpoint handlers (health / leaderboard / submit)
    ├── sanitize.mjs          # server-side whitelist sanitization + rate limiting + dedup
    └── kv.mjs                # KV key model (lexicographic ranking scoreKey encoding)
tools/
├── bench_proxy.mjs           # local same-origin proxy (node:http, multi-backend routing)
└── worker_shim.mjs           # Node shim (real Worker modules + in-memory KV, for glibc < 2.32)
tests/                        # 8 test files (engine/UI/browser/PNG/worker unit/e2e/smoke/shots)
docs/
└── deployment.md             # deployment guide (CF Workers + proxy template + local dev, bilingual)
.github/workflows/            # CI auto-deploy (push develop → test gates → wrangler deploy)
```

## Running Tests

Node >= 18 required; the four page suites need a live inference backend + `BENCH_KEY`; the three Worker suites do not.

```bash
npm install

# Worker side (no inference backend needed)
node --test tests/worker_api_test.js
node tests/worker_e2e_test.js
node tests/leaderboard_smoke.mjs

# Page suites (need a live backend, default ninfer 127.0.0.1:30001)
node tests/bench_engine_test.js
node tests/bench_ui_test.js        # needs /tmp/jsdom-env (npm i jsdom)
node tests/bench_browser_test.js   # needs /tmp/pw-env (playwright-core) + ./serve.sh start
node tests/bench_png_layout_test.js # same

node tests/leaderboard_shots.mjs   # leaderboard acceptance screenshots (shim origin)
```

## Development Conventions

- Every task follows: **plan → independent agent review → execute item by item → independent audit → cross-validation**
- No fabricated reviews, no assumptions, no out-of-order execution
- Lessons must be recorded in `docs/03-lessons/LESSONS.md`
- Service switches must be logged in `docs/00-plans/TASKS.md`
- Session entry protocol: see `CLAUDE.md`/`AGENTS.md`

## License

[GPL-3.0](LICENSE) — reworked from [chaoshen999/llm-tools](https://github.com/chaoshen999/llm-tools) (GPL-3.0).
